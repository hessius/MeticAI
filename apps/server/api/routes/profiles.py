"""Profile management endpoints."""
from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException
from typing import Optional, Any
from datetime import datetime, timezone
import json
import math
import os
import logging
import asyncio
import uuid
import base64
import binascii
import ipaddress
import socket
import threading
import httpx
from urllib.parse import urlparse

# Register HEIC/HEIF support with Pillow
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass  # pillow-heif not installed; HEIC files will fail gracefully

from config import DATA_DIR, MAX_UPLOAD_SIZE
from services.meticulous_service import (
    async_list_profiles,
    async_get_profile,
    async_save_profile,
    async_create_profile,
    async_load_profile_by_id,
    async_execute_action,
    async_delete_profile,
    MachineUnreachableError,
    invalidate_profile_list_cache,
)
from services.cache_service import _get_cached_image, _set_cached_image
from services.gemini_service import get_vision_model, PROFILING_KNOWLEDGE
from services.profile_recommendation_service import recommendation_service
from services.history_service import HISTORY_FILE, load_history, save_history, compute_content_hash, update_entry_sync_fields, get_entry_by_id as _get_entry_by_id
from services.analysis_service import _perform_local_shot_analysis, _generate_profile_description, generate_estimated_target_curves
from services.settings_service import load_settings
from api.routes.shots import _prepare_profile_for_llm
from utils.file_utils import atomic_write_json, deep_convert_to_dict
from services.temp_profile_service import is_temp_profile

router = APIRouter()
logger = logging.getLogger(__name__)

_history_lock = threading.Lock()

IMAGE_CACHE_DIR = DATA_DIR / "image_cache"

