# Docker Deployment Guide

## Overview

This document provides comprehensive instructions for deploying the compression service using Docker with optimized, production-ready configurations.

## Features

- **Multi-stage build**: Optimized for minimal image size
- **Alpine Linux base**: Lightweight and secure
- **WASM support**: Includes Draco and KTX2 libraries
- **Health checks**: Built-in monitoring
- **Non-root user**: Enhanced security
- **Resource limits**: Production-ready constraints

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Build and start production service
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# Stop service
docker-compose down
```

### Using Docker directly

```bash
# Build the image
npm run docker:build:prod

# Run the container
npm run docker:run:prod

# Check container status
docker ps
```

## Build Targets

The Dockerfile provides multiple targets for different use cases:

### Production (default)
- Minimal Alpine-based image
- Only production dependencies
- Optimized for size and performance

### Builder
- Includes development tools
- Used for building TypeScript
- Can be used for development

### Development
- Hot reload support
- Source code mounted as volumes
- Full development environment

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run docker:build` | Build production image |
| `npm run docker:build:prod` | Build production image (explicit) |
| `npm run docker:build:dev` | Build development image |
| `npm run docker:run` | Run container in foreground |
| `npm run docker:run:prod` | Run container in background (daemon) |
| `npm run docker:stop` | Stop running container |
| `npm run docker:clean` | Remove container |
| `npm run docker:logs` | View container logs |
| `npm run docker:shell` | Access container shell |
| `npm run docker:size` | Check image size |
| `npm run docker:prune` | Clean up unused Docker resources |

## Development Mode

Start the service in development mode with hot reload:

```bash
# Using Docker Compose
npm run docker:compose:dev

# This will:
# - Build the development image
# - Mount source code as volumes
# - Enable hot reload via tsx watch
# - Make the service available on port 3117
```

## Production Deployment

### Environment Variables

- `NODE_ENV`: Set to `production`
- `PORT`: Service port (default: 3117)

### Resource Limits

Default production limits:
- CPU: 2.0 cores max, 0.25 cores reserved
- Memory: 1GB max, 256MB reserved

### Security Features

- Non-root user (`compression`)
- No new privileges
- Read-only filesystem where possible
- Security optimized Alpine base

### Health Checks

The service includes comprehensive health checks:
- Endpoint: `/health`
- Interval: 30 seconds
- Timeout: 15 seconds
- Retries: 3
- Start period: 45 seconds

## WASM Files

The Docker image automatically includes all necessary WASM files:

### Draco Compression
- `/public/draco_decoder_gltf.wasm`
- `/public/draco_encoder.wasm`

### KTX2 Texture Compression
- `/public/ktx2/basis_encoder.wasm`
- `/public/ktx2/basis_transcoder.wasm`
- `/public/ktx2/libktx.wasm`
- `/public/ktx2/msc_basis_transcoder.wasm`

These files are served statically via the `/public/*` route.

## Monitoring and Logs

### View Logs
```bash
# Docker Compose
docker-compose logs -f

# Direct Docker
npm run docker:logs
```

### Monitor Health
```bash
# Check health endpoint
curl http://localhost:3117/health

# Docker health status
docker inspect compression-service --format='{{.State.Health.Status}}'
```

### Container Stats
```bash
# Real-time stats
docker stats compression-service

# Image size
npm run docker:size
```

## Troubleshooting

### Container Won't Start

1. Check logs: `npm run docker:logs`
2. Verify WASM files exist in `/public/`
3. Ensure port 3117 is not in use
4. Check system resources

### Performance Issues

1. Monitor container stats: `docker stats`
2. Increase resource limits in docker-compose.yml
3. Check health endpoint response times

### WASM Loading Errors

1. Verify WASM files are copied correctly
2. Check static file serving configuration
3. Ensure correct file permissions

## Clean Up

Remove all Docker resources:

```bash
# Stop and remove containers
docker-compose down

# Remove images
docker rmi compression-service:latest

# Clean up system
npm run docker:prune
```

## Network Configuration

The service uses a custom network `compression-network` for:
- Service isolation
- Future scalability
- Integration with other services (Redis, etc.)

## Scaling

For horizontal scaling:

```bash
# Scale to 3 replicas
docker-compose up -d --scale compression-service=3
```

Note: You'll need a load balancer for multiple instances.

## Security Recommendations

1. **Use specific image tags** in production
2. **Regular security updates** for base images
3. **Scan images** for vulnerabilities
4. **Limit resource usage** appropriately
5. **Use secrets management** for sensitive data
6. **Network segmentation** in production

## Performance Optimization

1. **Multi-stage builds** reduce image size
2. **Layer caching** optimizes build times
3. **Resource limits** prevent resource exhaustion
4. **Health checks** enable automatic recovery
5. **Dumb-init** handles process signals correctly

## Integration with CI/CD

Example CI/CD integration:

```yaml
# .github/workflows/docker.yml
name: Docker Build

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker image
        run: npm run docker:build:prod
      - name: Test container
        run: |
          npm run docker:run:prod
          sleep 10
          curl http://localhost:3117/health
```