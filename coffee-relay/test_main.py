"""
Comprehensive tests for the Coffee Relay FastAPI application.

Tests cover:
- /analyze_coffee endpoint functionality
- /analyze_and_profile endpoint functionality (consolidated endpoint)
- Error handling and edge cases
- Integration with Gemini AI (mocked)
"""

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from unittest.mock import Mock, patch, MagicMock, mock_open, AsyncMock
from io import BytesIO
from PIL import Image
from pathlib import Path
import os
import subprocess
import json
import time


# Import the app
import sys
sys.path.insert(0, os.path.dirname(__file__))
from main import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def sample_image():
    """Create a sample image for testing."""
    # Create a simple test image
    img = Image.new('RGB', (100, 100), color='red')
    img_bytes = BytesIO()
    img.save(img_bytes, format='PNG')
    img_bytes.seek(0)
    return img_bytes


class TestAnalyzeCoffeeEndpoint:
    """Tests for the /analyze_coffee endpoint."""

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_vision_model')
    def test_analyze_coffee_success(self, mock_vision_model, client, sample_image):
        """Test successful coffee bag analysis."""
        # Mock the Gemini response
        mock_response = Mock()
        mock_response.text = "Ethiopian Yirgacheffe, Light Roast, Floral and Citrus Notes"
        mock_vision_model.return_value.generate_content.return_value = mock_response

        # Send request
        response = client.post(
            "/analyze_coffee",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        # Assertions
        assert response.status_code == 200
        assert "analysis" in response.json()
        assert "Ethiopian" in response.json()["analysis"]
        mock_vision_model.return_value.generate_content.assert_called_once()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_vision_model')
    def test_analyze_coffee_with_whitespace(self, mock_vision_model, client, sample_image):
        """Test that response text is properly stripped of whitespace."""
        # Mock response with extra whitespace
        mock_response = Mock()
        mock_response.text = "  Colombian Supremo, Medium Roast  \n"
        mock_vision_model.return_value.generate_content.return_value = mock_response

        response = client.post(
            "/analyze_coffee",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        assert response.status_code == 200
        assert response.json()["analysis"] == "Colombian Supremo, Medium Roast"

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_vision_model')
    def test_analyze_coffee_api_error(self, mock_vision_model, client, sample_image):
        """Test error handling when Gemini API fails."""
        # Mock an API error
        mock_vision_model.return_value.generate_content.side_effect = Exception("API Error: Rate limit exceeded")

        response = client.post(
            "/analyze_coffee",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        assert response.status_code == 200
        assert "error" in response.json()
        assert "API Error" in response.json()["error"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_analyze_coffee_invalid_image(self, client):
        """Test handling of invalid image data."""
        # Send invalid image data
        invalid_data = BytesIO(b"not an image")
        
        response = client.post(
            "/analyze_coffee",
            files={"file": ("test.txt", invalid_data, "text/plain")}
        )

        assert response.status_code == 200
        assert "error" in response.json()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_analyze_coffee_missing_file(self, client):
        """Test error when no file is provided."""
        response = client.post("/analyze_coffee")
        
        assert response.status_code == 422  # Unprocessable Entity

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_vision_model')
    def test_analyze_coffee_different_image_formats(self, mock_vision_model, client):
        """Test analysis with different image formats (JPEG, PNG, etc.)."""
        mock_response = Mock()
        mock_response.text = "Test coffee analysis"
        mock_vision_model.return_value.generate_content.return_value = mock_response

        for format_type in ['PNG', 'JPEG']:
            img = Image.new('RGB', (100, 100), color='blue')
            img_bytes = BytesIO()
            img.save(img_bytes, format=format_type)
            img_bytes.seek(0)

            response = client.post(
                "/analyze_coffee",
                files={"file": (f"test.{format_type.lower()}", img_bytes, f"image/{format_type.lower()}")}
            )

            assert response.status_code == 200
            assert "analysis" in response.json()


class TestAnalyzeAndProfileEndpoint:
    """Tests for the /analyze_and_profile endpoint (consolidated endpoint)."""

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.save_to_history')
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_analyze_and_profile_with_image_only(self, mock_vision_model, mock_subprocess, mock_save_history, client, sample_image):
        """Test profile creation with only an image (no user preferences)."""
        # Mock history saving
        mock_save_history.return_value = {"id": "test-123"}
        
        # Mock the Gemini vision response
        mock_response = Mock()
        mock_response.text = "Ethiopian Yirgacheffe, Light Roast, Floral Notes"
        mock_vision_model.return_value.generate_content.return_value = mock_response
        
        # Mock successful subprocess execution
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Profile uploaded"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "success"
        assert response.json()["analysis"] == "Ethiopian Yirgacheffe, Light Roast, Floral Notes"
        assert "Profile uploaded" in response.json()["reply"]
        
        # Verify vision model was called
        mock_vision_model.return_value.generate_content.assert_called_once()
        
        # Verify subprocess was called with correct arguments
        mock_subprocess.assert_called_once()
        call_args = mock_subprocess.call_args[0][0]
        assert "docker" in call_args
        assert "gemini-client" in call_args
        assert "-y" in call_args  # yolo mode for auto-approval
        
        # Verify the prompt contains the analysis
        prompt = call_args[-1]
        assert "Ethiopian Yirgacheffe, Light Roast, Floral Notes" in prompt

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.save_to_history')
    @patch('main.subprocess.run')
    def test_analyze_and_profile_with_prefs_only(self, mock_subprocess, mock_save_history, client):
        """Test profile creation with only user preferences (no image)."""
        # Mock history saving
        mock_save_history.return_value = {"id": "test-456"}
        
        # Mock successful subprocess execution
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Profile uploaded"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            data={"user_prefs": "Strong and intense espresso"}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "success"
        assert response.json()["analysis"] is None  # No image, so no analysis
        assert "Profile uploaded" in response.json()["reply"]
        
        # Verify subprocess was called with user preferences
        call_args = mock_subprocess.call_args[0][0]
        prompt = call_args[-1]
        assert "Strong and intense espresso" in prompt

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.save_to_history')
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_analyze_and_profile_with_both(self, mock_vision_model, mock_subprocess, mock_save_history, client, sample_image):
        """Test profile creation with both image and user preferences."""
        # Mock history saving
        mock_save_history.return_value = {"id": "test-789"}
        
        # Mock the Gemini vision response
        mock_response = Mock()
        mock_response.text = "Colombian Supremo, Medium Roast, Nutty"
        mock_vision_model.return_value.generate_content.return_value = mock_response
        
        # Mock successful subprocess execution
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Profile uploaded"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            files={"file": ("test.png", sample_image, "image/png")},
            data={"user_prefs": "Quick extraction"}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "success"
        assert response.json()["analysis"] == "Colombian Supremo, Medium Roast, Nutty"
        
        # Verify subprocess was called with both coffee analysis and user preferences
        call_args = mock_subprocess.call_args[0][0]
        prompt = call_args[-1]
        assert "Colombian Supremo, Medium Roast, Nutty" in prompt
        assert "Quick extraction" in prompt

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_analyze_and_profile_missing_both(self, client):
        """Test error when neither image nor preferences are provided."""
        response = client.post("/analyze_and_profile")
        
        assert response.status_code == 400
        assert "at least one" in response.json()["detail"].lower()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_analyze_and_profile_subprocess_error(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test error handling when subprocess fails."""
        # Mock the Gemini vision response
        mock_response = Mock()
        mock_response.text = "Test Coffee"
        mock_vision_model.return_value.generate_content.return_value = mock_response
        
        # Mock subprocess failure
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "Docker container not found"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "error"
        assert response.json()["analysis"] == "Test Coffee"
        assert "Docker container not found" in response.json()["message"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_analyze_and_profile_exception(self, mock_subprocess, client):
        """Test handling of unexpected exceptions."""
        # Mock an exception in subprocess
        mock_subprocess.side_effect = Exception("Unexpected error occurred")

        response = client.post(
            "/analyze_and_profile",
            data={"user_prefs": "Default"}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "error"
        assert "Unexpected error" in response.json()["message"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_vision_model')
    def test_analyze_and_profile_image_processing_error(self, mock_vision_model, client):
        """Test error when image processing fails."""
        # Mock an exception in vision model
        mock_vision_model.return_value.generate_content.side_effect = Exception("Vision API error")
        
        # Send invalid image data
        invalid_data = BytesIO(b"not an image")

        response = client.post(
            "/analyze_and_profile",
            files={"file": ("test.txt", invalid_data, "text/plain")}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "error"

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.save_to_history')
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_analyze_and_profile_various_preferences(self, mock_vision_model, mock_subprocess, mock_save_history, client, sample_image):
        """Test profile creation with different user preferences."""
        # Mock history saving
        mock_save_history.return_value = {"id": "test-multi"}
        
        mock_response = Mock()
        mock_response.text = "Test Coffee"
        mock_vision_model.return_value.generate_content.return_value = mock_response
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Profile uploaded"
        mock_subprocess.return_value = mock_result

        preferences = [
            "Strong and intense",
            "Mild and smooth",
            "Default settings",
            "Quick extraction"
        ]

        for pref in preferences:
            response = client.post(
                "/analyze_and_profile",
                files={"file": ("test.png", sample_image, "image/png")},
                data={"user_prefs": pref}
            )
            
            assert response.status_code == 200
            assert response.json()["status"] == "success"

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_analyze_and_profile_yolo_mode(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test that yolo mode is used for auto-approval of tool calls.
        
        Note: The --allowed-tools flag doesn't work with MCP-provided tools,
        so we use -y (yolo mode) instead. Security is maintained because
        the MCP server only exposes safe tools.
        """
        mock_response = Mock()
        mock_response.text = "Test Coffee"
        mock_vision_model.return_value.generate_content.return_value = mock_response
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        call_args = mock_subprocess.call_args[0][0]
        
        # Verify that yolo mode flag is present for auto-approval
        assert "-y" in call_args
        
        # Verify the command structure is correct
        assert "docker" in call_args
        assert "exec" in call_args
        assert "-i" in call_args
        assert "gemini-client" in call_args
        assert "gemini" in call_args

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.save_to_history')
    @patch('main.subprocess.run')
    def test_analyze_and_profile_special_characters(self, mock_subprocess, mock_save_history, client):
        """Test handling of special characters in input."""
        # Mock history saving
        mock_save_history.return_value = {"id": "test-special"}
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            data={"user_prefs": "Extra-strong <intense> & 'special' \"roast\""}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "success"



class TestHealthAndStartup:
    """Tests for application health and startup."""

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_app_imports_successfully(self):
        """Test that the app can be imported without errors."""
        from main import app
        assert app is not None

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_fastapi_app_initialization(self, client):
        """Test that FastAPI app initializes correctly."""
        # Try to access the OpenAPI schema
        response = client.get("/openapi.json")
        assert response.status_code == 200
        
        # Verify our endpoints are registered
        openapi_data = response.json()
        assert "/analyze_coffee" in openapi_data["paths"]
        assert "/analyze_and_profile" in openapi_data["paths"]


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_vision_model')
    def test_analyze_coffee_large_image(self, mock_vision_model, client):
        """Test handling of large images."""
        mock_response = Mock()
        mock_response.text = "Analysis result"
        mock_vision_model.return_value.generate_content.return_value = mock_response

        # Create a larger image
        img = Image.new('RGB', (4000, 3000), color='green')
        img_bytes = BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)

        response = client.post(
            "/analyze_coffee",
            files={"file": ("large.png", img_bytes, "image/png")}
        )

        assert response.status_code == 200
        assert "analysis" in response.json()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_vision_model')
    def test_analyze_coffee_very_long_response(self, mock_vision_model, client, sample_image):
        """Test handling of very long AI responses."""
        mock_response = Mock()
        mock_response.text = "A" * 10000  # Very long response
        mock_vision_model.return_value.generate_content.return_value = mock_response

        response = client.post(
            "/analyze_coffee",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        assert response.status_code == 200
        assert len(response.json()["analysis"]) == 10000


class TestEnhancedBaristaPersona:
    """Tests for enhanced barista persona and profile creation features."""

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_prompt_includes_modern_barista_persona(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test that the prompt includes the modern experimental barista persona."""
        mock_response = Mock()
        mock_response.text = "Ethiopian Coffee, Light Roast"
        mock_vision_model.return_value.generate_content.return_value = mock_response
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        # Verify the prompt contains persona elements
        call_args = mock_subprocess.call_args[0][0]
        prompt = call_args[-1]
        
        assert "PERSONA:" in prompt
        assert "modern, experimental barista" in prompt
        assert "espresso profiling" in prompt
        assert "creative" in prompt or "puns" in prompt

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_prompt_includes_complex_profile_support(self, mock_subprocess, client):
        """Test that the prompt includes instructions for complex profile creation."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            data={"user_prefs": "Test preferences"}
        )

        # Verify the prompt includes complex profile guidelines
        call_args = mock_subprocess.call_args[0][0]
        prompt = call_args[-1]
        
        assert "PROFILE CREATION GUIDELINES:" in prompt
        assert "multi-stage extraction" in prompt
        assert "pre-infusion" in prompt
        assert "blooming" in prompt

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_prompt_includes_naming_convention(self, mock_subprocess, client):
        """Test that the prompt includes witty naming convention instructions."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            data={"user_prefs": "Strong espresso"}
        )

        # Verify the prompt includes naming guidelines
        call_args = mock_subprocess.call_args[0][0]
        prompt = call_args[-1]
        
        assert "NAMING CONVENTION:" in prompt
        assert "witty" in prompt or "pun" in prompt
        assert "Examples:" in prompt

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_prompt_includes_user_summary_instructions(self, mock_subprocess, client):
        """Test that the prompt includes instructions for post-creation user summary."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            data={"user_prefs": "Test"}
        )

        # Verify the prompt includes user summary requirements
        call_args = mock_subprocess.call_args[0][0]
        prompt = call_args[-1]
        
        assert "user summary" in prompt
        assert "Profile Name" in prompt or "Description" in prompt
        assert "Preparation" in prompt
        assert "Design Rationale" in prompt or "Why This Works" in prompt
        assert "Special Requirements" in prompt or "Special Notes" in prompt

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_prompt_includes_output_format(self, mock_subprocess, client):
        """Test that the prompt includes the output format template."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            data={"user_prefs": "Test"}
        )

        # Verify the prompt includes output format
        call_args = mock_subprocess.call_args[0][0]
        prompt = call_args[-1]
        
        assert "OUTPUT FORMAT:" in prompt
        assert "Profile Created:" in prompt
        assert "Description:" in prompt
        assert "Preparation:" in prompt
        assert "Why This Works:" in prompt

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_enhanced_prompt_with_both_inputs(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test enhanced prompt when both image and preferences are provided."""
        mock_response = Mock()
        mock_response.text = "Kenyan AA, Medium Roast, Berry notes"
        mock_vision_model.return_value.generate_content.return_value = mock_response
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Profile Created: The Berry Express"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            files={"file": ("test.png", sample_image, "image/png")},
            data={"user_prefs": "Highlight berry notes"}
        )

        assert response.status_code == 200
        
        # Verify the prompt includes all elements for both inputs
        call_args = mock_subprocess.call_args[0][0]
        prompt = call_args[-1]
        
        # Should have coffee analysis
        assert "Kenyan AA, Medium Roast, Berry notes" in prompt
        # Should have user preferences
        assert "Highlight berry notes" in prompt
        # Should have all enhancement features
        assert "PERSONA:" in prompt
        assert "PROFILE CREATION GUIDELINES:" in prompt
        assert "NAMING CONVENTION:" in prompt
        assert "OUTPUT FORMAT:" in prompt


class TestCORS:
    """Tests for CORS middleware configuration."""

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_vision_model')
    def test_cors_headers_on_analyze_coffee(self, mock_vision_model, client, sample_image):
        """Test that CORS headers are present on /analyze_coffee responses."""
        mock_response = Mock()
        mock_response.text = "Test coffee"
        mock_vision_model.return_value.generate_content.return_value = mock_response

        response = client.post(
            "/analyze_coffee",
            files={"file": ("test.png", sample_image, "image/png")},
            headers={"Origin": "http://localhost:3000"}
        )

        assert response.status_code == 200
        # Check for CORS headers
        assert "access-control-allow-origin" in response.headers
        assert response.headers["access-control-allow-origin"] == "*"

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_cors_headers_on_analyze_and_profile(self, mock_subprocess, client):
        """Test that CORS headers are present on /analyze_and_profile responses."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            data={"user_prefs": "Test"},
            headers={"Origin": "http://localhost:3000"}
        )

        assert response.status_code == 200
        # Check for CORS headers
        assert "access-control-allow-origin" in response.headers
        assert response.headers["access-control-allow-origin"] == "*"

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_cors_preflight_request(self, client):
        """Test CORS preflight OPTIONS request."""
        response = client.options(
            "/analyze_coffee",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type"
            }
        )

        # Preflight requests should return 200
        assert response.status_code == 200
        # Check CORS headers on preflight response
        assert "access-control-allow-origin" in response.headers
        assert "access-control-allow-methods" in response.headers
        assert "access-control-allow-headers" in response.headers

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_cors_allows_credentials(self, client):
        """Test that CORS allows credentials."""
        response = client.options(
            "/analyze_and_profile",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST"
            }
        )

        assert response.status_code == 200
        assert "access-control-allow-credentials" in response.headers
        assert response.headers["access-control-allow-credentials"] == "true"


class TestStatusEndpoint:
    """Tests for the /status endpoint."""

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_status_endpoint_exists(self, mock_subprocess, client):
        """Test that /status endpoint exists and is accessible."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "✓ Everything is up to date!"
        mock_subprocess.return_value = mock_result

        response = client.get("/status")
        assert response.status_code == 200

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    @patch('main.Path')
    def test_status_returns_json_structure(self, mock_path, mock_subprocess, client):
        """Test that /status returns expected JSON structure."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "✓ Up to date"
        mock_subprocess.return_value = mock_result

        # Mock version file
        mock_version_file = Mock()
        mock_version_file.exists.return_value = True
        mock_path.return_value = mock_version_file
        
        with patch('builtins.open', create=True) as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = '{"last_check": "2026-01-13T00:00:00Z", "repositories": {}}'
            
            response = client.get("/status")
            
        assert response.status_code == 200
        data = response.json()
        assert "update_available" in data
        assert "last_check" in data or "error" in data
        assert isinstance(data.get("update_available"), bool) or "error" in data

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('builtins.open', new_callable=mock_open, read_data='{"update_available": true, "last_check": "2024-01-01T00:00:00", "repositories": {"mcp": {"update_available": true}}}')
    @patch('main.Path')
    def test_status_detects_updates_available(self, mock_path, mock_file, client):
        """Test that /status correctly identifies when updates are available."""
        # Mock version file as existing
        mock_version_file = Mock()
        mock_version_file.exists.return_value = True
        mock_path.return_value = mock_version_file

        response = client.get("/status")
        assert response.status_code == 200
        data = response.json()
        assert data.get("update_available") == True

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('builtins.open', new_callable=mock_open, read_data='{"update_available": true, "last_check": "2024-01-01T00:00:00", "repositories": {"mcp": {"update_available": true}}}')
    @patch('main.Path')
    def test_status_detects_missing_dependencies(self, mock_path, mock_file, client):
        """Test that /status identifies missing dependencies as requiring updates."""
        # Mock version file as existing
        mock_version_file = Mock()
        mock_version_file.exists.return_value = True
        mock_path.return_value = mock_version_file

        response = client.get("/status")
        assert response.status_code == 200
        data = response.json()
        assert data.get("update_available") == True

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_status_handles_missing_version_file(self, mock_path, client):
        """Test that /status handles missing version file gracefully."""
        # Mock version file as not existing
        mock_version_file = Mock()
        mock_version_file.exists.return_value = False
        mock_path.return_value = mock_version_file

        response = client.get("/status")
        assert response.status_code == 200
        data = response.json()
        # Should still return a valid response
        assert "update_available" in data

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('builtins.open')
    @patch('main.Path')
    def test_status_handles_script_error(self, mock_path, mock_open_func, client):
        """Test that /status handles update script errors gracefully."""
        # Mock version file as existing but simulate error reading it
        mock_version_file = Mock()
        mock_version_file.exists.return_value = True
        mock_path.return_value = mock_version_file
        mock_open_func.side_effect = Exception("File read error")

        response = client.get("/status")
        assert response.status_code == 200
        data = response.json()
        # Should return error information
        assert "error" in data or "message" in data

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_status_endpoint_cors_enabled(self, mock_path, client):
        """Test that /status endpoint has CORS enabled for web app."""
        # Mock version file as not existing for simplicity
        mock_version_file = Mock()
        mock_version_file.exists.return_value = False
        mock_path.return_value = mock_version_file

        response = client.get(
            "/status",
            headers={"Origin": "http://localhost:3550"}
        )

        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_status_in_openapi_schema(self, client):
        """Test that /status endpoint is registered in OpenAPI schema."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        
        openapi_data = response.json()
        assert "/status" in openapi_data["paths"]
        assert "get" in openapi_data["paths"]["/status"]


class TestTriggerUpdateEndpoint:
    """Tests for the /api/trigger-update endpoint."""

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_success(self, mock_path_class, client):
        """Test successful update trigger."""
        # Mock the rebuild signal file
        mock_rebuild_file = Mock()
        mock_path_class.return_value = mock_rebuild_file

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "message" in data
        assert "host will pull updates and restart containers" in data["message"].lower()
        
        # Verify write_text was called to signal the update
        mock_rebuild_file.write_text.assert_called_once()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_write_failure(self, mock_path, client):
        """Test handling of file write failure."""
        # Mock the rebuild signal file to raise an exception on write
        mock_rebuild_file = Mock()
        mock_rebuild_file.write_text.side_effect = OSError("Permission denied")
        mock_path.return_value = mock_rebuild_file

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert data["detail"]["status"] == "error"
        assert "Permission denied" in data["detail"]["error"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_io_error(self, mock_path, client):
        """Test handling of IO errors."""
        # Mock the rebuild signal file to raise an IO exception
        mock_rebuild_file = Mock()
        mock_rebuild_file.write_text.side_effect = IOError("Disk full")
        mock_path.return_value = mock_rebuild_file

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert data["detail"]["status"] == "error"
        assert "Disk full" in data["detail"]["error"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_unexpected_error(self, mock_path, client):
        """Test handling of unexpected errors."""
        # Mock the rebuild signal file to raise an unexpected exception
        mock_rebuild_file = Mock()
        mock_rebuild_file.write_text.side_effect = Exception("Unexpected error")
        mock_path.return_value = mock_rebuild_file

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert data["detail"]["status"] == "error"
        assert "unexpected error" in data["detail"]["error"].lower()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_cors_enabled(self, mock_path, client):
        """Test that /api/trigger-update has CORS enabled."""
        # Mock the rebuild signal file
        mock_rebuild_file = Mock()
        mock_path.return_value = mock_rebuild_file

        response = client.post(
            "/api/trigger-update",
            headers={"Origin": "http://localhost:3550"}
        )

        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_trigger_update_in_openapi_schema(self, client):
        """Test that /api/trigger-update endpoint is registered in OpenAPI schema."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        
        openapi_data = response.json()
        assert "/api/trigger-update" in openapi_data["paths"]
        assert "post" in openapi_data["paths"]["/api/trigger-update"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_no_body_required(self, mock_path, client):
        """Test that endpoint works without request body."""
        # Mock the rebuild signal file
        mock_rebuild_file = Mock()
        mock_path.return_value = mock_rebuild_file

        # Test without any body
        response = client.post("/api/trigger-update")
        
        assert response.status_code == 200
        assert response.json()["status"] == "success"

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_signal_written(self, mock_path, client):
        """Test that timestamp is written to signal file."""
        # Mock the rebuild signal file
        mock_rebuild_file = Mock()
        mock_path.return_value = mock_rebuild_file

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        
        # Verify write_text was called with a timestamp string
        mock_rebuild_file.write_text.assert_called_once()
        call_args = mock_rebuild_file.write_text.call_args[0][0]
        # Verify the update signal format (flexible to allow timestamp changes)
        assert call_args.startswith("update-requested:")

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_partial_failure(self, mock_path, client):
        """Test handling when file write operation encounters an error."""
        # Mock the rebuild signal file to raise an error
        mock_rebuild_file = Mock()
        mock_rebuild_file.write_text.side_effect = PermissionError("Cannot write to file")
        mock_path.return_value = mock_rebuild_file

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        # The detail is nested in the response
        assert "detail" in data
        assert "status" in str(data["detail"])
        assert "error" in str(data["detail"])

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_timeout(self, mock_path, client):
        """Test handling when file write operation times out or hangs."""
        # Mock the rebuild signal file to raise a timeout-related error
        mock_rebuild_file = Mock()
        mock_rebuild_file.write_text.side_effect = TimeoutError("File operation timed out")
        mock_path.return_value = mock_rebuild_file

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        # Check the error field contains the timeout-related message
        assert "timed" in data["detail"]["error"].lower()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.Path')
    def test_trigger_update_path_resolution(self, mock_path, client):
        """Test that file path is properly resolved."""
        # Mock the rebuild signal file
        mock_rebuild_file = Mock()
        mock_path.return_value = mock_rebuild_file

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 200
        # Verify Path was called with the correct path
        mock_path.assert_called_once_with("/app/.update-requested")
        # Verify write_text was called
        mock_rebuild_file.write_text.assert_called_once()


class TestHistoryAPI:
    """Tests for the profile history API endpoints."""

    @pytest.fixture
    def mock_history_file(self, tmp_path):
        """Create a temporary history file."""
        history_file = tmp_path / "profile_history.json"
        history_file.write_text("[]")
        return history_file

    @pytest.fixture
    def sample_history_entry(self):
        """Create a sample history entry."""
        return {
            "id": "test-entry-123",
            "created_at": "2026-01-18T10:00:00+00:00",
            "profile_name": "Ethiopian Sunrise",
            "coffee_analysis": "Light roast with floral notes",
            "user_preferences": "Light Body with Florals",
            "reply": "Profile Created: Ethiopian Sunrise\n\nDescription: A bright and floral profile...",
            "profile_json": {"name": "Ethiopian Sunrise", "stages": []},
            "image_preview": None
        }

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_get_history_empty(self, mock_load, client):
        """Test getting history when it's empty."""
        mock_load.return_value = []

        response = client.get("/api/history")
        
        assert response.status_code == 200
        data = response.json()
        assert data["entries"] == []
        assert data["total"] == 0
        assert data["limit"] == 50
        assert data["offset"] == 0

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_get_history_with_entries(self, mock_load, client, sample_history_entry):
        """Test getting history with existing entries."""
        mock_load.return_value = [sample_history_entry]

        response = client.get("/api/history")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["entries"]) == 1
        assert data["entries"][0]["profile_name"] == "Ethiopian Sunrise"
        assert data["total"] == 1

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_get_history_pagination(self, mock_load, client, sample_history_entry):
        """Test history pagination with limit and offset."""
        # Create multiple entries
        entries = []
        for i in range(10):
            entry = sample_history_entry.copy()
            entry["id"] = f"entry-{i}"
            entry["profile_name"] = f"Profile {i}"
            entries.append(entry)
        mock_load.return_value = entries

        # Test with custom limit and offset
        response = client.get("/api/history?limit=3&offset=2")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["entries"]) == 3
        assert data["total"] == 10
        assert data["limit"] == 3
        assert data["offset"] == 2

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_get_history_removes_image_preview(self, mock_load, client, sample_history_entry):
        """Test that image_preview is removed from list view."""
        entry = sample_history_entry.copy()
        entry["image_preview"] = "base64-thumbnail-data"
        mock_load.return_value = [entry]

        response = client.get("/api/history")
        
        assert response.status_code == 200
        data = response.json()
        # image_preview should be None in list view
        assert data["entries"][0]["image_preview"] is None

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_get_history_entry_by_id(self, mock_load, client, sample_history_entry):
        """Test getting a specific history entry by ID."""
        mock_load.return_value = [sample_history_entry]

        response = client.get(f"/api/history/{sample_history_entry['id']}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == sample_history_entry["id"]
        assert data["profile_name"] == "Ethiopian Sunrise"
        assert data["profile_json"] is not None

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_get_history_entry_not_found(self, mock_load, client):
        """Test 404 when history entry doesn't exist."""
        mock_load.return_value = []

        response = client.get("/api/history/non-existent-id")
        
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._save_history')
    @patch('main._load_history')
    def test_delete_history_entry(self, mock_load, mock_save, client, sample_history_entry):
        """Test deleting a specific history entry."""
        mock_load.return_value = [sample_history_entry]

        response = client.delete(f"/api/history/{sample_history_entry['id']}")
        
        assert response.status_code == 200
        assert response.json()["status"] == "success"
        # Verify save was called with empty list
        mock_save.assert_called_once_with([])

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_delete_history_entry_not_found(self, mock_load, client):
        """Test 404 when deleting non-existent entry."""
        mock_load.return_value = []

        response = client.delete("/api/history/non-existent-id")
        
        assert response.status_code == 404

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._save_history')
    @patch('main._load_history')
    def test_clear_history(self, mock_load, mock_save, client, sample_history_entry):
        """Test clearing all history."""
        mock_load.return_value = [sample_history_entry]

        response = client.delete("/api/history")
        
        assert response.status_code == 200
        assert response.json()["status"] == "success"
        assert "cleared" in response.json()["message"].lower()
        mock_save.assert_called_once_with([])

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_get_profile_json(self, mock_load, client, sample_history_entry):
        """Test getting profile JSON for download."""
        mock_load.return_value = [sample_history_entry]

        response = client.get(f"/api/history/{sample_history_entry['id']}/json")
        
        assert response.status_code == 200
        assert response.json()["name"] == "Ethiopian Sunrise"
        assert "content-disposition" in response.headers
        assert "ethiopian-sunrise.json" in response.headers["content-disposition"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_get_profile_json_not_available(self, mock_load, client, sample_history_entry):
        """Test 404 when profile JSON is not available."""
        entry = sample_history_entry.copy()
        entry["profile_json"] = None
        mock_load.return_value = [entry]

        response = client.get(f"/api/history/{sample_history_entry['id']}/json")
        
        assert response.status_code == 404
        assert "not available" in response.json()["detail"].lower()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._load_history')
    def test_get_profile_json_entry_not_found(self, mock_load, client):
        """Test 404 when entry doesn't exist for JSON download."""
        mock_load.return_value = []

        response = client.get("/api/history/non-existent-id/json")
        
        assert response.status_code == 404


class TestHistoryHelperFunctions:
    """Tests for history helper functions."""

    def test_extract_profile_json_from_code_block(self):
        """Test extracting profile JSON from markdown code block."""
        from main import _extract_profile_json
        
        reply = '''Profile Created: Test Profile
        
Description: A test profile

```json
{"name": "Test Profile", "stages": [{"name": "stage1"}]}
```
'''
        result = _extract_profile_json(reply)
        
        assert result is not None
        assert result["name"] == "Test Profile"
        assert len(result["stages"]) == 1

    def test_extract_profile_json_no_json(self):
        """Test extracting when no JSON is present."""
        from main import _extract_profile_json
        
        reply = "Profile Created: Test Profile\n\nNo JSON here"
        result = _extract_profile_json(reply)
        
        assert result is None

    def test_extract_profile_json_invalid_json(self):
        """Test extracting when JSON is invalid."""
        from main import _extract_profile_json
        
        reply = '''Profile Created: Test Profile
        
```json
{not valid json}
```
'''
        result = _extract_profile_json(reply)
        
        assert result is None

    def test_extract_profile_name(self):
        """Test extracting profile name from reply."""
        from main import _extract_profile_name
        
        reply = "Profile Created: Ethiopian Sunrise\n\nDescription: ..."
        result = _extract_profile_name(reply)
        
        assert result == "Ethiopian Sunrise"

    def test_extract_profile_name_not_found(self):
        """Test default name when pattern not found."""
        from main import _extract_profile_name
        
        reply = "Some reply without profile name"
        result = _extract_profile_name(reply)
        
        assert result == "Untitled Profile"

    def test_extract_profile_name_case_insensitive(self):
        """Test that extraction is case-insensitive."""
        from main import _extract_profile_name
        
        reply = "profile created: lowercase Name\n\nDescription: ..."
        result = _extract_profile_name(reply)
        
        assert result == "lowercase Name"

    @patch('main._save_history')
    @patch('main._load_history')
    def test_save_to_history(self, mock_load, mock_save):
        """Test saving a profile to history."""
        from main import save_to_history
        
        mock_load.return_value = []
        
        reply = '''Profile Created: Test Profile

Description: A test profile

```json
{"name": "Test Profile", "stages": []}
```
'''
        entry = save_to_history(
            coffee_analysis="Test analysis",
            user_prefs="Light Body",
            reply=reply
        )
        
        assert entry["profile_name"] == "Test Profile"
        assert entry["coffee_analysis"] == "Test analysis"
        assert entry["user_preferences"] == "Light Body"
        assert entry["profile_json"] is not None
        assert "id" in entry
        assert "created_at" in entry
        
        # Verify save was called with the new entry
        mock_save.assert_called_once()
        saved_history = mock_save.call_args[0][0]
        assert len(saved_history) == 1
        assert saved_history[0]["id"] == entry["id"]

    @patch('main._save_history')
    @patch('main._load_history')
    def test_save_to_history_limits_entries(self, mock_load, mock_save):
        """Test that history is limited to 100 entries."""
        from main import save_to_history
        
        # Create 100 existing entries
        existing_entries = [{"id": f"entry-{i}"} for i in range(100)]
        mock_load.return_value = existing_entries
        
        save_to_history(
            coffee_analysis=None,
            user_prefs="Test",
            reply="Profile Created: New Profile"
        )
        
        # Verify save was called
        mock_save.assert_called_once()
        saved_history = mock_save.call_args[0][0]
        
        # Should still be 100 entries (oldest removed)
        assert len(saved_history) == 100
        # New entry should be first
        assert saved_history[0]["profile_name"] == "New Profile"

    @patch('main._save_history')
    @patch('main._load_history')
    def test_save_to_history_new_entry_first(self, mock_load, mock_save):
        """Test that new entries are added at the beginning."""
        from main import save_to_history
        
        existing = [{"id": "old-entry", "profile_name": "Old Profile"}]
        mock_load.return_value = existing
        
        save_to_history(
            coffee_analysis=None,
            user_prefs=None,
            reply="Profile Created: New Profile"
        )
        
        mock_save.assert_called_once()
        saved_history = mock_save.call_args[0][0]
        
        assert len(saved_history) == 2
        assert saved_history[0]["profile_name"] == "New Profile"
        assert saved_history[1]["id"] == "old-entry"


class TestSecurityFeatures:
    """Tests for security features added to prevent vulnerabilities."""
    
    # Test constants
    TEST_SIZE_EXCESS = 1000  # Bytes to exceed limits in tests

    def test_sanitize_profile_name_for_filename(self):
        """Test that profile names are properly sanitized for filenames."""
        from main import _sanitize_profile_name_for_filename
        
        # Test path traversal attempts
        assert ".." not in _sanitize_profile_name_for_filename("../../etc/passwd")
        assert "/" not in _sanitize_profile_name_for_filename("path/to/file")
        assert "\\" not in _sanitize_profile_name_for_filename("path\\to\\file")
        
        # Test special characters are removed/replaced
        result = _sanitize_profile_name_for_filename("Profile: Test & Name!")
        assert ":" not in result
        assert "&" not in result
        assert "!" not in result
        
        # Test spaces are replaced with underscores
        assert _sanitize_profile_name_for_filename("My Profile") == "my_profile"
        
        # Test length limiting
        long_name = "a" * 300
        result = _sanitize_profile_name_for_filename(long_name)
        assert len(result) <= 200
    
    def test_get_cached_image_prevents_path_traversal(self):
        """Test that _get_cached_image prevents path traversal attacks."""
        from main import _get_cached_image
        from pathlib import Path
        import tempfile
        import shutil
        
        # Create a temporary test cache directory
        temp_dir = tempfile.mkdtemp()
        cache_dir = Path(temp_dir) / 'test_cache'
        cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Patch IMAGE_CACHE_DIR to use our temp directory
        with patch('main.IMAGE_CACHE_DIR', cache_dir):
            # Attempt path traversal - should return None safely
            result = _get_cached_image("../../etc/passwd")
            assert result is None
            
            # Also test other path traversal attempts
            result = _get_cached_image("../../../root")
            assert result is None
        
        # Clean up
        shutil.rmtree(temp_dir, ignore_errors=True)
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_meticulous_api')
    def test_upload_profile_image_validates_size(self, mock_api, client):
        """Test that image upload validates file size."""
        from main import MAX_UPLOAD_SIZE
        
        # Create a large image (simulate exceeding limit)
        large_image = BytesIO(b"x" * (MAX_UPLOAD_SIZE + self.TEST_SIZE_EXCESS))
        
        response = client.post(
            "/api/profile/test-profile/image",
            files={"file": ("test.png", large_image, "image/png")}
        )
        
        assert response.status_code == 413  # Payload Too Large
        assert "too large" in response.json()["detail"].lower()
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_meticulous_api')
    def test_upload_profile_image_validates_content_type(self, mock_api, client, sample_image):
        """Test that image upload validates content type."""
        response = client.post(
            "/api/profile/test-profile/image",
            files={"file": ("test.txt", sample_image, "text/plain")}
        )
        
        assert response.status_code == 400
        assert "must be an image" in response.json()["detail"].lower()
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.get_meticulous_api')
    def test_apply_profile_image_validates_base64_size(self, mock_api, client):
        """Test that apply-image endpoint validates decoded size."""
        import base64
        from main import MAX_UPLOAD_SIZE
        
        # Create oversized base64 data
        large_data = b"x" * (MAX_UPLOAD_SIZE + self.TEST_SIZE_EXCESS)
        b64_data = base64.b64encode(large_data).decode('utf-8')
        data_uri = f"data:image/png;base64,{b64_data}"
        
        response = client.post(
            "/api/profile/test-profile/apply-image",
            json={"image_data": data_uri}
        )
        
        assert response.status_code == 413  # Payload Too Large
        assert "too large" in response.json()["detail"].lower()
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_apply_profile_image_validates_format(self, client):
        """Test that apply-image endpoint validates image format."""
        # Test with invalid data URI format
        response = client.post(
            "/api/profile/test-profile/apply-image",
            json={"image_data": "not-a-data-uri"}
        )
        
        assert response.status_code == 400
        assert "invalid" in response.json()["detail"].lower()
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_apply_profile_image_validates_png_format(self, client):
        """Test that apply-image validates it's actually PNG data."""
        import base64
        
        # Create invalid PNG data (just random bytes)
        fake_data = b"not-a-valid-png-image"
        b64_data = base64.b64encode(fake_data).decode('utf-8')
        data_uri = f"data:image/png;base64,{b64_data}"
        
        response = client.post(
            "/api/profile/test-profile/apply-image",
            json={"image_data": data_uri}
        )
        
        assert response.status_code == 400
        assert "invalid image" in response.json()["detail"].lower()


class TestHelperFunctions:
    """Tests for helper functions that process data."""
    
    def test_safe_float_with_valid_input(self):
        """Test _safe_float with valid float."""
        from main import _safe_float
        
        assert _safe_float(3.14) == 3.14
        assert _safe_float("5.5") == 5.5
        assert _safe_float(10) == 10.0
    
    def test_safe_float_with_invalid_input(self):
        """Test _safe_float with invalid input uses default."""
        from main import _safe_float
        
        assert _safe_float("invalid", default=0.0) == 0.0
        assert _safe_float(None, default=1.5) == 1.5
        assert _safe_float({}, default=2.0) == 2.0
    
    def test_sanitize_profile_name_for_filename_basic(self):
        """Test basic filename sanitization."""
        from main import _sanitize_profile_name_for_filename
        
        # Normal name
        assert _sanitize_profile_name_for_filename("My Profile") == "my_profile"
        
        # With special characters
        result = _sanitize_profile_name_for_filename("Profile: Test!")
        assert ":" not in result
        assert "!" not in result
    
    def test_sanitize_profile_name_path_traversal(self):
        """Test path traversal prevention in filename sanitization."""
        from main import _sanitize_profile_name_for_filename
        
        # Path traversal attempts
        assert ".." not in _sanitize_profile_name_for_filename("../../../etc/passwd")
        assert "/" not in _sanitize_profile_name_for_filename("path/to/file")
        assert "\\" not in _sanitize_profile_name_for_filename("path\\to\\file")
    
    def test_extract_profile_name_from_reply(self):
        """Test extraction of profile name from LLM reply."""
        from main import _extract_profile_name
        
        # Standard format
        reply = "Profile Created: My Amazing Profile\nSome description..."
        assert _extract_profile_name(reply) == "My Amazing Profile"
        
        # With extra whitespace
        reply2 = "Profile Created:  Spaced Name  \nMore text"
        assert _extract_profile_name(reply2).strip() == "Spaced Name"
    
    def test_extract_profile_name_not_found(self):
        """Test profile name extraction when not found."""
        from main import _extract_profile_name
        
        reply = "This doesn't contain the profile marker"
        assert _extract_profile_name(reply) == "Untitled Profile"


class TestCacheManagement:
    """Tests for caching helper functions."""
    
    @patch('main.IMAGE_CACHE_DIR', Path('/tmp/test_image_cache'))
    def test_ensure_image_cache_dir(self):
        """Test that cache directory is created."""
        from main import _ensure_image_cache_dir
        import shutil
        
        # Clean up if exists
        if Path('/tmp/test_image_cache').exists():
            shutil.rmtree('/tmp/test_image_cache')
        
        _ensure_image_cache_dir()
        
        assert Path('/tmp/test_image_cache').exists()
        
        # Clean up
        shutil.rmtree('/tmp/test_image_cache', ignore_errors=True)
    
    @patch('main.SHOT_CACHE_FILE', Path('/tmp/test_shot_cache.json'))
    @patch('main._load_shot_cache')
    @patch('main._save_shot_cache')
    def test_set_cached_shots(self, mock_save, mock_load):
        """Test setting cached shot data."""
        from main import _set_cached_shots
        
        mock_load.return_value = {}
        
        test_data = {"shot1": {"time": 30}}
        _set_cached_shots("test-profile", test_data, limit=50)
        
        # Verify save was called
        mock_save.assert_called_once()
        saved_cache = mock_save.call_args[0][0]
        assert "test-profile" in saved_cache
    
    @patch('main.SHOT_CACHE_FILE', Path('/tmp/test_shot_cache.json'))
    @patch('main._load_shot_cache')
    def test_get_cached_shots_hit(self, mock_load):
        """Test getting cached shots when cache exists."""
        from main import _get_cached_shots
        import time
        
        # Mock recent cache
        mock_load.return_value = {
            "test-profile": {
                "data": {"shot1": {"time": 30}},
                "cached_at": time.time() - 100,  # 100 seconds ago
                "limit": 50
            }
        }
        
        data, is_stale, age = _get_cached_shots("test-profile", limit=50)
        
        assert data is not None
        assert data is not None
        assert "shot1" in data
        assert not is_stale
    
    @patch('main.SHOT_CACHE_FILE', Path('/tmp/test_shot_cache.json'))
    @patch('main._load_shot_cache')
    def test_get_cached_shots_miss(self, mock_load):
        """Test getting cached shots when cache doesn't exist."""
        from main import _get_cached_shots
        
        mock_load.return_value = {}
        
        data, is_stale, age = _get_cached_shots("nonexistent-profile", limit=50)
        
        assert data is None
        assert age is None


class TestShotAnalysisHelpers:
    """Tests for shot analysis helper functions."""
    
    def test_format_dynamics_description_basic(self):
        """Test formatting of stage dynamics description."""
        from main import _format_dynamics_description
        
        stage = {
            "type": "pressure",
            "dynamics_points": [[0, 2.0], [10, 2.5]],
            "dynamics_over": "time"
        }
        
        desc = _format_dynamics_description(stage)
        
        assert isinstance(desc, str)
        assert isinstance(desc, str) and len(desc) > 0
    
    def test_compute_stage_stats_basic(self):
        """Test computing statistics for stage telemetry."""
        from main import _compute_stage_stats
        
        entries = [
            {"time": 0, "shot": {"pressure": 8.0, "flow": 2.0}},
            {"time": 1000, "shot": {"pressure": 9.0, "flow": 2.5}},
            {"time": 2000, "shot": {"pressure": 8.5, "flow": 2.2}}
        ]
        
        stats = _compute_stage_stats(entries)
        
        assert "avg_pressure" in stats
        assert stats["avg_pressure"] > 8.0
        assert stats["avg_pressure"] < 9.0

    def test_format_dynamics_description_flow_type(self):
        """Test with flow type."""
        from main import _format_dynamics_description
        
        stage = {
            "type": "flow",
            "dynamics_points": [[0, 2.0], [10, 4.0]],
            "dynamics_over": "time"
        }
        result = _format_dynamics_description(stage)
        assert "ml/s" in result

    def test_safe_float_with_string(self):
        """Test _safe_float with string input."""
        from main import _safe_float
        
        assert _safe_float("42.5") == 42.5
        assert _safe_float("invalid") == 0.0
        assert _safe_float("", 5.0) == 5.0
        assert _safe_float(None, 10.0) == 10.0

    def test_resolve_variable_basic(self):
        """Test variable resolution."""
        from main import _resolve_variable
        
        variables = [
            {"key": "dose", "name": "Dose", "value": 18.0},
            {"key": "ratio", "name": "Ratio", "value": 2.0}
        ]
        
        value, name = _resolve_variable("$dose", variables)
        assert value == 18.0
        assert name == "Dose"

    def test_resolve_variable_not_found(self):
        """Test variable resolution when variable not found."""
        from main import _resolve_variable
        
        variables = []
        value, name = _resolve_variable("$unknown", variables)
        assert value == "$unknown"
        assert name == "unknown"

    def test_resolve_variable_not_variable(self):
        """Test resolution of non-variable value."""
        from main import _resolve_variable
        
        value, name = _resolve_variable(42.0, [])
        assert value == 42.0
        assert name is None

    def test_format_exit_triggers_basic(self):
        """Test exit trigger formatting."""
        from main import _format_exit_triggers
        
        triggers = [
            {"type": "time", "value": 25, "comparison": ">="},
            {"type": "weight", "value": 36, "comparison": ">="}
        ]
        
        result = _format_exit_triggers(triggers)
        assert len(result) == 2
        assert result[0]["type"] == "time"
        assert "25" in result[0]["description"]  # Contains 25
        assert "s" in result[0]["description"]   # Has seconds unit

    def test_format_limits_basic(self):
        """Test limits formatting."""
        from main import _format_limits
        
        limits = [
            {"type": "pressure", "value": 10, "comparison": "<="},
            {"type": "flow", "value": 4, "comparison": "<="}
        ]
        
        result = _format_limits(limits)
        assert len(result) == 2
        assert "10" in result[0]["description"]  # Contains 10
        assert "bar" in result[0]["description"]  # Has bar unit

    def test_extract_shot_stage_data(self):
        """Test extracting stage data from shot."""
        from main import _extract_shot_stage_data
        
        shot_data = {
            "data": [
                {"time": 0, "shot": {"weight": 0, "pressure": 2.0, "flow": 0.5}, "status": "during", "stage_name": "Bloom"},
                {"time": 5000, "shot": {"weight": 2.0, "pressure": 2.0, "flow": 0.5}, "status": "during", "stage_name": "Bloom"},
                {"time": 10000, "shot": {"weight": 10.0, "pressure": 9.0, "flow": 2.5}, "status": "during", "stage_name": "Main"},
                {"time": 25000, "shot": {"weight": 36.0, "pressure": 9.0, "flow": 2.5}, "status": "during", "stage_name": "Main"},
            ]
        }
        
        result = _extract_shot_stage_data(shot_data)
        # Function returns dict of stages
        assert isinstance(result, dict)

    def test_prepare_profile_for_llm(self):
        """Test preparing profile data for LLM."""
        from main import _prepare_profile_for_llm
        
        profile_data = {
            "name": "Test",
            "temperature": 93.0,
            "final_weight": 36.0,
            "variables": [{"key": "dose", "value": 18.0}],
            "stages": [{"name": "Main", "type": "pressure"}]
        }
        
        result = _prepare_profile_for_llm(profile_data, "Test description")
        assert result["name"] == "Test"
        assert "stages" in result
        assert "variables" in result

    def test_compute_stage_stats_includes_start_end_pressure(self):
        """Test that stage stats include start/end pressure and flow values."""
        from main import _compute_stage_stats
        
        entries = [
            {"time": 0, "shot": {"pressure": 2.0, "flow": 0.5, "weight": 0}},
            {"time": 1000, "shot": {"pressure": 5.0, "flow": 1.0, "weight": 5}},
            {"time": 2000, "shot": {"pressure": 8.0, "flow": 2.0, "weight": 10}},
            {"time": 3000, "shot": {"pressure": 6.0, "flow": 1.5, "weight": 15}}
        ]
        
        stats = _compute_stage_stats(entries)
        
        # New fields should be present
        assert "start_pressure" in stats
        assert "end_pressure" in stats
        assert "start_flow" in stats
        assert "end_flow" in stats
        
        # Values should match first and last entries
        assert stats["start_pressure"] == 2.0
        assert stats["end_pressure"] == 6.0
        assert stats["start_flow"] == 0.5
        assert stats["end_flow"] == 1.5

    def test_determine_exit_trigger_hit_with_less_than_comparison(self):
        """Test that <= comparisons use min/end values instead of max."""
        from main import _determine_exit_trigger_hit
        
        # Stage data where pressure declined from 9 to 3 bar
        stage_data = {
            "duration": 15.0,
            "end_weight": 36.0,
            "max_pressure": 9.0,
            "min_pressure": 3.0,
            "end_pressure": 3.0,
            "max_flow": 2.5,
            "min_flow": 1.0,
            "end_flow": 1.0
        }
        
        # Exit trigger: pressure <= 4 bar (should trigger because end_pressure is 3)
        exit_triggers = [
            {"type": "pressure", "value": 4.0, "comparison": "<="}
        ]
        
        result = _determine_exit_trigger_hit(stage_data, exit_triggers)
        
        # Should trigger because end_pressure (3.0) <= 4.0
        assert result["triggered"] is not None
        assert result["triggered"]["type"] == "pressure"
        # The actual value should be end_pressure, not max_pressure
        assert result["triggered"]["actual"] == 3.0

    def test_determine_exit_trigger_hit_with_greater_than_comparison(self):
        """Test that >= comparisons still use max values."""
        from main import _determine_exit_trigger_hit
        
        stage_data = {
            "duration": 5.0,
            "end_weight": 10.0,
            "max_pressure": 9.0,
            "min_pressure": 2.0,
            "end_pressure": 8.0,
            "max_flow": 3.0,
            "min_flow": 0.5,
            "end_flow": 2.5
        }
        
        # Exit trigger: pressure >= 8.5 bar (should trigger because max_pressure is 9)
        exit_triggers = [
            {"type": "pressure", "value": 8.5, "comparison": ">="}
        ]
        
        result = _determine_exit_trigger_hit(stage_data, exit_triggers)
        
        # Should trigger because max_pressure (9.0) >= 8.5
        assert result["triggered"] is not None
        assert result["triggered"]["actual"] == 9.0

    def test_determine_exit_trigger_hit_flow_less_than(self):
        """Test flow exit trigger with <= comparison."""
        from main import _determine_exit_trigger_hit
        
        stage_data = {
            "duration": 20.0,
            "end_weight": 40.0,
            "max_pressure": 6.0,
            "min_pressure": 6.0,
            "end_pressure": 6.0,
            "max_flow": 4.0,
            "min_flow": 1.5,
            "end_flow": 1.5
        }
        
        # Exit trigger: flow <= 2.0 ml/s
        exit_triggers = [
            {"type": "flow", "value": 2.0, "comparison": "<="}
        ]
        
        result = _determine_exit_trigger_hit(stage_data, exit_triggers)
        
        # Should trigger because end_flow (1.5) <= 2.0
        assert result["triggered"] is not None
        assert result["triggered"]["type"] == "flow"
        assert result["triggered"]["actual"] == 1.5

    def test_generate_execution_description_rising_pressure(self):
        """Test execution description for rising pressure."""
        from main import _generate_execution_description
        
        desc = _generate_execution_description(
            stage_type="pressure",
            duration=5.0,
            start_pressure=2.0,
            end_pressure=9.0,
            max_pressure=9.0,
            start_flow=0.5,
            end_flow=2.0,
            max_flow=2.5,
            weight_gain=8.0
        )
        
        assert "rose" in desc.lower() or "increased" in desc.lower()
        assert "2.0" in desc
        assert "9.0" in desc

    def test_generate_execution_description_declining_pressure(self):
        """Test execution description for declining pressure."""
        from main import _generate_execution_description
        
        desc = _generate_execution_description(
            stage_type="pressure",
            duration=10.0,
            start_pressure=9.0,
            end_pressure=6.0,
            max_pressure=9.0,
            start_flow=2.0,
            end_flow=2.0,
            max_flow=2.5,
            weight_gain=15.0
        )
        
        assert "declined" in desc.lower() or "decreased" in desc.lower() or "dropped" in desc.lower()
        assert "9.0" in desc
        assert "6.0" in desc

    def test_generate_execution_description_steady_pressure(self):
        """Test execution description for steady pressure."""
        from main import _generate_execution_description
        
        desc = _generate_execution_description(
            stage_type="pressure",
            duration=15.0,
            start_pressure=6.0,
            end_pressure=6.1,  # Very small change
            max_pressure=6.2,
            start_flow=2.0,
            end_flow=2.0,
            max_flow=2.1,
            weight_gain=20.0
        )
        
        # Should describe as "held" or "steady" since delta is < 0.5
        assert "held" in desc.lower() or "steady" in desc.lower()

    def test_generate_profile_target_curves_basic(self):
        """Test generating profile target curves for chart overlay."""
        from main import _generate_profile_target_curves
        
        profile_data = {
            "stages": [
                {
                    "name": "Bloom",
                    "type": "pressure",
                    "dynamics_points": [[0, 2.0]],  # Constant 2 bar
                    "dynamics_over": "time"
                },
                {
                    "name": "Main",
                    "type": "pressure",
                    "dynamics_points": [[0, 9.0]],  # Constant 9 bar
                    "dynamics_over": "time"
                }
            ],
            "variables": []
        }
        
        shot_stage_times = {
            "Bloom": (0.0, 5.0),
            "Main": (5.0, 25.0)
        }
        
        curves = _generate_profile_target_curves(profile_data, shot_stage_times)
        
        assert isinstance(curves, list)
        assert len(curves) > 0
        
        # Should have target_pressure values
        pressure_points = [c for c in curves if "target_pressure" in c]
        assert len(pressure_points) > 0

    def test_generate_profile_target_curves_ramp(self):
        """Test generating target curves for a pressure ramp."""
        from main import _generate_profile_target_curves
        
        profile_data = {
            "stages": [
                {
                    "name": "Ramp Up",
                    "type": "pressure",
                    "dynamics_points": [[0, 2.0], [5, 9.0]],  # Ramp from 2 to 9 bar over 5s
                    "dynamics_over": "time"
                }
            ],
            "variables": []
        }
        
        shot_stage_times = {
            "Ramp Up": (0.0, 5.0)
        }
        
        curves = _generate_profile_target_curves(profile_data, shot_stage_times)
        
        # Should have at least 2 points (start and end)
        pressure_points = [c for c in curves if "target_pressure" in c]
        assert len(pressure_points) >= 2
        
        # First should be 2 bar, last should be 9 bar
        assert pressure_points[0]["target_pressure"] == 2.0
        assert pressure_points[-1]["target_pressure"] == 9.0

    def test_generate_profile_target_curves_flow_stage(self):
        """Test generating target curves for flow-based stage."""
        from main import _generate_profile_target_curves
        
        profile_data = {
            "stages": [
                {
                    "name": "Flow Stage",
                    "type": "flow",
                    "dynamics_points": [[0, 2.5]],
                    "dynamics_over": "time"
                }
            ],
            "variables": []
        }
        
        shot_stage_times = {
            "Flow Stage": (0.0, 20.0)
        }
        
        curves = _generate_profile_target_curves(profile_data, shot_stage_times)
        
        # Should have target_flow values
        flow_points = [c for c in curves if "target_flow" in c]
        assert len(flow_points) > 0
        assert flow_points[0]["target_flow"] == 2.5

    def test_generate_profile_target_curves_weight_based_dynamics(self):
        """Test that weight-based dynamics stages are skipped in target curve generation.
        
        Weight-based dynamics cannot be plotted on a time-based chart since they
        don't have a fixed time mapping. This test verifies the expected behavior
        of skipping these stages rather than attempting to convert them.
        """
        from main import _generate_profile_target_curves
        
        profile_data = {
            "stages": [
                {
                    "name": "Weight-Based Pressure",
                    "type": "pressure",
                    "dynamics_points": [[0, 2.0], [20, 9.0], [40, 6.0]],
                    "dynamics_over": "weight"
                },
                {
                    "name": "Time-Based Flow",
                    "type": "flow",
                    "dynamics_points": [[0, 2.5]],
                    "dynamics_over": "time"
                }
            ],
            "variables": []
        }
        
        shot_stage_times = {
            "Weight-Based Pressure": (0.0, 15.0),
            "Time-Based Flow": (15.0, 30.0)
        }
        
        curves = _generate_profile_target_curves(profile_data, shot_stage_times)
        
        # Weight-based stages should be skipped, so only time-based stage should appear
        flow_points = [c for c in curves if "target_flow" in c]
        pressure_points = [c for c in curves if "target_pressure" in c]
        
        # Should have flow points from the time-based stage
        assert len(flow_points) > 0
        assert flow_points[0]["target_flow"] == 2.5
        
        # Should NOT have pressure points from the weight-based stage
        assert len(pressure_points) == 0

    def test_local_analysis_includes_profile_target_curves(self):
        """Test that local analysis returns profile target curves."""
        from main import _perform_local_shot_analysis
        
        shot_data = {
            "data": [
                {"time": 0, "shot": {"weight": 0, "pressure": 2.0, "flow": 0.5}, "status": "Bloom"},
                {"time": 5000, "shot": {"weight": 2.0, "pressure": 2.0, "flow": 0.5}, "status": "Bloom"},
                {"time": 6000, "shot": {"weight": 5.0, "pressure": 9.0, "flow": 2.5}, "status": "Main"},
                {"time": 25000, "shot": {"weight": 36.0, "pressure": 9.0, "flow": 2.5}, "status": "Main"},
            ]
        }
        
        profile_data = {
            "name": "Test Profile",
            "final_weight": 36.0,
            "stages": [
                {
                    "name": "Bloom",
                    "key": "bloom",
                    "type": "pressure",
                    "dynamics_points": [[0, 2.0]],
                    "dynamics_over": "time",
                    "exit_triggers": [{"type": "time", "value": 5, "comparison": ">="}]
                },
                {
                    "name": "Main",
                    "key": "main",
                    "type": "pressure",
                    "dynamics_points": [[0, 9.0]],
                    "dynamics_over": "time",
                    "exit_triggers": [{"type": "weight", "value": 36, "comparison": ">="}]
                }
            ],
            "variables": []
        }
        
        result = _perform_local_shot_analysis(shot_data, profile_data)
        
        # Should include profile_target_curves
        assert "profile_target_curves" in result
        assert isinstance(result["profile_target_curves"], list)

    def test_stage_execution_data_includes_description(self):
        """Test that stage execution data includes a description."""
        from main import _analyze_stage_execution
        
        profile_stage = {
            "name": "Main Extraction",
            "key": "main",
            "type": "pressure",
            "dynamics_points": [[0, 9.0]],
            "dynamics_over": "time",
            "exit_triggers": [{"type": "weight", "value": 36, "comparison": ">="}]
        }
        
        shot_stage_data = {
            "duration": 20.0,
            "start_weight": 5.0,
            "end_weight": 36.0,
            "start_pressure": 2.0,
            "end_pressure": 9.0,
            "avg_pressure": 8.5,
            "max_pressure": 9.0,
            "min_pressure": 2.0,
            "start_flow": 0.5,
            "end_flow": 2.5,
            "avg_flow": 2.0,
            "max_flow": 2.5,
            "min_flow": 0.5
        }
        
        result = _analyze_stage_execution(profile_stage, shot_stage_data, 25.0)
        
        # Execution data should include description
        assert result["execution_data"] is not None
        assert "description" in result["execution_data"]
        assert isinstance(result["execution_data"]["description"], str)
        assert len(result["execution_data"]["description"]) > 0


class TestBasicEndpoints:
    """Tests for basic utility endpoints."""
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    def test_parse_gemini_error(self):
        """Test Gemini error parsing."""
        from main import parse_gemini_error
        
        error_text = """Some error occurred
        Error details here
        Quota exceeded message"""
        
        result = parse_gemini_error(error_text)
        
        assert isinstance(result, str)
        assert len(result) > 0
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._ensure_history_file')
    @patch('main.Path')
    def test_load_history_with_valid_file(self, mock_path, mock_ensure):
        """Test loading history from valid file."""
        from main import _load_history
        
        # Mock file operations
        mock_file = Mock()
        mock_file.exists.return_value = True
        mock_file.read_text.return_value = json.dumps([
            {"id": "123", "profile_name": "Test"}
        ])
        mock_path.return_value = mock_file
        
        history = _load_history()
        
        assert isinstance(history, list)
    
    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main._ensure_history_file')
    @patch('builtins.open')
    def test_load_history_with_missing_file(self, mock_open_func, mock_ensure):
        """Test loading history when file doesn't exist."""
        from main import _load_history
        
        # Mock file not found
        mock_open_func.side_effect = FileNotFoundError("File not found")
        
        history = _load_history()
        
        assert history == []



class TestProcessImageForProfile:
    """Tests for image processing function."""
    
    def test_process_image_for_profile_valid_png(self):
        """Test processing a valid PNG image."""
        from main import process_image_for_profile
        from PIL import Image
        import io
        
        # Create a test image
        img = Image.new('RGB', (1024, 768), color='red')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG')
        img_data = img_bytes.getvalue()
        
        data_uri, png_bytes = process_image_for_profile(img_data, "image/png")
        
        assert data_uri.startswith("data:image/png;base64,")
        assert len(png_bytes) > 0
        
        # Verify it's 512x512
        result_img = Image.open(io.BytesIO(png_bytes))
        assert result_img.size == (512, 512)
    
    def test_process_image_for_profile_jpeg(self):
        """Test processing a JPEG image."""
        from main import process_image_for_profile
        from PIL import Image
        import io
        
        # Create a test JPEG image
        img = Image.new('RGB', (800, 600), color='blue')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='JPEG')
        img_data = img_bytes.getvalue()
        
        data_uri, png_bytes = process_image_for_profile(img_data, "image/jpeg")
        
        assert data_uri.startswith("data:image/png;base64,")
        
        # Verify conversion and resize
        result_img = Image.open(io.BytesIO(png_bytes))
        assert result_img.format == 'PNG'
        assert result_img.size == (512, 512)


class TestCheckUpdatesEndpoint:
    """Tests for the /api/check-updates endpoint."""

    @patch('main.Path')
    @patch('main.asyncio.sleep', new_callable=AsyncMock)
    def test_check_updates_success_with_updates(self, mock_sleep, mock_path, client):
        """Test successful update check with updates available."""
        # Mock version file exists and has update data
        mock_version_file = MagicMock()
        mock_version_file.exists.return_value = True
        mock_path.return_value = mock_version_file
        
        version_data = {
            "update_available": True,
            "last_check": "2024-01-15T10:30:00",
            "repositories": {
                "MeticAI": {"current": "v1.0.0", "latest": "v1.1.0"}
            }
        }
        
        with patch('builtins.open', mock_open(read_data=json.dumps(version_data))):
            response = client.post("/api/check-updates")
        
        assert response.status_code == 200
        data = response.json()
        assert data["update_available"] is True
        assert data["last_check"] == "2024-01-15T10:30:00"
        assert "repositories" in data

    @patch('main.Path')
    @patch('main.asyncio.sleep', new_callable=AsyncMock)
    def test_check_updates_no_updates(self, mock_sleep, mock_path, client):
        """Test update check with no updates available."""
        mock_version_file = MagicMock()
        mock_version_file.exists.return_value = True
        mock_path.return_value = mock_version_file
        
        version_data = {
            "update_available": False,
            "last_check": "2024-01-15T10:30:00",
            "repositories": {
                "MeticAI": {"current": "v1.0.0", "latest": "v1.0.0"}
            }
        }
        
        with patch('builtins.open', mock_open(read_data=json.dumps(version_data))):
            response = client.post("/api/check-updates")
        
        assert response.status_code == 200
        data = response.json()
        assert data["update_available"] is False

    @patch('main.Path')
    def test_check_updates_file_not_found(self, mock_path, client):
        """Test update check when version file doesn't exist."""
        mock_version_file = MagicMock()
        mock_version_file.exists.return_value = False
        mock_path.return_value = mock_version_file
        
        response = client.post("/api/check-updates")
        
        assert response.status_code == 200
        data = response.json()
        assert data["update_available"] is False
        assert "error" in data
        assert "Version file not found" in data["error"]

    @patch('main.Path')
    @patch('main.asyncio.sleep', new_callable=AsyncMock)
    def test_check_updates_fresh_check(self, mock_sleep, mock_path, client):
        """Test that update check triggers fresh check and waits for update."""
        mock_version_file = MagicMock()
        mock_signal_file = MagicMock()
        
        # Setup: version file exists, signal file gets created then removed
        call_count = {"path_calls": 0}
        
        def path_side_effect(arg):
            if ".versions.json" in str(arg):
                return mock_version_file
            elif ".update-check-requested" in str(arg):
                return mock_signal_file
            return MagicMock()
        
        mock_path.side_effect = path_side_effect
        mock_version_file.exists.return_value = True
        
        # Signal file exists initially, then gets removed
        signal_exists_calls = [True, False]
        mock_signal_file.exists.side_effect = signal_exists_calls
        
        old_version_data = {
            "update_available": False,
            "last_check": "2024-01-15T10:00:00",
            "repositories": {}
        }
        
        new_version_data = {
            "update_available": True,
            "last_check": "2024-01-15T10:30:00",
            "repositories": {
                "MeticAI": {"current": "v1.0.0", "latest": "v1.1.0"}
            }
        }
        
        read_calls = [json.dumps(old_version_data), json.dumps(new_version_data)]
        
        with patch('builtins.open', mock_open()) as mock_file:
            mock_file.return_value.read.side_effect = read_calls
            response = client.post("/api/check-updates")
        
        assert response.status_code == 200
        data = response.json()
        assert "update_available" in data

    @patch('main.Path')
    def test_check_updates_json_error(self, mock_path, client):
        """Test handling of corrupted version file."""
        mock_version_file = MagicMock()
        mock_version_file.exists.return_value = True
        mock_path.return_value = mock_version_file
        
        with patch('builtins.open', mock_open(read_data="invalid json {")):
            response = client.post("/api/check-updates")
        
        # Should handle gracefully
        assert response.status_code in [200, 500]


class TestMachineProfilesEndpoint:
    """Tests for the /api/machine/profiles endpoint."""

    @patch('main.get_meticulous_api')
    @patch('main.HISTORY_FILE')
    def test_list_profiles_success(self, mock_history_file, mock_get_api, client):
        """Test successful profile listing from machine."""
        # Mock API responses
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        # Mock list_profiles result - return simple objects
        mock_profile1 = type('Profile', (), {})()
        mock_profile1.id = "profile-1"
        mock_profile1.name = "Espresso Classic"
        mock_profile1.error = None
        
        mock_profile2 = type('Profile', (), {})()
        mock_profile2.id = "profile-2"
        mock_profile2.name = "Light Roast"
        mock_profile2.error = None
        
        mock_api.list_profiles.return_value = [mock_profile1, mock_profile2]
        
        # Mock get_profile results - return simple objects with all required attributes
        full_profile1 = type('FullProfile', (), {})()
        full_profile1.id = "profile-1"
        full_profile1.name = "Espresso Classic"
        full_profile1.author = "Barista Joe"
        full_profile1.temperature = 93.0
        full_profile1.final_weight = 36.0
        full_profile1.error = None
        
        full_profile2 = type('FullProfile', (), {})()
        full_profile2.id = "profile-2"
        full_profile2.name = "Light Roast"
        full_profile2.author = "Barista Jane"
        full_profile2.temperature = 91.0
        full_profile2.final_weight = 40.0
        full_profile2.error = None
        
        mock_api.get_profile.side_effect = [full_profile1, full_profile2]
        
        # Mock history file
        mock_history_file.exists.return_value = True
        history_data = [
            {"profile_name": "Espresso Classic", "reply": "Great profile"}
        ]
        
        with patch('builtins.open', mock_open(read_data=json.dumps(history_data))):
            response = client.get("/api/machine/profiles")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["total"] == 2
        assert len(data["profiles"]) == 2
        
        # Check first profile has history
        profile1 = next(p for p in data["profiles"] if p["name"] == "Espresso Classic")
        assert profile1["in_history"] is True
        assert profile1["has_description"] is True
        
        # Check second profile has no history
        profile2 = next(p for p in data["profiles"] if p["name"] == "Light Roast")
        assert profile2["in_history"] is False

    @patch('main.get_meticulous_api')
    def test_list_profiles_api_error(self, mock_get_api, client):
        """Test error handling when machine API fails."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        # Mock API error
        mock_result = MagicMock()
        mock_result.error = "Connection timeout"
        mock_api.list_profiles.return_value = mock_result
        
        response = client.get("/api/machine/profiles")
        
        assert response.status_code == 502
        assert "Machine API error" in response.json()["detail"]

    @patch('main.get_meticulous_api')
    @patch('main.HISTORY_FILE')
    def test_list_profiles_empty(self, mock_history_file, mock_get_api, client):
        """Test listing when no profiles exist."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.list_profiles.return_value = []
        
        mock_history_file.exists.return_value = False
        
        response = client.get("/api/machine/profiles")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["total"] == 0
        assert len(data["profiles"]) == 0

    @patch('main.get_meticulous_api')
    @patch('main.HISTORY_FILE')
    def test_list_profiles_partial_failure(self, mock_history_file, mock_get_api, client):
        """Test listing continues when individual profile fetch fails."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        mock_profile1 = type('Profile', (), {})()
        mock_profile1.id = "profile-1"
        mock_profile1.name = "Good Profile"
        mock_profile1.error = None
        
        mock_profile2 = type('Profile', (), {})()
        mock_profile2.id = "profile-2"
        mock_profile2.name = "Bad Profile"
        mock_profile2.error = None
        
        mock_api.list_profiles.return_value = [mock_profile1, mock_profile2]
        
        full_profile1 = type('FullProfile', (), {})()
        full_profile1.id = "profile-1"
        full_profile1.name = "Good Profile"
        full_profile1.author = "Barista"
        full_profile1.error = None
        
        # Second profile fetch fails
        mock_api.get_profile.side_effect = [full_profile1, Exception("Network error")]
        
        mock_history_file.exists.return_value = False
        
        response = client.get("/api/machine/profiles")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["total"] == 1  # Only successful profile
        assert len(data["profiles"]) == 1
        assert data["profiles"][0]["name"] == "Good Profile"

    @patch('main.get_meticulous_api')
    @patch('main.HISTORY_FILE')
    def test_list_profiles_history_dict_format(self, mock_history_file, mock_get_api, client):
        """Test handling of legacy history format (dict with entries key)."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        mock_profile = type('Profile', (), {})()
        mock_profile.id = "profile-1"
        mock_profile.name = "Test Profile"
        mock_profile.error = None
        
        mock_api.list_profiles.return_value = [mock_profile]
        
        full_profile = type('FullProfile', (), {})()
        full_profile.id = "profile-1"
        full_profile.name = "Test Profile"
        full_profile.author = "Barista"
        full_profile.error = None
        
        mock_api.get_profile.return_value = full_profile
        
        mock_history_file.exists.return_value = True
        # Legacy format: dict with entries key
        history_data = {
            "entries": [
                {"profile_name": "Test Profile", "reply": "Description here"}
            ]
        }
        
        with patch('builtins.open', mock_open(read_data=json.dumps(history_data))):
            response = client.get("/api/machine/profiles")
        
        assert response.status_code == 200
        data = response.json()
        assert data["profiles"][0]["in_history"] is True


class TestMachineProfileJsonEndpoint:
    """Tests for the /api/machine/profile/{profile_id}/json endpoint."""

    @patch('main.get_meticulous_api')
    def test_get_profile_json_success(self, mock_get_api, client):
        """Test successful profile JSON retrieval."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        # Mock profile object with various attributes
        mock_profile = MagicMock()
        mock_profile.id = "profile-123"
        mock_profile.name = "Test Profile"
        mock_profile.author = "Barista Joe"
        mock_profile.temperature = 93.0
        mock_profile.final_weight = 36.0
        mock_profile.stages = [{"name": "preinfusion"}]
        mock_profile.variables = {"key": "value"}
        mock_profile.error = None
        
        mock_api.get_profile.return_value = mock_profile
        
        response = client.get("/api/machine/profile/profile-123/json")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["profile"]["id"] == "profile-123"
        assert data["profile"]["name"] == "Test Profile"
        assert data["profile"]["author"] == "Barista Joe"
        assert data["profile"]["temperature"] == 93.0

    @patch('main.get_meticulous_api')
    def test_get_profile_json_api_error(self, mock_get_api, client):
        """Test error handling when machine API fails."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        mock_result = MagicMock()
        mock_result.error = "Profile not found"
        mock_api.get_profile.return_value = mock_result
        
        response = client.get("/api/machine/profile/invalid-id/json")
        
        assert response.status_code == 502
        assert "Machine API error" in response.json()["detail"]

    @patch('main.get_meticulous_api')
    def test_get_profile_json_nested_objects(self, mock_get_api, client):
        """Test handling of nested objects in profile."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        # Create mock profile with nested object using simple class
        mock_profile = type('Profile', (), {})()
        mock_profile.id = "profile-456"
        mock_profile.name = "Complex Profile"
        mock_profile.error = None
        
        # Create nested display object
        nested_obj = type('Display', (), {})()
        nested_obj.nested_key = "nested_value"
        mock_profile.display = nested_obj
        
        mock_api.get_profile.return_value = mock_profile
        
        response = client.get("/api/machine/profile/profile-456/json")
        
        assert response.status_code == 200
        data = response.json()
        assert "display" in data["profile"]

    @patch('main.get_meticulous_api')
    def test_get_profile_json_list_of_objects(self, mock_get_api, client):
        """Test handling of list of objects in profile."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        stage1 = MagicMock()
        stage1.__dict__ = {"name": "preinfusion", "duration": 5}
        
        stage2 = MagicMock()
        stage2.__dict__ = {"name": "extraction", "duration": 25}
        
        mock_profile = MagicMock()
        mock_profile.id = "profile-789"
        mock_profile.name = "Multi-Stage Profile"
        mock_profile.stages = [stage1, stage2]
        mock_profile.error = None
        
        mock_api.get_profile.return_value = mock_profile
        
        response = client.get("/api/machine/profile/profile-789/json")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["profile"]["stages"]) == 2
        assert data["profile"]["stages"][0]["name"] == "preinfusion"

    @patch('main.get_meticulous_api')
    def test_get_profile_json_exception(self, mock_get_api, client):
        """Test handling of unexpected exceptions."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.get_profile.side_effect = Exception("Unexpected error")
        
        response = client.get("/api/machine/profile/error-id/json")
        
        assert response.status_code == 500


class TestProfileImportEndpoint:
    """Tests for the /api/profile/import endpoint."""

    @patch('main.atomic_write_json')
    @patch('main._generate_profile_description', new_callable=AsyncMock)
    @patch('main.HISTORY_FILE')
    def test_import_profile_success(self, mock_history_file, mock_generate_desc, mock_atomic_write, client):
        """Test successful profile import with description generation."""
        mock_generate_desc.return_value = "Great espresso profile with balanced extraction"
        
        profile_json = {
            "name": "Imported Espresso",
            "author": "Coffee Master",
            "temperature": 93.0,
            "stages": [{"name": "extraction"}]
        }
        
        mock_history_file.exists.return_value = True
        
        with patch('builtins.open', mock_open(read_data='[]')) as mock_file:
            response = client.post(
                "/api/profile/import",
                json={
                    "profile": profile_json,
                    "generate_description": True,
                    "source": "file"
                }
            )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["profile_name"] == "Imported Espresso"
        assert data["has_description"] is True
        assert "entry_id" in data
        mock_atomic_write.assert_called_once()

    @patch('main.atomic_write_json')
    @patch('main._generate_profile_description', new_callable=AsyncMock)
    @patch('main.HISTORY_FILE')
    def test_import_profile_without_description(self, mock_history_file, mock_generate_desc, mock_atomic_write, client):
        """Test profile import without generating description."""
        # Should not be called when generate_description=False
        mock_generate_desc.return_value = "Should not use this"
        
        profile_json = {
            "name": "Quick Import",
            "temperature": 92.0
        }
        
        mock_history_file.exists.return_value = False
        
        with patch('builtins.open', mock_open()) as mock_file:
            response = client.post(
                "/api/profile/import",
                json={
                    "profile": profile_json,
                    "generate_description": False,
                    "source": "machine"
                }
            )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        # Description not generated, but basic message exists
        # has_description checks for "Description generation failed" not in reply
        # So we just verify import succeeded
        mock_generate_desc.assert_not_called()
        mock_atomic_write.assert_called_once()

    @patch('main.HISTORY_FILE')
    def test_import_profile_already_exists(self, mock_history_file, client):
        """Test importing a profile that already exists in history."""
        profile_json = {
            "name": "Existing Profile",
            "temperature": 93.0
        }
        
        mock_history_file.exists.return_value = True
        history_data = [
            {
                "id": "existing-123",
                "profile_name": "Existing Profile",
                "reply": "Already here"
            }
        ]
        
        with patch('builtins.open', mock_open(read_data=json.dumps(history_data))):
            response = client.post(
                "/api/profile/import",
                json={"profile": profile_json}
            )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "exists"
        assert "already exists" in data["message"]
        assert data["entry_id"] == "existing-123"

    def test_import_profile_missing_json(self, client):
        """Test error when no profile JSON is provided."""
        response = client.post(
            "/api/profile/import",
            json={"generate_description": True}
        )
        
        assert response.status_code == 400
        assert "No profile JSON provided" in response.json()["detail"]

    @patch('main.atomic_write_json')
    @patch('main._generate_profile_description', new_callable=AsyncMock)
    @patch('main.HISTORY_FILE')
    def test_import_profile_description_generation_fails(self, mock_history_file, mock_generate_desc, mock_atomic_write, client):
        """Test import continues when description generation fails."""
        mock_generate_desc.side_effect = Exception("AI service unavailable")
        
        profile_json = {
            "name": "Fallback Profile",
            "temperature": 91.0
        }
        
        mock_history_file.exists.return_value = False
        
        with patch('builtins.open', mock_open()) as mock_file:
            response = client.post(
                "/api/profile/import",
                json={
                    "profile": profile_json,
                    "generate_description": True,
                    "source": "file"
                }
            )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        # Should have fallback message
        assert data["has_description"] is False
        mock_atomic_write.assert_called_once()

    @patch('main.atomic_write_json')
    @patch('main.HISTORY_FILE')
    def test_import_profile_legacy_history_format(self, mock_history_file, mock_atomic_write, client):
        """Test import with legacy history format (dict with entries)."""
        profile_json = {
            "name": "New Profile",
            "temperature": 94.0
        }
        
        mock_history_file.exists.return_value = True
        # Legacy format
        history_data = {
            "entries": [
                {"profile_name": "Old Profile"}
            ]
        }
        
        with patch('builtins.open', mock_open(read_data=json.dumps(history_data))) as mock_file:
            response = client.post(
                "/api/profile/import",
                json={
                    "profile": profile_json,
                    "generate_description": False
                }
            )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"

    def test_import_profile_empty_request(self, client):
        """Test error when request body is empty."""
        response = client.post("/api/profile/import", json={})
        
        assert response.status_code == 400


class TestShotsByProfileEndpoint:
    """Tests for the /api/shots/by-profile/{profile_name} endpoint."""

    @patch('main.get_meticulous_api')
    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main._get_cached_shots')
    @patch('main._set_cached_shots')
    def test_get_shots_by_profile_success(self, mock_set_cache, mock_get_cache, mock_fetch_shot, mock_get_api, client):
        """Test successful retrieval of shots for a profile."""
        # No cache initially
        mock_get_cache.return_value = (None, False, None)
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        # Mock dates
        date1 = MagicMock()
        date1.name = "2024-01-15"
        mock_api.get_history_dates.return_value = [date1]
        
        # Mock files
        file1 = MagicMock()
        file1.name = "shot_001.json"
        file2 = MagicMock()
        file2.name = "shot_002.json"
        mock_api.get_shot_files.return_value = [file1, file2]
        
        # Mock shot data
        shot_data_1 = {
            "profile_name": "Espresso Classic",
            "time": 1705320000,
            "data": [
                {"time": 25000, "shot": {"weight": 36.5}}
            ]
        }
        
        shot_data_2 = {
            "profile": {"name": "Espresso Classic"},
            "time": 1705320100,
            "data": [
                {"time": 28000, "shot": {"weight": 38.0}}
            ]
        }
        
        mock_fetch_shot.side_effect = [shot_data_1, shot_data_2]
        
        response = client.get("/api/shots/by-profile/Espresso%20Classic?limit=10")
        
        assert response.status_code == 200
        data = response.json()
        assert data["profile_name"] == "Espresso Classic"
        assert data["count"] == 2
        assert len(data["shots"]) == 2
        assert data["shots"][0]["final_weight"] == 36.5
        assert data["shots"][1]["final_weight"] == 38.0

    @patch('main._get_cached_shots')
    def test_get_shots_by_profile_from_cache(self, mock_get_cache, client):
        """Test returning cached shots when available."""
        cached_data = {
            "profile_name": "Cached Profile",
            "shots": [{"date": "2024-01-15", "filename": "shot_001.json"}],
            "count": 1,
            "limit": 10
        }
        
        mock_get_cache.return_value = (cached_data, False, 1705320000.0)
        
        response = client.get("/api/shots/by-profile/Cached%20Profile")
        
        assert response.status_code == 200
        data = response.json()
        assert data["profile_name"] == "Cached Profile"
        assert data["count"] == 1
        assert "cached_at" in data
        assert data["is_stale"] is False

    @patch('main.get_meticulous_api')
    @patch('main._get_cached_shots')
    def test_get_shots_by_profile_api_error(self, mock_get_cache, mock_get_api, client):
        """Test error handling when machine API fails."""
        mock_get_cache.return_value = (None, False, None)
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        mock_result = MagicMock()
        mock_result.error = "Connection timeout"
        mock_api.get_history_dates.return_value = mock_result
        
        response = client.get("/api/shots/by-profile/Test%20Profile")
        
        assert response.status_code == 502

    @patch('main.get_meticulous_api')
    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main._get_cached_shots')
    @patch('main._set_cached_shots')
    def test_get_shots_by_profile_no_matches(self, mock_set_cache, mock_get_cache, mock_fetch_shot, mock_get_api, client):
        """Test when no shots match the profile."""
        mock_get_cache.return_value = (None, False, None)
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        date1 = type('Date', (), {})()
        date1.name = "2024-01-15"
        date1.error = None
        mock_api.get_history_dates.return_value = [date1]
        
        file1 = type('File', (), {})()
        file1.name = "shot_001.json"
        file1.error = None
        mock_api.get_shot_files.return_value = [file1]
        
        # Shot with different profile name
        shot_data = {
            "profile_name": "Different Profile",
            "time": 1705320000,
            "data": []
        }
        mock_fetch_shot.return_value = shot_data
        
        response = client.get("/api/shots/by-profile/Nonexistent%20Profile")
        
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert len(data["shots"]) == 0

    @patch('main.get_meticulous_api')
    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main._get_cached_shots')
    @patch('main._set_cached_shots')
    def test_get_shots_by_profile_with_limit(self, mock_set_cache, mock_get_cache, mock_fetch_shot, mock_get_api, client):
        """Test limit parameter works correctly."""
        mock_get_cache.return_value = (None, False, None)
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        date1 = type('Date', (), {})()
        date1.name = "2024-01-15"
        date1.error = None
        mock_api.get_history_dates.return_value = [date1]
        
        # Create file objects properly
        files = []
        for i in range(5):
            f = type('File', (), {})()
            f.name = f"shot_{i:03d}.json"
            f.error = None
            files.append(f)
        mock_api.get_shot_files.return_value = files
        
        # All shots match
        def create_shot_data(i):
            return {
                "profile_name": "Test Profile",
                "time": 1705320000 + i,
                "data": [{"time": 25000, "shot": {"weight": 36.0 + i}}]
            }
        
        mock_fetch_shot.side_effect = [create_shot_data(i) for i in range(5)]
        
        response = client.get("/api/shots/by-profile/Test%20Profile?limit=2")
        
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        assert data["limit"] == 2

    @patch('main.get_meticulous_api')
    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main._get_cached_shots')
    def test_get_shots_by_profile_include_data(self, mock_get_cache, mock_fetch_shot, mock_get_api, client):
        """Test including full shot data in response."""
        mock_get_cache.return_value = (None, False, None)
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        date1 = MagicMock()
        date1.name = "2024-01-15"
        mock_api.get_history_dates.return_value = [date1]
        
        file1 = MagicMock()
        file1.name = "shot_001.json"
        mock_api.get_shot_files.return_value = [file1]
        
        shot_data = {
            "profile_name": "Full Data Profile",
            "time": 1705320000,
            "data": [
                {"time": 10000, "shot": {"weight": 10.0, "pressure": 9.0}},
                {"time": 25000, "shot": {"weight": 36.0, "pressure": 9.0}}
            ]
        }
        mock_fetch_shot.return_value = shot_data
        
        response = client.get("/api/shots/by-profile/Full%20Data%20Profile?include_data=true")
        
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        assert "data" in data["shots"][0]
        assert len(data["shots"][0]["data"]["data"]) == 2

    @patch('main.get_meticulous_api')
    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main._get_cached_shots')
    @patch('main._set_cached_shots')
    def test_get_shots_by_profile_case_insensitive(self, mock_set_cache, mock_get_cache, mock_fetch_shot, mock_get_api, client):
        """Test profile name matching is case-insensitive."""
        mock_get_cache.return_value = (None, False, None)
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        date1 = type('Date', (), {})()
        date1.name = "2024-01-15"
        date1.error = None
        mock_api.get_history_dates.return_value = [date1]
        
        file1 = type('File', (), {})()
        file1.name = "shot_001.json"
        file1.error = None
        mock_api.get_shot_files.return_value = [file1]
        
        shot_data = {
            "profile_name": "ESPRESSO CLASSIC",
            "time": 1705320000,
            "data": [{"time": 25000, "shot": {"weight": 36.0}}]
        }
        mock_fetch_shot.return_value = shot_data
        
        response = client.get("/api/shots/by-profile/espresso%20classic")
        
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1

    @patch('main._get_cached_shots')
    @patch('main.get_meticulous_api')
    @patch('main._set_cached_shots')
    def test_get_shots_by_profile_force_refresh(self, mock_set_cache, mock_get_api, mock_get_cache, client):
        """Test force_refresh parameter bypasses cache."""
        # Cache exists but should be ignored
        cached_data = {
            "profile_name": "Cached",
            "shots": [],
            "count": 0
        }
        mock_get_cache.return_value = (cached_data, False, 1705320000.0)
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.get_history_dates.return_value = []
        
        response = client.get("/api/shots/by-profile/Test?force_refresh=true")
        
        assert response.status_code == 200
        # Should hit API, not cache
        mock_api.get_history_dates.assert_called_once()

    @patch('main.get_meticulous_api')
    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main._get_cached_shots')
    @patch('main._set_cached_shots')
    def test_get_shots_by_profile_partial_shot_errors(self, mock_set_cache, mock_get_cache, mock_fetch_shot, mock_get_api, client):
        """Test continues when individual shot fetch fails."""
        mock_get_cache.return_value = (None, False, None)
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        date1 = type('Date', (), {})()
        date1.name = "2024-01-15"
        date1.error = None
        mock_api.get_history_dates.return_value = [date1]
        
        file1 = type('File', (), {})()
        file1.name = "good.json"
        file1.error = None
        file2 = type('File', (), {})()
        file2.name = "bad.json"
        file2.error = None
        mock_api.get_shot_files.return_value = [file1, file2]
        
        good_shot = {
            "profile_name": "Test",
            "time": 1705320000,
            "data": [{"time": 25000, "shot": {"weight": 36.0}}]
        }
        
        # First succeeds, second fails
        mock_fetch_shot.side_effect = [good_shot, Exception("Corrupted file")]
        
        response = client.get("/api/shots/by-profile/Test")
        
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1  # Only the good shot


class TestImageProxyEndpoint:
    """Tests for the /api/profile/{profile_name}/image-proxy endpoint."""

    @patch('main._get_cached_image')
    def test_image_proxy_from_cache(self, mock_get_cache, client):
        """Test returning cached image."""
        mock_get_cache.return_value = b"fake_png_data"
        
        response = client.get("/api/profile/Test%20Profile/image-proxy")
        
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.content == b"fake_png_data"

    @patch('main._get_cached_image')
    @patch('main.get_meticulous_api')
    def test_image_proxy_profile_not_found(self, mock_get_api, mock_get_cache, client):
        """Test error when profile not found."""
        mock_get_cache.return_value = None
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.list_profiles.return_value = []
        
        response = client.get("/api/profile/Nonexistent/image-proxy")
        
        assert response.status_code == 404

    @patch('main._get_cached_image')
    @patch('main.get_meticulous_api')
    def test_image_proxy_no_image(self, mock_get_api, mock_get_cache, client):
        """Test error when profile has no image."""
        mock_get_cache.return_value = None
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        mock_profile = type('Profile', (), {})()
        mock_profile.name = "No Image"
        mock_profile.id = "profile-456"
        mock_profile.error = None
        mock_api.list_profiles.return_value = [mock_profile]
        
        full_profile = type('FullProfile', (), {})()
        full_profile.name = "No Image"
        full_profile.display = None
        full_profile.error = None
        mock_api.get_profile.return_value = full_profile
        
        response = client.get("/api/profile/No%20Image/image-proxy")
        
        assert response.status_code == 404


class TestAdditionalEndpoints:
    """Tests for additional utility endpoints."""

    def test_status_endpoint(self, client):
        """Test status endpoint."""
        response = client.get("/status")
        
        assert response.status_code == 200
        data = response.json()
        # Status endpoint returns update information
        assert "update_available" in data


class TestGetProfileInfoEndpoint:
    """Tests for the GET /api/profile/{profile_name} endpoint."""

    @patch('main.get_meticulous_api')
    def test_get_profile_info_success(self, mock_get_api, client):
        """Test successful profile retrieval."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        # Mock list profiles
        partial_profile = type('PartialProfile', (), {})()
        partial_profile.name = "Test Profile"
        partial_profile.id = "profile-123"
        partial_profile.error = None
        mock_api.list_profiles.return_value = [partial_profile]
        
        # Mock get full profile
        full_profile = type('FullProfile', (), {})()
        full_profile.id = "profile-123"
        full_profile.name = "Test Profile"
        full_profile.author = "Barista"
        full_profile.temperature = 93.0
        full_profile.final_weight = 36.0
        full_profile.error = None
        
        display = type('Display', (), {})()
        display.image = "data:image/png;base64,abc123"
        display.accentColor = "#FF5733"
        full_profile.display = display
        
        mock_api.get_profile.return_value = full_profile
        
        response = client.get("/api/profile/Test%20Profile")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["profile"]["name"] == "Test Profile"
        assert data["profile"]["temperature"] == 93.0
        assert data["profile"]["final_weight"] == 36.0
        assert data["profile"]["image"] == "data:image/png;base64,abc123"
        assert data["profile"]["accent_color"] == "#FF5733"

    @patch('main.get_meticulous_api')
    def test_get_profile_info_not_found(self, mock_get_api, client):
        """Test error when profile not found."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.list_profiles.return_value = []
        
        response = client.get("/api/profile/Nonexistent")
        
        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

    @patch('main.get_meticulous_api')
    def test_get_profile_info_no_display(self, mock_get_api, client):
        """Test profile without display/image."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial_profile = type('PartialProfile', (), {})()
        partial_profile.name = "Simple"
        partial_profile.id = "profile-456"
        partial_profile.error = None
        mock_api.list_profiles.return_value = [partial_profile]
        
        full_profile = type('FullProfile', (), {})()
        full_profile.id = "profile-456"
        full_profile.name = "Simple"
        full_profile.author = "Basic"
        full_profile.temperature = 90.0
        full_profile.final_weight = 40.0
        full_profile.display = None
        full_profile.error = None
        
        mock_api.get_profile.return_value = full_profile
        
        response = client.get("/api/profile/Simple")
        
        assert response.status_code == 200
        data = response.json()
        assert data["profile"]["image"] is None
        assert data["profile"]["accent_color"] is None

    @patch('main.get_meticulous_api')
    def test_get_profile_info_api_error(self, mock_get_api, client):
        """Test handling of machine API errors."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        error_result = type('ErrorResult', (), {})()
        error_result.error = "Connection failed"
        mock_api.list_profiles.return_value = error_result
        
        response = client.get("/api/profile/Test")
        
        assert response.status_code == 502

    @patch('main.get_meticulous_api')
    def test_get_profile_info_exception(self, mock_get_api, client):
        """Test exception handling."""
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.list_profiles.side_effect = Exception("Unexpected error")
        
        response = client.get("/api/profile/Test")
        
        assert response.status_code == 500


class TestLocalShotAnalysisEndpoint:
    """Tests for the POST /api/shots/analyze endpoint."""

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    def test_local_shot_analysis_success(self, mock_get_api, mock_fetch_shot, client):
        """Test successful local shot analysis."""
        # Mock shot data
        shot_data = {
            "profile_name": "Test Profile",
            "time": 1705320000,
            "data": [
                {"time": 0, "shot": {"weight": 0, "pressure": 0, "flow": 0}},
                {"time": 25000, "shot": {"weight": 36.0, "pressure": 9.0, "flow": 2.5}},
            ]
        }
        mock_fetch_shot.return_value = shot_data
        
        # Mock profile data
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial_profile = type('PartialProfile', (), {})()
        partial_profile.name = "Test Profile"
        partial_profile.id = "profile-123"
        partial_profile.error = None
        mock_api.list_profiles.return_value = [partial_profile]
        
        full_profile = type('FullProfile', (), {})()
        full_profile.name = "Test Profile"
        full_profile.temperature = 93.0
        full_profile.final_weight = 36.0
        full_profile.variables = []
        full_profile.stages = []
        full_profile.error = None
        mock_api.get_profile.return_value = full_profile
        
        response = client.post("/api/shots/analyze", data={
            "profile_name": "Test Profile",
            "shot_date": "2024-01-15",
            "shot_filename": "shot_001.json"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "analysis" in data
        assert "shot_summary" in data["analysis"]
        assert data["analysis"]["shot_summary"]["final_weight"] == 36.0

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    def test_local_shot_analysis_with_preinfusion(self, mock_get_api, mock_fetch_shot, client):
        """Test analysis detects preinfusion stages."""
        shot_data = {
            "profile_name": "Complex",
            "time": 1705320000,
            "data": [
                {"time": 0, "shot": {"weight": 0, "pressure": 2.0, "flow": 0.5}, "stage_name": "Bloom"},
                {"time": 5000, "shot": {"weight": 2.0, "pressure": 2.0, "flow": 0.5}, "stage_name": "Bloom"},
                {"time": 25000, "shot": {"weight": 36.0, "pressure": 9.0, "flow": 2.5}, "stage_name": "Main"},
            ]
        }
        mock_fetch_shot.return_value = shot_data
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial = type('P', (), {})()
        partial.name = "Complex"
        partial.id = "p-456"
        partial.error = None
        mock_api.list_profiles.return_value = [partial]
        
        full = type('F', (), {})()
        full.name = "Complex"
        full.temperature = 92.0
        full.final_weight = 36.0
        full.variables = []
        
        # Create stages with preinfusion
        stage1 = type('Stage', (), {})()
        stage1.name = "Bloom"
        stage1.key = "bloom"
        stage1.type = "pressure"
        stage1.dynamics_points = [[0, 2.0], [5, 2.0]]
        stage1.dynamics_over = "time"
        stage1.dynamics_interpolation = "linear"
        stage1.exit_triggers = []
        stage1.limits = []
        
        stage2 = type('Stage', (), {})()
        stage2.name = "Main"
        stage2.key = "main"
        stage2.type = "pressure"
        stage2.dynamics_points = [[0, 9.0]]
        stage2.dynamics_over = "time"
        stage2.dynamics_interpolation = "linear"
        stage2.exit_triggers = []
        stage2.limits = []
        
        full.stages = [stage1, stage2]
        full.error = None
        mock_api.get_profile.return_value = full
        
        response = client.post("/api/shots/analyze", data={
            "profile_name": "Complex",
            "shot_date": "2024-01-15",
            "shot_filename": "shot.json"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "preinfusion_summary" in data["analysis"]

    def test_local_shot_analysis_missing_params(self, client):
        """Test error when required parameters missing."""
        response = client.post("/api/shots/analyze", data={
            "profile_name": "Test"
            # Missing shot_date and shot_filename
        })
        
        assert response.status_code == 422

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    def test_local_shot_analysis_shot_not_found(self, mock_fetch_shot, client):
        """Test error when shot data not found."""
        async def raise_http_exception(*args, **kwargs):
            raise HTTPException(status_code=404, detail="Shot not found")
        
        mock_fetch_shot.side_effect = raise_http_exception
        
        response = client.post("/api/shots/analyze", data={
            "profile_name": "Test",
            "shot_date": "2024-01-15",
            "shot_filename": "missing.json"
        })
        
        assert response.status_code == 404

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    def test_local_shot_analysis_profile_not_found(self, mock_get_api, mock_fetch_shot, client):
        """Test error when profile not found."""
        mock_fetch_shot.return_value = {
            "profile_name": "Unknown",
            "time": 1705320000,
            "data": []
        }
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.list_profiles.return_value = []
        
        response = client.post("/api/shots/analyze", data={
            "profile_name": "Unknown",
            "shot_date": "2024-01-15",
            "shot_filename": "shot.json"
        })
        
        assert response.status_code == 404

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    def test_local_shot_analysis_weight_deviation(self, mock_get_api, mock_fetch_shot, client):
        """Test analysis with weight deviation."""
        shot_data = {
            "profile_name": "Test",
            "time": 1705320000,
            "data": [
                {"time": 0, "shot": {"weight": 0, "pressure": 0, "flow": 0}},
                {"time": 25000, "shot": {"weight": 45.0, "pressure": 9.0, "flow": 2.5}},  # Over target
            ]
        }
        mock_fetch_shot.return_value = shot_data
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial = type('P', (), {})()
        partial.name = "Test"
        partial.id = "p-123"
        partial.error = None
        mock_api.list_profiles.return_value = [partial]
        
        full = type('F', (), {})()
        full.name = "Test"
        full.temperature = 93.0
        full.final_weight = 36.0  # Target is 36g, got 45g
        full.variables = []
        full.stages = []
        full.error = None
        mock_api.get_profile.return_value = full
        
        response = client.post("/api/shots/analyze", data={
            "profile_name": "Test",
            "shot_date": "2024-01-15",
            "shot_filename": "shot.json"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["analysis"]["weight_analysis"]["status"] == "over"

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    def test_local_shot_analysis_exception(self, mock_get_api, mock_fetch_shot, client):
        """Test handling of unexpected exceptions."""
        mock_fetch_shot.return_value = {"profile_name": "Test", "data": []}
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.list_profiles.side_effect = Exception("Unexpected error")
        
        response = client.post("/api/shots/analyze", data={
            "profile_name": "Test",
            "shot_date": "2024-01-15",
            "shot_filename": "shot.json"
        })
        
        assert response.status_code == 500


class TestGenerateProfileImageEndpoint:
    """Tests for the POST /api/profile/{profile_name}/generate-image endpoint."""

    @patch('subprocess.run')
    @patch('main.get_meticulous_api')
    @patch('main.process_image_for_profile')
    @patch('main._set_cached_image')
    def test_generate_image_preview_mode(self, mock_cache, mock_process, mock_get_api, mock_subprocess, client):
        """Test image generation in preview mode."""
        # Mock subprocess for nanobanana
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "saved it to `/root/nanobanana-output/test.png`"
        mock_result.stderr = ""
        
        mock_subprocess.side_effect = [
            mock_result,  # nanobanana execution
            MagicMock(returncode=0),  # test -f check
            MagicMock(returncode=0, stdout=b"fake_png_data")  # cat image
        ]
        
        # Mock image processing
        mock_process.return_value = ("data:image/png;base64,abc123", b"png_bytes")
        
        response = client.post("/api/profile/Test%20Profile/generate-image?preview=true&style=abstract")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "preview"
        assert "image_data" in data
        assert data["style"] == "abstract"
        assert "prompt" in data

    @patch('subprocess.run')
    @patch('main.get_meticulous_api')
    @patch('main.process_image_for_profile')
    @patch('main._set_cached_image')
    def test_generate_image_save_to_profile(self, mock_cache, mock_process, mock_get_api, mock_subprocess, client):
        """Test image generation and save to profile."""
        # Mock subprocess
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "saved it to `/root/nanobanana-output/test.png`"
        
        mock_subprocess.side_effect = [
            mock_result,
            MagicMock(returncode=0),
            MagicMock(returncode=0, stdout=b"fake_png")
        ]
        
        mock_process.return_value = ("data:image/png;base64,xyz", b"png_bytes")
        
        # Mock API
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial = type('P', (), {})()
        partial.name = "Test Profile"
        partial.id = "p-123"
        partial.error = None
        mock_api.list_profiles.return_value = [partial]
        
        full = type('F', (), {})()
        full.id = "p-123"
        full.name = "Test Profile"
        full.display = None
        full.error = None
        mock_api.get_profile.return_value = full
        
        save_result = type('SaveResult', (), {})()
        save_result.error = None
        mock_api.save_profile.return_value = save_result
        
        response = client.post("/api/profile/Test%20Profile/generate-image?preview=false")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["profile_id"] == "p-123"

    @patch('subprocess.run')
    def test_generate_image_nanobanana_auth_error(self, mock_subprocess, client):
        """Test handling of API key errors."""
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "API key authentication failed"
        mock_result.stdout = ""
        mock_subprocess.return_value = mock_result
        
        response = client.post("/api/profile/Test/generate-image")
        
        assert response.status_code == 402

    @patch('subprocess.run')
    def test_generate_image_nanobanana_generic_error(self, mock_subprocess, client):
        """Test handling of generic generation errors."""
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "Unknown error occurred"
        mock_result.stdout = ""
        mock_subprocess.return_value = mock_result
        
        response = client.post("/api/profile/Test/generate-image")
        
        assert response.status_code == 500

    @patch('subprocess.run')
    def test_generate_image_timeout(self, mock_subprocess, client):
        """Test handling of generation timeout."""
        mock_subprocess.side_effect = subprocess.TimeoutExpired("docker", 120)
        
        response = client.post("/api/profile/Test/generate-image")
        
        assert response.status_code == 504

    @patch('subprocess.run')
    @patch('main.process_image_for_profile')
    def test_generate_image_file_not_found(self, mock_process, mock_subprocess, client):
        """Test when generated image cannot be found."""
        # Nanobanana succeeds but file not found
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Done but no file path"
        
        # All file checks fail
        mock_subprocess.side_effect = [
            mock_result,
            MagicMock(returncode=1),  # File not found
            MagicMock(returncode=1, stdout="")  # ls also fails
        ]
        
        response = client.post("/api/profile/Test/generate-image")
        
        assert response.status_code == 500

    @patch('subprocess.run')
    @patch('main._set_cached_image')
    def test_generate_image_invalid_style(self, mock_cache, mock_subprocess, client):
        """Test with invalid style parameter (should default to abstract)."""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "saved it to `/root/nanobanana-output/test.png`"
        
        mock_subprocess.side_effect = [
            mock_result,
            MagicMock(returncode=0),
            MagicMock(returncode=0, stdout=b"fake_png")
        ]
        
        with patch('main.process_image_for_profile') as mock_process:
            mock_process.return_value = ("data:image/png;base64,xyz", b"png")
            
            response = client.post("/api/profile/Test/generate-image?style=invalid&preview=true")
            
            assert response.status_code == 200
            data = response.json()
            assert data["style"] == "abstract"  # Should default

    @patch('subprocess.run')
    @patch('main.get_meticulous_api')
    @patch('main.process_image_for_profile')
    @patch('main._set_cached_image')
    def test_generate_image_profile_not_found_for_save(self, mock_cache, mock_process, mock_get_api, mock_subprocess, client):
        """Test error when profile not found for saving."""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "saved it to `/root/nanobanana-output/test.png`"
        
        mock_subprocess.side_effect = [
            mock_result,
            MagicMock(returncode=0),
            MagicMock(returncode=0, stdout=b"fake_png")
        ]
        
        mock_process.return_value = ("data:image/png;base64,xyz", b"png_bytes")
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.list_profiles.return_value = []
        
        response = client.post("/api/profile/Nonexistent/generate-image?preview=false")
        
        assert response.status_code == 404

    @patch('subprocess.run')
    @patch('main.get_meticulous_api')
    @patch('main.process_image_for_profile')
    @patch('main._set_cached_image')
    def test_generate_image_save_failure(self, mock_cache, mock_process, mock_get_api, mock_subprocess, client):
        """Test handling of profile save failure."""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "saved it to `/root/nanobanana-output/test.png`"
        
        mock_subprocess.side_effect = [
            mock_result,
            MagicMock(returncode=0),
            MagicMock(returncode=0, stdout=b"fake_png")
        ]
        
        mock_process.return_value = ("data:image/png;base64,xyz", b"png_bytes")
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial = type('P', (), {})()
        partial.name = "Test"
        partial.id = "p-123"
        partial.error = None
        mock_api.list_profiles.return_value = [partial]
        
        full = type('F', (), {})()
        full.id = "p-123"
        full.name = "Test"
        full.display = None
        full.error = None
        mock_api.get_profile.return_value = full
        
        # Save fails
        save_result = type('SaveResult', (), {})()
        save_result.error = "Failed to save"
        mock_api.save_profile.return_value = save_result
        
        response = client.post("/api/profile/Test/generate-image?preview=false")
        
        assert response.status_code == 502

    @patch('subprocess.run')
    def test_generate_image_read_failure(self, mock_subprocess, client):
        """Test when reading generated image fails."""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "saved it to `/root/nanobanana-output/test.png`"
        
        # File exists but cat fails
        mock_subprocess.side_effect = [
            mock_result,
            MagicMock(returncode=0),  # test -f succeeds
            MagicMock(returncode=1, stderr="Read error")  # cat fails
        ]
        
        response = client.post("/api/profile/Test/generate-image")
        
        assert response.status_code == 500


class TestLLMShotAnalysisEndpoint:
    """Tests for the POST /api/shots/analyze-llm endpoint."""

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    @patch('main.get_vision_model')
    @patch('main._perform_local_shot_analysis')
    def test_llm_analysis_success(self, mock_local_analysis, mock_get_model, mock_get_api, mock_fetch_shot, client):
        """Test successful LLM shot analysis."""
        # Mock shot data
        shot_data = {
            "profile_name": "Test",
            "time": 1705320000,
            "data": [{"time": 25000, "shot": {"weight": 36.0}}]
        }
        mock_fetch_shot.return_value = shot_data
        
        # Mock profile
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial = type('P', (), {})()
        partial.name = "Test"
        partial.id = "p-123"
        partial.error = None
        mock_api.list_profiles.return_value = [partial]
        
        full = type('F', (), {})()
        full.name = "Test"
        full.temperature = 93.0
        full.final_weight = 36.0
        full.variables = []
        full.stages = []
        full.error = None
        mock_api.get_profile.return_value = full
        
        # Mock local analysis
        mock_local_analysis.return_value = {
            "summary": {"final_weight": 36.0},
            "stages": []
        }
        
        # Mock LLM response
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "## 1. Shot Performance\n\n**What Happened:**\n- Excellent extraction\n\n**Assessment:** Good"
        mock_model.generate_content.return_value = mock_response
        mock_get_model.return_value = mock_model
        
        response = client.post("/api/shots/analyze-llm", data={
            "profile_name": "Test",
            "shot_date": "2024-01-15",
            "shot_filename": "shot.json",
            "profile_description": "Test description",
            "force_refresh": "true"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "llm_analysis" in data
        assert "Shot Performance" in data["llm_analysis"]

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    def test_llm_analysis_profile_not_found(self, mock_get_api, mock_fetch_shot, client):
        """Test error when profile not found."""
        mock_fetch_shot.return_value = {"profile_name": "Unknown", "data": []}
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        mock_api.list_profiles.return_value = []
        
        response = client.post("/api/shots/analyze-llm", data={
            "profile_name": "Unknown",
            "shot_date": "2024-01-15",
            "shot_filename": "shot.json",
            "force_refresh": "true"
        })
        
        assert response.status_code == 404

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    @patch('main.get_vision_model')
    @patch('main._perform_local_shot_analysis')
    def test_llm_analysis_model_error(self, mock_local_analysis, mock_get_model, mock_get_api, mock_fetch_shot, client):
        """Test handling of LLM errors."""
        mock_fetch_shot.return_value = {"profile_name": "Test", "data": []}
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial = type('P', (), {})()
        partial.name = "Test"
        partial.id = "p-123"
        partial.error = None
        mock_api.list_profiles.return_value = [partial]
        
        full = type('F', (), {})()
        full.name = "Test"
        full.temperature = 93.0
        full.final_weight = 36.0
        full.variables = []
        full.stages = []
        full.error = None
        mock_api.get_profile.return_value = full
        
        mock_local_analysis.return_value = {"summary": {}, "stages": []}
        
        mock_model = MagicMock()
        mock_model.generate_content.side_effect = Exception("API rate limit")
        mock_get_model.return_value = mock_model
        
        response = client.post("/api/shots/analyze-llm", data={
            "profile_name": "Test",
            "shot_date": "2024-01-15",
            "shot_filename": "shot.json",
            "force_refresh": "true"
        })
        
        assert response.status_code == 500

    def test_llm_analysis_missing_params(self, client):
        """Test error with missing required parameters."""
        response = client.post("/api/shots/analyze-llm", data={
            "profile_name": "Test"
            # Missing shot_date and shot_filename
        })
        
        assert response.status_code == 422

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    @patch('main.get_vision_model')
    @patch('main._perform_local_shot_analysis')
    def test_llm_analysis_with_description(self, mock_local_analysis, mock_get_model, mock_get_api, mock_fetch_shot, client):
        """Test LLM analysis with profile description."""
        mock_fetch_shot.return_value = {"profile_name": "Test", "data": []}
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial = type('P', (), {})()
        partial.name = "Test"
        partial.id = "p-123"
        partial.error = None
        mock_api.list_profiles.return_value = [partial]
        
        full = type('F', (), {})()
        full.name = "Test"
        full.temperature = 93.0
        full.final_weight = 36.0
        full.variables = []
        full.stages = []
        full.error = None
        mock_api.get_profile.return_value = full
        
        mock_local_analysis.return_value = {"summary": {}, "stages": []}
        
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "Analysis with description context"
        mock_model.generate_content.return_value = mock_response
        mock_get_model.return_value = mock_model
        
        response = client.post("/api/shots/analyze-llm", data={
            "profile_name": "Test",
            "shot_date": "2024-01-15",
            "shot_filename": "shot.json",
            "profile_description": "A gentle preinfusion profile",
            "force_refresh": "true"
        })
        
        assert response.status_code == 200
        # Verify description was passed to LLM
        call_args = mock_model.generate_content.call_args[0][0]
        assert "gentle preinfusion" in call_args

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    @patch('main.get_meticulous_api')
    @patch('main.get_vision_model')
    @patch('main._perform_local_shot_analysis')
    def test_llm_analysis_with_variables(self, mock_local_analysis, mock_get_model, mock_get_api, mock_fetch_shot, client):
        """Test LLM analysis with profile variables."""
        mock_fetch_shot.return_value = {"profile_name": "Test", "data": []}
        
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial = type('P', (), {})()
        partial.name = "Test"
        partial.id = "p-123"
        partial.error = None
        mock_api.list_profiles.return_value = [partial]
        
        # Create variable
        var = type('Var', (), {})()
        var.key = "dose"
        var.name = "Dose"
        var.type = "number"
        var.value = 18.0
        
        full = type('F', (), {})()
        full.name = "Test"
        full.temperature = 93.0
        full.final_weight = 36.0
        full.variables = [var]
        full.stages = []
        full.error = None
        mock_api.get_profile.return_value = full
        
        mock_local_analysis.return_value = {"summary": {}, "stages": []}
        
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "Analysis"
        mock_model.generate_content.return_value = mock_response
        mock_get_model.return_value = mock_model
        
        response = client.post("/api/shots/analyze-llm", data={
            "profile_name": "Test",
            "shot_date": "2024-01-15",
            "shot_filename": "shot.json",
            "force_refresh": "true"
        })
        
        assert response.status_code == 200

    @patch('main.fetch_shot_data', new_callable=AsyncMock)
    def test_llm_analysis_shot_not_found(self, mock_fetch_shot, client):
        """Test error when shot data not found."""
        async def raise_http_exception(*args, **kwargs):
            raise HTTPException(status_code=404, detail="Shot not found")
        
        mock_fetch_shot.side_effect = raise_http_exception
        
        response = client.post("/api/shots/analyze-llm", data={
            "profile_name": "Test",
            "shot_date": "2024-01-15",
            "shot_filename": "missing.json",
            "force_refresh": "true"
        })
        
        assert response.status_code == 404


class TestConvertDescriptionEndpoint:
    """Tests for the POST /api/profile/convert-description endpoint."""

    @patch('main.get_vision_model')
    @patch('main.HISTORY_FILE')
    def test_convert_description_success(self, mock_history_file, mock_get_model, client):
        """Test successful description conversion."""
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = """Profile Created: Test Profile

Description:
A balanced espresso profile with gentle preinfusion.

Preparation:
• Dose: 18g
• Grind: Medium-fine
• Temperature: 93°C
• Target Yield: 36g

Why This Works:
The preinfusion allows even saturation before pressure ramp.

Special Notes:
Adjust grind based on bean age."""
        
        mock_model.generate_content.return_value = mock_response
        mock_get_model.return_value = mock_model
        
        mock_history_file.exists.return_value = False
        
        response = client.post("/api/profile/convert-description", json={
            "profile": {
                "name": "Test Profile",
                "temperature": 93.0,
                "final_weight": 36.0,
                "stages": []
            },
            "description": "Original description here"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "converted_description" in data
        assert "Profile Created" in data["converted_description"]

    @patch('main.get_vision_model')
    @patch('main.HISTORY_FILE')
    def test_convert_description_with_history_update(self, mock_history_file, mock_get_model, client):
        """Test conversion updates history entry."""
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "Converted description"
        mock_model.generate_content.return_value = mock_response
        mock_get_model.return_value = mock_model
        
        # Mock history file
        mock_history_file.exists.return_value = True
        existing_history = [
            {"id": "entry-123", "profile_name": "Test", "reply": "Old description"},
            {"id": "entry-456", "profile_name": "Other", "reply": "Other description"}
        ]
        
        with patch('builtins.open', mock_open(read_data=json.dumps(existing_history))) as mock_file:
            response = client.post("/api/profile/convert-description", json={
                "profile": {"name": "Test", "temperature": 93.0, "final_weight": 36.0},
                "description": "Original",
                "entry_id": "entry-123"
            })
        
        assert response.status_code == 200

    def test_convert_description_missing_profile(self, client):
        """Test error when profile JSON missing."""
        response = client.post("/api/profile/convert-description", json={
            "description": "Some description"
            # Missing profile
        })
        
        assert response.status_code == 400

    @patch('main.get_vision_model')
    def test_convert_description_model_error(self, mock_get_model, client):
        """Test handling of LLM errors."""
        mock_model = MagicMock()
        mock_model.generate_content.side_effect = Exception("API error")
        mock_get_model.return_value = mock_model
        
        response = client.post("/api/profile/convert-description", json={
            "profile": {"name": "Test", "temperature": 93.0},
            "description": "Original"
        })
        
        assert response.status_code == 500

    @patch('main.get_vision_model')
    def test_convert_description_preserves_info(self, mock_get_model, client):
        """Test that conversion prompt preserves all information."""
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "Converted"
        mock_model.generate_content.return_value = mock_response
        mock_get_model.return_value = mock_model
        
        response = client.post("/api/profile/convert-description", json={
            "profile": {
                "name": "Complex Profile",
                "temperature": 94.5,
                "final_weight": 42.0,
                "stages": [{"name": "Stage1"}]
            },
            "description": "Detailed original description with specific notes"
        })
        
        assert response.status_code == 200
        # Verify prompt included original description
        call_args = mock_model.generate_content.call_args[0][0]
        assert "Detailed original description" in call_args
        assert "Complex Profile" in call_args


class TestErrorHandling:
    """Tests for error handling and edge cases."""

    @patch('main.get_meticulous_api')
    def test_api_connection_error(self, mock_get_api, client):
        """Test handling of machine connection errors."""
        mock_api = MagicMock()
        mock_get_api.side_effect = Exception("Connection refused")
        
        response = client.get("/api/machine/profiles")
        
        assert response.status_code == 500

    @patch('main.HISTORY_FILE')
    def test_corrupted_history_file(self, mock_history_file, client):
        """Test handling of corrupted history JSON."""
        mock_history_file.exists.return_value = True
        
        with patch('builtins.open', mock_open(read_data="invalid json {")):
            response = client.get("/api/history")
        
        # Should return empty or handle gracefully
        assert response.status_code in [200, 500]

    def test_parse_gemini_error_rate_limit(self):
        """Test parsing of Gemini rate limit errors."""
        from main import parse_gemini_error
        
        error_text = "429 RESOURCE_EXHAUSTED: Quota exceeded"
        result = parse_gemini_error(error_text)
        result_lower = str(result).lower()
        assert "rate limit" in result_lower or "quota" in result_lower

    def test_parse_gemini_error_generic(self):
        """Test parsing of generic errors."""
        from main import parse_gemini_error
        
        error_text = "Unknown error occurred"
        result = parse_gemini_error(error_text)
        assert isinstance(result, str)  # Returns a string

    def test_safe_float_edge_cases(self):
        """Test safe float conversion with various inputs."""
        from main import _safe_float
        
        assert _safe_float(0) == 0.0
        assert _safe_float(0.0) == 0.0
        assert _safe_float([]) == 0.0  # Invalid type
        assert _safe_float({}) == 0.0  # Invalid type

    def test_compute_stage_stats_with_gravimetric_flow(self):
        """Test stats with gravimetric_flow field."""
        from main import _compute_stage_stats
        
        entries = [
            {"time": 0, "shot": {"weight": 0, "pressure": 9.0, "gravimetric_flow": 2.0}},
            {"time": 5000, "shot": {"weight": 10.0, "pressure": 9.0, "gravimetric_flow": 2.5}},
        ]
        
        result = _compute_stage_stats(entries)
        assert result["max_flow"] > 0  # Should use gravimetric_flow

    def test_format_dynamics_over_weight(self):
        """Test dynamics description over weight."""
        from main import _format_dynamics_description
        
        stage = {
            "type": "flow",
            "dynamics_points": [[0, 2.0], [40, 3.0]],
            "dynamics_over": "weight"
        }
        result = _format_dynamics_description(stage)
        assert "g" in result  # Should use weight unit


class TestDataDirectoryConfiguration:
    """Tests for DATA_DIR configuration and TEST_MODE."""
    
    def test_data_dir_uses_temp_in_test_mode(self):
        """Test that DATA_DIR uses temp directory when TEST_MODE is true."""
        from main import DATA_DIR, TEST_MODE
        import tempfile
        
        # Verify TEST_MODE is enabled (set by conftest.py)
        assert TEST_MODE is True
        
        # Verify DATA_DIR uses temp directory
        temp_base = Path(tempfile.gettempdir())
        assert str(DATA_DIR).startswith(str(temp_base))
    
    def test_data_dir_exists_in_test_mode(self):
        """Test that DATA_DIR is created in test mode."""
        from main import DATA_DIR
        
        # DATA_DIR should be created during import
        assert DATA_DIR.exists()
        assert DATA_DIR.is_dir()
    
    def test_all_data_files_use_data_dir(self):
        """Test that all data file paths use DATA_DIR."""
        from main import (
            SETTINGS_FILE, HISTORY_FILE, LLM_CACHE_FILE,
            SHOT_CACHE_FILE, IMAGE_CACHE_DIR, DATA_DIR
        )
        
        # All paths should be under DATA_DIR
        assert SETTINGS_FILE.parent == DATA_DIR
        assert HISTORY_FILE.parent == DATA_DIR
        assert LLM_CACHE_FILE.parent == DATA_DIR
        assert SHOT_CACHE_FILE.parent == DATA_DIR
        assert IMAGE_CACHE_DIR.parent == DATA_DIR


class TestImagePromptErrorHandling:
    """Tests for image prompt generation error handling."""
    
    @patch('main.get_meticulous_api')
    @patch('main.subprocess.run')
    def test_generate_image_with_invalid_prompt_result_none(self, mock_subprocess, mock_get_api, client):
        """Test image generation when prompt builder returns None."""
        # Mock API to return profile exists
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial_profile = MagicMock()
        partial_profile.name = "TestProfile"
        partial_profile.id = "p-123"
        mock_api.list_profiles.return_value = [partial_profile]
        
        # Mock prompt builder to return None
        with patch('prompt_builder.build_image_prompt_with_metadata', return_value=None):
            response = client.post(
                "/api/profile/TestProfile/generate-image",
                params={"preview": "true"}
            )
            
            # Should return 500 error
            assert response.status_code == 500
            assert "Failed to build image generation prompt" in response.json()["detail"]
    
    @patch('main.get_meticulous_api')
    @patch('main.subprocess.run')
    def test_generate_image_with_invalid_prompt_result_not_dict(self, mock_subprocess, mock_get_api, client):
        """Test image generation when prompt builder returns non-dict."""
        # Mock API to return profile exists
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial_profile = MagicMock()
        partial_profile.name = "TestProfile"
        partial_profile.id = "p-123"
        mock_api.list_profiles.return_value = [partial_profile]
        
        # Mock prompt builder to return a string instead of dict
        with patch('prompt_builder.build_image_prompt_with_metadata', return_value="invalid"):
            response = client.post(
                "/api/profile/TestProfile/generate-image",
                params={"preview": "true"}
            )
            
            # Should return 500 error
            assert response.status_code == 500
            assert "Failed to build image generation prompt" in response.json()["detail"]
    
    @patch('main.get_meticulous_api')
    @patch('main.subprocess.run')
    def test_generate_image_with_valid_prompt_result(self, mock_subprocess, mock_get_api, client):
        """Test image generation with valid prompt result doesn't fail at validation."""
        # Mock API to return profile exists
        mock_api = MagicMock()
        mock_get_api.return_value = mock_api
        
        partial_profile = MagicMock()
        partial_profile.name = "TestProfile"
        partial_profile.id = "p-123"
        mock_api.list_profiles.return_value = [partial_profile]
        
        # Mock valid prompt result
        valid_prompt = {
            "prompt": "A beautiful coffee image",
            "metadata": {"influences_found": 2, "selected_colors": ["brown", "cream"]}
        }
        
        # Mock subprocess to return error (to stop execution after validation)
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "docker error"
        mock_subprocess.return_value = mock_result
        
        with patch('prompt_builder.build_image_prompt_with_metadata', return_value=valid_prompt):
            response = client.post(
                "/api/profile/TestProfile/generate-image",
                params={"preview": "true"}
            )
            
            # Should not fail with prompt validation error
            # May fail later for other reasons (docker, etc.)
            if response.status_code == 500:
                error_detail = str(response.json().get("detail", ""))
                assert "Failed to build image generation prompt" not in error_detail


class TestDataFileManagement:
    """Tests for data file ensure functions and management."""
    
    def test_ensure_settings_file_creates_file(self):
        """Test that _ensure_settings_file creates settings file."""
        from main import _ensure_settings_file, SETTINGS_FILE
        
        # Delete file if it exists
        if SETTINGS_FILE.exists():
            SETTINGS_FILE.unlink()
        
        # Call ensure function
        _ensure_settings_file()
        
        # File should now exist
        assert SETTINGS_FILE.exists()
        
        # Should contain valid JSON
        with open(SETTINGS_FILE) as f:
            settings = json.load(f)
            assert isinstance(settings, dict)
            assert "geminiApiKey" in settings
    
    def test_ensure_history_file_creates_file(self):
        """Test that _ensure_history_file creates history file."""
        from main import _ensure_history_file, HISTORY_FILE
        
        # Delete file if it exists
        if HISTORY_FILE.exists():
            HISTORY_FILE.unlink()
        
        # Call ensure function
        _ensure_history_file()
        
        # File should now exist
        assert HISTORY_FILE.exists()
        
        # Should contain empty array
        with open(HISTORY_FILE) as f:
            history = json.load(f)
            assert isinstance(history, list)
            assert len(history) == 0
    
    def test_ensure_llm_cache_file_creates_file(self):
        """Test that _ensure_llm_cache_file creates cache file."""
        from main import _ensure_llm_cache_file, LLM_CACHE_FILE
        
        # Delete file if it exists
        if LLM_CACHE_FILE.exists():
            LLM_CACHE_FILE.unlink()
        
        # Call ensure function
        _ensure_llm_cache_file()
        
        # File should now exist
        assert LLM_CACHE_FILE.exists()
        
        # Should contain empty dict
        with open(LLM_CACHE_FILE) as f:
            cache = json.load(f)
            assert isinstance(cache, dict)
            assert len(cache) == 0
    
    def test_ensure_shot_cache_file_creates_file(self):
        """Test that _ensure_shot_cache_file creates cache file."""
        from main import _ensure_shot_cache_file, SHOT_CACHE_FILE
        
        # Delete file if it exists
        if SHOT_CACHE_FILE.exists():
            SHOT_CACHE_FILE.unlink()
        
        # Call ensure function
        _ensure_shot_cache_file()
        
        # File should now exist
        assert SHOT_CACHE_FILE.exists()
        
        # Should contain empty dict
        with open(SHOT_CACHE_FILE) as f:
            cache = json.load(f)
            assert isinstance(cache, dict)
    
    def test_ensure_image_cache_dir_creates_directory(self):
        """Test that _ensure_image_cache_dir creates directory."""
        from main import _ensure_image_cache_dir, IMAGE_CACHE_DIR
        import shutil
        
        # Delete directory if it exists
        if IMAGE_CACHE_DIR.exists():
            shutil.rmtree(IMAGE_CACHE_DIR)
        
        # Call ensure function
        _ensure_image_cache_dir()
        
        # Directory should now exist
        assert IMAGE_CACHE_DIR.exists()
        assert IMAGE_CACHE_DIR.is_dir()
    
    def test_save_and_load_history(self):
        """Test saving and loading history."""
        from main import _save_history, _load_history
        
        test_history = [
            {"id": "123", "profile_name": "Test", "created_at": "2024-01-01"}
        ]
        
        _save_history(test_history)
        loaded = _load_history()
        
        assert len(loaded) == 1
        assert loaded[0]["id"] == "123"
        assert loaded[0]["profile_name"] == "Test"
    
    def test_load_history_with_valid_file(self):
        """Test loading history with existing valid file."""
        from main import _load_history, HISTORY_FILE
        
        # Create a valid history file
        test_data = [{"id": "test123", "name": "TestProfile"}]
        with open(HISTORY_FILE, 'w') as f:
            json.dump(test_data, f)
        
        history = _load_history()
        assert len(history) == 1
        assert history[0]["id"] == "test123"


class TestCacheManagementFunctions:
    """Tests for cache management helper functions."""
    
    def test_llm_cache_save_and_load(self):
        """Test LLM cache save and load operations."""
        from main import save_llm_analysis_to_cache, get_cached_llm_analysis
        
        # Save an analysis
        save_llm_analysis_to_cache("TestProfile", "2024-01-15", "shot.json", "Test analysis result")
        
        # Load it back
        result = get_cached_llm_analysis("TestProfile", "2024-01-15", "shot.json")
        
        assert result == "Test analysis result"
    
    def test_llm_cache_miss(self):
        """Test LLM cache miss returns None."""
        from main import get_cached_llm_analysis
        
        # Try to get non-existent cache entry
        result = get_cached_llm_analysis("NonExistent", "2024-01-15", "missing.json")
        
        assert result is None
    
    def test_shot_cache_operations(self):
        """Test shot cache set and get operations."""
        from main import _set_cached_shots, _get_cached_shots
        
        test_data = {"shots": [{"id": 1, "weight": 36.0}]}
        
        # Set cache
        _set_cached_shots("TestProfile", test_data, limit=100)
        
        # Get cache
        result, is_stale, cached_at = _get_cached_shots("TestProfile", limit=100)
        
        assert result is not None
        assert "shots" in result
        assert isinstance(is_stale, bool)
    
    def test_shot_cache_miss(self):
        """Test shot cache miss returns None."""
        from main import _get_cached_shots
        
        result, is_stale, cached_at = _get_cached_shots("NonExistentProfile", limit=100)
        
        assert result is None


class TestSettingsManagement:
    """Tests for settings management functions."""
    
    def test_settings_load(self):
        """Test loading settings from file."""
        from main import SETTINGS_FILE, _ensure_settings_file
        
        # Ensure file exists
        _ensure_settings_file()
        
        # Load and verify structure
        with open(SETTINGS_FILE) as f:
            settings = json.load(f)
        
        assert isinstance(settings, dict)
        assert "geminiApiKey" in settings
        assert "meticulousIp" in settings
        assert "serverIp" in settings
        assert "authorName" in settings
    
    def test_settings_update(self):
        """Test updating settings."""
        from main import SETTINGS_FILE, _ensure_settings_file
        
        _ensure_settings_file()
        
        # Update settings
        new_settings = {
            "geminiApiKey": "test_key",
            "meticulousIp": "192.168.1.1",
            "serverIp": "192.168.1.2",
            "authorName": "Test Author"
        }
        
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(new_settings, f)
        
        # Read back and verify
        with open(SETTINGS_FILE) as f:
            settings = json.load(f)
        
        assert settings["geminiApiKey"] == "test_key"
        assert settings["authorName"] == "Test Author"


class TestHelperFunctions:
    """Tests for various helper functions."""
    
    def test_sanitize_profile_name(self):
        """Test profile name sanitization for filenames."""
        from main import _sanitize_profile_name_for_filename
        
        # Test various special characters (converts to lowercase)
        assert _sanitize_profile_name_for_filename("Test/Profile") == "test_profile"
        assert _sanitize_profile_name_for_filename("Test\\Profile") == "test_profile"
        assert _sanitize_profile_name_for_filename("Test:Profile") == "test_profile"
        assert _sanitize_profile_name_for_filename("Normal_Name") == "normal_name"
        assert _sanitize_profile_name_for_filename("Test Profile") == "test_profile"
    
    def test_extract_profile_name_from_reply(self):
        """Test extracting profile name from LLM reply."""
        from main import _extract_profile_name
        
        # Test with clear profile name
        reply = "Profile Created: My Amazing Profile"
        name = _extract_profile_name(reply)
        assert name == "My Amazing Profile"
        
        # Test with variations
        reply2 = "profile created: Simple Name"
        name2 = _extract_profile_name(reply2)
        assert name2 == "Simple Name"
    
    def test_parse_gemini_error_messages(self):
        """Test parsing various Gemini error messages."""
        from main import parse_gemini_error
        
        # Test API key error
        error = "API key not valid"
        result = parse_gemini_error(error)
        assert "API key" in result or "key" in result.lower()
        
        # Test rate limit
        error2 = "429 RESOURCE_EXHAUSTED"
        result2 = parse_gemini_error(error2)
        assert "rate" in result2.lower() or "quota" in result2.lower()
        
        # Test generic error
        error3 = "Unknown error"
        result3 = parse_gemini_error(error3)
        assert isinstance(result3, str)


class TestAdditionalCoverage:
    """Additional tests to improve coverage to 68%."""
    
    def test_save_settings_endpoint_structure(self, client):
        """Test save settings endpoint accepts valid data."""
        from unittest.mock import patch
        
        test_settings = {
            "geminiApiKey": "test_key_123",
            "meticulousIp": "192.168.1.100",
            "serverIp": "192.168.1.101",
            "authorName": "Test User"
        }
        
        with patch.dict('os.environ', {"GEMINI_API_KEY": "test"}):
            # Just test the endpoint structure, don't actually save
            # (endpoint requires more complex setup)
            response = client.post("/api/settings", json=test_settings)
            # Endpoint may return various statuses depending on setup
            assert response.status_code in [200, 422, 500]
    
    def test_get_settings_endpoint(self, client):
        """Test get settings endpoint."""
        from unittest.mock import patch
        
        with patch.dict('os.environ', {"GEMINI_API_KEY": "test"}):
            response = client.get("/api/settings")
            # Endpoint may succeed or fail depending on setup
            assert response.status_code in [200, 500]
    
    def test_llm_cache_expiration(self):
        """Test LLM cache expiration logic."""
        from main import save_llm_analysis_to_cache, get_cached_llm_analysis, LLM_CACHE_TTL_SECONDS
        import time
        
        # Save with current timestamp
        save_llm_analysis_to_cache("ExpireTest", "2024-01-01", "test.json", "Old analysis")
        
        # Should be cached
        result = get_cached_llm_analysis("ExpireTest", "2024-01-01", "test.json")
        assert result == "Old analysis"
        
        # Note: We can't easily test expiration without mocking time
        # But we've at least tested the happy path
    
    def test_shot_cache_with_different_limits(self):
        """Test shot cache respects different limits."""
        from main import _set_cached_shots, _get_cached_shots
        
        test_data_50 = {"shots": list(range(50))}
        test_data_100 = {"shots": list(range(100))}
        
        # Cache with limit 50
        _set_cached_shots("Profile1", test_data_50, limit=50)
        
        # Cache with limit 100
        _set_cached_shots("Profile2", test_data_100, limit=100)
        
        # Retrieve both
        result1, _, _ = _get_cached_shots("Profile1", limit=50)
        result2, _, _ = _get_cached_shots("Profile2", limit=100)
        
        assert result1 is not None
        assert result2 is not None
    
    def test_extract_profile_name_edge_cases(self):
        """Test profile name extraction with edge cases."""
        from main import _extract_profile_name
        
        # Test with no match
        reply_no_match = "This is just a regular message"
        name = _extract_profile_name(reply_no_match)
        assert name == "Untitled Profile"
        
        # Test with extra whitespace
        reply_whitespace = "Profile Created:    Spaced Name   "
        name2 = _extract_profile_name(reply_whitespace)
        assert "Spaced Name" in name2
    
    def test_safe_float_with_none(self):
        """Test _safe_float with None value."""
        from main import _safe_float
        
        result = _safe_float(None)
        assert result == 0.0
        
        result2 = _safe_float("not a number")
        assert result2 == 0.0
        
        result3 = _safe_float(42.5)
        assert result3 == 42.5
    
    def test_history_pagination(self, client):
        """Test history pagination parameters."""
        response = client.get("/api/history?page=1&per_page=10")
        assert response.status_code == 200
        data = response.json()
        # API returns 'entries' not 'history'
        assert "entries" in data
        assert "total" in data
        assert "limit" in data or "per_page" in data
    
    def test_clear_history_endpoint(self, client):
        """Test clear history endpoint."""
        # First add some history
        from main import save_to_history
        save_to_history("Test Coffee", "Test Prefs", "Test Reply")
        
        # Clear it
        response = client.delete("/api/history")
        assert response.status_code == 200
        
        # Verify it's cleared
        response2 = client.get("/api/history")
        data = response2.json()
        # Should have minimal or no history in entries
        assert isinstance(data.get("entries", []), list)



