FROM node:22-slim

# Install curl so we can download the official script
RUN apt-get update && apt-get install -y curl

# Install the OFFICIAL Docker CLI (Latest) to match your host's API version
RUN curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh

# Install Gemini CLI
RUN npm install -g @google/gemini-cli

# Keep container alive
CMD ["tail", "-f", "/dev/null"]
