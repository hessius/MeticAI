# Multi-stage build for MeticAI web application

# Stage 1: Build the application using Node.js (universal ARM compatibility)
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./

# Install dependencies
# First remove bun from package.json since it causes issues on ARM during npm install
# Then install with legacy peer deps for compatibility
RUN sed -i '/"bun":/d' package.json && \
    npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production server with nginx
FROM nginx:alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Copy built application from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy example config as a template
COPY config.example.json /usr/share/nginx/html/config.example.json

# Also copy as config.json as a fallback (will be overwritten by volume mount if configured)
COPY config.example.json /usr/share/nginx/html/config.json

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
