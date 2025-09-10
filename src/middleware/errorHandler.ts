import { ErrorHandler } from 'hono';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error('Error occurred:', err);
  
  // Handle different error types
  if (err.name === 'ValidationError') {
    return c.json({ 
      error: 'Validation Error', 
      message: err.message 
    }, 400);
  }
  
  if (err.name === 'UnauthorizedError') {
    return c.json({ 
      error: 'Unauthorized', 
      message: err.message 
    }, 401);
  }
  
  // Default error response
  return c.json({ 
    error: 'Internal Server Error', 
    message: 'An unexpected error occurred',
    timestamp: new Date().toISOString()
  }, 500);
};