import { createCanvas, loadImage } from 'canvas';
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
  customBasisParams?: Partial<BasisParams>; // Legacy support
}

// KTX module will be loaded dynamically
let ktx: any = null;
let ktxInitialized = false;

// Initialize KTX module using local files with simple Function approach
async function initKtxModule(): Promise<void> {
  if (ktxInitialized && ktx) return;

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
    console.error("KTX2: Failed to initialize KTX module:", error);
    throw new Error(`KTX2 module initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  generateMipmaps: false,
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
  generateMipmaps: false,
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

export async function compressImageToKTX2(
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

  try {
    // Convert ArrayBuffer to Buffer for canvas operations
    const imageBuffer = Buffer.from(imageArrayBuffer);
    
    // Load the image using canvas (supports PNG, JPG, JPEG, etc.)
    const image = await loadImage(imageBuffer);
    console.log(`KTX2: Image loaded - ${image.width}x${image.height}`);
    
    // Ensure dimensions are divisible by 4 for block compression
    const width = Math.floor(image.width / 4) * 4;
    const height = Math.floor(image.height / 4) * 4;
    console.log(`KTX2: Adjusted dimensions - ${width}x${height}`);
    
    // Create canvas and get image data
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
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
    
    const imageData = ctx.getImageData(0, 0, width, height);
    console.log(`KTX2: Image data extracted - ${imageData.data.length} bytes`);

    // Create KTX texture
    console.log("KTX2: Creating textureCreateInfo...");
    const createInfo = new ktx.textureCreateInfo();
    
    // Set Vulkan format based on OETF setting
    if (compressionSettings.oetf === 'srgb') {
      createInfo.vkFormat = ktx.VkFormat.R8G8B8A8_SRGB;
      console.log("KTX2: Using VK_FORMAT_R8G8B8A8_SRGB for sRGB input");
    } else {
      createInfo.vkFormat = ktx.VkFormat.R8G8B8A8_UNORM;
      console.log("KTX2: Using VK_FORMAT_R8G8B8A8_UNORM for linear input");
    }
    
    createInfo.baseWidth = width;
    createInfo.baseHeight = height;
    createInfo.baseDepth = 1;
    createInfo.numDimensions = 2;
    createInfo.numLevels = 1;
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
    const setImageResult = ktxTextureInstance.setImageFromMemory(0, 0, 0, imageData.data);
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
    console.log(`KTX2: Perceptual: ${basisParams.perceptual ? 'enabled' : 'disabled'}`);

    // Compress to Basis Universal
    console.log("KTX2: Compressing to Basis Universal...");
    const compressResult = ktxTextureInstance.compressBasis(basisParams);
    if (compressResult !== ktx.ErrorCode.SUCCESS) {
      throw new Error(`Failed to compress KTX texture to Basis Universal. Error code: ${compressResult}`);
    }
    console.log("KTX2: Basis Universal compression successful");

    // Get KTX2 data
    console.log("KTX2: Writing KTX2 data to memory...");
    const ktx2FileBytes = ktxTextureInstance.writeToMemory();
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
    // Clean up KTX objects
    if (ktxTextureInstance) {
      console.log("KTX2: Deleting KTX texture object");
      ktxTextureInstance.delete();
    }
    if (basisParams) {
      console.log("KTX2: Deleting Basis parameters object");
      basisParams.delete();
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
  
  // Default settings for GLB compression with ETC1S as default and flipY enabled
  const defaultSettings: KTX2CompressionSettings = {
    format: KTX2TranscoderFormat.ETC1S, // Changed from UASTC to ETC1S for better compression ratios
    quality: 128, // Middle quality for ETC1S
    generateMipmaps: false,
    useZstandard: true,
    oetf: 'srgb',
    flipY: true, // Critical: Default to true for GLB compatibility
    basisParams: {
      qualityLevel: 128, // Middle quality for ETC1S
      checkForAlpha: true,
      perceptual: true,
      normalMap: false
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
    const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
    
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS);

    // Convert ArrayBuffer to Uint8Array before reading
    const uint8Input = new Uint8Array(inputBuffer);

    // Read the glTF/glb data from the ArrayBuffer
    const document = await io.readBinary(uint8Input);
    
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
        const textureFormat = isNormal ? KTX2TranscoderFormat.UASTC_4x4 : finalSettings.format;
        
        console.log(`  Detected as ${isNormal ? 'normal map' : 'regular texture'}, using ${textureFormat} format`);

        // Create texture-specific compression settings
        const textureSettings: KTX2CompressionSettings = {
          ...finalSettings,
          format: textureFormat,
          basisParams: {
            ...finalSettings.basisParams,
            normalMap: isNormal,
            // Use UASTC settings for normal maps
            ...(isNormal ? {
              uastc: true,
              rdo_uastc: true,
              rdo_uastc_quality_scalar: 3
            } : {
              uastc: false
            })
          }
        };

        // Compress the image data to KTX2
        const compressionResult = await compressImageToKTX2(image.buffer as ArrayBuffer, textureSettings);

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