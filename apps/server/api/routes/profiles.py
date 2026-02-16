"""Profile management endpoints."""
from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException
from typing import Optional, Any
from datetime import datetime, timezone
import json
import os
import logging
import asyncio
import uuid

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
    async_load_profile_by_id,
    async_execute_action,
)
from services.cache_service import _get_cached_image, _set_cached_image
from services.gemini_service import get_vision_model, PROFILING_KNOWLEDGE
from services.history_service import HISTORY_FILE, load_history, save_history
from services.analysis_service import _perform_local_shot_analysis, _generate_profile_description, generate_estimated_target_curves
from api.routes.shots import _prepare_profile_for_llm
from utils.file_utils import atomic_write_json, deep_convert_to_dict

router = APIRouter()
logger = logging.getLogger(__name__)

IMAGE_CACHE_DIR = DATA_DIR / "image_cache"


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
        loop = asyncio.get_event_loop()
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
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                # Get full profile
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
    """Generate an AI image for a profile using Gemini's native image generation.
    
    Uses the google-genai SDK with the gemini-2.5-flash-image model (Nano Banana)
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
                status_code=402,
                detail="Image generation requires GEMINI_API_KEY to be set."
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
        loop = asyncio.get_event_loop()
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
                
                # Construct full URL to the machine
                meticulous_ip = os.getenv("METICULOUS_IP")
                if not meticulous_ip:
                    raise HTTPException(status_code=500, detail="METICULOUS_IP not configured")
                
                image_url = f"http://{meticulous_ip}{image_path}"
                
                # Fetch the image from the machine
                import httpx
                async with httpx.AsyncClient() as client:
                    response = await client.get(image_url, timeout=10.0)
                    
                    if response.status_code != 200:
                        raise HTTPException(
                            status_code=response.status_code,
                            detail="Failed to fetch image from machine"
                        )
                    
                    # Cache the image for future requests
                    _set_cached_image(profile_name, response.content)
                    
                    # Return the image with appropriate content type
                    return Response(
                        content=response.content,
                        media_type="image/png"
                    )
        
        raise HTTPException(
            status_code=404,
            detail=f"Profile '{profile_name}' not found"
        )
        
    except HTTPException:
        raise
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
    request: Request
):
    """Get profile information from the Meticulous machine.
    
    Args:
        profile_name: Name of the profile to fetch
        
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
                
                return {
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
        
        raise HTTPException(
            status_code=404,
            detail=f"Profile '{profile_name}' not found on machine"
        )
        
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
                        "variables": [],
                        "stages": []
                    }
                    
                    # Extract variables if present
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
        model = get_vision_model()
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
                    continue
                
                # Check if this profile exists in our history
                in_history = False
                try:
                    history = load_history()
                    entries = history if isinstance(history, list) else history.get("entries", [])
                    in_history = any(
                        entry.get("profile_name") == full_profile.name 
                        for entry in entries
                    )
                except Exception:
                    pass
                
                # Convert profile to dict
                profile_dict = {
                    "id": full_profile.id,
                    "name": full_profile.name,
                    "author": getattr(full_profile, 'author', None),
                    "temperature": getattr(full_profile, 'temperature', None),
                    "final_weight": getattr(full_profile, 'final_weight', None),
                    "in_history": in_history,
                    "has_description": False,
                    "description": None
                }
                
                # Check for existing description in history
                if in_history:
                    try:
                        for entry in entries:
                            if entry.get("profile_name") == full_profile.name:
                                if entry.get("reply"):
                                    profile_dict["has_description"] = True
                                break
                    except Exception:
                        pass
                
                profiles.append(profile_dict)
            except Exception as e:
                logger.warning(
                    f"Failed to fetch profile {partial_profile.name}: {e}",
                    extra={"request_id": request_id}
                )
        
        logger.info(
            f"Found {len(profiles)} profiles on machine",
            extra={"request_id": request_id, "profile_count": len(profiles)}
        )
        
        return {
            "status": "success",
            "profiles": profiles,
            "total": len(profiles)
        }
        
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
                reply = f"Profile imported from {source}. Description generation failed."
        else:
            reply = f"Profile imported from {source}."
        
        # Create history entry
        entry_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        
        new_entry = {
            "id": entry_id,
            "created_at": created_at,
            "profile_name": profile_name,
            "user_preferences": f"Imported from {source}",
            "reply": reply,
            "profile_json": deep_convert_to_dict(profile_json),
            "imported": True,
            "import_source": source
        }
        
        # Save to history using cache-aware save to keep in-memory cache in sync
        history = load_history()
        if not isinstance(history, list):
            history = history.get("entries", [])
        
        history.insert(0, new_entry)
        
        save_history(history)
        
        logger.info(
            f"Profile imported successfully: {profile_name}",
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        
        return {
            "status": "success",
            "entry_id": entry_id,
            "profile_name": profile_name,
            "has_description": reply is not None and "Description generation failed" not in reply
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
                    reply = None
                    try:
                        reply = await _generate_profile_description(profile_json, request_id)
                    except Exception as e:
                        logger.warning(f"Failed to generate description for {profile_name}: {e}")
                        reply = "Profile imported from machine. Description generation failed."
                    
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

        model = get_vision_model()
        response = await model.async_generate_content(prompt)
        converted_description = response.text.strip()
        
        # Update the history entry if it exists
        entry_id = body.get("entry_id")
        if entry_id:
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

