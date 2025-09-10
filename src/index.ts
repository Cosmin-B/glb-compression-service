import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { errorHandler } from './middleware/errorHandler.js';
import { compression } from './routes/compression.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false
}));
app.onError(errorHandler);

// Serve static files from public directory for WASM files
app.use('/public/*', serveStatic({ root: './' }));

// Import texture routes
import textureRoutes from './routes/textureCompression.js';

// Mount compression routes
app.route('/compress', compression);
app.route('/texture', textureRoutes);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'compression-service'
  });
});

// Root endpoint
app.get('/', (c) => {
  return c.json({ 
    message: 'Compression Service API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      compression: {
        mesh: 'POST /compress/mesh - Mesh-only compression (Draco)',
        textures: 'POST /compress/textures - Texture-only compression (KTX2)',
        full: 'POST /compress/full - Full compression (mesh + textures)',
        healthCheck: 'GET /compress/health'
      },
      textureCompression: {
        pngToKtx2: 'POST /texture/png-to-ktx2 - Convert PNG to KTX2 format (supports optional format & basisParams)',
        imageToKtx2: 'POST /texture/image-to-ktx2 - Enhanced image to KTX2 conversion with customizable settings',
        glbTextures: 'POST /texture/glb-textures - Enhanced GLB texture compression',
        healthCheck: 'GET /texture/health'
      }
    }
  });
});

const port = 3117;

console.log(`Starting server on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server is running on port ${port}`);

// Also export for Cloudflare Workers deployment
export default {
  port,
  fetch: app.fetch,
};