#!/bin/bash
# Production Docker Deployment Script for Compression Service
# This script provides a complete production deployment workflow

set -e  # Exit on any error

echo "🚀 Compression Service Docker Deployment"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="compression-service"
CONTAINER_NAME="compression-service"
PORT=3117
HEALTH_ENDPOINT="http://localhost:$PORT/health"

# Functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    log_success "Docker is running"
}

# Build the Docker image
build_image() {
    log_info "Building Docker image..."
    if docker build --target production -t $IMAGE_NAME:latest .; then
        log_success "Image built successfully"
        
        # Show image size
        SIZE=$(docker images $IMAGE_NAME:latest --format "{{.Size}}")
        log_info "Final image size: $SIZE"
    else
        log_error "Failed to build Docker image"
        exit 1
    fi
}

# Stop and remove existing container
cleanup_existing() {
    if docker ps -q -f name=$CONTAINER_NAME | grep -q .; then
        log_warning "Stopping existing container..."
        docker stop $CONTAINER_NAME
    fi
    
    if docker ps -aq -f name=$CONTAINER_NAME | grep -q .; then
        log_warning "Removing existing container..."
        docker rm $CONTAINER_NAME
    fi
}

# Deploy the container
deploy_container() {
    log_info "Starting container..."
    docker run -d \
        --name $CONTAINER_NAME \
        -p $PORT:$PORT \
        --restart unless-stopped \
        -e NODE_ENV=production \
        -e PORT=$PORT \
        --security-opt no-new-privileges:true \
        $IMAGE_NAME:latest

    if [ $? -eq 0 ]; then
        log_success "Container started successfully"
    else
        log_error "Failed to start container"
        exit 1
    fi
}

# Wait for service to be ready
wait_for_service() {
    log_info "Waiting for service to be ready..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s $HEALTH_ENDPOINT > /dev/null 2>&1; then
            log_success "Service is ready and responding"
            return 0
        fi
        
        echo -n "."
        sleep 2
        ((attempt++))
    done
    
    log_error "Service failed to start within expected time"
    docker logs $CONTAINER_NAME
    return 1
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."
    
    # Check container status
    if docker ps -f name=$CONTAINER_NAME --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -q $CONTAINER_NAME; then
        log_success "Container is running"
        docker ps -f name=$CONTAINER_NAME --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    else
        log_error "Container is not running"
        return 1
    fi
    
    # Check health endpoint
    local health_response=$(curl -s $HEALTH_ENDPOINT)
    if echo "$health_response" | grep -q "ok"; then
        log_success "Health check passed"
        echo "  Response: $health_response"
    else
        log_error "Health check failed"
        return 1
    fi
    
    # Check WASM files
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/public/draco_decoder_gltf.wasm | grep -q "200"; then
        log_success "WASM files are accessible"
    else
        log_warning "WASM files may not be accessible"
    fi
}

# Show deployment info
show_info() {
    echo ""
    log_success "Deployment complete!"
    echo ""
    echo "📊 Deployment Information:"
    echo "  🌐 Service URL: http://localhost:$PORT"
    echo "  💓 Health Check: $HEALTH_ENDPOINT"
    echo "  📋 API Docs: http://localhost:$PORT (root endpoint shows available endpoints)"
    echo ""
    echo "🔧 Management Commands:"
    echo "  View logs: docker logs $CONTAINER_NAME -f"
    echo "  Stop service: docker stop $CONTAINER_NAME"
    echo "  Start service: docker start $CONTAINER_NAME"
    echo "  Access shell: docker exec -it $CONTAINER_NAME sh"
    echo ""
    echo "📁 Available Scripts:"
    echo "  npm run docker:logs    - View container logs"
    echo "  npm run docker:stop    - Stop container"
    echo "  npm run docker:shell   - Access container shell"
    echo ""
}

# Main deployment workflow
main() {
    case "${1:-deploy}" in
        "build")
            check_docker
            build_image
            ;;
        "deploy")
            check_docker
            build_image
            cleanup_existing
            deploy_container
            wait_for_service
            verify_deployment
            show_info
            ;;
        "clean")
            cleanup_existing
            log_success "Cleanup complete"
            ;;
        "status")
            if docker ps -f name=$CONTAINER_NAME --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -q $CONTAINER_NAME; then
                log_success "Service is running"
                docker ps -f name=$CONTAINER_NAME --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
                
                if curl -s $HEALTH_ENDPOINT > /dev/null 2>&1; then
                    log_success "Health check passed"
                    curl -s $HEALTH_ENDPOINT | jq . 2>/dev/null || curl -s $HEALTH_ENDPOINT
                else
                    log_warning "Health check failed"
                fi
            else
                log_warning "Service is not running"
            fi
            ;;
        "logs")
            docker logs $CONTAINER_NAME -f
            ;;
        *)
            echo "Usage: $0 [build|deploy|clean|status|logs]"
            echo ""
            echo "Commands:"
            echo "  build   - Build Docker image only"
            echo "  deploy  - Full deployment (build + deploy + verify) [default]"
            echo "  clean   - Stop and remove existing container"
            echo "  status  - Check service status and health"
            echo "  logs    - View container logs"
            exit 1
            ;;
    esac
}

main "$@"