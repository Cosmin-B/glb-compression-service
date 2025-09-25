import { createCanvas, loadImage, ImageData } from 'canvas';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface KTX2CompressionResult {
  buffer: ArrayBuffer;
  compressionRatio: number;
  originalSize: number;
  compressedSize: number;
  format?: string;
  texturesProcessed?: number;
  errors?: string[];
}

/**
 * KTX2 transcoder format constants matching Basis Universal transcoder formats
 */
export enum KTX2TranscoderFormat {
  UASTC_4x4 = 'UASTC_4x4',
  ETC1S = 'ETC1S'
}

/**
 * Extended compression settings interface
 */
export interface KTX2CompressionSettings {
  format?: KTX2TranscoderFormat;
  basisParams?: Partial<BasisParams>;
  // Legacy compatibility options
  basisUniversalMode?: 'ETC1S' | 'UASTC';
  quality?: number;
  oetf?: 'linear' | 'srgb';
  generateMipmaps?: boolean;
  useZstandard?: boolean;
  flipY?: boolean;
  forceFormat?: boolean; // If true, overrides normal map auto-detection
  customBasisParams?: Partial<BasisParams>; // Legacy support
}

// KTX module will be loaded dynamically
let ktx: any = null;
let ktxInitialized = false;
let isInitializing = false;

// Request queue to prevent WASM module overload
interface CompressionRequest {
  resolve: (result: KTX2CompressionResult) => void;
  reject: (error: Error) => void;
  imageArrayBuffer: ArrayBuffer;
  settings: KTX2CompressionSettings;
}

class KTX2RequestQueue {
  private queue: CompressionRequest[] = [];
  private processing = false;
  private maxConcurrent = 1; // Process one request at a time to prevent WASM crashes
  private currentRequests = 0;

  async add(imageArrayBuffer: ArrayBuffer, settings: KTX2CompressionSettings): Promise<KTX2CompressionResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, imageArrayBuffer, settings });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.currentRequests >= this.maxConcurrent) {
      return;
    }

    const request = this.queue.shift();
    if (!request) {
      return;
    }

    this.processing = true;
    this.currentRequests++;

    try {
      const result = await this.processRequest(request.imageArrayBuffer, request.settings);
      // Reset error count on successful compression
      consecutiveErrors = 0;
      request.resolve(result);
    } catch (error) {
      const handledError = handleCompressionError(error instanceof Error ? error : new Error('Unknown compression error'));
      request.reject(handledError);
    } finally {
      this.currentRequests--;
      this.processing = false;
      // Process next request if any
      if (this.queue.length > 0) {
        setTimeout(() => this.processQueue(), 0);
      }
    }
  }

  private async processRequest(imageArrayBuffer: ArrayBuffer, settings: KTX2CompressionSettings): Promise<KTX2CompressionResult> {
    // Add timeout protection
    const timeoutMs = 30000; // 30 seconds timeout
    return Promise.race([
      compressImageToKTX2Internal(imageArrayBuffer, settings),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Compression timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  }
}

const requestQueue = new KTX2RequestQueue();

// Module health tracking
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;
let lastErrorTime = 0;
const ERROR_RESET_INTERVAL = 60000; // 1 minute

// Circuit breaker for module initialization
let initFailureCount = 0;
const MAX_INIT_FAILURES = 5;
let lastInitFailureTime = 0;
const INIT_FAILURE_COOLDOWN = 300000; // 5 minutes

/**
 * Resets the KTX module in case of errors
 */
async function resetKTXModule(): Promise<void> {
  console.log("KTX2: Resetting KTX module due to errors...");

  // Clear current state
  ktx = null;
  ktxInitialized = false;
  isInitializing = false;

  // Force garbage collection if available
  if (typeof global !== 'undefined' && global.gc) {
    global.gc();
  }

  // Wait a bit before reinitializing
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Reinitialize
  await initKtxModule();

  console.log("KTX2: Module reset complete");
}

/**
 * Tracks errors and triggers module reset if necessary
 */
function handleCompressionError(error: Error): Error {
  const now = Date.now();

  // Reset error count if enough time has passed
  if (now - lastErrorTime > ERROR_RESET_INTERVAL) {
    consecutiveErrors = 0;
  }

  consecutiveErrors++;
  lastErrorTime = now;

  console.error(`KTX2: Compression error ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}:`, error.message);

  // If we have too many consecutive errors, schedule a module reset
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    console.warn("KTX2: Too many consecutive errors, scheduling module reset...");
    consecutiveErrors = 0; // Reset counter to prevent multiple resets

    // Schedule reset asynchronously to not block current operation
    setTimeout(() => {
      resetKTXModule().catch(resetError => {
        console.error("KTX2: Failed to reset module:", resetError);
      });
    }, 0);
  }

  return error;
}

// Initialize KTX module using local files with simple Function approach
async function initKtxModule(): Promise<void> {
  if (ktxInitialized && ktx) return;

  // Circuit breaker: Check if we're in cooldown period after too many failures
  const now = Date.now();
  if (initFailureCount >= MAX_INIT_FAILURES) {
    if (now - lastInitFailureTime < INIT_FAILURE_COOLDOWN) {
      const remainingCooldown = Math.ceil((INIT_FAILURE_COOLDOWN - (now - lastInitFailureTime)) / 1000);
      throw new Error(`KTX module initialization circuit breaker active. Too many failures. Retry in ${remainingCooldown} seconds.`);
    } else {
      // Reset failure count after cooldown
      initFailureCount = 0;
    }
  }

  // Prevent multiple simultaneous initialization attempts
  if (isInitializing) {
    // Wait for initialization to complete
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (ktxInitialized && ktx) return;
    throw new Error('KTX module initialization failed in concurrent attempt');
  }

  isInitializing = true;

  try {
    console.log("KTX2: Initializing libktx.js module from local files...");
    
    const publicPath = resolve(process.cwd(), 'public', 'ktx2');
    const libktxJsPath = resolve(publicPath, 'libktx.js');
    const libktxWasmPath = resolve(publicPath, 'libktx.wasm');
    
    console.log(`KTX2: Loading libktx.js from: ${libktxJsPath}`);
    console.log(`KTX2: WASM path: ${libktxWasmPath}`);

    const moduleConfig = {
      locateFile: (path: string, prefix: string) => {
        if (path.endsWith('.wasm')) {
          console.log(`KTX2: locateFile for .wasm, returning: ${libktxWasmPath}`);
          return libktxWasmPath;
        }
        console.log(`KTX2: locateFile for ${path}, using prefix: ${prefix}${path}`);
        return prefix + path; 
      }
    };

    // Read the libktx.js file content
    const scriptContent = readFileSync(libktxJsPath, 'utf8');
    console.log("KTX2: libktx.js content loaded from local file");
    
    console.log("KTX2: Attempting to execute script and retrieve createKtxModule function...");
    
    // Temporarily add CommonJS globals to globalThis for script execution
    const originalRequire = (globalThis as any).require;
    const originalDirname = (globalThis as any).__dirname;
    const originalFilename = (globalThis as any).__filename;
    
    (globalThis as any).require = (id: string) => {
      console.log(`KTX2: require called for: ${id}`);
      switch (id) {
        case 'fs':
          return { readFileSync, readSync: () => 0 };
        case 'path':
          return { 
            resolve, 
            dirname: (path: string) => {
              const parts = path.split(/[\\/\\]/);
              parts.pop();
              return parts.join('/') || '/';
            },
            join: (...paths: string[]) => paths.join('/').replace(/\/+/g, '/')
          };
        case 'crypto':
          return {
            randomFillSync: (buffer: any) => {
              if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                crypto.getRandomValues(buffer);
              } else {
                for (let i = 0; i < buffer.length; i++) {
                  buffer[i] = Math.floor(Math.random() * 256);
                }
              }
              return buffer;
            }
          };
        default:
          console.log(`KTX2: Unknown require module: ${id}, returning empty object`);
          return {};
      }
    };
    
    // Add CommonJS __dirname and __filename globals
    (globalThis as any).__dirname = publicPath;
    (globalThis as any).__filename = libktxJsPath;

    try {
      // Create a new function that executes the script and returns the createKtxModule function
      const getCreateKtxModule = new Function(scriptContent + "\nreturn createKtxModule;");
      const ktxModuleCreator = getCreateKtxModule.call(globalThis); // Execute in globalThis scope and get the returned function
      
      console.log("KTX2: createKtxModule function retrieved.");

      if (typeof ktxModuleCreator === 'undefined') {
        throw new Error("Failed to retrieve createKtxModule function after executing libktx.js.");
      }
      if (typeof ktxModuleCreator !== 'function') {
        throw new Error("Retrieved ktxModuleCreator is not a function.");
      }

      console.log("KTX2: Calling createKtxModule...");
      ktx = await ktxModuleCreator(moduleConfig);

      // Validate essential components are available
      if (!ktx || !ktx.texture || !ktx.ErrorCode || !ktx.VkFormat || !ktx.textureCreateInfo || !ktx.TextureCreateStorageEnum || !ktx.basisParams) {
        throw new Error('KTX module initialization succeeded but essential components are missing');
      }

      ktxInitialized = true;

      console.log("KTX2: KTX module initialized successfully");
      console.log("KTX2: Available components:", ktx ? Object.keys(ktx) : 'none');
      
    } catch (error) {
      throw error;
    } finally {
      // Always restore original CommonJS globals after module initialization is complete
      if (originalRequire) {
        (globalThis as any).require = originalRequire;
      } else {
        delete (globalThis as any).require;
      }
      
      if (originalDirname) {
        (globalThis as any).__dirname = originalDirname;
      } else {
        delete (globalThis as any).__dirname;
      }
      
      if (originalFilename) {
        (globalThis as any).__filename = originalFilename;
      } else {
        delete (globalThis as any).__filename;
      }
    }
    
  } catch (error) {
    ktx = null;
    ktxInitialized = false;
    initFailureCount++;
    lastInitFailureTime = Date.now();
    console.error(`KTX2: Failed to initialize KTX module (failure ${initFailureCount}/${MAX_INIT_FAILURES}):`, error);
    throw new Error(`KTX2 module initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    isInitializing = false;
  }
}

/**
 * Comprehensive Basis Universal compression parameters interface
 */
export interface BasisParams {
  // Core compression settings
  uastc?: boolean;
  verbose?: boolean;
  generateMipmaps?: boolean;
  mipmapFilter?: 'box' | 'tent' | 'bell' | 'bspline' | 'mitchell' | 'lanczos3' | 'lanczos4' | 'lanczos6' | 'lanczos12' | 'blackman' | 'kaiser' | 'gaussian' | 'catmullrom' | 'quadratic_interp' | 'quadratic_approx' | 'quadratic_mix';
  perceptual?: boolean;
  zstdLevel?: number; // Zstandard compression level (0 = disabled)
  
  // ETC1S specific parameters
  qualityLevel?: number; // For ETC1S mode (1-255, lower = better quality)
  maxEndpoints?: number;
  maxSelectors?: number;
  endpointRDOThreshold?: number;
  selectorRDOThreshold?: number;
  
  // UASTC specific parameters  
  rdo_uastc?: boolean;
  rdo_uastc_quality_scalar?: number; // For UASTC mode (0-4, higher = better quality)
  rdo_uastc_dict_size?: number;
  rdo_uastc_max_smooth_block_error_scale?: number;
  rdo_uastc_smooth_block_max_std_dev?: number;
  rdo_uastc_max_allowed_rms_increase_ratio?: number;
  rdo_uastc_skip_block_rms_thresh?: number;
  
  // Advanced settings
  mipSrgb?: boolean;
  normalMap?: boolean;
  separateRGToRGB_A?: boolean;
  checkForAlpha?: boolean;
  forceAlpha?: boolean;
  renormalize?: boolean;
  
  // Resampling settings
  resample?: boolean;
  resampleWidth?: number;
  resampleHeight?: number;
  resampleFactor?: number;
}

/**
 * Default Basis Universal compression parameters for ETC1S mode
 */
const DEFAULT_ETC1S_BASIS_PARAMS: Partial<BasisParams> = {
  uastc: false,
  verbose: true,
  generateMipmaps: true,
  mipmapFilter: 'kaiser',
  perceptual: true,
  qualityLevel: 128, // Middle quality
  zstdLevel: 3,
  checkForAlpha: true,
  normalMap: false,
  maxEndpoints: 16128,
  maxSelectors: 16128
};

/**
 * Default Basis Universal compression parameters for UASTC mode
 */
const DEFAULT_UASTC_BASIS_PARAMS: Partial<BasisParams> = {
  uastc: true,
  verbose: true,
  generateMipmaps: true,
  mipmapFilter: 'kaiser',
  perceptual: true,
  rdo_uastc_quality_scalar: 2, // Balanced quality/size
  zstdLevel: 3,
  checkForAlpha: true,
  normalMap: false,
  rdo_uastc: true
};

/**
 * Merge user-provided basisParams with format-specific defaults
 * @param format - The target compression format
 * @param userParams - User-provided basis parameters
 * @param legacySettings - Legacy compression settings for backward compatibility
 * @returns Merged basis parameters
 */
function mergeBasisParams(
  format: KTX2TranscoderFormat,
  userParams?: Partial<BasisParams>,
  legacySettings?: {
    quality?: number;
    generateMipmaps?: boolean;
    useZstandard?: boolean;
    oetf?: 'linear' | 'srgb';
  }
): BasisParams {
  // Start with format-specific defaults
  const defaults = format === KTX2TranscoderFormat.UASTC_4x4 
    ? { ...DEFAULT_UASTC_BASIS_PARAMS }
    : { ...DEFAULT_ETC1S_BASIS_PARAMS };

  // Apply legacy settings for backward compatibility
  if (legacySettings) {
    if (legacySettings.generateMipmaps !== undefined) {
      defaults.generateMipmaps = legacySettings.generateMipmaps;
    }
    if (legacySettings.oetf !== undefined) {
      defaults.perceptual = legacySettings.oetf === 'srgb';
    }
    if (legacySettings.useZstandard !== undefined) {
      defaults.zstdLevel = legacySettings.useZstandard ? 3 : 0;
    }
    if (legacySettings.quality !== undefined) {
      if (format === KTX2TranscoderFormat.UASTC_4x4) {
        // Map quality percentage to UASTC quality scalar (0-4)
        if (legacySettings.quality <= 20) defaults.rdo_uastc_quality_scalar = 0;
        else if (legacySettings.quality <= 40) defaults.rdo_uastc_quality_scalar = 1;
        else if (legacySettings.quality <= 60) defaults.rdo_uastc_quality_scalar = 2;
        else if (legacySettings.quality <= 80) defaults.rdo_uastc_quality_scalar = 3;
        else defaults.rdo_uastc_quality_scalar = 4;
      } else {
        // Map quality percentage to ETC1S quality level (1-255, lower = better quality)
        defaults.qualityLevel = Math.max(1, Math.min(255, Math.round(255 - (legacySettings.quality / 100) * 254)));
      }
    }
  }

  // Merge with user-provided parameters (highest priority)
  return { ...defaults, ...userParams };
}

/**
 * Determine the compression format from settings
 * @param settings - Compression settings
 * @returns The target compression format
 */
function determineCompressionFormat(settings: KTX2CompressionSettings): KTX2TranscoderFormat {
  // Explicit format takes precedence
  if (settings.format) {
    return settings.format;
  }
  
  // Fall back to legacy basisUniversalMode
  if (settings.basisUniversalMode) {
    return settings.basisUniversalMode === 'UASTC' 
      ? KTX2TranscoderFormat.UASTC_4x4 
      : KTX2TranscoderFormat.ETC1S;
  }
  
  // Default to ETC1S for best compatibility
  return KTX2TranscoderFormat.ETC1S;
}

/**
 * Validates input parameters before compression
 */
function validateCompressionInputs(imageArrayBuffer: ArrayBuffer, settings: KTX2CompressionSettings): void {
  if (!imageArrayBuffer) {
    throw new Error('Input imageArrayBuffer is null or undefined');
  }

  if (!(imageArrayBuffer instanceof ArrayBuffer)) {
    throw new Error('Input must be an ArrayBuffer');
  }

  if (imageArrayBuffer.byteLength === 0) {
    throw new Error('Input ArrayBuffer is empty');
  }

  // More conservative memory limit to prevent WASM crashes
  const maxSize = 50 * 1024 * 1024; // 50MB limit
  if (imageArrayBuffer.byteLength > maxSize) {
    throw new Error(`Input image too large: ${(imageArrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB. Maximum allowed: ${maxSize / 1024 / 1024}MB`);
  }

  // Validate settings object
  if (settings && typeof settings !== 'object') {
    throw new Error('Settings must be an object');
  }
}

/**
 * Checks if there's enough memory available for processing
 */
function checkMemoryAvailability(imageArrayBuffer: ArrayBuffer): void {
  const requiredMemory = imageArrayBuffer.byteLength * 4; // More conservative estimate: 4x memory usage for processing

  // Check if we have enough memory (rough estimate)
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    const memInfo = (performance as any).memory;
    if (memInfo && memInfo.usedJSHeapSize) {
      const availableMemory = memInfo.jsHeapSizeLimit - memInfo.usedJSHeapSize;
      const memoryUsagePercent = (memInfo.usedJSHeapSize / memInfo.jsHeapSizeLimit) * 100;

      console.log(`KTX2: Memory check - Used: ${(memInfo.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB, ` +
                  `Available: ${(availableMemory / 1024 / 1024).toFixed(2)}MB, ` +
                  `Usage: ${memoryUsagePercent.toFixed(1)}%, ` +
                  `Required: ${(requiredMemory / 1024 / 1024).toFixed(2)}MB`);

      if (availableMemory < requiredMemory) {
        throw new Error(`Insufficient memory. Required: ${(requiredMemory / 1024 / 1024).toFixed(2)}MB, Available: ${(availableMemory / 1024 / 1024).toFixed(2)}MB`);
      }

      // Warn if memory usage is getting high
      if (memoryUsagePercent > 80) {
        console.warn(`KTX2: High memory usage detected: ${memoryUsagePercent.toFixed(1)}%`);
      }
    }
  }
}

export async function compressImageToKTX2(
  imageArrayBuffer: ArrayBuffer,
  settings: KTX2CompressionSettings = {}
): Promise<KTX2CompressionResult> {
  // Validate inputs
  validateCompressionInputs(imageArrayBuffer, settings);
  checkMemoryAvailability(imageArrayBuffer);

  // Use request queue to prevent WASM module overload
  return requestQueue.add(imageArrayBuffer, settings);
}

/**
 * Internal compression function that does the actual work
 */
async function compressImageToKTX2Internal(
  imageArrayBuffer: ArrayBuffer,
  settings: KTX2CompressionSettings = {}
): Promise<KTX2CompressionResult> {
  console.log("KTX2: Starting image to KTX2 compression");
  console.log(`KTX2: Input buffer size: ${imageArrayBuffer.byteLength} bytes`);

  // Initialize KTX module if needed
  await initKtxModule();

  if (!ktx || !ktx.texture || !ktx.ErrorCode || !ktx.VkFormat || !ktx.textureCreateInfo || !ktx.TextureCreateStorageEnum || !ktx.basisParams) {
    throw new Error('KTX module or essential components not available');
  }

  // Determine compression format
  const format = determineCompressionFormat(settings);
  console.log(`KTX2: Using compression format: ${format}`);

  // Merge basis parameters with defaults, legacy settings, and user overrides
  const userBasisParams = settings.basisParams || settings.customBasisParams;
  const mergedBasisParams = mergeBasisParams(format, userBasisParams, {
    quality: settings.quality ?? undefined,
    generateMipmaps: settings.generateMipmaps ?? undefined,
    useZstandard: settings.useZstandard ?? undefined,
    oetf: settings.oetf ?? undefined
  });

  // Default settings for backward compatibility
  const compressionSettings = {
    format,
    basisUniversalMode: format === KTX2TranscoderFormat.UASTC_4x4 ? 'UASTC' as const : 'ETC1S' as const,
    quality: settings.quality || 75,
    oetf: settings.oetf || 'srgb',
    generateMipmaps: settings.generateMipmaps || false,
    useZstandard: settings.useZstandard || true,
    flipY: settings.flipY || false,
    basisParams: mergedBasisParams
  };
  
  console.log('KTX2: Final compression settings:', {
    format: compressionSettings.format,
    quality: compressionSettings.quality,
    oetf: compressionSettings.oetf,
    generateMipmaps: compressionSettings.generateMipmaps,
    useZstandard: compressionSettings.useZstandard,
    flipY: compressionSettings.flipY
  });
  console.log('KTX2: Merged basis parameters:', JSON.stringify(compressionSettings.basisParams, null, 2));

  let ktxTextureInstance: any = null;
  let basisParams: any = null;
  let imageData: ImageData | null = null;
  let canvas: any = null;

  try {
    // Convert ArrayBuffer to Buffer for canvas operations
    const imageBuffer = Buffer.from(imageArrayBuffer);
    
    // Load the image using canvas (supports PNG, JPG, JPEG, etc.)
    const image = await loadImage(imageBuffer);
    console.log(`KTX2: Image loaded - ${image.width}x${image.height}`);

    // Validate image dimensions to prevent WASM crashes
    const maxDimension = 8192; // 8K max dimension
    if (image.width > maxDimension || image.height > maxDimension) {
      throw new Error(`Image dimensions too large: ${image.width}x${image.height}. Maximum allowed: ${maxDimension}x${maxDimension}`);
    }

    if (image.width < 4 || image.height < 4) {
      throw new Error(`Image dimensions too small: ${image.width}x${image.height}. Minimum required: 4x4`);
    }

    // Check for reasonable aspect ratios to prevent extreme memory usage
    const aspectRatio = Math.max(image.width, image.height) / Math.min(image.width, image.height);
    if (aspectRatio > 16) {
      throw new Error(`Image aspect ratio too extreme: ${aspectRatio.toFixed(2)}:1. Maximum allowed: 16:1`);
    }
    
    // Ensure WebGL-compatible dimensions for mipmaps
    // WebGL requires each mipmap level to have dimensions that are multiples of 4 or equal to 0, 1, or 2
    const adjustDimensionForWebGL = (dimension: number): number => {
      // If already small enough for WebGL compatibility
      if (dimension <= 2) return dimension;

      // Round down to nearest multiple of 4 for optimal mipmap chain
      const adjusted = Math.floor(dimension / 4) * 4;

      // Ensure minimum dimension of 4 for block compression
      return Math.max(4, adjusted);
    };

    const width = adjustDimensionForWebGL(image.width);
    const height = adjustDimensionForWebGL(image.height);
    console.log(`KTX2: WebGL-compatible dimensions - ${width}x${height} (original: ${image.width}x${image.height})`);
    
    // Create canvas and get image data
    canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    
    // Handle image flipping for GLB textures if requested
    if (compressionSettings.flipY) {
      console.log("KTX2: Flipping image vertically for GLB compatibility");
      ctx.save();
      ctx.scale(1, -1); // Flip Y axis
      ctx.drawImage(image, 0, -height, width, height); // Draw flipped
      ctx.restore();
    } else {
      ctx.drawImage(image, 0, 0, width, height);
    }
    
    imageData = ctx.getImageData(0, 0, width, height);
    if (!imageData) {
      throw new Error('Failed to extract image data from canvas context');
    }
    console.log(`KTX2: Image data extracted - ${imageData.data.length} bytes`);

    // Validate image data
    if (!imageData || !imageData.data || imageData.data.length === 0) {
      throw new Error('Failed to extract valid image data from canvas');
    }

    // Additional safety check for image dimensions
    if (imageData.width !== width || imageData.height !== height) {
      throw new Error(`Image data dimensions mismatch. Expected: ${width}x${height}, Got: ${imageData.width}x${imageData.height}`);
    }

    // Create KTX texture
    console.log("KTX2: Creating textureCreateInfo...");
    const createInfo = new ktx.textureCreateInfo();
    
    // Set Vulkan format based on OETF setting with better color space detection
    const mergedParams = compressionSettings.basisParams;
    const isColorTexture = !mergedParams?.normalMap; // Normal maps should use linear space

    if (compressionSettings.oetf === 'srgb' || (isColorTexture && compressionSettings.oetf !== 'linear')) {
      createInfo.vkFormat = ktx.VkFormat.R8G8B8A8_SRGB;
      console.log("KTX2: Using VK_FORMAT_R8G8B8A8_SRGB for sRGB color texture");
    } else {
      createInfo.vkFormat = ktx.VkFormat.R8G8B8A8_UNORM;
      console.log("KTX2: Using VK_FORMAT_R8G8B8A8_UNORM for linear/normal map data");
    }
    
    createInfo.baseWidth = width;
    createInfo.baseHeight = height;
    createInfo.baseDepth = 1;
    createInfo.numDimensions = 2;

    // Calculate correct number of mipmap levels when mipmaps are enabled
    const generateMipmaps = mergedParams?.generateMipmaps || false;
    if (generateMipmaps) {
      // Calculate the number of mipmap levels (same logic as the logging)
      const maxDimension = Math.max(width, height);
      const numLevels = Math.floor(Math.log2(maxDimension)) + 1;
      createInfo.numLevels = numLevels;
      console.log(`KTX2: Setting KTX2 container for ${numLevels} mipmap levels`);
    } else {
      createInfo.numLevels = 1;
    }

    createInfo.numLayers = 1;
    createInfo.numFaces = 1;
    createInfo.isArray = false;
    createInfo.generateMipmaps = false; // Always false for texture creation - mipmaps handled by Basis compression

    console.log("KTX2: Creating KTX texture object...");
    ktxTextureInstance = new ktx.texture(createInfo, ktx.TextureCreateStorageEnum.ALLOC_STORAGE);
    if (!ktxTextureInstance) {
      throw new Error("Failed to create ktx.texture object");
    }

    console.log("KTX2: Setting image data...");

    // Additional validation before calling WASM function
    if (!imageData.data || imageData.data.length === 0) {
      throw new Error('Image data is empty or invalid');
    }

    if (imageData.data.length !== width * height * 4) {
      throw new Error(`Image data size mismatch. Expected: ${width * height * 4}, Got: ${imageData.data.length}`);
    }

    let setImageResult;
    try {
      setImageResult = ktxTextureInstance.setImageFromMemory(0, 0, 0, imageData.data);
    } catch (wasmError) {
      throw new Error(`WASM setImageFromMemory call failed: ${wasmError instanceof Error ? wasmError.message : 'Unknown WASM error'}`);
    }

    if (setImageResult !== ktx.ErrorCode.SUCCESS) {
      throw new Error(`Failed to set image from memory. Error code: ${setImageResult}`);
    }

    // Configure Basis Universal compression with merged parameters
    console.log("KTX2: Creating basisParams with comprehensive configuration...");
    basisParams = new ktx.basisParams();
    
    // Apply all merged basis parameters
    const params = compressionSettings.basisParams;
    
    // Core compression settings
    if (params.uastc !== undefined) {
      basisParams.uastc = params.uastc;
      console.log(`KTX2: Compression mode: ${params.uastc ? 'UASTC' : 'ETC1S'}`);
    }
    if (params.verbose !== undefined) basisParams.verbose = params.verbose;
    if (params.generateMipmaps !== undefined) basisParams.generateMipmaps = params.generateMipmaps;
    if (params.mipmapFilter !== undefined) basisParams.mipmapFilter = params.mipmapFilter;
    if (params.perceptual !== undefined) basisParams.perceptual = params.perceptual;
    
    // Format-specific quality settings
    if (params.uastc) {
      // UASTC specific parameters
      if (params.rdo_uastc !== undefined) basisParams.rdo_uastc = params.rdo_uastc;
      if (params.rdo_uastc_quality_scalar !== undefined) {
        basisParams.rdo_uastc_quality_scalar = params.rdo_uastc_quality_scalar;
        console.log(`KTX2: UASTC mode. RDO quality scalar: ${basisParams.rdo_uastc_quality_scalar}`);
      }
      if (params.rdo_uastc_dict_size !== undefined) basisParams.rdo_uastc_dict_size = params.rdo_uastc_dict_size;
      if (params.rdo_uastc_max_smooth_block_error_scale !== undefined) basisParams.rdo_uastc_max_smooth_block_error_scale = params.rdo_uastc_max_smooth_block_error_scale;
      if (params.rdo_uastc_smooth_block_max_std_dev !== undefined) basisParams.rdo_uastc_smooth_block_max_std_dev = params.rdo_uastc_smooth_block_max_std_dev;
      if (params.rdo_uastc_max_allowed_rms_increase_ratio !== undefined) basisParams.rdo_uastc_max_allowed_rms_increase_ratio = params.rdo_uastc_max_allowed_rms_increase_ratio;
      if (params.rdo_uastc_skip_block_rms_thresh !== undefined) basisParams.rdo_uastc_skip_block_rms_thresh = params.rdo_uastc_skip_block_rms_thresh;
    } else {
      // ETC1S specific parameters
      if (params.qualityLevel !== undefined) {
        basisParams.qualityLevel = params.qualityLevel;
        console.log(`KTX2: ETC1S mode. Quality level: ${basisParams.qualityLevel}`);
      }
      if (params.maxEndpoints !== undefined) basisParams.maxEndpoints = params.maxEndpoints;
      if (params.maxSelectors !== undefined) basisParams.maxSelectors = params.maxSelectors;
      if (params.endpointRDOThreshold !== undefined) basisParams.endpointRDOThreshold = params.endpointRDOThreshold;
      if (params.selectorRDOThreshold !== undefined) basisParams.selectorRDOThreshold = params.selectorRDOThreshold;
    }
    
    // Compression settings
    if (params.zstdLevel !== undefined) {
      basisParams.zstdLevel = params.zstdLevel;
      console.log(`KTX2: ZSTD compression level: ${basisParams.zstdLevel}`);
    }
    
    // Advanced settings
    if (params.mipSrgb !== undefined) basisParams.mipSrgb = params.mipSrgb;
    if (params.normalMap !== undefined) basisParams.normalMap = params.normalMap;
    if (params.separateRGToRGB_A !== undefined) basisParams.separateRGToRGB_A = params.separateRGToRGB_A;
    if (params.checkForAlpha !== undefined) basisParams.checkForAlpha = params.checkForAlpha;
    if (params.forceAlpha !== undefined) basisParams.forceAlpha = params.forceAlpha;
    if (params.renormalize !== undefined) basisParams.renormalize = params.renormalize;
    
    // Resampling settings
    if (params.resample !== undefined) basisParams.resample = params.resample;
    if (params.resampleWidth !== undefined) basisParams.resampleWidth = params.resampleWidth;
    if (params.resampleHeight !== undefined) basisParams.resampleHeight = params.resampleHeight;
    if (params.resampleFactor !== undefined) basisParams.resampleFactor = params.resampleFactor;
    
    console.log(`KTX2: Applied comprehensive basis parameters successfully`);
    console.log(`KTX2: Mipmaps: ${basisParams.generateMipmaps ? 'enabled' : 'disabled'}`);
    console.log(`KTX2: Mipmap filter: ${basisParams.mipmapFilter || 'default'}`);
    console.log(`KTX2: Perceptual: ${basisParams.perceptual ? 'enabled' : 'disabled'}`);
    console.log(`KTX2: Color space: ${compressionSettings.oetf || 'auto-detected'}`);

    // Log WebGL compatibility information
    if (basisParams.generateMipmaps) {
      const maxMipLevels = Math.floor(Math.log2(Math.max(width, height))) + 1;
      console.log(`KTX2: Will generate ${maxMipLevels} mipmap levels for WebGL compatibility`);
      console.log(`KTX2: Base dimensions (${width}x${height}) are WebGL-compatible for mipmapping`);
    }

    // Compress to Basis Universal
    console.log("KTX2: Compressing to Basis Universal...");

    let compressResult;
    try {
      compressResult = ktxTextureInstance.compressBasis(basisParams);
    } catch (wasmError) {
      throw new Error(`WASM compressBasis call failed: ${wasmError instanceof Error ? wasmError.message : 'Unknown WASM error'}`);
    }

    if (compressResult !== ktx.ErrorCode.SUCCESS) {
      throw new Error(`Failed to compress KTX texture to Basis Universal. Error code: ${compressResult}`);
    }
    console.log("KTX2: Basis Universal compression successful");

    // Get KTX2 data
    console.log("KTX2: Writing KTX2 data to memory...");

    let ktx2FileBytes;
    try {
      ktx2FileBytes = ktxTextureInstance.writeToMemory();
    } catch (wasmError) {
      throw new Error(`WASM writeToMemory call failed: ${wasmError instanceof Error ? wasmError.message : 'Unknown WASM error'}`);
    }

    if (!ktx2FileBytes || ktx2FileBytes.length === 0) {
      throw new Error("compressBasis succeeded but writeToMemory returned no data");
    }

    const compressedSize = ktx2FileBytes.length;
    const compressionRatio = ((imageArrayBuffer.byteLength - compressedSize) / imageArrayBuffer.byteLength) * 100;
    
    console.log(`KTX2: Compression completed successfully`);
    console.log(`KTX2: Original size: ${imageArrayBuffer.byteLength} bytes`);
    console.log(`KTX2: Compressed size: ${compressedSize} bytes`);
    console.log(`KTX2: Compression ratio: ${compressionRatio.toFixed(2)}%`);
    
    // Convert Uint8Array to ArrayBuffer
    const resultBuffer = new ArrayBuffer(compressedSize);
    const resultView = new Uint8Array(resultBuffer);
    resultView.set(ktx2FileBytes);
    
    return {
      buffer: resultBuffer,
      compressionRatio,
      originalSize: imageArrayBuffer.byteLength,
      compressedSize
    };
    
  } catch (error) {
    console.error("KTX2: Compression failed:", error);
    throw new Error(`KTX2 compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    // Clean up KTX objects with error handling
    try {
      if (ktxTextureInstance) {
        console.log("KTX2: Deleting KTX texture object");
        ktxTextureInstance.delete();
      }
    } catch (error) {
      console.warn("KTX2: Warning - Failed to delete KTX texture object:", error);
    }

    try {
      if (basisParams) {
        console.log("KTX2: Deleting Basis parameters object");
        basisParams.delete();
      }
    } catch (error) {
      console.warn("KTX2: Warning - Failed to delete Basis parameters object:", error);
    }

    // Clear references
    ktxTextureInstance = null;
    basisParams = null;
    imageData = null;
    canvas = null;

    // Force garbage collection hint
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();
    }
  }
}

/**
 * Backward compatibility alias for PNG compression
 */
export async function compressPNGToKTX2(
  pngArrayBuffer: ArrayBuffer, 
  settings: KTX2CompressionSettings = {}
): Promise<KTX2CompressionResult> {
  return compressImageToKTX2(pngArrayBuffer, settings);
}

/**
 * Legacy function for compatibility with existing texture compression routes
 */
export async function compressPNGToKTX2Legacy(pngBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const result = await compressImageToKTX2(pngBuffer);
  return result.buffer;
}

/**
 * Enhanced GLB texture compression using real KTX2 encoder
 * Based on the b2b-web-suite implementation, adapted for server-side Node.js
 * Updated to accept custom compression settings with ETC1S as default format
 */
export async function compressGLBTexturesKTX2(
  inputBuffer: ArrayBuffer,
  compressionSettings: KTX2CompressionSettings = {}
): Promise<KTX2CompressionResult> {
  console.log("Starting enhanced GLB texture compression with KTX2...");

  // Validate inputs
  validateCompressionInputs(inputBuffer, compressionSettings);
  
  // Default settings for GLB compression with ETC1S as default and flipY enabled
  const defaultSettings: KTX2CompressionSettings = {
    format: KTX2TranscoderFormat.ETC1S, // Changed from UASTC to ETC1S for better compression ratios
    quality: 128, // Middle quality for ETC1S
    generateMipmaps: true, // Enable mipmaps for WebGL compatibility
    useZstandard: true,
    oetf: 'srgb',
    flipY: true, // Critical: Default to true for GLB compatibility
    basisParams: {
      qualityLevel: 128, // Middle quality for ETC1S
      checkForAlpha: true,
      perceptual: true,
      normalMap: false,
      generateMipmaps: true, // Ensure mipmaps are generated
      mipmapFilter: 'kaiser', // Use Kaiser filter for better quality
      mipSrgb: true // Properly handle sRGB color space in mipmaps
    }
  };

  // Merge user settings with defaults
  const finalSettings: KTX2CompressionSettings = {
    ...defaultSettings,
    ...compressionSettings,
    basisParams: {
      ...defaultSettings.basisParams,
      ...compressionSettings.basisParams
    }
  };

  console.log("Final compression settings:", {
    format: finalSettings.format,
    quality: finalSettings.quality,
    flipY: finalSettings.flipY,
    generateMipmaps: finalSettings.generateMipmaps
  });
  
  try {
    // Import gltf-transform dependencies
    const { NodeIO } = await import("@gltf-transform/core");
    const { 
      KHRTextureBasisu,
      KHRTextureTransform,
      KHRMaterialsPBRSpecularGlossiness,
      KHRMaterialsUnlit,
      KHRMaterialsEmissiveStrength,
      KHRMaterialsIOR,
      KHRMaterialsTransmission,
      KHRMaterialsSpecular,
      KHRMaterialsSheen,
      KHRMaterialsClearcoat,
      KHRMaterialsIridescence,
      KHRMaterialsAnisotropy,
      KHRMaterialsVolume,
      KHRMaterialsVariants,
      EXTTextureWebP,
      EXTTextureAVIF
    } = await import("@gltf-transform/extensions");
    
    // Use only texture-related extensions, explicitly excluding mesh compression extensions
    const textureOnlyExtensions = [
      KHRTextureBasisu,
      KHRTextureTransform,
      KHRMaterialsPBRSpecularGlossiness,
      KHRMaterialsUnlit,
      KHRMaterialsEmissiveStrength,
      KHRMaterialsIOR,
      KHRMaterialsTransmission,
      KHRMaterialsSpecular,
      KHRMaterialsSheen,
      KHRMaterialsClearcoat,
      KHRMaterialsIridescence,
      KHRMaterialsAnisotropy,
      KHRMaterialsVolume,
      KHRMaterialsVariants,
      EXTTextureWebP,
      EXTTextureAVIF
    ];
    
    const io = new NodeIO()
      .registerExtensions(textureOnlyExtensions);

    // Convert ArrayBuffer to Uint8Array before reading
    const uint8Input = new Uint8Array(inputBuffer);

    // Read the glTF/glb data from the ArrayBuffer - this may still have Draco data but we'll ignore it
    let document;
    try {
      document = await io.readBinary(uint8Input);
    } catch (error) {
      console.log("Texture-only compression: Failed to read GLB with texture extensions, trying minimal loader...");
      // Fallback to minimal NodeIO without any extensions if Draco conflicts persist
      const minimalIO = new NodeIO();
      document = await minimalIO.readBinary(uint8Input);
    }
    
    console.log("GLB document loaded successfully");
    console.log("Number of textures before compression:", document.getRoot().listTextures().length);

    const textures = document.getRoot().listTextures();
    let processedCount = 0;
    const errors: string[] = [];
    
    // Helper function to detect normal maps by texture name
    const isNormalMap = (textureName: string): boolean => {
      const normalMapKeywords = ['normal', 'norm', 'nrm'];
      const lowerName = textureName.toLowerCase();
      return normalMapKeywords.some(keyword => lowerName.includes(keyword));
    };
    
    // Check for existing KTX2 compression
    for (const texture of textures) {
      if (texture.getMimeType() === 'image/ktx2') {
        console.log(`Texture ${texture.getName()} is already KTX2 compressed - skipping`);
        continue;
      }

      try {
        // Get the image data
        const image = texture.getImage();
        if (!image) {
          console.log(`No image data found for texture ${texture.getName()} - skipping`);
          continue;
        }

        const textureName = texture.getName() || `texture_${processedCount}`;
        console.log(`Processing texture ${processedCount + 1}: ${textureName}`);

        // Detect if this is a normal map and adjust format accordingly
        const isNormal = isNormalMap(textureName);
        const textureFormat = finalSettings.forceFormat 
          ? finalSettings.format // Force the specified format for all textures
          : (isNormal ? KTX2TranscoderFormat.UASTC_4x4 : finalSettings.format); // Auto-detect format
        
        const formatReason = finalSettings.forceFormat 
          ? 'forced format' 
          : (isNormal ? 'normal map auto-detection' : 'default format');
        console.log(`  Detected as ${isNormal ? 'normal map' : 'regular texture'}, using ${textureFormat} format (${formatReason})`);

        // Create texture-specific compression settings
        const textureSettings: KTX2CompressionSettings = {
          ...finalSettings,
          format: textureFormat,
          basisParams: {
            ...finalSettings.basisParams,
            normalMap: isNormal,
            // Use format-specific settings unless forced
            ...(finalSettings.forceFormat ? {
              // When forcing format, use the format's default settings
              uastc: textureFormat === KTX2TranscoderFormat.UASTC_4x4
            } : {
              // Auto-detect: Use UASTC settings for normal maps, ETC1S for others
              ...(isNormal && textureFormat === KTX2TranscoderFormat.UASTC_4x4 ? {
                uastc: true,
                rdo_uastc: true,
                rdo_uastc_quality_scalar: 3
              } : {
                uastc: textureFormat === KTX2TranscoderFormat.UASTC_4x4
              })
            })
          }
        };

        // Compress the image data to KTX2 using internal function to bypass queue
        const compressionResult = await compressImageToKTX2Internal(image.buffer as ArrayBuffer, textureSettings);

        // Update the texture with compressed data
        texture.setImage(new Uint8Array(compressionResult.buffer));
        texture.setMimeType('image/ktx2');
        
        console.log(`Successfully compressed texture ${textureName} to KTX2`);
        console.log(`  Original size: ${image.byteLength} bytes`);
        console.log(`  Compressed size: ${compressionResult.compressedSize} bytes`);
        console.log(`  Compression ratio: ${compressionResult.compressionRatio.toFixed(2)}%`);
        console.log(`  Format used: ${textureFormat}`);
        
        processedCount++;
      } catch (error) {
        const errorMsg = `Failed to compress texture ${texture.getName()}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        // Continue with other textures even if one fails
      }
    }
    
    console.log(`GLB texture compression completed. Processed ${processedCount}/${textures.length} textures.`);

    // Serialize the texture-compressed glTF back to an ArrayBuffer
    const compressedArrayBuffer = (await io.writeBinary(document)) as unknown as ArrayBuffer;

    console.log("GLB texture compression complete!");
    console.log(`Original size: ${inputBuffer.byteLength} bytes`);
    console.log(`Compressed size: ${compressedArrayBuffer.byteLength} bytes`);
    const compressionRatio = ((inputBuffer.byteLength - compressedArrayBuffer.byteLength) / inputBuffer.byteLength * 100);
    console.log(`Overall compression ratio: ${compressionRatio.toFixed(2)}%`);

    return {
      buffer: compressedArrayBuffer,
      originalSize: inputBuffer.byteLength,
      compressedSize: compressedArrayBuffer.byteLength,
      compressionRatio: compressionRatio,
      format: finalSettings.format || 'ETC1S',
      texturesProcessed: processedCount,
      errors: errors.length > 0 ? errors : []
    };
    
  } catch (error) {
    console.error("GLB texture compression failed:", error);
    throw new Error(`GLB texture compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}