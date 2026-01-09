# MeticAI Test Suite

This directory contains comprehensive tests for all scripts in the MeticAI repository to ensure that all new commits and pull requests are functionally validated before merging.

## Test Coverage

### 1. Python Tests (coffee-relay)
Location: `coffee-relay/test_main.py`

Tests for the FastAPI coffee relay application:
- `/analyze_coffee` endpoint functionality
- `/create_profile` endpoint functionality
- Error handling and edge cases
- Gemini AI integration (mocked)
- Input validation
- Special character handling
- Large file handling

**Test Categories:**
- `TestAnalyzeCoffeeEndpoint`: Tests for coffee bag image analysis
- `TestCreateProfileEndpoint`: Tests for espresso profile creation
- `TestHealthAndStartup`: Application initialization tests
- `TestEdgeCases`: Boundary conditions and edge cases

### 2. Bash Tests (installation scripts)

#### Local Installation Script
Location: `tests/test_local_install.bats`

Tests for the `local-install.sh` installation script:
- Prerequisite checking (git, docker)
- Environment file creation
- Input validation
- Git clone operations
- User interaction handling
- Error conditions

#### Remote Installation Script
Location: `tests/test_web_install.bats`

Tests for the `web_install.sh` remote installation script:
- Repository cloning functionality
- Local vs remote mode detection
- Git installation handling
- Directory existence handling
- Integration with local-install.sh
- Error handling for network issues

## Running Tests

### Prerequisites

#### For Python Tests
```bash
cd coffee-relay
pip install -r requirements-test.txt
```

#### For Bash Tests
Install BATS (Bash Automated Testing System):
```bash
# On Ubuntu/Debian
sudo apt-get install bats

# On macOS
brew install bats-core

# Or install from source
git clone https://github.com/bats-core/bats-core.git
cd bats-core
sudo ./install.sh /usr/local
```

### Running Python Tests

```bash
# Run all Python tests
cd coffee-relay
pytest test_main.py -v

# Run with coverage report
pytest test_main.py --cov=main --cov-report=html --cov-report=term

# Run specific test class
pytest test_main.py::TestAnalyzeCoffeeEndpoint -v

# Run specific test
pytest test_main.py::TestAnalyzeCoffeeEndpoint::test_analyze_coffee_success -v
```

### Running Bash Tests

```bash
# Run all bash tests for local installation
cd tests
bats test_local_install.bats

# Run tests for remote installation
bats test_web_install.bats

# Run all bash tests
bats test_*.bats

# Run from repository root
bats tests/test_local_install.bats
bats tests/test_web_install.bats

# Run with verbose output
bats -t test_local_install.bats
bats -t test_web_install.bats
```

## Test Results Interpretation

### Python Tests
- **PASSED**: Test executed successfully
- **FAILED**: Test assertion failed, indicates a bug
- **ERROR**: Test encountered an exception
- Coverage reports are generated in `coffee-relay/htmlcov/`

### Bash Tests
- **✓**: Test passed
- **✗**: Test failed
- Exit code 0 indicates all tests passed

## CI/CD Integration

### GitHub Actions Example

Create `.github/workflows/tests.yml`:

```yaml
name: Run Tests

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: |
          cd coffee-relay
          pip install -r requirements-test.txt
      
      - name: Run Python tests
        run: |
          cd coffee-relay
          pytest test_main.py -v --cov=main --cov-report=xml
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./coffee-relay/coverage.xml

  bash-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install BATS
        run: |
          sudo apt-get update
          sudo apt-get install -y bats
      
      - name: Run Bash tests
        run: |
          bats tests/test_local_install.bats
          bats tests/test_web_install.bats
```

## Writing New Tests

### Python Test Guidelines

1. Follow the existing test structure
2. Use meaningful test names that describe what is being tested
3. Mock external dependencies (Gemini API, Docker commands)
4. Test both success and failure paths
5. Include edge cases and boundary conditions

Example:
```python
@patch('main.vision_model')
def test_analyze_coffee_success(self, mock_vision_model, client, sample_image):
    """Test successful coffee bag analysis."""
    mock_response = Mock()
    mock_response.text = "Ethiopian Yirgacheffe"
    mock_vision_model.generate_content.return_value = mock_response
    
    response = client.post(
        "/analyze_coffee",
        files={"file": ("test.png", sample_image, "image/png")}
    )
    
    assert response.status_code == 200
    assert "analysis" in response.json()
```

### Bash Test Guidelines

1. Use setup/teardown for test isolation
2. Create temporary directories for file operations
3. Mock external commands when possible
4. Clean up after tests
5. Use timeout for interactive scripts

Example:
```bash
@test "Script creates .env file" {
    create_mock_command "git" 0 ""
    create_mock_command "docker" 0 ""
    
    run bash -c 'echo -e "api_key\n192.168.1.1\n" | ./local-install.sh'
    
    [ -f .env ]
    grep -q "GEMINI_API_KEY=api_key" .env
}
```

## Troubleshooting

### Python Tests

**Issue**: Import errors
```bash
# Solution: Ensure you're in the coffee-relay directory
cd coffee-relay
export PYTHONPATH=.
pytest test_main.py
```

**Issue**: Mock not working
```bash
# Solution: Check patch path matches the import in main.py
# Use 'main.module' not 'module' if main.py imports it
```

### Bash Tests

**Issue**: BATS not found
```bash
# Solution: Install BATS or use full path
/usr/local/bin/bats tests/test_local_install.bats
```

**Issue**: Tests timing out
```bash
# Solution: Increase timeout in test or optimize script
timeout 10 ./local-install.sh
```

## Maintenance

- Update tests when adding new features
- Maintain test coverage above 80%
- Review and update mocks when dependencies change
- Run full test suite before submitting PRs
- Document new test cases in this README

## Test Philosophy

These tests follow these principles:
1. **Comprehensive**: Cover all critical paths and edge cases
2. **Isolated**: Each test is independent and doesn't affect others
3. **Fast**: Tests run quickly to encourage frequent execution
4. **Maintainable**: Clear, well-documented test code
5. **Reliable**: Tests produce consistent results

## Additional Resources

- [pytest documentation](https://docs.pytest.org/)
- [BATS documentation](https://bats-core.readthedocs.io/)
- [FastAPI testing guide](https://fastapi.tiangolo.com/tutorial/testing/)
- [GitHub Actions documentation](https://docs.github.com/en/actions)
