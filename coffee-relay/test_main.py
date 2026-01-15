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
from unittest.mock import Mock, patch, MagicMock
from io import BytesIO
from PIL import Image
import os
import subprocess


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
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_analyze_and_profile_with_image_only(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test profile creation with only an image (no user preferences)."""
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
    @patch('main.subprocess.run')
    def test_analyze_and_profile_with_prefs_only(self, mock_subprocess, client):
        """Test profile creation with only user preferences (no image)."""
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
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_analyze_and_profile_with_both(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test profile creation with both image and user preferences."""
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
    @patch('main.subprocess.run')
    @patch('main.get_vision_model')
    def test_analyze_and_profile_various_preferences(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test profile creation with different user preferences."""
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
    @patch('main.subprocess.run')
    def test_analyze_and_profile_special_characters(self, mock_subprocess, client):
        """Test handling of special characters in input."""
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
    @patch('main.subprocess.run')
    def test_status_detects_updates_available(self, mock_subprocess, client):
        """Test that /status correctly identifies when updates are available."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "⚠ Update available\nMeticulous MCP needs update"
        mock_subprocess.return_value = mock_result

        response = client.get("/status")
        assert response.status_code == 200
        data = response.json()
        assert data.get("update_available") == True

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_status_detects_missing_dependencies(self, mock_subprocess, client):
        """Test that /status identifies missing dependencies as requiring updates."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "✗ Not installed\nMeticulous MCP not found"
        mock_subprocess.return_value = mock_result

        response = client.get("/status")
        assert response.status_code == 200
        data = response.json()
        assert data.get("update_available") == True

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    @patch('main.Path')
    def test_status_handles_missing_version_file(self, mock_path, mock_subprocess, client):
        """Test that /status handles missing version file gracefully."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Checking..."
        mock_subprocess.return_value = mock_result

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
    @patch('main.subprocess.run')
    def test_status_handles_script_error(self, mock_subprocess, client):
        """Test that /status handles update script errors gracefully."""
        # Simulate script error
        mock_subprocess.side_effect = Exception("Script not found")

        response = client.get("/status")
        assert response.status_code == 200
        data = response.json()
        # Should return error information
        assert "error" in data or "message" in data

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_status_endpoint_cors_enabled(self, mock_subprocess, client):
        """Test that /status endpoint has CORS enabled for web app."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Up to date"
        mock_subprocess.return_value = mock_result

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
    @patch('main.subprocess.run')
    def test_trigger_update_success(self, mock_subprocess, client):
        """Test successful update trigger."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "✓ All updates applied successfully\n✓ Containers rebuilt and started"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "output" in data
        assert "All updates applied successfully" in data["output"]
        
        # Verify subprocess was called with correct arguments
        mock_subprocess.assert_called_once()
        call_args = mock_subprocess.call_args[0][0]
        assert "bash" in call_args
        assert "update.sh" in call_args[1]  # Resolved path contains update.sh
        assert "--auto" in call_args

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_trigger_update_script_failure(self, mock_subprocess, client):
        """Test handling of update script failure."""
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stdout = "Checking for updates..."
        mock_result.stderr = "Error: Failed to pull repository"
        mock_subprocess.return_value = mock_result

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert data["detail"]["status"] == "error"
        assert "Failed to pull repository" in data["detail"]["error"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_trigger_update_subprocess_error(self, mock_subprocess, client):
        """Test handling of subprocess errors."""
        mock_subprocess.side_effect = subprocess.SubprocessError("Script not found")

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert data["detail"]["status"] == "error"
        assert "Failed to execute update script" in data["detail"]["message"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_trigger_update_unexpected_error(self, mock_subprocess, client):
        """Test handling of unexpected errors."""
        mock_subprocess.side_effect = Exception("Unexpected error")

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert data["detail"]["status"] == "error"
        assert "unexpected error" in data["detail"]["message"].lower()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_trigger_update_cors_enabled(self, mock_subprocess, client):
        """Test that /api/trigger-update has CORS enabled."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

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
    @patch('main.subprocess.run')
    def test_trigger_update_no_body_required(self, mock_subprocess, client):
        """Test that endpoint works without request body."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Update complete"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        # Test without any body
        response = client.post("/api/trigger-update")
        
        assert response.status_code == 200
        assert response.json()["status"] == "success"

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_trigger_update_includes_stdout(self, mock_subprocess, client):
        """Test that successful response includes script output."""
        expected_output = """
========================================
      ☕️ MeticAI Update Manager 🔄
========================================

Checking for updates...
✓ All updates applied successfully
✓ Containers rebuilt and started
"""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = expected_output
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 200
        data = response.json()
        assert "output" in data
        assert "MeticAI Update Manager" in data["output"]
        assert "All updates applied successfully" in data["output"]

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_trigger_update_partial_failure(self, mock_subprocess, client):
        """Test handling when script returns error with partial output."""
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stdout = "Updating MeticAI...\n✓ MeticAI updated\nUpdating MCP..."
        mock_result.stderr = "Error: git pull failed"
        mock_subprocess.return_value = mock_result

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        # The detail is nested in the response
        assert "detail" in data
        assert "status" in str(data["detail"])
        assert "error" in str(data["detail"])

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_trigger_update_timeout(self, mock_subprocess, client):
        """Test handling when update script times out."""
        mock_subprocess.side_effect = subprocess.TimeoutExpired(
            cmd=["bash", "update.sh", "--auto"],
            timeout=600
        )

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert "timeout" in str(data["detail"]).lower()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.subprocess.run')
    def test_trigger_update_path_resolution(self, mock_subprocess, client):
        """Test that script path is properly resolved."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_result.stderr = ""
        mock_subprocess.return_value = mock_result

        response = client.post("/api/trigger-update")
        
        assert response.status_code == 200
        # Verify subprocess was called with resolved path
        call_args = mock_subprocess.call_args
        # First positional argument should be the command list
        cmd_list = call_args[0][0]
        # The script path should not contain '..'
        assert ".." not in cmd_list[1]
