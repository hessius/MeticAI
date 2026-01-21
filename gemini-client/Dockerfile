FROM node:22-slim

# Install curl so we can download the official script
RUN apt-get update && apt-get install -y curl git

# Install the OFFICIAL Docker CLI (Latest) to match your host's API version
RUN curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh

# Install Gemini CLI
RUN npm install -g @google/gemini-cli

# Install nanobanana extension for image generation
# Note: This requires a paid API key for image generation
# Clone to a known path so we can reference it in settings.json
RUN git clone https://github.com/gemini-cli-extensions/nanobanana.git /opt/nanobanana && \
    cd /opt/nanobanana && \
    npm install && \
    npm run build

# Keep container alive
CMD ["tail", "-f", "/dev/null"]
