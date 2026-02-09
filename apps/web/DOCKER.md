# Docker Deployment Guide

This guide provides detailed instructions for deploying the MeticAI web application using Docker.

## Table of Contents

- [Quick Start](#quick-start)
- [Building the Docker Image](#building-the-docker-image)
- [Running the Container](#running-the-container)
- [Server Configuration](#server-configuration)
- [Docker Compose](#docker-compose)
- [Networking](#networking)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

## Quick Start

The fastest way to get started with Docker. **No Bun installation required** - the application is built entirely inside the Docker container.

**Option 1: Using the helper script (easiest)**

```bash
./docker-build.sh
```

This automated script handles everything:
1. Checks for Docker and Docker Compose
2. Builds the Docker image (including bun install and build inside the container)
3. Start the Docker containers

**Option 2: Using Docker Compose directly**

```bash
docker compose up -d
```

**Option 3: Manual Docker build**

```bash
docker build -t meticai-web .
docker run -p 3550:80 meticai-web
```

The application will be available at `http://localhost:3550`.

**⚠️ API Connection:** After starting the container, you must configure the backend API connection by creating a `config.json` file. See [Server Configuration](#server-configuration) for details. Without this, the web application will try to connect to `http://localhost:5000` which won't work from inside the Docker container.

## Building the Docker Image

### Prerequisites

You only need Docker installed on your system. **Bun is not required** - the application is built inside the container.

### Basic Build

```bash
docker build -t meticai-web .
```

### Build with Custom Tag

```bash
docker build -t meticai-web:v1.0.0 .
```

### Build Process

The Docker setup uses a multi-stage build process:

1. **Stage 1 (Builder)**: 
   - Uses `oven/bun:1` image
   - Installs dependencies with `bun install --frozen-lockfile`
   - Builds the application with `bun run build`
   - Creates the production-ready `dist` folder

2. **Stage 2 (Production)**: 
   - Uses `nginx:alpine` for a lightweight production image
   - Copies only the built `dist` folder from Stage 1
   - Includes nginx configuration for SPA routing
   - Exposes port 80
   - Includes health checks

The final production image:
- Contains only the built static files and nginx
- Does not include Bun or build dependencies
- Is optimized for production deployment (~50MB vs ~500MB with Bun)

**Note:** A legacy `Dockerfile.simple` is also available which requires a pre-built `dist` folder. This is no longer the recommended approach.

## Running the Container

### Basic Run

```bash
docker run -d -p 3550:80 --name meticai meticai-web
```

This will:
- Run the container in detached mode (`-d`)
- Map port 3550 on your host to port 80 in the container
- Name the container "meticai"

### Run with Custom Port

```bash
docker run -d -p 3000:80 --name meticai meticai-web
```

Access the application at `http://localhost:3000`.

### View Logs

```bash
# View logs
docker logs meticai

# Follow logs in real-time
docker logs -f meticai
```

### Stop and Remove Container

```bash
# Stop the container
docker stop meticai

# Remove the container
docker rm meticai
```

## Server Configuration

The application needs to connect to a backend server for espresso profile generation. By default, it connects to `http://localhost:5000`, but you can configure this for different deployments.

### Option 1: Mount Configuration File (Recommended)

Create a `config.json` file on your host system:

```json
{
  "serverUrl": "http://your-backend-server:5000"
}
```

Then mount it when running the container:

```bash
docker run -d -p 3550:80 \
  -v $(pwd)/config.json:/usr/share/nginx/html/config.json:ro \
  --name meticai \
  meticai-web
```

The `:ro` flag mounts the file as read-only.

### Option 2: Use Docker Exec

If the container is already running, you can create the config file inside:

```bash
docker exec -it meticai sh -c 'echo "{\"serverUrl\":\"http://192.168.1.100:5000\"}" > /usr/share/nginx/html/config.json'
```

### Configuration Examples

#### Local Development Backend
```json
{
  "serverUrl": "http://localhost:5000"
}
```

#### Backend on Host Machine (from Docker)
When running in Docker and the backend is on the host machine:

**Linux:**
```json
{
  "serverUrl": "http://172.17.0.1:5000"
}
```

**macOS/Windows (Docker Desktop):**
```json
{
  "serverUrl": "http://host.docker.internal:5000"
}
```

#### Remote Backend Server
```json
{
  "serverUrl": "http://192.168.1.100:8080"
}
```

#### Production Backend
```json
{
  "serverUrl": "https://api.meticai.example.com"
}
```

## Docker Compose

Docker Compose provides an easier way to manage the container with all its configurations.

### Using Docker Compose

The included `docker-compose.yml` file provides a complete setup. **No pre-build required** - the image is built automatically:

```bash
# Start the application (builds automatically if needed)
docker compose up -d

# View logs
docker compose logs -f

# Stop the application
docker compose down
```

### Custom Configuration with Docker Compose

1. **Create a `config.json` file** in the same directory as `docker-compose.yml`:

   ```json
   {
     "serverUrl": "http://your-backend:5000"
   }
   ```

2. **Start the application**:

   ```bash
   docker-compose up -d
   ```

The `docker-compose.yml` file automatically mounts `config.json` if it exists.

### Customizing docker-compose.yml

You can modify the `docker-compose.yml` file to suit your needs:

```yaml
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3550:80"  # Change the host port here
    volumes:
      - ./config.json:/usr/share/nginx/html/config.json:ro
    restart: unless-stopped
    environment:
      # Add environment variables if needed
      - TZ=America/New_York
```

## Networking

### Accessing External Servers

The containerized web application can communicate with backend servers outside the Docker network.

#### Same Host Network

To allow the container to access services on the host machine, use:

```bash
docker run -d -p 3550:80 --network host --name meticai meticai-web
```

**Note:** `--network host` is only available on Linux. On macOS/Windows, use `host.docker.internal`.

#### Custom Bridge Network

Create a custom bridge network for better isolation:

```bash
# Create network
docker network create meticai-network

# Run container on the network
docker run -d -p 3550:80 --network meticai-network --name meticai meticai-web
```

#### Connecting to Other Containers

If your backend server is also in a Docker container:

```yaml
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile.simple
    ports:
      - "3550:80"
    depends_on:
      - backend
    networks:
      - meticai-network

  backend:
    image: your-backend-image:latest
    ports:
      - "5000:5000"
    networks:
      - meticai-network

networks:
  meticai-network:
    driver: bridge
```

Then configure the web app to use `http://backend:5000` as the server URL.

### Network Troubleshooting

#### Test Container Network Connectivity

```bash
# Enter the container
docker exec -it meticai sh

# Test connectivity (if wget is available)
wget -O- http://your-backend:5000/health

# Or use the healthcheck
docker inspect meticai | grep -A 5 Health
```

#### Check Container IP

```bash
docker inspect meticai | grep IPAddress
```

## Production Deployment

### Best Practices

1. **Use a specific version tag**:
   ```bash
   docker build -t meticai-web:1.0.0 .
   ```

2. **Use environment-specific configs**:
   - Development: `config.dev.json`
   - Staging: `config.staging.json`
   - Production: `config.prod.json`

3. **Enable HTTPS** (use a reverse proxy like nginx or Traefik):
   ```yaml
   version: '3.8'
   
   services:
     web:
       build: .
       expose:
         - "80"
       labels:
         - "traefik.enable=true"
         - "traefik.http.routers.meticai.rule=Host(`meticai.example.com`)"
         - "traefik.http.routers.meticai.tls=true"
   ```

4. **Set resource limits**:
   ```yaml
   services:
     web:
       build: .
       deploy:
         resources:
           limits:
             cpus: '0.5'
             memory: 512M
           reservations:
             cpus: '0.25'
             memory: 256M
   ```

5. **Use health checks**:
   The Dockerfile includes a health check that runs every 30 seconds.

### Deployment Checklist

- [ ] Build the Docker image with a version tag
- [ ] Create production `config.json` with correct backend URL
- [ ] Test the container locally
- [ ] Configure reverse proxy for HTTPS (if needed)
- [ ] Set up container orchestration (Kubernetes, Docker Swarm, etc.)
- [ ] Configure monitoring and logging
- [ ] Set up automated backups (if applicable)
- [ ] Document the deployment for your team

### Example Production Setup

```bash
# Build with version tag
docker build -t meticai-web:1.0.0 .

# Create production config
cat > config.production.json << EOF
{
  "serverUrl": "https://api.meticai.example.com"
}
EOF

# Run with production config
docker run -d \
  --name meticai-prod \
  -p 3550:80 \
  -v $(pwd)/config.production.json:/usr/share/nginx/html/config.json:ro \
  --restart unless-stopped \
  meticai-web:1.0.0

# Verify it's running
docker ps | grep meticai-prod
docker logs meticai-prod
```

## Troubleshooting

### Build Fails During npm install

If you encounter errors during the Docker build process when npm is installing dependencies:

**Common causes:**
- Network connectivity issues
- Docker build cache issues
- Insufficient memory allocated to Docker

**Solutions:**

```bash
# Try building without cache
docker build --no-cache -t meticai-web .

# Or with docker compose
docker compose build --no-cache
```

If the issue persists, check Docker logs:
```bash
docker compose logs
```

### Container Won't Start

```bash
# Check logs
docker logs meticai

# Check if port is already in use
netstat -tulpn | grep 3550

# Try running in foreground to see errors
docker run -p 3550:80 meticai-web
```

### Can't Access the Application

1. **Check if container is running**:
   ```bash
   docker ps
   ```

2. **Check port mapping**:
   ```bash
   docker port meticai
   ```

3. **Test from inside the container**:
   ```bash
   docker exec -it meticai sh
   wget -O- http://localhost
   ```

### Configuration Not Loading

1. **Verify config file exists in container**:
   ```bash
   docker exec -it meticai cat /usr/share/nginx/html/config.json
   ```

2. **Check browser console** for errors loading config

3. **Verify the config.json is valid JSON**:
   ```bash
   cat config.json | python -m json.tool
   ```

### Cannot Connect to Backend Server

1. **From the container, test backend connectivity**:
   ```bash
   docker exec -it meticai sh
   # Try to reach backend (install curl if needed)
   apk add --no-cache curl
   curl http://your-backend:5000/health
   ```

2. **Check network configuration**:
   ```bash
   docker network inspect meticai-network
   ```

3. **Verify server URL in config**:
   ```bash
   docker exec -it meticai cat /usr/share/nginx/html/config.json
   ```

### Rebuild After Changes

If you make changes to the application source code:

```bash
# Stop and remove the old container
docker compose down

# Rebuild the image (--no-cache ensures a fresh build)
docker compose build --no-cache

# Start with the new image
docker compose up -d
```

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [MeticAI README](./README.md)

## Support

If you encounter issues not covered in this guide:

1. Check the [main README](./README.md) for general application information
2. Review Docker logs: `docker logs meticai`
3. Open an issue on GitHub with:
   - Docker version: `docker --version`
   - Container logs
   - Configuration file contents
   - Steps to reproduce the issue
