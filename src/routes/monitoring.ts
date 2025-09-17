import { Hono } from 'hono';
import { getQueueStats, configureEndpoint } from '../middleware/requestQueue.js';

const monitoring = new Hono();

/**
 * Queue monitoring and management endpoints
 */

/**
 * GET /queue/stats - Get current queue statistics
 */
monitoring.get('/stats', (c) => {
  try {
    const stats = getQueueStats();

    // Add system memory info
    const memUsage = process.memoryUsage();
    const systemStats = {
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
      },
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    };

    return c.json({
      system: systemStats,
      queue: stats
    });
  } catch (error) {
    console.error('Error fetching queue stats:', error);
    return c.json({
      error: 'Failed to fetch queue statistics',
      message: error.message
    }, 500);
  }
});

/**
 * GET /queue/health - Health check with queue status
 */
monitoring.get('/health', (c) => {
  try {
    const stats = getQueueStats();
    const summary = stats.summary;

    // Determine health status
    let status = 'healthy';
    let issues = [];

    // Check for overload conditions
    const totalActive = summary.totalActive;
    const totalQueued = summary.totalQueued;
    const totalRejected = summary.totalRejected;

    if (totalQueued > 10) {
      status = 'degraded';
      issues.push(`High queue load: ${totalQueued} requests queued`);
    }

    if (totalRejected > 5) {
      status = 'degraded';
      issues.push(`Service rejection detected: ${totalRejected} requests rejected`);
    }

    if (totalQueued > 20 || totalRejected > 20) {
      status = 'unhealthy';
      issues.push('Service severely overloaded');
    }

    const healthResponse = {
      status,
      timestamp: new Date().toISOString(),
      issues,
      metrics: {
        activeRequests: totalActive,
        queuedRequests: totalQueued,
        completedRequests: summary.totalCompleted,
        rejectedRequests: totalRejected
      }
    };

    const httpStatus = status === 'healthy' ? 200 : (status === 'degraded' ? 200 : 503);
    return c.json(healthResponse, httpStatus);

  } catch (error) {
    console.error('Error in queue health check:', error);
    return c.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    }, 500);
  }
});

/**
 * POST /queue/config - Update endpoint configuration
 * Body: { endpoint: string, config: { maxConcurrent?: number, queueTimeout?: number, ... } }
 */
monitoring.post('/config', async (c) => {
  try {
    const body = await c.req.json();
    const { endpoint, config } = body;

    if (!endpoint || !config) {
      return c.json({
        error: 'Invalid request',
        message: 'Endpoint and config are required'
      }, 400);
    }

    // Validate config parameters
    const validParams = ['maxConcurrent', 'queueTimeout', 'requestTimeout', 'maxQueueSize'];
    const invalidParams = Object.keys(config).filter(key => !validParams.includes(key));

    if (invalidParams.length > 0) {
      return c.json({
        error: 'Invalid config parameters',
        invalidParams,
        validParams
      }, 400);
    }

    // Apply configuration
    configureEndpoint(endpoint, config);

    return c.json({
      message: `Configuration updated for ${endpoint}`,
      endpoint,
      config
    });

  } catch (error) {
    console.error('Error updating queue config:', error);
    return c.json({
      error: 'Failed to update configuration',
      message: error.message
    }, 500);
  }
});

/**
 * GET /queue/endpoints - List all configured endpoints with their settings
 */
monitoring.get('/endpoints', (c) => {
  try {
    const stats = getQueueStats();

    const endpoints = Object.entries(stats.endpoints).map(([path, data]: [string, any]) => ({
      endpoint: path,
      limits: {
        maxConcurrent: data.config.maxConcurrent,
        maxQueueSize: data.config.maxQueueSize,
        queueTimeout: data.config.queueTimeout,
        requestTimeout: data.config.requestTimeout
      },
      current: {
        active: data.active,
        queued: data.queued,
        utilization: data.utilization,
        queueUtilization: data.queueUtilization
      },
      statistics: {
        completed: data.completed,
        failed: data.failed,
        rejected: data.rejected,
        avgProcessingTime: Math.round(data.avgProcessingTime),
        maxProcessingTime: data.maxProcessingTime
      }
    }));

    return c.json({
      timestamp: new Date().toISOString(),
      totalEndpoints: endpoints.length,
      endpoints
    });

  } catch (error) {
    console.error('Error fetching endpoint info:', error);
    return c.json({
      error: 'Failed to fetch endpoint information',
      message: error.message
    }, 500);
  }
});

/**
 * GET /metrics - Prometheus-style metrics for monitoring systems
 */
monitoring.get('/metrics', (c) => {
  try {
    const stats = getQueueStats();
    const memUsage = process.memoryUsage();

    let metrics = [];

    // Memory metrics
    metrics.push(`# HELP nodejs_memory_usage_bytes Memory usage in bytes`);
    metrics.push(`# TYPE nodejs_memory_usage_bytes gauge`);
    metrics.push(`nodejs_memory_usage_bytes{type="rss"} ${memUsage.rss}`);
    metrics.push(`nodejs_memory_usage_bytes{type="heap_used"} ${memUsage.heapUsed}`);
    metrics.push(`nodejs_memory_usage_bytes{type="heap_total"} ${memUsage.heapTotal}`);
    metrics.push(`nodejs_memory_usage_bytes{type="external"} ${memUsage.external}`);

    // Queue metrics per endpoint
    metrics.push(`# HELP compression_requests_active Currently active requests`);
    metrics.push(`# TYPE compression_requests_active gauge`);

    metrics.push(`# HELP compression_requests_queued Currently queued requests`);
    metrics.push(`# TYPE compression_requests_queued gauge`);

    metrics.push(`# HELP compression_requests_completed_total Completed requests`);
    metrics.push(`# TYPE compression_requests_completed_total counter`);

    metrics.push(`# HELP compression_requests_failed_total Failed requests`);
    metrics.push(`# TYPE compression_requests_failed_total counter`);

    metrics.push(`# HELP compression_requests_rejected_total Rejected requests`);
    metrics.push(`# TYPE compression_requests_rejected_total counter`);

    Object.entries(stats.endpoints).forEach(([endpoint, data]: [string, any]) => {
      const endpointLabel = endpoint.replace(/[^a-zA-Z0-9_]/g, '_');
      metrics.push(`compression_requests_active{endpoint="${endpoint}"} ${data.active}`);
      metrics.push(`compression_requests_queued{endpoint="${endpoint}"} ${data.queued}`);
      metrics.push(`compression_requests_completed_total{endpoint="${endpoint}"} ${data.completed}`);
      metrics.push(`compression_requests_failed_total{endpoint="${endpoint}"} ${data.failed}`);
      metrics.push(`compression_requests_rejected_total{endpoint="${endpoint}"} ${data.rejected}`);
    });

    // Process uptime
    metrics.push(`# HELP nodejs_process_uptime_seconds Process uptime`);
    metrics.push(`# TYPE nodejs_process_uptime_seconds gauge`);
    metrics.push(`nodejs_process_uptime_seconds ${process.uptime()}`);

    return c.text(metrics.join('\n'));

  } catch (error) {
    console.error('Error generating metrics:', error);
    return c.text('# Error generating metrics\n', 500);
  }
});

export default monitoring;