# Multi-stage build for optimal image size
# Stage 1: Builder stage with all dependencies
FROM node:20-alpine AS builder

# Install build dependencies for native modules (canvas, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

# Set working directory
WORKDIR /app

# Copy package files for efficient dependency installation
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --include=dev --no-audit --no-fund

# Copy source code and TypeScript config
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript to JavaScript
RUN npm run build

# Stage 2: Runtime dependencies
FROM node:20-alpine AS deps

# Install both build and runtime dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    cairo \
    jpeg \
    pango \
    musl \
    giflib \
    pixman \
    pangomm \
    libjpeg-turbo \
    freetype

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (canvas needs build tools)
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Stage 3: Final production image
FROM node:20-alpine AS production

# Install runtime dependencies for native modules
RUN apk add --no-cache \
    cairo \
    jpeg \
    pango \
    musl \
    giflib \
    pixman \
    pangomm \
    libjpeg-turbo \
    freetype \
    dumb-init

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S compression -u 1001 -G nodejs

# Copy production dependencies from deps stage
COPY --from=deps --chown=compression:nodejs /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder --chown=compression:nodejs /app/dist ./dist

# Copy WASM files and static assets (critical for compression functionality)
COPY --chown=compression:nodejs public ./public

# Copy package.json for npm start command
COPY --chown=compression:nodejs package.json ./

# Switch to non-root user
USER compression

# Expose port 3117
EXPOSE 3117

# Health check with improved error handling
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const http=require('http');const options={hostname:'localhost',port:3117,path:'/health',timeout:8000};const req=http.request(options,(res)=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.on('timeout',()=>process.exit(1));req.end();"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]