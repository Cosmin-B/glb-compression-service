import { Context, Next } from 'hono';

/**
 * Request Queue Middleware
 * Implements intelligent request queuing with configurable limits per endpoint
 * Prevents system overload during high-traffic compression operations
 */

interface QueueConfig {
  maxConcurrent: number;           // Max concurrent requests per endpoint
  queueTimeout: number;           // Max time to wait in queue (ms)
  requestTimeout: number;         // Max time for request processing (ms)
  maxQueueSize: number;          // Max queued requests before rejection
  enableMetrics: boolean;        // Enable detailed metrics collection
}

interface QueuedRequest {
  id: string;
  timestamp: number;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeoutHandle?: NodeJS.Timeout;
}

interface EndpointStats {
  active: number;
  queued: number;
  completed: number;
  failed: number;
  rejected: number;
  avgProcessingTime: number;
  maxProcessingTime: number;
  totalProcessingTime: number;
}

class RequestQueueManager {
  private queues: Map<string, QueuedRequest[]> = new Map();
  private activeRequests: Map<string, Set<string>> = new Map();
  private stats: Map<string, EndpointStats> = new Map();
  private config: Map<string, QueueConfig> = new Map();
  private requestStartTimes: Map<string, number> = new Map();

  constructor() {
    // Default configuration
    this.setEndpointConfig('default', {
      maxConcurrent: 8,
      queueTimeout: 60000,      // 1 minute queue timeout
      requestTimeout: 300000,   // 5 minute processing timeout
      maxQueueSize: 20,         // Max 20 queued requests
      enableMetrics: true
    });

    // Compression-specific configurations
    this.setEndpointConfig('/compress/full', {
      maxConcurrent: 4,         // Most intensive - lower limit
      queueTimeout: 120000,     // 2 minute queue timeout
      requestTimeout: 600000,   // 10 minute processing timeout
      maxQueueSize: 10,
      enableMetrics: true
    });

    this.setEndpointConfig('/compress/textures', {
      maxConcurrent: 6,         // Medium intensity
      queueTimeout: 90000,      // 1.5 minute queue timeout
      requestTimeout: 300000,   // 5 minute processing timeout
      maxQueueSize: 15,
      enableMetrics: true
    });

    this.setEndpointConfig('/compress/mesh', {
      maxConcurrent: 8,         // Less intensive than full
      queueTimeout: 60000,
      requestTimeout: 180000,   // 3 minute processing timeout
      maxQueueSize: 20,
      enableMetrics: true
    });
  }

  /**
   * Set configuration for specific endpoint
   */
  setEndpointConfig(endpoint: string, config: QueueConfig) {
    this.config.set(endpoint, config);
    if (!this.queues.has(endpoint)) {
      this.queues.set(endpoint, []);
      this.activeRequests.set(endpoint, new Set());
      this.stats.set(endpoint, {
        active: 0,
        queued: 0,
        completed: 0,
        failed: 0,
        rejected: 0,
        avgProcessingTime: 0,
        maxProcessingTime: 0,
        totalProcessingTime: 0
      });
    }
  }

  /**
   * Get configuration for endpoint (with fallback to default)
   */
  getConfig(endpoint: string): QueueConfig {
    return this.config.get(endpoint) || this.config.get('default')!;
  }

  /**
   * Get or create stats for endpoint
   */
  private getStats(endpoint: string): EndpointStats {
    if (!this.stats.has(endpoint)) {
      this.setEndpointConfig(endpoint, this.getConfig('default'));
    }
    return this.stats.get(endpoint)!;
  }

  /**
   * Check if endpoint can accept new request immediately
   */
  canProcessImmediately(endpoint: string): boolean {
    const config = this.getConfig(endpoint);
    const activeCount = this.activeRequests.get(endpoint)?.size || 0;
    return activeCount < config.maxConcurrent;
  }

  /**
   * Add request to queue or process immediately
   */
  async enqueueRequest(endpoint: string, requestId: string): Promise<void> {
    const config = this.getConfig(endpoint);
    const stats = this.getStats(endpoint);

    // Check if we can process immediately
    if (this.canProcessImmediately(endpoint)) {
      this.startProcessing(endpoint, requestId);
      return;
    }

    // Check queue capacity
    const currentQueue = this.queues.get(endpoint) || [];
    if (currentQueue.length >= config.maxQueueSize) {
      stats.rejected++;
      throw new Error(`Queue full: ${endpoint} (max: ${config.maxQueueSize})`);
    }

    // Add to queue
    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        id: requestId,
        timestamp: Date.now(),
        resolve,
        reject
      };

      // Set queue timeout
      queuedRequest.timeoutHandle = setTimeout(() => {
        this.removeFromQueue(endpoint, requestId);
        stats.rejected++;
        reject(new Error(`Queue timeout: ${endpoint} (${config.queueTimeout}ms)`));
      }, config.queueTimeout);

      currentQueue.push(queuedRequest);
      stats.queued = currentQueue.length;

      console.log(`[QUEUE] ${endpoint}: Added ${requestId} to queue (position: ${currentQueue.length})`);
    });
  }

  /**
   * Start processing a request
   */
  private startProcessing(endpoint: string, requestId: string): void {
    const activeSet = this.activeRequests.get(endpoint) || new Set();
    activeSet.add(requestId);
    this.activeRequests.set(endpoint, activeSet);

    const stats = this.getStats(endpoint);
    stats.active = activeSet.size;

    this.requestStartTimes.set(requestId, Date.now());

    console.log(`[QUEUE] ${endpoint}: Started processing ${requestId} (active: ${stats.active})`);
  }

  /**
   * Complete request and process next in queue
   */
  completeRequest(endpoint: string, requestId: string, success: boolean = true): void {
    const activeSet = this.activeRequests.get(endpoint);
    if (activeSet?.has(requestId)) {
      activeSet.delete(requestId);
    }

    // Update metrics
    const stats = this.getStats(endpoint);
    stats.active = activeSet?.size || 0;

    const startTime = this.requestStartTimes.get(requestId);
    if (startTime) {
      const processingTime = Date.now() - startTime;
      stats.totalProcessingTime += processingTime;
      stats.maxProcessingTime = Math.max(stats.maxProcessingTime, processingTime);

      if (success) {
        stats.completed++;
        stats.avgProcessingTime = stats.totalProcessingTime / stats.completed;
      } else {
        stats.failed++;
      }

      this.requestStartTimes.delete(requestId);
    }

    console.log(`[QUEUE] ${endpoint}: Completed ${requestId} (${success ? 'success' : 'failed'}, active: ${stats.active})`);

    // Process next request in queue
    this.processNextInQueue(endpoint);
  }

  /**
   * Process the next request in queue if capacity available
   */
  private processNextInQueue(endpoint: string): void {
    if (!this.canProcessImmediately(endpoint)) {
      return;
    }

    const queue = this.queues.get(endpoint) || [];
    if (queue.length === 0) {
      return;
    }

    const nextRequest = queue.shift()!;
    const stats = this.getStats(endpoint);
    stats.queued = queue.length;

    // Clear timeout
    if (nextRequest.timeoutHandle) {
      clearTimeout(nextRequest.timeoutHandle);
    }

    // Start processing
    this.startProcessing(endpoint, nextRequest.id);
    nextRequest.resolve(undefined);
  }

  /**
   * Remove request from queue
   */
  private removeFromQueue(endpoint: string, requestId: string): void {
    const queue = this.queues.get(endpoint) || [];
    const index = queue.findIndex(req => req.id === requestId);

    if (index !== -1) {
      const removed = queue.splice(index, 1)[0];
      if (removed.timeoutHandle) {
        clearTimeout(removed.timeoutHandle);
      }

      const stats = this.getStats(endpoint);
      stats.queued = queue.length;
    }
  }

  /**
   * Get comprehensive queue statistics
   */
  getQueueStats(): Record<string, any> {
    const allStats: Record<string, any> = {};

    for (const [endpoint, stats] of Array.from(this.stats.entries())) {
      const config = this.getConfig(endpoint);
      allStats[endpoint] = {
        ...stats,
        config: {
          maxConcurrent: config.maxConcurrent,
          maxQueueSize: config.maxQueueSize,
          queueTimeout: config.queueTimeout,
          requestTimeout: config.requestTimeout
        },
        utilization: Math.round((stats.active / config.maxConcurrent) * 100),
        queueUtilization: Math.round((stats.queued / config.maxQueueSize) * 100)
      };
    }

    return {
      endpoints: allStats,
      summary: {
        totalActive: Array.from(this.stats.values()).reduce((sum, stats) => sum + stats.active, 0),
        totalQueued: Array.from(this.stats.values()).reduce((sum, stats) => sum + stats.queued, 0),
        totalCompleted: Array.from(this.stats.values()).reduce((sum, stats) => sum + stats.completed, 0),
        totalFailed: Array.from(this.stats.values()).reduce((sum, stats) => sum + stats.failed, 0),
        totalRejected: Array.from(this.stats.values()).reduce((sum, stats) => sum + stats.rejected, 0),
      }
    };
  }

  /**
   * Reset statistics (for testing)
   */
  resetStats(): void {
    for (const stats of Array.from(this.stats.values())) {
      stats.active = 0;
      stats.queued = 0;
      stats.completed = 0;
      stats.failed = 0;
      stats.rejected = 0;
      stats.avgProcessingTime = 0;
      stats.maxProcessingTime = 0;
      stats.totalProcessingTime = 0;
    }
  }
}

// Global queue manager instance
const queueManager = new RequestQueueManager();

/**
 * Middleware factory for request queuing
 */
export function createRequestQueueMiddleware() {
  return async (c: Context, next: Next) => {
    const endpoint = c.req.path;
    const requestId = `${endpoint}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[QUEUE] ${endpoint}: New request ${requestId}`);

    try {
      // Enqueue request (will resolve immediately if capacity available)
      await queueManager.enqueueRequest(endpoint, requestId);

      // Set up request timeout
      const config = queueManager.getConfig(endpoint);
      const timeoutHandle = setTimeout(() => {
        console.log(`[QUEUE] ${endpoint}: Request ${requestId} timed out`);
        queueManager.completeRequest(endpoint, requestId, false);
      }, config.requestTimeout);

      // Process the request
      try {
        await next();
        clearTimeout(timeoutHandle);
        queueManager.completeRequest(endpoint, requestId, true);
      } catch (error) {
        clearTimeout(timeoutHandle);
        queueManager.completeRequest(endpoint, requestId, false);
        throw error;
      }

    } catch (error) {
      // Request was rejected or timed out in queue
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[QUEUE] ${endpoint}: Request ${requestId} rejected - ${errorMessage}`);

      const errorResponse = {
        error: 'Service overloaded',
        message: errorMessage,
        requestId,
        endpoint,
        queueStats: queueManager.getQueueStats().endpoints[endpoint] || {}
      };

      return c.json(errorResponse, 503); // Service Unavailable
    }
  };
}

/**
 * Get queue statistics (for monitoring endpoint)
 */
export function getQueueStats() {
  return queueManager.getQueueStats();
}

/**
 * Configure endpoint limits (for dynamic configuration)
 */
export function configureEndpoint(endpoint: string, config: Partial<QueueConfig>) {
  const currentConfig = queueManager.getConfig(endpoint);
  const newConfig = { ...currentConfig, ...config };
  queueManager.setEndpointConfig(endpoint, newConfig);
}

/**
 * Reset queue statistics (for testing)
 */
export function resetQueueStats() {
  queueManager.resetStats();
}

export type { QueueConfig };
export { RequestQueueManager };