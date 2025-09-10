import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { errorHandler } from './middleware/errorHandler';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());
app.onError(errorHandler);

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
      health: '/health'
    }
  });
});

const port = 3117;

console.log(`Server is running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};