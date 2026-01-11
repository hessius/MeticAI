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
    @patch('main.vision_model')
    def test_analyze_coffee_success(self, mock_vision_model, client, sample_image):
        """Test successful coffee bag analysis."""
        # Mock the Gemini response
        mock_response = Mock()
        mock_response.text = "Ethiopian Yirgacheffe, Light Roast, Floral and Citrus Notes"
        mock_vision_model.generate_content.return_value = mock_response

        # Send request
        response = client.post(
            "/analyze_coffee",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        # Assertions
        assert response.status_code == 200
        assert "analysis" in response.json()
        assert "Ethiopian" in response.json()["analysis"]
        mock_vision_model.generate_content.assert_called_once()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.vision_model')
    def test_analyze_coffee_with_whitespace(self, mock_vision_model, client, sample_image):
        """Test that response text is properly stripped of whitespace."""
        # Mock response with extra whitespace
        mock_response = Mock()
        mock_response.text = "  Colombian Supremo, Medium Roast  \n"
        mock_vision_model.generate_content.return_value = mock_response

        response = client.post(
            "/analyze_coffee",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        assert response.status_code == 200
        assert response.json()["analysis"] == "Colombian Supremo, Medium Roast"

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key"})
    @patch('main.vision_model')
    def test_analyze_coffee_api_error(self, mock_vision_model, client, sample_image):
        """Test error handling when Gemini API fails."""
        # Mock an API error
        mock_vision_model.generate_content.side_effect = Exception("API Error: Rate limit exceeded")

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
    @patch('main.vision_model')
    def test_analyze_coffee_different_image_formats(self, mock_vision_model, client):
        """Test analysis with different image formats (JPEG, PNG, etc.)."""
        mock_response = Mock()
        mock_response.text = "Test coffee analysis"
        mock_vision_model.generate_content.return_value = mock_response

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
    @patch('main.vision_model')
    def test_analyze_and_profile_with_image_only(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test profile creation with only an image (no user preferences)."""
        # Mock the Gemini vision response
        mock_response = Mock()
        mock_response.text = "Ethiopian Yirgacheffe, Light Roast, Floral Notes"
        mock_vision_model.generate_content.return_value = mock_response
        
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
        mock_vision_model.generate_content.assert_called_once()
        
        # Verify subprocess was called with correct arguments
        mock_subprocess.assert_called_once()
        call_args = mock_subprocess.call_args[0][0]
        assert "docker" in call_args
        assert "gemini-client" in call_args
        assert "--allowed-tools" in call_args
        
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
    @patch('main.vision_model')
    def test_analyze_and_profile_with_both(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test profile creation with both image and user preferences."""
        # Mock the Gemini vision response
        mock_response = Mock()
        mock_response.text = "Colombian Supremo, Medium Roast, Nutty"
        mock_vision_model.generate_content.return_value = mock_response
        
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
    @patch('main.vision_model')
    def test_analyze_and_profile_subprocess_error(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test error handling when subprocess fails."""
        # Mock the Gemini vision response
        mock_response = Mock()
        mock_response.text = "Test Coffee"
        mock_vision_model.generate_content.return_value = mock_response
        
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
    @patch('main.vision_model')
    def test_analyze_and_profile_image_processing_error(self, mock_vision_model, client):
        """Test error when image processing fails."""
        # Mock an exception in vision model
        mock_vision_model.generate_content.side_effect = Exception("Vision API error")
        
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
    @patch('main.vision_model')
    def test_analyze_and_profile_various_preferences(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test profile creation with different user preferences."""
        mock_response = Mock()
        mock_response.text = "Test Coffee"
        mock_vision_model.generate_content.return_value = mock_response
        
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
    @patch('main.vision_model')
    def test_analyze_and_profile_allowed_tools(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test that only safe tools are whitelisted."""
        mock_response = Mock()
        mock_response.text = "Test Coffee"
        mock_vision_model.generate_content.return_value = mock_response
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_subprocess.return_value = mock_result

        response = client.post(
            "/analyze_and_profile",
            files={"file": ("test.png", sample_image, "image/png")}
        )

        call_args = mock_subprocess.call_args[0][0]
        
        # Verify that allowed-tools flag is present
        assert "--allowed-tools" in call_args
        
        # Verify safe tools are whitelisted
        allowed_tools_idx = call_args.index("--allowed-tools")
        assert "create_profile" == call_args[allowed_tools_idx + 1]
        assert "apply_profile" == call_args[allowed_tools_idx + 2]

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
    @patch('main.vision_model')
    def test_analyze_coffee_large_image(self, mock_vision_model, client):
        """Test handling of large images."""
        mock_response = Mock()
        mock_response.text = "Analysis result"
        mock_vision_model.generate_content.return_value = mock_response

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
    @patch('main.vision_model')
    def test_analyze_coffee_very_long_response(self, mock_vision_model, client, sample_image):
        """Test handling of very long AI responses."""
        mock_response = Mock()
        mock_response.text = "A" * 10000  # Very long response
        mock_vision_model.generate_content.return_value = mock_response

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
    @patch('main.vision_model')
    def test_prompt_includes_modern_barista_persona(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test that the prompt includes the modern experimental barista persona."""
        mock_response = Mock()
        mock_response.text = "Ethiopian Coffee, Light Roast"
        mock_vision_model.generate_content.return_value = mock_response
        
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
    @patch('main.vision_model')
    def test_enhanced_prompt_with_both_inputs(self, mock_vision_model, mock_subprocess, client, sample_image):
        """Test enhanced prompt when both image and preferences are provided."""
        mock_response = Mock()
        mock_response.text = "Kenyan AA, Medium Roast, Berry notes"
        mock_vision_model.generate_content.return_value = mock_response
        
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
    @patch('main.vision_model')
    def test_cors_headers_on_analyze_coffee(self, mock_vision_model, client, sample_image):
        """Test that CORS headers are present on /analyze_coffee responses."""
        mock_response = Mock()
        mock_response.text = "Test coffee"
        mock_vision_model.generate_content.return_value = mock_response

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
