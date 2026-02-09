FROM python:3.12-slim

# Install Docker CLI, Docker Compose plugin, buildx, and git (for update functionality)
RUN apt-get update && apt-get install -y \
    docker.io \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    # Create cli-plugins directory
    && mkdir -p /usr/local/lib/docker/cli-plugins \
    # Install Docker Compose plugin
    && curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" -o /usr/local/lib/docker/cli-plugins/docker-compose \
    && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose \
    # Install Docker Buildx plugin (note: filename format is different)
    && BUILDX_ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') \
    && curl -SL "https://github.com/docker/buildx/releases/download/v0.20.1/buildx-v0.20.1.linux-${BUILDX_ARCH}" -o /usr/local/lib/docker/cli-plugins/docker-buildx \
    && chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python deps
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code - modular structure
COPY main.py .
COPY config.py .
COPY logging_config.py .
COPY prompt_builder.py .
COPY api/ ./api/
COPY services/ ./services/
COPY utils/ ./utils/
COPY models/ ./models/

# Run the app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
