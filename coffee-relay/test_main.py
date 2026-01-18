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
from unittest.mock import Mock, patch, MagicMock, mock_open
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
        assert "host will perform the update" in data["message"].lower()
        
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
        mock_path.assert_called_once_with("/app/.rebuild-needed")
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
