# Phase 4: Documentation & Configuration - Implementation Plan

## Overview

Phase 4 focuses on improving API documentation and creating a unified configuration management system.

## Goals

### 1. Add Comprehensive API Documentation
- Add detailed docstrings to all API endpoints
- Include parameter descriptions
- Document response schemas
- Add error response documentation
- Consider OpenAPI examples

### 2. Create Unified Configuration Module
- Consolidate scattered configuration
- Use pydantic-settings for type-safe configuration
- Environment variables centralized
- Constants defined in one place
- Easy to test and mock

### 3. Document Docker Compose Volume Mounts
- Document purpose of each volume mount
- Identify which are essential vs optional
- Security review of mounts (.git, docker.sock)
- Consider reducing where possible

## Implementation Steps

### Step 1: Create Unified Config Module

Create `meticai-server/config.py` (simple class-based approach for no new dependencies):
```python
class Config:
    # Environment-based configuration
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
    METICULOUS_IP = os.environ.get("METICULOUS_IP")
    
    # Application constants
    UPDATE_CHECK_INTERVAL = 7200  # 2 hours
    MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
    
    # Cache settings
    LLM_CACHE_TTL_SECONDS = 259200  # 3 days
    SHOT_CACHE_STALE_SECONDS = 3600  # 1 hour
```

Note: Using simple class instead of pydantic-settings to avoid adding new dependencies.

### Step 2: Update Code to Use Config

- Replace hardcoded constants with config.settings
- Update services to accept config as dependency
- Make testing easier with configurable values

### Step 3: Add API Documentation

For each route module, enhance docstrings:
```python
@router.post("/analyze_coffee")
async def analyze_coffee(
    request: Request, 
    file: UploadFile = File(...)
):
    """Analyze a coffee bag image using Google Gemini Vision AI.
    
    Args:
        request: FastAPI request object
        file: Coffee bag image (PNG, JPEG, or WEBP, max 10MB)
        
    Returns:
        JSONResponse containing:
        - analysis (str): Coffee identification and characteristics
        - status (str): "success"
        - timestamp (str): ISO 8601 timestamp
        
    Raises:
        HTTPException(400): If file is too large or invalid format
        HTTPException(500): If Gemini API fails
        
    Example:
        POST /analyze_coffee
        Content-Type: multipart/form-data
        
        Response:
        {
            "analysis": "Ethiopian Yirgacheffe, Light Roast, Floral Notes",
            "status": "success",
            "timestamp": "2026-02-08T14:47:00Z"
        }
    """
```

### Step 4: Document Docker Volumes

Create `DOCKER_VOLUMES.md` documenting each mount:

| Mount | Purpose | Essential | Security Notes |
|-------|---------|-----------|----------------|
| `/var/run/docker.sock` | Container management | Yes | Risk: Full Docker access |
| `./.git` | Version tracking | No | Consider removing |
| `./data` | Persistent data | Yes | Safe |
| `./logs` | Log files | Yes | Safe |

### Step 5: Verify and Test

- Ensure config module works
- Test with environment variables
- Verify all imports work
- Update tests to use config

## Success Criteria

- ✅ All API endpoints have comprehensive docstrings
- ✅ Unified config module created
- ✅ All constants moved to config
- ✅ Docker volumes documented
- ✅ Tests pass with config changes
- ✅ Code review passes

---

**Status**: Planning Complete - Ready to Implement
**Next**: Create config.py module