# Simple placeholder SVG for profiles without images (coffee bean icon)
PLACEHOLDER_SVG = b'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256">
<rect width="256" height="256" fill="#2d2d2d"/>
<path fill="#6b5b47" d="M128 32c-53 0-96 43-96 96s43 96 96 96 96-43 96-96-43-96-96-96zm0 176c-44.2 0-80-35.8-80-80s35.8-80 80-80 80 35.8 80 80-35.8 80-80 80z"/>
<path fill="#8b7355" d="M128 56c-39.8 0-72 32.2-72 72s32.2 72 72 72 72-32.2 72-72-32.2-72-72-72zm0 128c-30.9 0-56-25.1-56-56s25.1-56 56-56 56 25.1 56 56-25.1 56-56 56z"/>
<ellipse cx="128" cy="128" rx="32" ry="40" fill="#6b5b47"/>
</svg>'''


def _parse_data_image_uri(image_uri: str) -> tuple[str, bytes]:
    """Parse and decode a base64 data:image URI.

    Returns:
        Tuple of (mime_type, decoded_bytes)
    """
    try:
        header, encoded_image = image_uri.split(",", 1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid profile image data") from exc

    if not header.endswith(";base64") or not header.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Invalid profile image data")

    mime_type = header[5:-7].strip().lower()  # strip "data:" prefix and ";base64" suffix
    if not mime_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid profile image data")

    try:
        image_bytes = base64.b64decode(encoded_image, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="Invalid profile image data") from exc

    return mime_type, image_bytes


def _canonical_host(value: str) -> str:
    parsed = urlparse(value if "://" in value else f"http://{value}")
    host = (parsed.hostname or "").strip().lower()
    if host in {"", "localhost"}:
        return host
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return host.rstrip(".")


def _is_allowed_machine_image_url(image_url: str) -> bool:
    parsed = urlparse(image_url)
    if parsed.scheme not in ("http", "https"):
        return False

    target_host = (parsed.hostname or "").strip().lower()
    if not target_host:
        return False

    meticulous_ip = os.getenv("METICULOUS_IP")
    if not meticulous_ip:
        settings = load_settings()
        meticulous_ip = (settings.get("meticulousIp") or "").strip()
    if not meticulous_ip:
        return False

    allowed_host = _canonical_host(meticulous_ip)
    candidate_host = _canonical_host(target_host)
    if candidate_host == allowed_host:
        return True

    try:
        allowed_resolved = {socket.gethostbyname(allowed_host)}
    except Exception:
        allowed_resolved = set()

    try:
        candidate_resolved = {socket.gethostbyname(candidate_host)}
    except Exception:
        candidate_resolved = set()

    return bool(allowed_resolved and candidate_resolved and (allowed_resolved & candidate_resolved))


def process_image_for_profile(image_data: bytes, content_type: str = "image/png") -> tuple[str, bytes]:
    """Process an image for profile upload: crop to square, resize to 512x512, convert to base64 data URI.
    
    Args:
        image_data: Raw image bytes
        content_type: MIME type of the image
        
    Returns:
        Tuple of (base64 data URI string, PNG bytes for caching)
    """
    from PIL import Image as PILImage
    import io
    import base64 as b64
    
    # Open image with PIL
    img = PILImage.open(io.BytesIO(image_data))
    
    # Convert to RGB if necessary (for PNG with alpha channel)
    if img.mode in ('RGBA', 'LA', 'P'):
        # Create white background for transparency
        background = PILImage.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        if img.mode in ('RGBA', 'LA'):
            background.paste(img, mask=img.split()[-1])  # Use alpha channel as mask
            img = background
        else:
            img = img.convert('RGB')
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    
    # Crop to square (center crop)
    width, height = img.size
    min_dim = min(width, height)
    left = (width - min_dim) // 2
    top = (height - min_dim) // 2
    right = left + min_dim
    bottom = top + min_dim
    img = img.crop((left, top, right, bottom))
    
    # Resize to 512x512
    img = img.resize((512, 512), PILImage.Resampling.LANCZOS)
    
    # Convert to PNG bytes
    buffer = io.BytesIO()
    img.save(buffer, format='PNG', optimize=True)
    png_bytes = buffer.getvalue()
    
    # Encode to base64 data URI
    b64_data = b64.b64encode(png_bytes).decode('utf-8')
    return f"data:image/png;base64,{b64_data}", png_bytes


@router.post("/api/profile/{profile_name:path}/image")
async def upload_profile_image(
    profile_name: str,
    request: Request,
    file: UploadFile = File(...)
):
    """Upload an image for a profile.
    
    The image will be:
    - Center-cropped to square aspect ratio
    - Resized to 512x512
    - Converted to base64 data URI
    - Saved to the profile on the Meticulous machine
    
    Args:
        profile_name: Name of the profile to update
        file: Image file to upload
        
    Returns:
        Success status with profile info
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Uploading image for profile: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        # Validate file type
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(
                status_code=400,
                detail="File must be an image"
            )
        
        # Read image data with size limit
        image_data = await file.read()
        
        # Validate file size
        if len(image_data) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"Image too large. Maximum size is {MAX_UPLOAD_SIZE / (1024*1024):.0f}MB"
            )
        
        # Process image: crop, resize, encode (CPU-bound, offload to thread)
        loop = asyncio.get_running_loop()
        image_data_uri, png_bytes = await loop.run_in_executor(
            None, process_image_for_profile, image_data, file.content_type
        )
        
        # Cache the processed image for fast retrieval
        _set_cached_image(profile_name, png_bytes)
        
        logger.info(
            f"Processed image for profile: {profile_name} (size: {len(image_data_uri)} chars)",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        # Find the profile by name
        profiles_result = await async_list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        # Find matching profile
        matching_profile = None
        profile_fetch_error = None
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                # Get full profile
                full_profile = await async_get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    # Non-UUID profile IDs cause 404 on machine API
                    profile_fetch_error = f"Unable to fetch profile details. Profile ID '{partial_profile.id}' may be invalid (non-UUID). Consider deleting and recreating this profile."
                    logger.warning(
                        f"Profile found in list but fetch failed: {profile_name}",
                        extra={
                            "request_id": request_id,
                            "profile_id": partial_profile.id,
                            "error": full_profile.error
                        }
                    )
                    continue
                matching_profile = full_profile
                break
        
        if not matching_profile:
            error_detail = f"Profile '{profile_name}' not found on machine"
            if profile_fetch_error:
                error_detail = profile_fetch_error
            raise HTTPException(
                status_code=404,
                detail=error_detail
            )
        
        # Update the profile with the new image
        from meticulous.profile import Display
        
        # Preserve existing accent color if present
        existing_accent = None
        if matching_profile.display:
            existing_accent = matching_profile.display.accentColor
        
        matching_profile.display = Display(
            image=image_data_uri,
            accentColor=existing_accent
        )
        
        # Save the updated profile
        save_result = await async_save_profile(matching_profile)
        
        if hasattr(save_result, 'error') and save_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to save profile: {save_result.error}"
            )
        
        logger.info(
            f"Successfully updated profile image: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        return {
            "status": "success",
            "message": f"Image uploaded for profile '{profile_name}'",
            "profile_id": matching_profile.id,
            "image_size": len(image_data_uri)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to upload profile image: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to upload profile image"}
        )


# Image generation styles that work well for coffee/espresso profiles
IMAGE_GEN_STYLES = [
    "abstract",
    "minimalist", 
    "pixel-art",
    "watercolor",
    "modern",
    "vintage"
]


@router.post("/api/profile/{profile_name:path}/generate-image")
async def generate_profile_image(
    profile_name: str,
    request: Request,
    style: str = "abstract",
    tags: str = "",
    preview: bool = False
):
    """Generate an AI image for a profile using Google's Imagen model.
    
    Uses the google-genai SDK with the imagen-4.0-fast-generate-001 model
    to generate a square image based on the profile name and optional tags.
    
    Args:
        profile_name: Name of the profile
        style: Image style (abstract, minimalist, pixel-art, watercolor, modern, vintage)
        tags: Comma-separated tags to include in the prompt
        preview: If true, return the image as base64 without saving to profile
        
    Returns:
        Success status with generated image info (and image data if preview=true)
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Generating image for profile: {profile_name}",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "style": style,
                "tags": tags
            }
        )
        
        # Validate style
        if style not in IMAGE_GEN_STYLES:
            style = "abstract"
        
        # Parse tags
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
        
        # Build the prompt using the advanced prompt builder
        from prompt_builder import build_image_prompt_with_metadata
        
        prompt_result = build_image_prompt_with_metadata(
            profile_name=profile_name,
            style=style,
            tags=tag_list
        )
        
        if not prompt_result or not isinstance(prompt_result, dict):
            logger.error(
                "Failed to build image prompt - prompt_result is invalid",
                extra={
                    "request_id": request_id,
                    "prompt_result": prompt_result
                }
            )
            raise HTTPException(
                status_code=500,
                detail="Failed to build image generation prompt"
            )
        
        full_prompt = prompt_result.get("prompt", "")
        prompt_metadata = prompt_result.get("metadata", {})
        
        logger.info(
            f"Built image generation prompt",
            extra={
                "request_id": request_id,
                "prompt": full_prompt[:200],
                "influences_found": prompt_metadata.get("influences_found", 0),
                "selected_colors": prompt_metadata.get("selected_colors", []),
                "selected_moods": prompt_metadata.get("selected_moods", [])
            }
        )
        
        # Generate image using Imagen via google-genai SDK
        from google.genai import types as genai_types
        from services.gemini_service import get_gemini_client
        
        try:
            client = get_gemini_client()
        except ValueError:
            raise HTTPException(
                status_code=503,
                detail="AI features are unavailable. Please configure a Gemini API key in Settings."
            )
        
        response = client.models.generate_images(
            model="imagen-4.0-fast-generate-001",
            prompt=full_prompt,
            config=genai_types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="1:1",
                output_mime_type="image/png",
            ),
        )
        
        # Extract image data from response
        if not response.generated_images or len(response.generated_images) == 0:
            logger.error(
                "Image generation returned no images",
                extra={"request_id": request_id}
            )
            raise HTTPException(
                status_code=500,
                detail="Image generation completed but no image was returned by the model"
            )
        
        generated = response.generated_images[0]
        image_data = generated.image.image_bytes
        
        # Process the image (crop/resize) — CPU-bound, offload to thread
        loop = asyncio.get_running_loop()
        image_data_uri, png_bytes = await loop.run_in_executor(
            None, process_image_for_profile, image_data, "image/png"
        )
        
        # Cache the processed image for fast retrieval
        _set_cached_image(profile_name, png_bytes)
        
        logger.info(
            f"Processed generated image for profile: {profile_name} (size: {len(image_data_uri)} chars)",
            extra={"request_id": request_id}
        )
        
        # If preview mode, return the image without saving
        if preview:
            logger.info(
                f"Returning preview image for profile: {profile_name}",
                extra={"request_id": request_id, "style": style}
            )
            return {
                "status": "preview",
                "message": f"Preview image generated for profile '{profile_name}'",
                "style": style,
                "prompt": full_prompt,
                "prompt_metadata": prompt_metadata,
                "image_data": image_data_uri
            }
        
        # Find the profile and update it
        profiles_result = await async_list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        matching_profile = None
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                full_profile = await async_get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                matching_profile = full_profile
                break
        
        if not matching_profile:
            raise HTTPException(
                status_code=404,
                detail=f"Profile '{profile_name}' not found on machine"
            )
        
        # Update the display image
        from meticulous.profile import Display
        
        existing_accent = None
        if matching_profile.display:
            existing_accent = matching_profile.display.accentColor
        
        matching_profile.display = Display(
            image=image_data_uri,
            accentColor=existing_accent
        )
        
        save_result = await async_save_profile(matching_profile)
        
        if hasattr(save_result, 'error') and save_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to save profile: {save_result.error}"
            )
        
        logger.info(
            f"Successfully generated and saved profile image: {profile_name}",
            extra={"request_id": request_id, "style": style}
        )
        
        return {
            "status": "success",
            "message": f"Image generated for profile '{profile_name}'",
            "profile_id": matching_profile.id,
            "style": style,
            "prompt": full_prompt,
            "prompt_metadata": prompt_metadata
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to generate profile image: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to generate profile image"}
        )


from pydantic import BaseModel

class ApplyImageRequest(BaseModel):
    image_data: str  # Base64 data URI


@router.post("/api/profile/{profile_name:path}/apply-image")
async def apply_profile_image(
    profile_name: str,
    request: Request,
    body: ApplyImageRequest
):
    """Apply a previously generated (previewed) image to a profile.
    
    This endpoint saves a base64 image data URI to the profile's display.
    Used after previewing a generated image and choosing to keep it.
    
    Args:
        profile_name: Name of the profile
        body: Request body containing image_data (base64 data URI)
        
    Returns:
        Success status with profile info
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Applying image to profile: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        image_data_uri = body.image_data
        
        # Validate it looks like a data URI
        if not image_data_uri.startswith("data:image/"):
            raise HTTPException(
                status_code=400,
                detail="Invalid image data - must be a data URI"
            )
        
        # Extract and cache the PNG bytes from the data URI
        from PIL import Image as PILImage
        import io
        import base64 as b64
        try:
            # Format: data:image/png;base64,<data>
            header, b64_data = image_data_uri.split(',', 1)
            png_bytes = b64.b64decode(b64_data)
            
            # Validate decoded size
            if len(png_bytes) > MAX_UPLOAD_SIZE:
                raise HTTPException(
                    status_code=413,
                    detail=f"Decoded image too large. Maximum size is {MAX_UPLOAD_SIZE / (1024*1024):.0f}MB"
                )
            
            # Validate it's actually a valid PNG image
            try:
                img = PILImage.open(io.BytesIO(png_bytes))
                img.verify()  # Verify it's a valid image
                # Re-open since verify() closes the file
                img = PILImage.open(io.BytesIO(png_bytes))
                if img.format != 'PNG':
                    raise HTTPException(
                        status_code=400,
                        detail=f"Expected PNG format, got {img.format}"
                    )
            except HTTPException:
                raise
            except Exception as img_err:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid image data: {str(img_err)}"
                )
            
            _set_cached_image(profile_name, png_bytes)
        except HTTPException:
            # Re-raise HTTP exceptions to preserve the status code and error message
            # that was specifically created for the API client
            raise
        except Exception as e:
            logger.warning(f"Failed to process/cache image from apply-image: {e}")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to decode image data: {str(e)}"
            )
        
        # Find the profile and update it
        profiles_result = await async_list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        matching_profile = None
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                full_profile = await async_get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                matching_profile = full_profile
                break
        
        if not matching_profile:
            raise HTTPException(
                status_code=404,
                detail=f"Profile '{profile_name}' not found on machine"
            )
        
        # Update the display image
        from meticulous.profile import Display
        
        existing_accent = None
        if matching_profile.display:
            existing_accent = matching_profile.display.accentColor
        
        matching_profile.display = Display(
            image=image_data_uri,
            accentColor=existing_accent
        )
        
        save_result = await async_save_profile(matching_profile)
        
        if hasattr(save_result, 'error') and save_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to save profile: {save_result.error}"
            )
        
        logger.info(
            f"Successfully applied image to profile: {profile_name}",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "message": f"Image applied to profile '{profile_name}'",
            "profile_id": matching_profile.id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to apply profile image: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to apply profile image"}
        )


@router.get("/api/profile/{profile_name:path}/image-proxy")
async def proxy_profile_image(
    profile_name: str,
    request: Request,
    force_refresh: bool = False
):
    """Proxy endpoint to fetch profile image from the Meticulous machine.
    
    This fetches the image from the machine and returns it directly,
    so the frontend doesn't need to know the machine IP.
    Images are cached indefinitely on the server for fast loading.
    
    Args:
        profile_name: Name of the profile
        force_refresh: If true, bypass cache and fetch from machine
        
    Returns:
        The profile image as PNG, or 404 if not found
    """
    request_id = request.state.request_id
    from fastapi.responses import Response
    
    # Check cache first (unless forcing refresh)
    if not force_refresh:
        cached_image = _get_cached_image(profile_name)
        if cached_image:
            logger.info(
                f"Returning cached image for profile: {profile_name}",
                extra={"request_id": request_id, "from_cache": True, "size": len(cached_image)}
            )
            return Response(
                content=cached_image,
                media_type="image/png"
            )
    
    try:
        # First get the profile to find the image path
        profiles_result = await async_list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        # Find matching profile
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                full_profile = await async_get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                
                if not full_profile.display or not full_profile.display.image:
                    raise HTTPException(status_code=404, detail="Profile has no image")
                
                image_path = full_profile.display.image

                if image_path.startswith("data:image/"):
                    mime_type, image_bytes = _parse_data_image_uri(image_path)

                    _set_cached_image(profile_name, image_bytes)
                    return Response(
                        content=image_bytes,
                        media_type=mime_type
                    )
                
                if image_path.startswith(("http://", "https://")):
                    image_url = image_path
                    if not _is_allowed_machine_image_url(image_url):
                        raise HTTPException(status_code=400, detail="Profile image URL host is not allowed")
                else:
                    # Construct full URL to the machine
                    meticulous_ip = os.getenv("METICULOUS_IP")
                    if not meticulous_ip:
                        settings = load_settings()
                        meticulous_ip = settings.get("meticulousIp", "").strip()
                    if not meticulous_ip:
                        raise HTTPException(status_code=500, detail="METICULOUS_IP not configured")

                    image_url = f"http://{meticulous_ip}{image_path}"
                
                # Fetch the image from the machine
                async with httpx.AsyncClient() as client:
                    response = await client.get(image_url, timeout=10.0)
                    
                    if response.status_code != 200:
                        raise HTTPException(
                            status_code=response.status_code,
                            detail="Failed to fetch image from machine"
                        )
                    
                    raw_content_type = response.headers.get("content-type") if hasattr(response, "headers") else None
                    if not isinstance(raw_content_type, str):
                        raw_content_type = "image/png"

                    media_type = raw_content_type.split(";", 1)[0].strip() or "image/png"
                    if not media_type.startswith("image/"):
                        media_type = "image/png"

                    # Cache the image for future requests
                    _set_cached_image(profile_name, response.content)
                    
                    # Return the image with appropriate content type
                    return Response(
                        content=response.content,
                        media_type=media_type
                    )
        
        # Profile not found on machine - return placeholder instead of 404
        # This prevents browser console errors for deleted/missing profiles
        logger.debug(
            f"Profile '{profile_name}' not found on machine, returning placeholder",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        return Response(
            content=PLACEHOLDER_SVG,
            media_type="image/svg+xml"
        )
        
    except HTTPException as he:
        # If it's a "no image" case, return placeholder
        if he.status_code == 404:
            return Response(
                content=PLACEHOLDER_SVG,
                media_type="image/svg+xml"
            )
        raise
    except httpx.TimeoutException as e:
        logger.warning(
            f"Timed out while proxying profile image: {str(e)}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        raise HTTPException(status_code=504, detail="Timed out fetching profile image")
    except httpx.HTTPError as e:
        logger.warning(
            f"HTTP error while proxying profile image: {str(e)}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        raise HTTPException(status_code=502, detail="Failed to fetch image from machine")
    except Exception as e:
        logger.error(
            f"Failed to proxy profile image: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch profile image: {str(e)}"
        )


@router.get("/api/profile/{profile_name:path}/target-curves")
async def get_profile_target_curves(
    profile_name: str,
    request: Request
):
    """Return estimated target curves for a profile (no shot data needed).
    
    Used by the live-view to show goal overlay lines during a shot.
    Stage durations are estimated from exit-trigger time values.
    
    Returns:
        {status, target_curves: [{time, target_pressure?, target_flow?, stage_name}]}
    """
    request_id = request.state.request_id

    try:
        profiles_result = await async_list_profiles()
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(status_code=502, detail="Machine API error")

        for partial in profiles_result:
            if partial.name == profile_name:
                full_profile = await async_get_profile(partial.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue

                # Build dict for the analysis helper
                profile_dict: dict = {}
                for attr in ['stages', 'variables']:
                    val = getattr(full_profile, attr, None)
                    if val is not None:
                        if isinstance(val, list):
                            profile_dict[attr] = [
                                item.__dict__ if hasattr(item, '__dict__') else item
                                for item in val
                            ]
                            # Flatten nested __dict__ inside list items
                            for i, item in enumerate(profile_dict[attr]):
                                if isinstance(item, dict):
                                    for k, v in list(item.items()):
                                        if hasattr(v, '__dict__'):
                                            item[k] = v.__dict__
                                        elif isinstance(v, list):
                                            item[k] = [
                                                el.__dict__ if hasattr(el, '__dict__') else el
                                                for el in v
                                            ]
                        else:
                            profile_dict[attr] = val

                curves = generate_estimated_target_curves(profile_dict)
                return {"status": "success", "target_curves": curves}

        raise HTTPException(status_code=404, detail=f"Profile '{profile_name}' not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get target curves: {e}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/profile/{profile_name:path}")
async def get_profile_info(
    profile_name: str,
    request: Request,
    include_stages: bool = False
):
    """Get profile information from the Meticulous machine.
    
    Args:
        profile_name: Name of the profile to fetch
        include_stages: If True, include full stage/variable data for breakdown display
        
    Returns:
        Profile information including image if set
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Fetching profile info: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        profiles_result = await async_list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        # Find matching profile
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                # Get full profile
                full_profile = await async_get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                
                # Extract image from display if present
                image = None
                accent_color = None
                if full_profile.display:
                    image = full_profile.display.image
                    accent_color = full_profile.display.accentColor
                
                result = {
                    "status": "success",
                    "profile": {
                        "id": full_profile.id,
                        "name": full_profile.name,
                        "author": full_profile.author,
                        "temperature": full_profile.temperature,
                        "final_weight": full_profile.final_weight,
                        "image": image,
                        "accent_color": accent_color
                    }
                }
                
                # Optionally include full stage/variable data
                if include_stages:
                    def _serialise(obj):
                        """Recursively convert API objects to dicts."""
                        if obj is None:
                            return None
                        if isinstance(obj, (str, int, float, bool)):
                            return obj
                        if isinstance(obj, list):
                            return [_serialise(i) for i in obj]
                        if isinstance(obj, dict):
                            return {k: _serialise(v) for k, v in obj.items()}
                        if hasattr(obj, '__dict__'):
                            return {k: _serialise(v) for k, v in obj.__dict__.items() if v is not None}
                        return obj

                    if hasattr(full_profile, 'stages') and full_profile.stages:
                        result["profile"]["stages"] = _serialise(full_profile.stages)
                    if hasattr(full_profile, 'variables') and full_profile.variables:
                        result["profile"]["variables"] = _serialise(full_profile.variables)
                
                return result
        
        # Profile not found - return graceful response instead of 404
        # This prevents browser console errors when viewing history with deleted profiles
        logger.info(
            f"Profile not found on machine: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        return {
            "status": "not_found",
            "profile": None,
            "message": f"Profile '{profile_name}' not found on machine"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get profile info: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to get profile info"}
        )


@router.put("/profile/{profile_name:path}/edit")
@router.put("/api/profile/{profile_name:path}/edit")
async def edit_profile(profile_name: str, request: Request):
    """Edit an existing profile on the Meticulous machine.

    Supports updating name, temperature, final_weight, variables, and author.
    If the name changes, all matching history entries are updated too.

    Body:
        name?: str          – new profile name (non-empty)
        temperature?: float – brew temperature (70-100 °C)
        final_weight?: float – target weight (> 0)
        variables?: list    – [{key: str, value: float|str}, ...]
        author?: str        – profile author
    """
    request_id = request.state.request_id

    try:
        body = await request.json()

        # --- validation -----------------------------------------------------------
        new_name = body.get("name")
        if new_name is not None:
            if not isinstance(new_name, str) or not new_name.strip():
                raise HTTPException(status_code=400, detail="Profile name must be a non-empty string")
            new_name = new_name.strip()

        temperature = body.get("temperature")
        if temperature is not None:
            try:
                temperature = float(temperature)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Temperature must be a number")
            if temperature > 100:
                raise HTTPException(status_code=400, detail="Temperature must not exceed 100 °C")

        final_weight = body.get("final_weight")
        if final_weight is not None:
            try:
                final_weight = float(final_weight)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Final weight must be a number")
            if final_weight <= 0:
                raise HTTPException(status_code=400, detail="Final weight must be greater than 0")

        variables = body.get("variables")
        author = body.get("author")

        if all(v is None for v in [new_name, temperature, final_weight, variables, author]):
            raise HTTPException(status_code=400, detail="At least one field to update is required")

        # --- find profile by name ------------------------------------------------
        profiles_result = await async_list_profiles()
        if hasattr(profiles_result, "error") and profiles_result.error:
            raise HTTPException(status_code=502, detail=f"Machine API error: {profiles_result.error}")

        matching_profile = None
        for p in profiles_result:
            if p.name == profile_name:
                matching_profile = p
                break

        if matching_profile is None:
            raise HTTPException(status_code=404, detail=f"Profile '{profile_name}' not found on machine")

        full_profile = await async_get_profile(matching_profile.id)
        if hasattr(full_profile, "error") and full_profile.error:
            raise HTTPException(status_code=502, detail=f"Failed to fetch profile: {full_profile.error}")

        # --- apply changes directly on profile object ---------------------------
        old_name = full_profile.name

        if new_name is not None:
            full_profile.name = new_name
        if temperature is not None:
            full_profile.temperature = temperature
        if final_weight is not None:
            full_profile.final_weight = final_weight
        if author is not None:
            full_profile.author = author

        if variables is not None and hasattr(full_profile, "variables") and full_profile.variables:
            incoming = {v["key"]: v["value"] for v in variables if "key" in v and "value" in v}
            for var in full_profile.variables:
                var_key = getattr(var, "key", None)
                if var_key and var_key in incoming:
                    var.value = incoming[var_key]

        # --- persist -------------------------------------------------------------
        await async_save_profile(full_profile)
        recommendation_service.invalidate_cache()

        logger.info(
            f"Profile edited: '{old_name}' → '{full_profile.name}'",
            extra={"request_id": request_id, "profile_name": profile_name},
        )

        # --- cascade rename into history -----------------------------------------
        if new_name is not None and new_name != old_name:
            with _history_lock:
                history = load_history()
                updated = 0
                for entry in history:
                    if entry.get("profile_name") == old_name:
                        entry["profile_name"] = new_name
                        updated += 1
                if updated:
                    save_history(history)
            if updated:
                logger.info(
                    f"Updated {updated} history entries from '{old_name}' to '{new_name}'",
                    extra={"request_id": request_id},
                )

        return {
            "status": "success",
            "profile": deep_convert_to_dict(full_profile),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to edit profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


@router.post("/api/shots/analyze")
async def analyze_shot(
    request: Request,
    profile_name: str = Form(...),
    shot_date: str = Form(...),
    shot_filename: str = Form(...),
    profile_description: Optional[str] = Form(None)
):
    """Analyze a shot against its profile using local algorithmic analysis.
    
    This endpoint fetches the shot data and profile information, then performs
    a detailed comparison of actual execution vs profile intent.
    
    Args:
        profile_name: Name of the profile used for the shot
        shot_date: Date of the shot (YYYY-MM-DD)
        shot_filename: Filename of the shot
        profile_description: Optional description of the profile's intent (for future AI use)
        
    Returns:
        Detailed analysis of shot performance against profile
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Starting shot analysis",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename
            }
        )
        
        # Fetch shot data
        shot_data = await fetch_shot_data(shot_date, shot_filename)
        
        # Fetch profile from machine
        profiles_result = await async_list_profiles()
        
        logger.debug(f"Looking for profile '{profile_name}' in {len(profiles_result)} profiles")
        
        profile_data = None
        for partial_profile in profiles_result:
            # Compare ignoring case and whitespace
            if partial_profile.name.lower().strip() == profile_name.lower().strip():
                logger.debug(f"Found matching profile: {partial_profile.name} (id={partial_profile.id})")
                full_profile = await async_get_profile(partial_profile.id)
                if not (hasattr(full_profile, 'error') and full_profile.error):
                    # Convert profile object to dict
                    profile_data = {
                        "name": full_profile.name,
                        "temperature": getattr(full_profile, 'temperature', None),
                        "final_weight": getattr(full_profile, 'final_weight', None),
                        "description": None,
                        "user_preferences": None,
                        "variables": [],
                        "stages": []
                    }

                    if hasattr(full_profile, 'variables') and full_profile.variables:
                        for var in full_profile.variables:
                            var_dict = {
                                "key": getattr(var, 'key', ''),
                                "name": getattr(var, 'name', ''),
                                "type": getattr(var, 'type', ''),
                                "value": getattr(var, 'value', 0)
                            }
                            profile_data["variables"].append(var_dict)
                    
                    # Extract full stage data including dynamics and triggers
                    if hasattr(full_profile, 'stages') and full_profile.stages:
                        for stage in full_profile.stages:
                            stage_dict = {
                                "name": getattr(stage, 'name', 'Unknown'),
                                "key": getattr(stage, 'key', ''),
                                "type": getattr(stage, 'type', 'unknown'),
                            }
                            # Add dynamics - handle both direct attributes and dynamics object
                            if hasattr(stage, 'dynamics') and stage.dynamics is not None:
                                dynamics = stage.dynamics
                                if hasattr(dynamics, 'points') and dynamics.points:
                                    stage_dict['dynamics_points'] = dynamics.points
                                if hasattr(dynamics, 'over'):
                                    stage_dict['dynamics_over'] = dynamics.over
                                if hasattr(dynamics, 'interpolation'):
                                    stage_dict['dynamics_interpolation'] = dynamics.interpolation
                            else:
                                # Fallback: check for direct attributes
                                for attr in ['dynamics_points', 'dynamics_over', 'dynamics_interpolation']:
                                    val = getattr(stage, attr, None)
                                    if val is not None:
                                        stage_dict[attr] = val
                            # Add exit triggers and limits
                            for attr in ['exit_triggers', 'limits']:
                                val = getattr(stage, attr, None)
                                if val is not None:
                                    # Convert to list of dicts if needed
                                    if isinstance(val, list):
                                        stage_dict[attr] = [
                                            dict(item) if hasattr(item, '__dict__') else item
                                            for item in val
                                        ]
                                    else:
                                        stage_dict[attr] = val
                            profile_data["stages"].append(stage_dict)
                break
        
        if not profile_data:
            # Fallback: try to get profile from shot data itself
            shot_profile = shot_data.get("profile", {})
            if shot_profile:
                profile_data = shot_profile
            else:
                raise HTTPException(
                    status_code=404,
                    detail=f"Profile '{profile_name}' not found on machine or in shot data"
                )
        
        # Perform local analysis
        analysis = _perform_local_shot_analysis(shot_data, profile_data)
        
        logger.info(
            "Shot analysis completed successfully",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "stages_analyzed": len(analysis.get("stage_analyses", [])),
                "unreached_stages": len(analysis.get("unreached_stages", []))
            }
        )
        
        return {
            "status": "success",
            "analysis": analysis
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Shot analysis failed: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename,
                "error_type": type(e).__name__
            }
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Shot analysis failed"}
        )


# ============================================================================
# LLM Shot Analysis
# ============================================================================


@router.get("/api/shots/llm-analysis-cache")
async def get_llm_analysis_cache(
    request: Request,
    profile_name: str,
    shot_date: str,
    shot_filename: str
):
    """Check if a cached LLM analysis exists for the given shot.
    
    Returns the cached analysis if it exists and is not expired,
    otherwise returns null.
    """
    request_id = request.state.request_id
    
    logger.info(
        "Checking LLM analysis cache",
        extra={
            "request_id": request_id,
            "profile_name": profile_name,
            "shot_date": shot_date,
            "shot_filename": shot_filename
        }
    )
    
    cached = get_cached_llm_analysis(profile_name, shot_date, shot_filename)
    
    if cached:
        logger.info(
            "LLM analysis cache hit",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        return {
            "status": "success",
            "cached": True,
            "analysis": cached
        }
    else:
        logger.info(
            "LLM analysis cache miss",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        return {
            "status": "success", 
            "cached": False,
            "analysis": None
        }


@router.post("/api/shots/analyze-llm")
async def analyze_shot_with_llm(
    request: Request,
    profile_name: str = Form(...),
    shot_date: str = Form(...),
    shot_filename: str = Form(...),
    profile_description: Optional[str] = Form(None),
    force_refresh: bool = Form(False)
):
    """Analyze a shot using LLM with expert profiling knowledge.
    
    This endpoint performs a deep analysis of shot execution, combining:
    - Local algorithmic analysis for data extraction
    - Expert espresso profiling knowledge
    - LLM reasoning for actionable recommendations
    
    Results are cached server-side for 3 days.
    Use force_refresh=True to bypass cache and regenerate analysis.
    
    Returns structured analysis answering:
    1. How did the shot go and why?
    2. What should change about the setup (grind, filter, basket, prep)?
    3. What should change about the profile?
    4. Any issues found in the profile design itself?
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Starting LLM shot analysis",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename,
                "force_refresh": force_refresh
            }
        )
        
        # Check cache first (unless force refresh)
        if not force_refresh:
            cached_analysis = get_cached_llm_analysis(profile_name, shot_date, shot_filename)
            if cached_analysis:
                logger.info(
                    "Returning cached LLM analysis",
                    extra={"request_id": request_id, "profile_name": profile_name}
                )
                return {
                    "status": "success",
                    "profile_name": profile_name,
                    "shot_date": shot_date,
                    "shot_filename": shot_filename,
                    "llm_analysis": cached_analysis,
                    "cached": True
                }
        
        # Fetch shot data
        shot_data = await fetch_shot_data(shot_date, shot_filename)
        
        # Fetch profile from machine (with variables)
        profiles_result = await async_list_profiles()
        
        profile_data = None
        for partial_profile in profiles_result:
            if partial_profile.name.lower() == profile_name.lower():
                full_profile = await async_get_profile(partial_profile.id)
                if not (hasattr(full_profile, 'error') and full_profile.error):
                    profile_data = {
                        "name": full_profile.name,
                        "temperature": getattr(full_profile, 'temperature', None),
                        "final_weight": getattr(full_profile, 'final_weight', None),
                        "variables": [],
                        "stages": []
                    }
                    
                    # Extract variables
                    if hasattr(full_profile, 'variables') and full_profile.variables:
                        for var in full_profile.variables:
                            profile_data["variables"].append({
                                "key": getattr(var, 'key', ''),
                                "name": getattr(var, 'name', ''),
                                "type": getattr(var, 'type', ''),
                                "value": getattr(var, 'value', 0)
                            })
                    
                    # Extract stages with full details
                    if hasattr(full_profile, 'stages') and full_profile.stages:
                        for stage in full_profile.stages:
                            stage_dict = {
                                "name": getattr(stage, 'name', 'Unknown'),
                                "key": getattr(stage, 'key', ''),
                                "type": getattr(stage, 'type', 'unknown'),
                            }
                            for attr in ['dynamics_points', 'dynamics_over', 'dynamics_interpolation', 'exit_triggers', 'limits']:
                                val = getattr(stage, attr, None)
                                if val is not None:
                                    if isinstance(val, list):
                                        stage_dict[attr] = [dict(item) if hasattr(item, '__dict__') else item for item in val]
                                    else:
                                        stage_dict[attr] = val
                            profile_data["stages"].append(stage_dict)
                break
        
        if not profile_data:
            raise HTTPException(
                status_code=404,
                detail=f"Profile '{profile_name}' not found on machine"
            )
        
        # Run local analysis first to extract data
        local_analysis = _perform_local_shot_analysis(shot_data, profile_data)
        
        # Prepare profile data (clean, no image)
        clean_profile = _prepare_profile_for_llm(profile_data, profile_description)
        
        # Build the LLM prompt with FULL local analysis
        prompt = f"""You are an expert espresso barista and profiling specialist analyzing a shot from a Meticulous Espresso Machine.

## Expert Knowledge
{PROFILING_KNOWLEDGE}

## Profile Being Used
Name: {clean_profile['name']}
Temperature: {clean_profile.get('temperature', 'Not set')}°C
Target Weight: {clean_profile.get('final_weight', 'Not set')}g

### Profile Description
{profile_description or 'No description provided - analyze the profile structure to understand intent.'}

### Profile Variables
{json.dumps(clean_profile.get('variables', []), indent=2)}

### Profile Stages
{json.dumps(clean_profile.get('stages', []), indent=2)}

## Full Local Analysis
This is the complete algorithmic analysis of the shot. Use this data to inform your expert analysis.

IMPORTANT: Each stage includes 'cumulative_weight_at_end' which shows the total weight when that stage ended.
If a stage ended early but the cumulative weight was near the target weight, the shot likely terminated 
correctly due to reaching the final weight target - this is NORMAL and EXPECTED behavior.
A stage that appears "short" may simply mean the target yield was reached, which is the correct outcome.

{json.dumps(local_analysis, indent=2)}

---

Based on this data, provide a detailed expert analysis.

CRITICAL FORMATTING RULES:
1. You MUST use EXACTLY these 5 section headers with the exact format shown (## followed by number, period, space, then title)
2. Each section MUST have the subsection headers shown (bold text with colon, like **What Happened:**)
3. ALL content under subsections MUST be bullet points starting with "- "
4. Keep bullet points concise (1-2 sentences max per bullet)
5. Do NOT add extra sections or subsections beyond what's specified

## 1. Shot Performance

**What Happened:**
- [Stage-by-stage description of the extraction]
- [Notable events: pressure spikes, flow restrictions, early/late stage exits]
- [Final weight accuracy relative to target]

**Assessment:** [Choose exactly one: Good / Acceptable / Needs Improvement / Problematic]

## 2. Root Cause Analysis

**Primary Factors:**
- [Most likely cause with brief explanation]
- [Second most likely cause if applicable]

**Secondary Considerations:**
- [Other contributing factors]
- [Environmental or equipment factors if relevant]

## 3. Setup Recommendations

**Priority Changes:**
- [Most important change - be specific with numbers when possible]
- [Second priority change]

**Additional Suggestions:**
- [Other tweaks to consider]

## 4. Profile Recommendations

**Recommended Adjustments:**
- [Specific profile changes: timing, triggers, targets]
- [Variable value changes if applicable]

**Reasoning:**
- [Why these changes would improve the shot]

## 5. Profile Design Observations

**Strengths:**
- [Well-designed aspects of this profile]

**Potential Improvements:**
- [Exit trigger or safety limit suggestions]
- [Robustness improvements]

Focus on actionable insights. Be specific with numbers where possible (e.g., "grind 1-2 steps finer" not just "grind finer").
"""
        
        # Call LLM (non-blocking)
        try:
            model = get_vision_model()
        except ValueError as e:
            raise HTTPException(
                status_code=503,
                detail={
                    "status": "error",
                    "message": str(e),
                    "error": "AI features are unavailable until GEMINI_API_KEY is configured"
                }
            ) from e
        response = await model.async_generate_content(prompt)
        
        llm_analysis = response.text if response else "Analysis generation failed"
        
        # Save to cache
        save_llm_analysis_to_cache(profile_name, shot_date, shot_filename, llm_analysis)
        
        logger.info(
            "LLM shot analysis completed and cached",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "response_length": len(llm_analysis)
            }
        )
        
        return {
            "status": "success",
            "profile_name": profile_name,
            "shot_date": shot_date,
            "shot_filename": shot_filename,
            "llm_analysis": llm_analysis,
            "cached": False
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"LLM shot analysis failed: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "profile_name": profile_name
            }
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "LLM shot analysis failed"}
        )


# ============================================================================
# Profile Import Endpoints
# ============================================================================

@router.get("/api/machine/profiles")
async def list_machine_profiles(request: Request):
    """List all profiles from the Meticulous machine with full details.
    
    Returns profiles that are on the machine but may not be in the MeticAI history.
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching all profiles from machine",
            extra={"request_id": request_id}
        )
        
        profiles_result = await async_list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        profiles = []
        for partial_profile in profiles_result:
            try:
                full_profile = await async_get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    # Fall back to partial profile data (non-UUID IDs cause 404 on get)
                    logger.warning(
                        f"Could not fetch full profile {partial_profile.name}, using partial data",
                        extra={"request_id": request_id, "profile_id": partial_profile.id}
                    )
                    full_profile = partial_profile
                
                # Check if this profile exists in our history
                in_history = False
                try:
                    history = load_history()
                    entries = history if isinstance(history, list) else history.get("entries", [])
                    profile_name = getattr(full_profile, 'name', None) or getattr(partial_profile, 'name', None)
                    in_history = any(
                        entry.get("profile_name") == profile_name 
                        for entry in entries
                    )
                except Exception:
                    pass
                
                # Convert profile to dict with full parameter data
                profile_dict = {
                    "id": getattr(full_profile, 'id', partial_profile.id),
                    "name": getattr(full_profile, 'name', partial_profile.name),
                    "author": getattr(full_profile, 'author', getattr(partial_profile, 'author', None)),
                    "temperature": getattr(full_profile, 'temperature', getattr(partial_profile, 'temperature', None)),
                    "final_weight": getattr(full_profile, 'final_weight', getattr(partial_profile, 'final_weight', None)),
                    "in_history": in_history,
                    "has_description": False,
                    "description": None
                }
                stages = getattr(full_profile, 'stages', None)
                variables = getattr(full_profile, 'variables', None)
                if stages:
                    profile_dict["stages"] = deep_convert_to_dict(stages)
                if variables:
                    profile_dict["variables"] = deep_convert_to_dict(variables)
                
                # Check for existing description in history
                if in_history:
                    try:
                        for entry in entries:
                            if entry.get("profile_name") == profile_dict["name"]:
                                profile_dict["user_preferences"] = entry.get("user_preferences")
                                if entry.get("reply"):
                                    profile_dict["has_description"] = True
                                break
                    except Exception:
                        pass
                
                profiles.append(profile_dict)
            except Exception as e:
                # Fall back to partial profile data on exception (e.g., 404 for non-UUID IDs)
                logger.warning(
                    f"Failed to fetch profile {partial_profile.name}, using partial data: {e}",
                    extra={"request_id": request_id}
                )
                # Use partial profile data instead of skipping
                profile_dict = {
                    "id": partial_profile.id,
                    "name": partial_profile.name,
                    "author": getattr(partial_profile, 'author', None),
                    "temperature": getattr(partial_profile, 'temperature', None),
                    "final_weight": getattr(partial_profile, 'final_weight', None),
                    "in_history": False,
                    "has_description": False,
                    "description": None,
                    "user_preferences": None,
                }
                profiles.append(profile_dict)
        
        logger.info(
            f"Found {len(profiles)} profiles on machine",
            extra={"request_id": request_id, "profile_count": len(profiles)}
        )
        
        return {
            "status": "success",
            "profiles": profiles,
            "total": len(profiles)
        }
        
    except MachineUnreachableError:
        # Offline fallback — return profiles from history
        logger.info(
            "Machine unreachable, returning history-based profiles",
            extra={"request_id": request_id}
        )
        try:
            history = load_history()
            entries = history if isinstance(history, list) else history.get("entries", [])
            profiles = []
            seen: set[str] = set()
            for entry in entries:
                name = entry.get("profile_name")
                if not name or name in seen:
                    continue
                seen.add(name)
                pj = entry.get("profile_json") or {}
                profiles.append({
                    "id": entry.get("id", ""),
                    "name": name,
                    "author": pj.get("author"),
                    "temperature": pj.get("temperature"),
                    "final_weight": pj.get("final_weight"),
                    "in_history": True,
                    "has_description": bool(entry.get("reply")),
                    "user_preferences": entry.get("user_preferences"),
                })
            return {
                "status": "success",
                "profiles": profiles,
                "total": len(profiles),
                "offline": True,
            }
        except Exception as fallback_err:
            logger.warning(
                f"Offline fallback also failed: {fallback_err}",
                extra={"request_id": request_id}
            )
            raise MachineUnreachableError() from fallback_err
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to list machine profiles: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.get("/machine/profile/{profile_id}")
@router.get("/api/machine/profile/{profile_id}")
async def get_machine_profile(profile_id: str, request: Request):
    """Get a single profile from the Meticulous machine with variables.

    Returns the profile dict including a ``variables`` array.  When the
    machine profile does not contain an explicit variables list the endpoint
    synthesises basic entries from the top-level ``final_weight`` and
    ``temperature`` fields so that callers always get adjustable parameters.
    """
    request_id = request.state.request_id

    try:
        logger.info(
            f"Fetching profile: {profile_id}",
            extra={"request_id": request_id, "profile_id": profile_id}
        )

        profile = await async_get_profile(profile_id)

        if hasattr(profile, 'error') and profile.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profile.error}"
            )

        # Convert to dict for JSON serialization
        profile_json: dict = {}
        for attr in ['id', 'name', 'author', 'temperature', 'final_weight',
                     'stages', 'variables', 'display', 'isDefault', 'source',
                     'beverage_type', 'tank_temperature']:
            if hasattr(profile, attr):
                val = getattr(profile, attr)
                if val is not None:
                    if hasattr(val, '__dict__'):
                        profile_json[attr] = val.__dict__
                    elif isinstance(val, list):
                        profile_json[attr] = [
                            item.__dict__ if hasattr(item, '__dict__') else item
                            for item in val
                        ]
                    else:
                        profile_json[attr] = val

        # Ensure there is always a variables array.  Merge well-known
        # top-level fields (final_weight, temperature) with any explicit
        # variables so the UI can always offer adjustment sliders.
        variables = profile_json.get("variables")
        if not variables or not isinstance(variables, list):
            variables = []

        existing_keys = {v.get("key") for v in variables if isinstance(v, dict)}
        if profile_json.get("final_weight") is not None and "final_weight" not in existing_keys:
            variables.append({
                "key": "final_weight",
                "name": "Final Weight",
                "type": "weight",
                "value": float(profile_json["final_weight"]),
            })
        if profile_json.get("temperature") is not None and "temperature" not in existing_keys:
            variables.append({
                "key": "temperature",
                "name": "Temperature",
                "type": "temperature",
                "value": float(profile_json["temperature"]),
            })
        profile_json["variables"] = variables

        return {
            "status": "success",
            "profile": profile_json,
            "variables": profile_json.get("variables", []),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.get("/api/machine/profile/{profile_id}/json")
async def get_machine_profile_json(profile_id: str, request: Request):
    """Get the full profile JSON from the Meticulous machine.
    
    Args:
        profile_id: The profile ID to fetch
        
    Returns:
        Full profile JSON suitable for export/import
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Fetching profile JSON: {profile_id}",
            extra={"request_id": request_id, "profile_id": profile_id}
        )
        
        profile = await async_get_profile(profile_id)
        
        if hasattr(profile, 'error') and profile.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profile.error}"
            )
        
        # Convert to dict for JSON serialization
        profile_json = {}
        for attr in ['id', 'name', 'author', 'temperature', 'final_weight', 'stages', 
                     'variables', 'display', 'isDefault', 'source', 'beverage_type',
                     'tank_temperature']:
            if hasattr(profile, attr):
                val = getattr(profile, attr)
                if val is not None:
                    # Handle nested objects
                    if hasattr(val, '__dict__'):
                        profile_json[attr] = val.__dict__
                    elif isinstance(val, list):
                        profile_json[attr] = [
                            item.__dict__ if hasattr(item, '__dict__') else item 
                            for item in val
                        ]
                    else:
                        profile_json[attr] = val
        
        return {
            "status": "success",
            "profile": profile_json
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get profile JSON: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.delete("/api/machine/profile/{profile_id}")
async def delete_machine_profile(profile_id: str, request: Request):
    """Delete a profile from the Meticulous machine.
    
    Args:
        profile_id: The profile ID to delete
        
    Returns:
        Status of the deletion operation
    """
    request_id = request.state.request_id
    
    try:
        # First get the profile to log its name
        profile = await async_get_profile(profile_id)
        profile_name = getattr(profile, 'name', profile_id) if profile else profile_id
        
        logger.info(
            f"Deleting profile: {profile_name} ({profile_id})",
            extra={"request_id": request_id, "profile_id": profile_id}
        )
        
        result = await async_delete_profile(profile_id)
        recommendation_service.invalidate_cache()
        
        logger.info(
            f"Successfully deleted profile: {profile_name}",
            extra={"request_id": request_id, "profile_id": profile_id}
        )
        
        return {
            "status": "success",
            "message": f"Profile '{profile_name}' deleted successfully",
            "profile_id": profile_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to delete profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.post("/api/machine/profiles/bulk-delete")
async def bulk_delete_machine_profiles(request: Request):
    """Delete multiple profiles from the Meticulous machine.

    Body:
        profile_ids: list of profile ID strings to delete

    Returns:
        Summary with succeeded / failed counts and per-profile results.
    """
    request_id = request.state.request_id

    try:
        body = await request.json()
        profile_ids = body.get("profile_ids", [])

        if not isinstance(profile_ids, list) or len(profile_ids) == 0:
            raise HTTPException(
                status_code=400,
                detail="profile_ids must be a non-empty list",
            )

        results: list[dict] = []
        succeeded = 0

        for pid in profile_ids:
            try:
                profile = await async_get_profile(pid)
                name = getattr(profile, "name", pid) if profile else pid
                await async_delete_profile(pid)
                results.append({"profile_id": pid, "name": name, "status": "success"})
                succeeded += 1
            except Exception as e:
                logger.warning(
                    f"Bulk delete: failed to delete {pid}: {e}",
                    extra={"request_id": request_id},
                )
                results.append({"profile_id": pid, "status": "error", "error": str(e)})

        recommendation_service.invalidate_cache()

        logger.info(
            f"Bulk delete: {succeeded}/{len(profile_ids)} profiles deleted",
            extra={"request_id": request_id},
        )

        return {
            "status": "success",
            "deleted": succeeded,
            "failed": len(profile_ids) - succeeded,
            "total": len(profile_ids),
            "results": results,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Bulk delete failed: {e}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


@router.patch("/api/machine/profile/{profile_id}")
async def update_machine_profile(profile_id: str, request: Request):
    """Update a profile on the Meticulous machine.
    
    Currently supports:
    - Renaming (via "name" field)
    
    Args:
        profile_id: The profile ID to update
        
    Body:
        name: New name for the profile (optional)
        
    Returns:
        Updated profile information
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        new_name = body.get("name")
        
        if not new_name:
            raise HTTPException(
                status_code=400, 
                detail="At least one field to update is required (e.g., 'name')"
            )
        
        # Get the current profile
        profile = await async_get_profile(profile_id)
        if hasattr(profile, 'error') and profile.error:
            raise HTTPException(
                status_code=404,
                detail=f"Profile not found: {profile_id}"
            )
        
        old_name = getattr(profile, 'name', profile_id)
        
        logger.info(
            f"Renaming profile '{old_name}' to '{new_name}'",
            extra={"request_id": request_id, "profile_id": profile_id}
        )
        
        # Convert profile to dict for modification
        profile_dict = {}
        for attr in ['id', 'name', 'author', 'author_id', 'temperature', 'final_weight', 
                     'stages', 'variables', 'display', 'isDefault', 'source', 
                     'beverage_type', 'tank_temperature', 'previous_authors']:
            if hasattr(profile, attr):
                val = getattr(profile, attr)
                if val is not None:
                    if hasattr(val, '__dict__'):
                        profile_dict[attr] = val.__dict__
                    elif isinstance(val, list):
                        profile_dict[attr] = [
                            item.__dict__ if hasattr(item, '__dict__') else item 
                            for item in val
                        ]
                    else:
                        profile_dict[attr] = val
        
        # Update the name
        profile_dict["name"] = new_name
        
        # Save the updated profile
        await async_save_profile(profile_dict)
        recommendation_service.invalidate_cache()
        
        logger.info(
            f"Successfully renamed profile to '{new_name}'",
            extra={"request_id": request_id, "profile_id": profile_id}
        )
        
        return {
            "status": "success",
            "message": f"Profile renamed from '{old_name}' to '{new_name}'",
            "profile_id": profile_id,
            "old_name": old_name,
            "new_name": new_name
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to update profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.post("/api/profile/import")
async def import_profile(request: Request):
    """Import a profile into the MeticAI history.
    
    The profile can come from:
    - A JSON file upload
    - A profile already on the machine (by ID)
    
    If the profile has no description, it will be sent to the LLM for analysis.
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        profile_json = body.get("profile")
        generate_description = body.get("generate_description", True)
        source = body.get("source", "file")  # "file" or "machine"
        
        if not profile_json:
            raise HTTPException(status_code=400, detail="No profile JSON provided")
        
        profile_name = profile_json.get("name", "Imported Profile")
        
        logger.info(
            f"Importing profile: {profile_name}",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "source": source,
                "generate_description": generate_description
            }
        )
        
        # Check if profile already exists in history
        existing_entry = None
        history = load_history()
        entries = history if isinstance(history, list) else history.get("entries", [])
        for entry in entries:
            if entry.get("profile_name") == profile_name:
                existing_entry = entry
                break
        
        if existing_entry:
            return {
                "status": "exists",
                "message": f"Profile '{profile_name}' already exists in history",
                "entry_id": existing_entry.get("id")
            }
        
        # Generate description if requested
        reply = None
        if generate_description:
            try:
                reply = await _generate_profile_description(profile_json, request_id)
            except Exception as e:
                logger.warning(
                    f"Failed to generate description: {e}",
                    extra={"request_id": request_id}
                )
                from services.analysis_service import _build_static_profile_description
                reply = _build_static_profile_description(profile_json)
        else:
            from services.analysis_service import _build_static_profile_description
            reply = _build_static_profile_description(profile_json)
        
        # Create history entry
        entry_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        
        profile_dict = deep_convert_to_dict(profile_json)
        new_entry = {
            "id": entry_id,
            "created_at": created_at,
            "profile_name": profile_name,
            "user_preferences": f"Imported from {source}",
            "reply": reply,
            "profile_json": profile_dict,
            "content_hash": compute_content_hash(profile_dict),
            "imported": True,
            "import_source": source
        }
        
        # Save to history using cache-aware save to keep in-memory cache in sync
        with _history_lock:
            history = load_history()
            if not isinstance(history, list):
                history = history.get("entries", [])
            
            history.insert(0, new_entry)
            
            save_history(history)
        
        # Upload profile to the Meticulous machine when imported from a file.
        # Profiles imported from the machine (source="machine") already exist there.
        machine_profile_id = None
        if source == "file":
            try:
                result = await async_create_profile(profile_json)
                machine_profile_id = result.get("id") if isinstance(result, dict) else None
                logger.info(
                    f"Profile uploaded to machine: {profile_name}",
                    extra={"request_id": request_id, "machine_profile_id": machine_profile_id}
                )
            except Exception as exc:
                logger.warning(
                    f"Profile saved to history but failed to upload to machine: {exc}",
                    extra={"request_id": request_id, "error_type": type(exc).__name__}
                )
        
        logger.info(
            f"Profile imported successfully: {profile_name}",
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        
        return {
            "status": "success",
            "entry_id": entry_id,
            "profile_name": profile_name,
            "has_description": reply is not None and "Description generation failed" not in reply,
            "uploaded_to_machine": machine_profile_id is not None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to import profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )



def _validate_url_for_ssrf(url: str) -> None:
    """Reject URLs that could hit internal/private network resources."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Unsupported scheme: {parsed.scheme}")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("No hostname in URL")
    blocked = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"}
    if hostname.lower() in blocked:
        raise ValueError(f"Blocked hostname: {hostname}")
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(hostname))
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError(f"URL resolves to private/reserved IP: {ip}")
    except socket.gaierror:
        pass  # Let httpx handle DNS errors


@router.post("/api/import-from-url")
async def import_from_url(request: Request):
    """Import a profile from a URL (JSON or .met format)."""
    request_id = request.state.request_id
    try:
        body = await request.json()
        url = body.get("url", "").strip()
        generate_description = body.get("generate_description", True)
        if not url:
            raise HTTPException(status_code=400, detail="No URL provided")
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise HTTPException(status_code=400, detail="Only http and https URLs are supported")
        try:
            _validate_url_for_ssrf(url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Blocked URL: {exc}")
        logger.info("Importing profile from URL: %s", url, extra={"request_id": request_id})
        max_size = 5 * 1024 * 1024
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                async with client.stream("GET", url) as resp:
                    resp.raise_for_status()
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in resp.aiter_bytes(8192):
                        total += len(chunk)
                        if total > max_size:
                            raise HTTPException(status_code=413, detail="Response too large (max 5 MB)")
                        chunks.append(chunk)
                    content = b"".join(chunks)
        except httpx.TimeoutException:
            raise HTTPException(status_code=408, detail="Request timed out fetching URL")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=f"Remote server returned {exc.response.status_code}")
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Failed to fetch URL: {exc}")
        try:
            profile_json = json.loads(content)
        except Exception:
            raise HTTPException(status_code=400, detail="URL did not return valid JSON")
        if not isinstance(profile_json, dict):
            raise HTTPException(status_code=400, detail="URL did not return a valid profile object")
        if not profile_json.get("name"):
            raise HTTPException(status_code=400, detail="Profile is missing a 'name' field")
        profile_name = profile_json["name"]
        reply = None
        if generate_description:
            try:
                reply = await _generate_profile_description(profile_json, request_id)
            except Exception as e:
                logger.warning("Failed to generate description for URL import: %s", e, extra={"request_id": request_id})
                from services.analysis_service import _build_static_profile_description
                reply = _build_static_profile_description(profile_json)
        else:
            from services.analysis_service import _build_static_profile_description
            reply = _build_static_profile_description(profile_json)
        entry_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        new_entry = {"id": entry_id, "created_at": created_at, "profile_name": profile_name, "user_preferences": f"Imported from URL: {url}", "reply": reply, "profile_json": deep_convert_to_dict(profile_json), "imported": True, "import_source": "url"}
        with _history_lock:
            history = load_history()
            entries = history if isinstance(history, list) else history.get("entries", [])
            for entry in entries:
                if entry.get("profile_name") == profile_name:
                    return {"status": "exists", "message": f"Profile '{profile_name}' already exists", "entry_id": entry.get("id"), "profile_name": profile_name}
            entries.insert(0, new_entry)
            save_history(entries)
        machine_profile_id = None
        try:
            result = await async_create_profile(profile_json)
            machine_profile_id = result.get("id") if isinstance(result, dict) else None
            logger.info("URL-imported profile uploaded to machine: %s", profile_name, extra={"request_id": request_id, "machine_profile_id": machine_profile_id})
        except Exception as exc:
            logger.warning("Profile saved to history but failed to upload to machine: %s", exc, extra={"request_id": request_id, "error_type": type(exc).__name__})
        logger.info("Profile imported from URL successfully: %s", profile_name, extra={"request_id": request_id, "entry_id": entry_id, "source_url": url})
        return {"status": "success", "entry_id": entry_id, "profile_name": profile_name, "has_description": reply is not None and "Description generation failed" not in reply, "uploaded_to_machine": machine_profile_id is not None}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to import profile from URL: %s", str(e), exc_info=True, extra={"request_id": request_id, "error_type": type(e).__name__})
        raise HTTPException(status_code=500, detail={"status": "error", "error": str(e)})

@router.post("/api/profile/import-all")
async def import_all_profiles(request: Request):
    """Import all profiles from the Meticulous machine that aren't already in history.
    
    This is a long-running operation that imports profiles one at a time,
    generating descriptions for each. The response is streamed as newline-delimited JSON
    to provide progress updates.
    
    Returns:
        Streamed JSON with progress updates and final summary
    """
    from fastapi.responses import StreamingResponse
    
    request_id = request.state.request_id

    generate_description = True
    try:
        body = await request.json()
        if isinstance(body, dict):
            generate_description = bool(body.get("generate_description", True))
    except Exception:
        generate_description = True
    
    async def generate_import_stream():
        """Generator that yields progress updates as JSON lines."""
        imported = []
        skipped = []
        failed = []
        
        try:
            # Get list of machine profiles
            profiles_result = await async_list_profiles()
            
            if hasattr(profiles_result, 'error') and profiles_result.error:
                yield json.dumps({
                    "type": "error",
                    "message": f"Machine API error: {profiles_result.error}"
                }) + "\n"
                return
            
            # Get existing profile names from history
            existing_names = set()
            history = load_history()
            entries = history if isinstance(history, list) else history.get("entries", [])
            existing_names = {entry.get("profile_name") for entry in entries}
            
            # Filter profiles to import
            profiles_to_import = []
            for partial_profile in profiles_result:
                try:
                    full_profile = await async_get_profile(partial_profile.id)
                    if hasattr(full_profile, 'error') and full_profile.error:
                        continue
                    if full_profile.name not in existing_names:
                        profiles_to_import.append(full_profile)
                    else:
                        skipped.append(full_profile.name)
                except Exception:
                    # Ignore errors fetching individual profiles (may have been deleted)
                    pass
            
            total_to_import = len(profiles_to_import)
            total_profiles = total_to_import + len(skipped)
            
            # Send initial status
            yield json.dumps({
                "type": "start",
                "total": total_profiles,
                "to_import": total_to_import,
                "already_imported": len(skipped),
                "message": f"Found {total_to_import} profiles to import ({len(skipped)} already in catalogue)"
            }) + "\n"
            
            if total_to_import == 0:
                yield json.dumps({
                    "type": "complete",
                    "imported": 0,
                    "skipped": len(skipped),
                    "failed": 0,
                    "message": "All profiles already in catalogue"
                }) + "\n"
                return
            
            # Import each profile
            for idx, profile in enumerate(profiles_to_import, 1):
                profile_name = profile.name
                
                yield json.dumps({
                    "type": "progress",
                    "current": idx,
                    "total": total_to_import,
                    "profile_name": profile_name,
                    "message": f"Importing {idx}/{total_to_import}: {profile_name}"
                }) + "\n"
                
                try:
                    # Convert profile to JSON dict using deep conversion
                    profile_json = deep_convert_to_dict(profile)
                    
                    # Generate description
                    if generate_description:
                        try:
                            reply = await _generate_profile_description(profile_json, request_id)
                        except Exception as e:
                            logger.warning(f"Failed to generate description for {profile_name}: {e}")
                            from services.analysis_service import _build_static_profile_description
                            reply = _build_static_profile_description(profile_json)
                    else:
                        from services.analysis_service import _build_static_profile_description
                        reply = _build_static_profile_description(profile_json)
                    
                    # Create history entry
                    entry_id = str(uuid.uuid4())
                    created_at = datetime.now(timezone.utc).isoformat()
                    
                    new_entry = {
                        "id": entry_id,
                        "created_at": created_at,
                        "profile_name": profile_name,
                        "user_preferences": "Imported from machine (bulk import)",
                        "reply": reply,
                        "profile_json": profile_json,
                        "imported": True,
                        "import_source": "machine_bulk"
                    }
                    
                    # Save to history using cache-aware save
                    with _history_lock:
                        history = load_history()
                        if not isinstance(history, list):
                            history = history.get("entries", [])
                        
                        history.insert(0, new_entry)
                        
                        save_history(history)
                    
                    imported.append(profile_name)
                    
                    yield json.dumps({
                        "type": "imported",
                        "current": idx,
                        "total": total_to_import,
                        "profile_name": profile_name,
                        "message": f"Imported: {profile_name}"
                    }) + "\n"
                    
                except Exception as e:
                    logger.error(f"Failed to import {profile_name}: {e}", exc_info=True)
                    failed.append({"name": profile_name, "error": str(e)})
                    
                    yield json.dumps({
                        "type": "failed",
                        "current": idx,
                        "total": total_to_import,
                        "profile_name": profile_name,
                        "error": str(e),
                        "message": f"Failed: {profile_name}"
                    }) + "\n"
            
            # Send completion summary
            yield json.dumps({
                "type": "complete",
                "imported": len(imported),
                "skipped": len(skipped),
                "failed": len(failed),
                "imported_profiles": imported,
                "skipped_profiles": skipped,
                "failed_profiles": failed,
                "message": f"Import complete: {len(imported)} imported, {len(skipped)} skipped, {len(failed)} failed"
            }) + "\n"
            
            logger.info(
                f"Bulk import completed: {len(imported)} imported, {len(skipped)} skipped, {len(failed)} failed",
                extra={"request_id": request_id}
            )
            
        except Exception as e:
            logger.error(f"Bulk import error: {e}", exc_info=True, extra={"request_id": request_id})
            yield json.dumps({
                "type": "error",
                "message": str(e)
            }) + "\n"
    
    return StreamingResponse(
        generate_import_stream(),
        media_type="application/x-ndjson"
    )


@router.get("/api/machine/profiles/count")
async def get_machine_profile_count(request: Request):
    """Get a quick count of profiles on the machine and how many are not yet imported.
    
    This is a lightweight endpoint for showing import-all button availability.
    """
    request_id = request.state.request_id
    
    try:
        profiles_result = await async_list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        total_on_machine = len(list(profiles_result))
        
        # Re-fetch to count (iterator was consumed)
        profiles_result = await async_list_profiles()
        
        # Get existing profile names from history
        existing_names = set()
        history = load_history()
        entries = history if isinstance(history, list) else history.get("entries", [])
        existing_names = {entry.get("profile_name") for entry in entries}
        
        not_imported = 0
        for partial_profile in profiles_result:
            try:
                full_profile = await async_get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                if full_profile.name not in existing_names:
                    not_imported += 1
            except Exception:
                # Ignore errors fetching individual profiles (may have been deleted)
                pass
        
        return {
            "status": "success",
            "total_on_machine": total_on_machine,
            "not_imported": not_imported,
            "already_imported": total_on_machine - not_imported
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get profile count: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.get("/machine/profiles/orphaned")
@router.get("/api/machine/profiles/orphaned")
async def list_orphaned_history_entries(request: Request):
    """List history entries whose profiles no longer exist on the machine.

    Cross-references history entries against the current machine profile list
    and returns entries that have no matching machine profile.
    """
    request_id = request.state.request_id

    try:
        logger.info(
            "Checking for orphaned history entries",
            extra={"request_id": request_id},
        )

        profiles_result = await async_list_profiles()
        if hasattr(profiles_result, "error") and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}",
            )

        machine_names: set[str] = {
            getattr(p, "name", "") for p in profiles_result
        }

        history = load_history()
        entries = history if isinstance(history, list) else history.get("entries", [])

        orphaned = []
        for entry in entries:
            profile_name = entry.get("profile_name", "")
            if profile_name and profile_name not in machine_names and not is_temp_profile(profile_name):
                orphaned.append({
                    "id": entry.get("id"),
                    "profile_name": profile_name,
                    "created_at": entry.get("created_at"),
                    "has_profile_json": bool(entry.get("profile_json")),
                })

        logger.info(
            f"Found {len(orphaned)} orphaned history entries",
            extra={"request_id": request_id, "orphan_count": len(orphaned)},
        )

        return {
            "status": "success",
            "orphaned": orphaned,
            "total": len(orphaned),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to check orphaned profiles: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


# ---------------------------------------------------------------------------
# Profile Sync endpoints
# ---------------------------------------------------------------------------


@router.post("/profiles/sync")
@router.post("/api/profiles/sync")
async def sync_profiles(request: Request):
    """Run a full sync between machine profiles and MeticAI history.

    Computes a content hash for every machine profile and compares it against
    the hash stored in the corresponding history entry.  Returns three lists:

    - **new**: profiles on the machine that have no history entry at all.
    - **updated**: profiles whose content hash differs from the stored hash.
    - **orphaned**: history entries with no matching machine profile (reuses
      the existing orphan-detection logic).
    """
    request_id = request.state.request_id

    try:
        logger.info(
            "Starting profile sync",
            extra={"request_id": request_id},
        )

        # 1. Fetch machine profiles
        profiles_result = await async_list_profiles()
        if hasattr(profiles_result, "error") and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}",
            )

        # 2. Build a name→entry lookup from history
        history = load_history()
        entries = history if isinstance(history, list) else history.get("entries", [])
        history_by_name: dict[str, dict] = {}
        for entry in entries:
            pname = entry.get("profile_name", "")
            if pname and pname not in history_by_name:
                history_by_name[pname] = entry

        # 3. Walk machine profiles
        new_profiles: list[dict] = []
        updated_profiles: list[dict] = []
        machine_names: set[str] = set()

        for partial in profiles_result:
            profile_name = getattr(partial, "name", "")
            profile_id = getattr(partial, "id", "")
            machine_names.add(profile_name)

            # Fetch full profile to compute hash
            try:
                full = await async_get_profile(profile_id)
                if hasattr(full, "error") and full.error:
                    full = partial
            except Exception:
                full = partial

            profile_dict = deep_convert_to_dict(full)
            current_hash = compute_content_hash(profile_dict)

            entry = history_by_name.get(profile_name)
            if entry is None:
                new_profiles.append({
                    "profile_id": profile_id,
                    "profile_name": profile_name,
                    "content_hash": current_hash,
                })
            else:
                stored_hash = entry.get("content_hash")
                if not stored_hash:
                    # Backfill: first sync after creation — store the machine
                    # hash as baseline without flagging as "updated".
                    try:
                        update_entry_sync_fields(
                            entry["id"],
                            content_hash=current_hash,
                            profile_json=profile_dict,
                        )
                    except Exception:
                        pass
                elif stored_hash != current_hash:
                    updated_profiles.append({
                        "profile_id": profile_id,
                        "profile_name": profile_name,
                        "history_id": entry.get("id"),
                        "stored_hash": stored_hash,
                        "current_hash": current_hash,
                    })

        # 4. Orphaned entries (in history but not on machine)
        orphaned: list[dict] = []
        for entry in entries:
            pname = entry.get("profile_name", "")
            if pname and pname not in machine_names:
                orphaned.append({
                    "id": entry.get("id"),
                    "profile_name": pname,
                    "created_at": entry.get("created_at"),
                    "has_profile_json": bool(entry.get("profile_json")),
                })

        logger.info(
            f"Sync complete: {len(new_profiles)} new, {len(updated_profiles)} updated, {len(orphaned)} orphaned",
            extra={"request_id": request_id},
        )

        return {
            "status": "success",
            "new": new_profiles,
            "updated": updated_profiles,
            "orphaned": orphaned,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Profile sync failed: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


@router.post("/profiles/sync/accept/{profile_id}")
@router.post("/api/profiles/sync/accept/{profile_id}")
async def accept_sync_update(profile_id: str, request: Request, ai_description: bool = False):
    """Accept a machine profile update and refresh the history entry.

    Re-fetches the profile from the machine, updates the stored
    ``profile_json`` and ``content_hash``, and optionally regenerates the
    AI description.
    """
    request_id = request.state.request_id

    try:
        logger.info(
            f"Accepting sync update for profile {profile_id}",
            extra={"request_id": request_id, "profile_id": profile_id, "ai_description": ai_description},
        )

        # Fetch latest from machine
        full_profile = await async_get_profile(profile_id)
        if hasattr(full_profile, "error") and full_profile.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {full_profile.error}",
            )

        profile_dict = deep_convert_to_dict(full_profile)
        profile_name = profile_dict.get("name", getattr(full_profile, "name", "Unknown"))
        new_hash = compute_content_hash(profile_dict)

        # Find the history entry by name
        history = load_history()
        entries = history if isinstance(history, list) else history.get("entries", [])
        target_entry = None
        for entry in entries:
            if entry.get("profile_name") == profile_name:
                target_entry = entry
                break

        if not target_entry:
            raise HTTPException(status_code=404, detail="No history entry found for this profile")

        # Optionally regenerate description
        new_reply = None
        if ai_description:
            try:
                new_reply = await _generate_profile_description(profile_dict, request_id)
            except Exception as e:
                logger.warning(
                    f"AI description generation failed during sync accept: {e}",
                    extra={"request_id": request_id},
                )

        updated = update_entry_sync_fields(
            target_entry["id"],
            content_hash=new_hash,
            machine_updated_at=datetime.now(timezone.utc).isoformat(),
            profile_json=profile_dict,
            reply=new_reply,
        )

        if not updated:
            raise HTTPException(status_code=404, detail="History entry not found")

        logger.info(
            f"Sync update accepted for '{profile_name}'",
            extra={"request_id": request_id, "entry_id": target_entry["id"]},
        )

        return {
            "status": "success",
            "profile_name": profile_name,
            "content_hash": new_hash,
            "ai_description_generated": ai_description and new_reply is not None,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to accept sync update: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


@router.get("/profiles/sync/status")
@router.get("/api/profiles/sync/status")
async def sync_status(request: Request):
    """Count of pending sync items for badge display.

    Fetches full profiles to compute content hashes so that updated profiles
    are accurately reflected in the badge count.  Also backfills hashes for
    history entries that were created before hash tracking was added.
    """
    request_id = request.state.request_id

    try:
        profiles_result = await async_list_profiles()
        if hasattr(profiles_result, "error") and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}",
            )

        history = load_history()
        entries = history if isinstance(history, list) else history.get("entries", [])
        history_by_name: dict[str, dict] = {}
        for entry in entries:
            pname = entry.get("profile_name", "")
            if pname and pname not in history_by_name:
                history_by_name[pname] = entry

        machine_names: set[str] = set()
        new_count = 0
        updated_count = 0

        for partial in profiles_result:
            name = getattr(partial, "name", "")
            profile_id = getattr(partial, "id", "")
            machine_names.add(name)
            entry = history_by_name.get(name)
            if entry is None:
                new_count += 1
            else:
                stored_hash = entry.get("content_hash")
                try:
                    full = await async_get_profile(profile_id)
                    if hasattr(full, "error") and full.error:
                        continue
                    profile_dict = deep_convert_to_dict(full)
                    current_hash = compute_content_hash(profile_dict)

                    if not stored_hash:
                        # Backfill baseline hash silently
                        try:
                            update_entry_sync_fields(
                                entry["id"],
                                content_hash=current_hash,
                                profile_json=profile_dict,
                            )
                        except Exception:
                            pass
                    elif stored_hash != current_hash:
                        updated_count += 1
                except Exception:
                    pass

        orphan_count = sum(
            1 for entry in entries
            if entry.get("profile_name", "") and entry.get("profile_name", "") not in machine_names
        )

        return {
            "status": "success",
            "new_count": new_count,
            "updated_count": updated_count,
            "orphaned_count": orphan_count,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get sync status: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


@router.post("/profiles/auto-sync")
@router.post("/api/profiles/auto-sync")
async def auto_sync_profiles(request: Request):
    """Automatically sync all new and updated profiles from the machine.

    Imports new profiles and accepts updates without user intervention.
    Orphaned profiles are reported but not automatically removed.
    """
    request_id = request.state.request_id

    try:
        body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
        ai_description = body.get("ai_description", False)

        # Run full sync detection
        profiles_result = await async_list_profiles()
        if hasattr(profiles_result, "error") and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}",
            )

        history = load_history()
        entries = history if isinstance(history, list) else history.get("entries", [])
        history_by_name: dict[str, dict] = {}
        for entry in entries:
            pname = entry.get("profile_name", "")
            if pname and pname not in history_by_name:
                history_by_name[pname] = entry

        imported = []
        updated = []

        for partial in profiles_result:
            profile_name = getattr(partial, "name", "")
            profile_id = getattr(partial, "id", "")

            if profile_name not in history_by_name:
                # New profile — import it
                try:
                    full_profile = await async_get_profile(profile_id)
                    if hasattr(full_profile, "error") and full_profile.error:
                        continue
                    profile_dict = deep_convert_to_dict(full_profile)

                    if ai_description:
                        try:
                            reply = await _generate_profile_description(profile_dict, request_id)
                        except Exception:
                            from services.analysis_service import _build_static_profile_description
                            reply = _build_static_profile_description(profile_dict)
                    else:
                        from services.analysis_service import _build_static_profile_description
                        reply = _build_static_profile_description(profile_dict)

                    entry_id = str(uuid.uuid4())
                    new_entry = {
                        "id": entry_id,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "profile_name": profile_name,
                        "user_preferences": "Imported from machine (auto-sync)",
                        "reply": reply,
                        "profile_json": profile_dict,
                        "content_hash": compute_content_hash(profile_dict),
                        "imported": True,
                        "import_source": "machine",
                    }
                    # Reload history to avoid stale writes
                    history = load_history()
                    if not isinstance(history, list):
                        history = history.get("entries", [])
                    history.insert(0, new_entry)
                    save_history(history)
                    imported.append(profile_name)
                except Exception as exc:
                    logger.warning(
                        f"Auto-sync: failed to import '{profile_name}': {exc}",
                        extra={"request_id": request_id},
                    )
            else:
                # Existing profile — check for updates
                existing = history_by_name[profile_name]
                stored_hash = existing.get("content_hash")
                try:
                    full_profile = await async_get_profile(profile_id)
                    if hasattr(full_profile, "error") and full_profile.error:
                        continue
                    profile_dict = deep_convert_to_dict(full_profile)
                    current_hash = compute_content_hash(profile_dict)

                    if not stored_hash:
                        # Backfill: store machine hash as baseline (not an update)
                        update_entry_sync_fields(
                            existing["id"],
                            content_hash=current_hash,
                            profile_json=profile_dict,
                        )
                    elif current_hash != stored_hash:
                        new_reply = None
                        if ai_description:
                            try:
                                new_reply = await _generate_profile_description(profile_dict, request_id)
                            except Exception:
                                pass
                        update_entry_sync_fields(
                            existing["id"],
                            content_hash=current_hash,
                            machine_updated_at=datetime.now(timezone.utc).isoformat(),
                            profile_json=profile_dict,
                            reply=new_reply,
                        )
                        updated.append(profile_name)
                except Exception as exc:
                    logger.warning(
                        f"Auto-sync: failed to update '{profile_name}': {exc}",
                        extra={"request_id": request_id},
                    )

        logger.info(
            f"Auto-sync complete: {len(imported)} imported, {len(updated)} updated",
            extra={"request_id": request_id},
        )

        return {
            "status": "success",
            "imported": imported,
            "updated": updated,
            "imported_count": len(imported),
            "updated_count": len(updated),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Auto-sync failed: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


@router.post("/machine/profile/restore/{history_id}")
@router.post("/api/machine/profile/restore/{history_id}")
async def restore_profile_from_history(history_id: str, request: Request):
    """Re-upload a profile from history to the Meticulous machine.

    Loads the stored profile JSON from a history entry and saves it back to
    the machine via async_save_profile().
    """
    request_id = request.state.request_id

    try:
        from services.history_service import get_entry_by_id

        entry = get_entry_by_id(history_id)
        if not entry:
            raise HTTPException(status_code=404, detail="History entry not found")

        profile_json = entry.get("profile_json")
        if not profile_json:
            raise HTTPException(
                status_code=400,
                detail="History entry does not contain profile JSON",
            )

        profile_name = entry.get("profile_name", "Restored Profile")

        logger.info(
            f"Restoring profile '{profile_name}' to machine from history",
            extra={"request_id": request_id, "history_id": history_id},
        )

        # Send profile dict directly to the machine API.
        # We bypass async_save_profile / Profile model because the stored
        # JSON may lack fields the Pydantic model requires (e.g. author_id).
        import httpx
        import os

        meticulous_ip = os.environ.get("METICULOUS_IP", "").strip()
        if not meticulous_ip:
            raise HTTPException(status_code=503, detail="METICULOUS_IP not configured")

        # Ensure author_id is present — machine API may require it
        if "author_id" not in profile_json:
            profile_json["author_id"] = profile_json.get("author", "MeticAI")

        # Strip None values (machine API rejects them)
        clean_json = {k: v for k, v in profile_json.items() if v is not None}

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"http://{meticulous_ip}/api/v1/profile/save",
                json=clean_json,
            )
            if resp.status_code != 200:
                logger.error(
                    f"Machine API rejected profile save: {resp.status_code} - {resp.text}",
                    extra={"request_id": request_id},
                )
                raise HTTPException(
                    status_code=502,
                    detail=f"Machine API error: {resp.text}",
                )

        invalidate_profile_list_cache()

        logger.info(
            f"Successfully restored profile '{profile_name}' to machine",
            extra={"request_id": request_id, "history_id": history_id},
        )

        return {
            "status": "success",
            "message": f"Profile '{profile_name}' restored to machine",
            "profile_name": profile_name,
            "history_id": history_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to restore profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


@router.post("/api/profile/convert-description")
async def convert_profile_description(request: Request):
    """Convert an existing profile description to the standard MeticAI format.
    
    Takes a profile with an existing description and reformats it while
    preserving all original information.
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        profile_json = body.get("profile")
        existing_description = body.get("description", "")
        
        if not profile_json:
            raise HTTPException(status_code=400, detail="No profile JSON provided")
        
        profile_name = profile_json.get("name", "Unknown Profile")
        
        logger.info(
            f"Converting description for profile: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        prompt = f"""You are an expert espresso barista analysing profiles for the Meticulous Espresso Machine.

## Expert Profiling Knowledge
{PROFILING_KNOWLEDGE}

Analyze this Meticulous Espresso profile and convert its description to the standard MeticAI format.

IMPORTANT: Preserve ALL information from the original description. Do not lose any details - only reformat them.

PROFILE JSON:
```json
{json.dumps(profile_json, indent=2)}
```

ORIGINAL DESCRIPTION:
{existing_description}

Convert to this exact format while preserving all original information:

Profile Created: {profile_name}

Description:
[Preserve the original description's key points and add technical insights from the profile JSON]

Preparation:
• Dose: [From original or profile settings]
• Grind: [From original or recommend based on profile]
• Temperature: [From profile: {profile_json.get('temperature', 'Not specified')}°C]
• Target Yield: [From profile: {profile_json.get('final_weight', 'Not specified')}g]
• Expected Time: [Calculate from stages if possible]

Why This Works:
[Combine original explanation with technical analysis of the profile stages]

Special Notes:
[Preserve any special notes from original, add any additional insights]

Remember: NO information should be lost in this conversion!"""

        try:
            model = get_vision_model()
        except ValueError as e:
            raise HTTPException(
                status_code=503,
                detail={
                    "status": "error",
                    "message": str(e),
                    "error": "AI features are unavailable until GEMINI_API_KEY is configured"
                }
            ) from e
        response = await model.async_generate_content(prompt)
        converted_description = response.text.strip()
        
        # Update the history entry if it exists
        entry_id = body.get("entry_id")
        if entry_id:
            with _history_lock:
                history = load_history()
                entries = history if isinstance(history, list) else history.get("entries", [])
                for entry in entries:
                    if entry.get("id") == entry_id:
                        entry["reply"] = converted_description
                        entry["description_converted"] = True
                        break
                save_history(history)
        
        logger.info(
            f"Description converted successfully for: {profile_name}",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "converted_description": converted_description
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to convert description: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.post("/profile/{entry_id}/regenerate-description")
@router.post("/api/profile/{entry_id}/regenerate-description")
async def regenerate_profile_description(entry_id: str, request: Request):
    """Regenerate the AI description for an existing profile in history.

    Replaces a static (non-AI) description with a full AI-generated one.
    Requires a configured Gemini API key.
    """
    request_id = request.state.request_id

    try:
        history = load_history()
        entries = history if isinstance(history, list) else history.get("entries", [])
        target_entry = None
        for entry in entries:
            if entry.get("id") == entry_id:
                target_entry = entry
                break

        if not target_entry:
            raise HTTPException(status_code=404, detail="History entry not found")

        profile_json = target_entry.get("profile_json")
        if not profile_json:
            raise HTTPException(status_code=400, detail="No profile JSON data available for this entry")

        profile_name = target_entry.get("profile_name", "Unknown Profile")
        logger.info(
            f"Regenerating AI description for: {profile_name}",
            extra={"request_id": request_id, "entry_id": entry_id},
        )

        new_description = await _generate_profile_description(profile_json, request_id)

        # Check it actually used AI (not the static fallback)
        if "generated without AI assistance" in new_description:
            raise HTTPException(
                status_code=503,
                detail="AI description generation failed — check that your Gemini API key is configured",
            )

        target_entry["reply"] = new_description
        save_history(history)

        logger.info(
            f"AI description regenerated for: {profile_name}",
            extra={"request_id": request_id, "entry_id": entry_id},
        )

        return {"status": "success", "description": new_description}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to regenerate description: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


# ============================================================================
# Run Shot Endpoints
# ============================================================================

# ==============================================================================
# Scheduled Shots - Import from centralized scheduling_state module
# ==============================================================================
# All scheduling state and persistence is managed by services.scheduling_state
# to avoid duplicate state across modules

from services.scheduling_state import (
    _scheduled_shots,
    _scheduled_tasks,
    _recurring_schedules,
    save_scheduled_shots as _save_scheduled_shots,
    save_recurring_schedules as _save_recurring_schedules,
    restore_scheduled_shots as _restore_scheduled_shots,
    get_next_occurrence as _get_next_occurrence,
    PREHEAT_DURATION_MINUTES,
)


async def _schedule_next_recurring(schedule_id: str, schedule: dict):
    """Schedule the next occurrence of a recurring schedule.
    
    This function calculates when the next occurrence should happen based on 
    the schedule configuration and creates a scheduled shot for that time.
    """
    next_time = _get_next_occurrence(schedule)
    
    if not next_time:
        logger.warning(f"Could not calculate next occurrence for recurring schedule {schedule_id}")
        return
    
    profile_id = schedule.get("profile_id")
    preheat = schedule.get("preheat", True)
    
    # Create a one-time scheduled shot for the next occurrence
    shot_id = f"recurring-{schedule_id}-{next_time.isoformat()}"
    
    # Check if we already have this shot scheduled
    if shot_id in _scheduled_shots:
        logger.debug(f"Recurring shot {shot_id} already scheduled")
        return
    
    shot_delay = (next_time - datetime.now(timezone.utc)).total_seconds()
    
    if shot_delay < 0:
        logger.warning(f"Next occurrence for {schedule_id} is in the past, skipping")
        return
    
    # Store the scheduled shot
    scheduled_shot = {
        "id": shot_id,
        "profile_id": profile_id,
        "scheduled_time": next_time.isoformat(),
        "preheat": preheat,
        "status": "scheduled",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "recurring_schedule_id": schedule_id
    }
    _scheduled_shots[shot_id] = scheduled_shot
    await _save_scheduled_shots()
    
    logger.info(
        f"Scheduled next recurring shot {shot_id} for {next_time.isoformat()} "
        f"(profile: {profile_id}, preheat: {preheat})"
    )


async def _recurring_schedule_checker():
    """Background task to ensure recurring schedules stay up to date.
    
    Runs every hour to:
    1. Check for completed recurring shots and schedule the next occurrence
    2. Ensure all enabled recurring schedules have an upcoming shot scheduled
    """
    while True:
        try:
            await asyncio.sleep(3600)  # Check every hour
            
            logger.info("Running recurring schedule check")
            
            # Find completed recurring shots and schedule next occurrence
            for shot_id, shot in list(_scheduled_shots.items()):
                recurring_id = shot.get("recurring_schedule_id")
                if recurring_id and shot.get("status") in ["completed", "failed"]:
                    # Update last_run time for interval-based schedules
                    if recurring_id in _recurring_schedules:
                        schedule = _recurring_schedules[recurring_id]
                        if schedule.get("recurrence_type") == "interval":
                            schedule["last_run"] = shot.get("scheduled_time")
                            await _save_recurring_schedules()
                        
                        # Schedule next occurrence
                        await _schedule_next_recurring(recurring_id, schedule)
            
            # Ensure all enabled schedules have an upcoming shot
            for schedule_id, schedule in _recurring_schedules.items():
                if not schedule.get("enabled", True):
                    continue
                
                # Check if there's already a pending shot for this schedule
                has_pending = any(
                    s.get("recurring_schedule_id") == schedule_id 
                    and s.get("status") in ["scheduled", "preheating"]
                    for s in _scheduled_shots.values()
                )
                
                if not has_pending:
                    await _schedule_next_recurring(schedule_id, schedule)
                    
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in recurring schedule checker: {e}", exc_info=True)
            await asyncio.sleep(60)  # Wait a bit before retrying


async def _restore_scheduled_shots():
    """Restore scheduled shots from disk on startup and recreate tasks."""
    global _scheduled_shots
    
    # Load persisted shots
    persisted_shots = await _persistence.load()
    
    if not persisted_shots:
        return
    
    # Filter out shots that are in the past or invalid
    now = datetime.now(timezone.utc)
    restored_count = 0
    
    for schedule_id, shot in persisted_shots.items():
        try:
            # Parse scheduled time
            scheduled_time_str = shot.get("scheduled_time")
            if not scheduled_time_str:
                logger.warning(f"Skipping shot {schedule_id}: no scheduled_time")
                continue
            
            scheduled_time = datetime.fromisoformat(scheduled_time_str.replace('Z', '+00:00'))
            if scheduled_time.tzinfo is None:
                scheduled_time = scheduled_time.replace(tzinfo=timezone.utc)
            
            # Skip if time has passed
            if scheduled_time <= now:
                logger.info(f"Skipping expired shot {schedule_id} (scheduled for {scheduled_time_str})")
                continue
            
            # Restore the shot
            _scheduled_shots[schedule_id] = shot
            
            # Recreate the async task
            profile_id = shot.get("profile_id")
            preheat = shot.get("preheat", False)
            current_status = shot.get("status", "scheduled")
            shot_delay = (scheduled_time - now).total_seconds()
            
            # Create the execution task that handles restoration properly
            async def execute_scheduled_shot(sid=schedule_id, pid=profile_id, ph=preheat, delay=shot_delay, was_preheating=(current_status == "preheating")):
                try:
                    
                    # If we were already preheating when restored, skip preheat logic
                    # and just wait for the shot time
                    if was_preheating:
                        logger.info(f"Restored shot {sid} was already preheating, waiting {delay:.0f}s until shot time")
                        _scheduled_shots[sid]["status"] = "preheating"
                        await _save_scheduled_shots()
                        
                        # Just wait until shot time (preheat should still be running on machine)
                        if delay > 0:
                            await asyncio.sleep(delay)
                    elif ph:
                        # Normal preheat flow for shots that weren't yet preheating
                        preheat_delay = delay - (PREHEAT_DURATION_MINUTES * 60)
                        if preheat_delay > 0:
                            await asyncio.sleep(preheat_delay)
                            _scheduled_shots[sid]["status"] = "preheating"
                            await _save_scheduled_shots()
                            
                            # Start preheat using ActionType.PREHEAT
                            try:
                                from meticulous.api_types import ActionType
                                await async_execute_action(ActionType.PREHEAT)
                            except Exception as e:
                                logger.warning(f"Preheat failed for scheduled shot {sid}: {e}")
                            
                            # Wait for remaining time until shot
                            await asyncio.sleep(PREHEAT_DURATION_MINUTES * 60)
                        else:
                            # Not enough time for full preheat, start immediately
                            _scheduled_shots[sid]["status"] = "preheating"
                            await _save_scheduled_shots()
                            try:
                                from meticulous.api_types import ActionType
                                await async_execute_action(ActionType.PREHEAT)
                            except Exception as e:
                                logger.warning(f"Preheat failed for scheduled shot {sid}: {e}")
                            await asyncio.sleep(delay)
                    else:
                        await asyncio.sleep(delay)
                    
                    _scheduled_shots[sid]["status"] = "running"
                    await _save_scheduled_shots()
                    
                    # Load and run the profile (if profile_id was provided)
                    if pid:
                        load_result = await async_load_profile_by_id(pid)
                        if not (hasattr(load_result, 'error') and load_result.error):
                            from meticulous.api_types import ActionType
                            await async_execute_action(ActionType.START)
                            _scheduled_shots[sid]["status"] = "completed"
                        else:
                            _scheduled_shots[sid]["status"] = "failed"
                            _scheduled_shots[sid]["error"] = load_result.error
                    else:
                        # Preheat only mode - mark as completed
                        _scheduled_shots[sid]["status"] = "completed"
                    
                    await _save_scheduled_shots()
                        
                except asyncio.CancelledError:
                    _scheduled_shots[sid]["status"] = "cancelled"
                    await _save_scheduled_shots()
                except Exception as e:
                    logger.error(f"Scheduled shot {sid} failed: {e}")
                    _scheduled_shots[sid]["status"] = "failed"
                    _scheduled_shots[sid]["error"] = str(e)
                    await _save_scheduled_shots()
                finally:
                    # Clean up task reference
                    if sid in _scheduled_tasks:
                        del _scheduled_tasks[sid]
            
            task = asyncio.create_task(execute_scheduled_shot())
            _scheduled_tasks[schedule_id] = task
            restored_count += 1
            
            logger.info(
                f"Restored scheduled shot {schedule_id} for {scheduled_time_str} "
                f"(profile: {profile_id}, preheat: {preheat}, status: {current_status}, delay: {shot_delay:.0f}s)"
            )
            
        except Exception as e:
            logger.error(f"Failed to restore scheduled shot {schedule_id}: {e}", exc_info=True)
    
    if restored_count > 0:
        logger.info(f"Restored {restored_count} scheduled shot(s) from persistence")


# ============================================================================
# Apply AI Recommendations
# ============================================================================

@router.post("/profile/{name:path}/apply-recommendations")
@router.post("/api/profile/{name:path}/apply-recommendations")
async def apply_recommendations(
    name: str,
    request: Request,
    recommendations: str = Form(...),
):
    """Apply selected AI recommendations to a profile.

    Only applies patchable (adjustable) variables. Info-only variables
    and unknown keys are silently skipped.

    Args:
        name: Profile name on the machine.
        recommendations: JSON string — list of recommendation objects with
            at least ``variable``, ``recommended_value``, ``stage``.

    Returns:
        Updated profile dict.
    """
    request_id = request.state.request_id

    try:
        recs = json.loads(recommendations)
        if not isinstance(recs, list):
            raise HTTPException(status_code=400, detail="recommendations must be a JSON array")
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid recommendations JSON: {exc}")

    try:
        # --- find profile by name ------------------------------------------------
        profiles_result = await async_list_profiles()
        if hasattr(profiles_result, "error") and profiles_result.error:
            raise HTTPException(status_code=502, detail=f"Machine API error: {profiles_result.error}")

        matching_profile = None
        for p in profiles_result:
            if p.name == name:
                matching_profile = p
                break

        if matching_profile is None:
            raise HTTPException(status_code=404, detail=f"Profile '{name}' not found on machine")

        full_profile = await async_get_profile(matching_profile.id)
        if hasattr(full_profile, "error") and full_profile.error:
            raise HTTPException(status_code=502, detail=f"Failed to fetch profile: {full_profile.error}")

        applied: list[dict] = []
        skipped: list[dict] = []

        for rec in recs:
            if not isinstance(rec, dict):
                skipped.append({"variable": "?", "reason": "invalid entry (not an object)"})
                continue
            variable = rec.get("variable", "")
            recommended_value = rec.get("recommended_value")
            stage = rec.get("stage", "")

            if recommended_value is None:
                skipped.append({"variable": variable, "reason": "no recommended_value"})
                continue

            # Validate recommended_value is coercible to a finite number
            try:
                rv_float = float(recommended_value)
                if not math.isfinite(rv_float):
                    raise ValueError("non-finite")
            except (TypeError, ValueError):
                skipped.append({"variable": variable, "reason": "invalid recommended_value"})
                continue

            # --- global settings (temperature, final_weight) ---
            if stage == "global":
                if variable == "temperature" and hasattr(full_profile, "temperature"):
                    try:
                        val = float(recommended_value)
                    except (TypeError, ValueError):
                        skipped.append({"variable": variable, "reason": "invalid value"})
                        continue
                    if val > 100:
                        skipped.append({"variable": variable, "reason": "exceeds 100 °C"})
                        continue
                    full_profile.temperature = val
                    applied.append({"variable": variable, "stage": stage, "value": val})
                    continue
                elif variable == "final_weight" and hasattr(full_profile, "final_weight"):
                    try:
                        val = float(recommended_value)
                    except (TypeError, ValueError):
                        skipped.append({"variable": variable, "reason": "invalid value"})
                        continue
                    if val <= 0:
                        skipped.append({"variable": variable, "reason": "must be > 0"})
                        continue
                    full_profile.final_weight = val
                    applied.append({"variable": variable, "stage": stage, "value": val})
                    continue

            # --- profile variables ---
            if hasattr(full_profile, "variables") and full_profile.variables:
                matched_var = False
                for var in full_profile.variables:
                    var_key = getattr(var, "key", "")
                    if var_key == variable:
                        # Skip info-only variables
                        if var_key.startswith("info_") or getattr(var, "adjustable", None) is False:
                            skipped.append({"variable": variable, "reason": "info-only / not adjustable"})
                            matched_var = True
                            break
                        try:
                            var.value = float(recommended_value)
                        except (TypeError, ValueError):
                            skipped.append({"variable": variable, "reason": "invalid value"})
                            matched_var = True
                            break
                        applied.append({"variable": variable, "stage": stage, "value": var.value})
                        matched_var = True
                        break
                if matched_var:
                    continue

            # --- stage exit triggers ---
            # Variables like "exit_weight", "exit_time" target a stage's exit_triggers
            exit_trigger_map = {
                "exit_weight": "weight",
                "exit_time": "time",
                "exit_pressure": "pressure",
                "exit_flow": "flow",
                "exit_volume": "volume",
            }
            trigger_type = exit_trigger_map.get(variable)
            if trigger_type and stage and hasattr(full_profile, "stages") and full_profile.stages:
                matched_stage = False
                stage_lower = stage.lower()
                for profile_stage in full_profile.stages:
                    stage_name = getattr(profile_stage, "name", "")
                    if stage_name.lower() == stage_lower:
                        triggers = getattr(profile_stage, "exit_triggers", None)
                        if triggers:
                            for trigger in triggers:
                                if getattr(trigger, "type", "") == trigger_type:
                                    try:
                                        trigger.value = float(recommended_value)
                                    except (TypeError, ValueError):
                                        skipped.append({"variable": variable, "reason": "invalid value"})
                                        matched_stage = True
                                        break
                                    applied.append({
                                        "variable": variable,
                                        "stage": stage,
                                        "value": trigger.value,
                                    })
                                    matched_stage = True
                                    break
                        if not matched_stage:
                            skipped.append({"variable": variable, "reason": f"no {trigger_type} exit trigger in stage '{stage_name}'"})
                            matched_stage = True
                        break
                if matched_stage:
                    continue

            # --- stage limits ---
            # Variables like "limit_pressure", "limit_flow" target a stage's limits
            limit_map = {
                "limit_pressure": "pressure",
                "limit_flow": "flow",
                "limit_weight": "weight",
            }
            limit_type = limit_map.get(variable)
            if limit_type and stage and hasattr(full_profile, "stages") and full_profile.stages:
                matched_stage = False
                stage_lower = stage.lower()
                for profile_stage in full_profile.stages:
                    stage_name = getattr(profile_stage, "name", "")
                    if stage_name.lower() == stage_lower:
                        limits = getattr(profile_stage, "limits", None)
                        if limits:
                            for limit in limits:
                                if getattr(limit, "type", "") == limit_type:
                                    try:
                                        limit.value = float(recommended_value)
                                    except (TypeError, ValueError):
                                        skipped.append({"variable": variable, "reason": "invalid value"})
                                        matched_stage = True
                                        break
                                    applied.append({
                                        "variable": variable,
                                        "stage": stage,
                                        "value": limit.value,
                                    })
                                    matched_stage = True
                                    break
                        if not matched_stage:
                            skipped.append({"variable": variable, "reason": f"no {limit_type} limit in stage '{stage_name}'"})
                            matched_stage = True
                        break
                if matched_stage:
                    continue

            skipped.append({"variable": variable, "reason": "variable not found in profile"})

        if not applied:
            return {
                "status": "no_changes",
                "message": "No applicable recommendations to apply",
                "applied": [],
                "skipped": skipped,
            }

        # --- persist -------------------------------------------------------------
        await async_save_profile(full_profile)

        logger.info(
            f"Applied {len(applied)} recommendation(s) to profile '{name}'",
            extra={"request_id": request_id, "applied_count": len(applied), "skipped_count": len(skipped)},
        )

        return {
            "status": "success",
            "profile": deep_convert_to_dict(full_profile),
            "applied": applied,
            "skipped": skipped,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to apply recommendations: {e}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": name},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


# ============================================================================
# Profile recommendations
# ============================================================================


@router.post("/profiles/recommend")
@router.post("/api/profiles/recommend")
async def recommend_profiles(
    request: Request,
    tags: list[str] = Form(default=[]),
    limit: int = Form(default=5),
):
    """Return profile recommendations based on tag preferences.

    Uses structural comparison (stage types, pressure/flow control,
    peak pressure, target weight, temperature) — no AI tokens consumed.
    """
    request_id = request.state.request_id

    try:
        results = await recommendation_service.get_recommendations(
            tags=tags,
            limit=limit,
        )

        return {
            "status": "success",
            "recommendations": results,
            "count": len(results),
        }

    except Exception as e:
        logger.error(
            f"Failed to get recommendations: {e}",
            exc_info=True,
            extra={"request_id": request_id},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )


@router.post("/profiles/find-similar")
@router.post("/api/profiles/find-similar")
async def find_similar_profiles(
    request: Request,
    profile_name: str = Form(...),
    limit: int = Form(default=10),
):
    """Find profiles similar to a given source profile."""
    request_id = request.state.request_id

    try:
        results = await recommendation_service.find_similar(
            source_profile_name=profile_name,
            limit=limit,
        )

        return {
            "status": "success",
            "recommendations": results,
            "count": len(results),
        }

    except Exception as e:
        logger.error(
            f"Failed to find similar profiles: {e}",
            exc_info=True,
            extra={"request_id": request_id},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )
