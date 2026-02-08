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

Create `meticai-server/config.py`:
```python
from pydantic_settings import BaseSettings
from pydantic import Field
from pathlib import Path
import os
import tempfile

class Settings(BaseSettings):
    # API Keys
    gemini_api_key: str = Field(..., env="GEMINI_API_KEY")
    
    # Machine Configuration  
    meticulous_ip: str = Field(..., env="METICULOUS_IP")
    pi_ip: str = Field(..., env="PI_IP")
    
    # Data Directories
    data_dir: Path = Field(default="/app/data", env="DATA_DIR")
    log_dir: Path = Field(default="/app/logs", env="LOG_DIR")
    
    # Application Settings
    update_check_interval: int = 7200  # 2 hours
    max_upload_size: int = 10 * 1024 * 1024  # 10 MB
    
    # Cache Settings
    llm_cache_ttl_seconds: int = 259200  # 3 days
    shot_cache_stale_seconds: int = 3600  # 1 hour
    
    # Test Mode
    test_mode: bool = Field(default=False, env="TEST_MODE")
    
    class Config:
        env_file = ".env"
        case_sensitive = False
```

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
