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
