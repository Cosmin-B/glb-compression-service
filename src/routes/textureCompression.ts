// src/routes/textureCompression.ts
/**
 * Texture compression routes for PNG to KTX2 conversion
 */

import { Hono } from 'hono';
import { compressPNGToKTX2, compressImageToKTX2, compressGLBTexturesKTX2, KTX2TranscoderFormat, KTX2CompressionSettings } from '../compression/ktx2TextureCompression.js';
import type { BasisParams } from '../compression/ktx2TextureCompression.js';

const textureRoutes = new Hono();

/**
 * Helper functions for parameter validation and FormData handling
 */

// Helper function to validate Content-Type header for FormData endpoints
const validateContentType = (contentType: string | undefined, allowedTypes: string[]): void => {
  if (!contentType) {
    throw new Error(`Missing Content-Type header. Expected one of: ${allowedTypes.join(', ')}`);
  }

  const normalizedContentType = contentType.toLowerCase();
  const isValidType = allowedTypes.some(type => normalizedContentType.includes(type.toLowerCase()));

  if (!isValidType) {
    throw new Error(`Content-Type was not one of '${allowedTypes.join('\' or \'')}'. Received: ${contentType}`);
  }
};

// Helper function to validate File object before processing
const validateFileObject = (file: any, fieldName: string): File => {
  if (!file) {
    throw new Error(`No ${fieldName} file provided in form data. Include file as '${fieldName}' field in multipart form data.`);
  }

  if (!(file instanceof File)) {
    throw new Error(`Invalid ${fieldName} field type. Expected File object, got: ${typeof file}. Ensure you're sending multipart/form-data with a proper file field.`);
  }

  if (file.size === 0) {
    throw new Error(`Empty ${fieldName} file provided. File size is 0 bytes.`);
  }

  if (!file.name) {
    throw new Error(`Invalid ${fieldName} file: missing filename.`);
  }

  // Check if arrayBuffer method is available
  if (typeof file.arrayBuffer !== 'function') {
    throw new Error(`Invalid ${fieldName} file object: arrayBuffer method not available. This may indicate a corrupted File object or incompatible client.`);
  }

  return file;
};

// Helper function to provide troubleshooting guidance based on error patterns
const getTroubleshootingTips = (error: Error): string[] => {
  const errorMsg = error.message.toLowerCase();
  const tips: string[] = [];

  if (errorMsg.includes('content-type')) {
    tips.push("Ensure your HTTP client sends Content-Type: multipart/form-data header");
    tips.push("Check that your form is properly configured to send multipart data");
  }

  if (errorMsg.includes('no') && errorMsg.includes('file')) {
    tips.push("Verify the file field name matches the expected field ('image' for image endpoints, 'glb' for GLB endpoint)");
    tips.push("Ensure the file is properly attached to the form data");
  }

  if (errorMsg.includes('arrayBuffer')) {
    tips.push("The file may be corrupted or the client connection was interrupted");
    tips.push("Try uploading a smaller file or check your network connection");
  }

  if (errorMsg.includes('basisparams')) {
    tips.push("Ensure basisParams is sent as a valid JSON string, not an object");
    tips.push("Example: basisParams='{\"qualityLevel\": 128, \"generateMipmaps\": true}'");
  }

  if (tips.length === 0) {
    tips.push("Check the server logs for more detailed error information");
    tips.push("Verify your file is not corrupted and is of the expected format");
  }

  return tips;
};

// Helper function to validate format parameter and convert to enum
const validateFormat = (format: string): KTX2TranscoderFormat => {
  if (format === 'ETC1S') {
    return KTX2TranscoderFormat.ETC1S;
  } else if (format === 'UASTC') {
    return KTX2TranscoderFormat.UASTC_4x4;
  }
  throw new Error(`Invalid format: ${format}. Must be 'ETC1S' or 'UASTC'`);
};

// Helper function to validate flipY parameter
const validateFlipY = (flipY: string): boolean => {
  if (flipY === 'true') return true;
  if (flipY === 'false') return false;
  throw new Error(`Invalid flipY: ${flipY}. Must be 'true' or 'false'`);
};

// Helper function to validate and parse basisParams
const validateAndParseBasisParams = (basisParams: any): Partial<BasisParams> => {
  try {
    let parsed;

    // Handle different input types
    if (typeof basisParams === 'string') {
      // Check for common FormData conversion issues
      if (basisParams === '[object Object]') {
        throw new Error('basisParams was sent as an object but converted to "[object Object]" string. Please send basisParams as a JSON string instead. Example: {"rdo_uastc_quality_scalar": 2, "generateMipmaps": true}');
      }

      // Try to parse JSON string
      try {
        parsed = JSON.parse(basisParams);
      } catch (parseError) {
        throw new Error(`Failed to parse basisParams JSON string: ${parseError instanceof Error ? parseError.message : 'Invalid JSON format'}`);
      }
    } else if (typeof basisParams === 'object' && basisParams !== null) {
      // Already an object, use directly
      parsed = basisParams;
    } else {
      throw new Error(`Invalid basisParams type: ${typeof basisParams}. Expected JSON string or object.`);
    }

    // Validate that result is an object
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('basisParams must be a valid JSON object');
    }

    // Define valid BasisParams keys for validation
    const validKeys = new Set([
      'uastc', 'verbose', 'generateMipmaps', 'mipmapFilter', 'perceptual', 'zstdLevel',
      'qualityLevel', 'maxEndpoints', 'maxSelectors', 'endpointRDOThreshold', 'selectorRDOThreshold',
      'rdo_uastc', 'rdo_uastc_quality_scalar', 'rdo_uastc_dict_size', 'rdo_uastc_max_smooth_block_error_scale',
      'rdo_uastc_smooth_block_max_std_dev', 'rdo_uastc_max_allowed_rms_increase_ratio', 'rdo_uastc_skip_block_rms_thresh',
      'mipSrgb', 'normalMap', 'separateRGToRGB_A', 'checkForAlpha', 'forceAlpha', 'renormalize',
      'resample', 'resampleWidth', 'resampleHeight', 'resampleFactor'
    ]);

    // Validate that all keys are recognized BasisParams properties
    const invalidKeys = Object.keys(parsed).filter(key => !validKeys.has(key));
    if (invalidKeys.length > 0) {
      console.warn(`API: Warning - Unknown basisParams keys: ${invalidKeys.join(', ')}`);
      console.warn(`API: Valid keys are: ${Array.from(validKeys).join(', ')}`);
    }

    // Optional: Log the successfully parsed parameters for debugging
    console.log("API: Successfully parsed basisParams:", JSON.stringify(parsed, null, 2));

    return parsed;
  } catch (error) {
    // Provide helpful error message with examples
    const errorMsg = error instanceof Error ? error.message : 'Unknown parsing error';
    throw new Error(`Invalid basisParams: ${errorMsg}. Expected format: JSON string like '{"rdo_uastc_quality_scalar": 2, "generateMipmaps": true}' or valid object.`);
  }
};

/**
 * Verify input type and log details
 */
const verifyInputType = (arrayBuffer: ArrayBuffer, expectedType: string): void => {
  console.log(`API: ${expectedType} input type verification:`);
  console.log(`API: - Type: ${typeof arrayBuffer}`);
  console.log(`API: - Is ArrayBuffer: ${arrayBuffer instanceof ArrayBuffer}`);
  console.log(`API: - Constructor name: ${arrayBuffer.constructor.name}`);
  console.log(`API: - Size: ${arrayBuffer.byteLength} bytes`);
};


/**
 * POST /texture/png-to-ktx2 - Convert PNG to KTX2 format (Enhanced with optional custom settings)
 */
textureRoutes.post('/png-to-ktx2', async (c) => {
  console.log("API: Starting PNG to KTX2 compression endpoint");

  try {
    // Validate Content-Type header first
    const contentType = c.req.header('content-type');
    validateContentType(contentType, ['multipart/form-data', 'application/x-www-form-urlencoded']);

    // Parse multipart form data to get the image file and optional settings
    const formData = await c.req.formData();
    const imageFileRaw = formData.get('image');
    const formatParam = formData.get('format') as string;
    const basisParamsParam = formData.get('basisParams') as string;

    // Log FormData contents for debugging
    console.log("API: PNG endpoint FormData contents:");
    console.log("API: - image file type:", typeof imageFileRaw, "instance:", imageFileRaw?.constructor?.name);
    console.log("API: - format:", formatParam);
    console.log("API: - basisParams type:", typeof basisParamsParam, "value:", basisParamsParam);

    // Validate file object before processing
    const imageFile = validateFileObject(imageFileRaw, 'image');

    console.log(`API: Received valid file: ${imageFile.name}, Size: ${imageFile.size}, Type: ${imageFile.type}`);

    // Convert File to ArrayBuffer with error handling
    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await imageFile.arrayBuffer();
    } catch (error) {
      throw new Error(`Failed to read image file: ${error instanceof Error ? error.message : 'Unknown error'}. The file may be corrupted or too large.`);
    }
    verifyInputType(arrayBuffer, "PNG");
    
    console.log(`API: Received PNG data, Size: ${arrayBuffer.byteLength}`);
    
    // Check if it looks like a PNG file
    const header = new Uint8Array(arrayBuffer.slice(0, 8));
    const isPNG = header[0] === 0x89 && 
                  header[1] === 0x50 && 
                  header[2] === 0x4E && 
                  header[3] === 0x47;
    
    if (!isPNG) {
      console.log("API: Warning - Input doesn't appear to be a PNG file");
    } else {
      console.log("API: Confirmed PNG file format");
    }
    
    console.log("API: Starting PNG to KTX2 conversion...");
    
    // Start with default settings (enhanced with new format support)
    const compressionSettings: KTX2CompressionSettings = {
      format: KTX2TranscoderFormat.ETC1S,  // Use new format enum
      basisUniversalMode: 'ETC1S',  // Keep for backward compatibility
      quality: 128,                 // Use proper default quality (128 matches DEFAULT_ETC1S_BASIS_PARAMS)
      oetf: 'srgb',                // Original oetf setting for color textures
      generateMipmaps: true,        // Original mipmap setting
      useZstandard: true,           // Original zstandard setting
      // Explicitly set default basis params to ensure proper mipmap generation
      basisParams: {
        uastc: false,
        verbose: true,
        generateMipmaps: true,
        mipmapFilter: 'kaiser',
        perceptual: true,
        qualityLevel: 128,
        zstdLevel: 3,
        checkForAlpha: true,
        normalMap: false,
        maxEndpoints: 16128,
        maxSelectors: 16128
      }
    };
    
    // Override format if provided
    if (formatParam) {
      const newFormat = validateFormat(formatParam);
      compressionSettings.format = newFormat;
      compressionSettings.basisUniversalMode = newFormat === KTX2TranscoderFormat.UASTC_4x4 ? 'UASTC' : 'ETC1S';
      console.log(`API: Using custom format: ${newFormat} (legacy: ${compressionSettings.basisUniversalMode})`);
    }

    // Parse and validate custom basis parameters if provided
    if (basisParamsParam) {
      try {
        const validatedParams = validateAndParseBasisParams(basisParamsParam);
        compressionSettings.basisParams = validatedParams;
        // Keep legacy support
        compressionSettings.customBasisParams = validatedParams;
        console.log("API: Using custom basis parameters:", JSON.stringify(compressionSettings.basisParams, null, 2));
      } catch (error) {
        console.error("API: basisParams parsing error:", error);
        throw error; // Re-throw the detailed error from validateAndParseBasisParams
      }
    }

    // Compress PNG to KTX2 using enhanced settings
    const compressionResult = await compressPNGToKTX2(arrayBuffer, compressionSettings);
    
    console.log("API: PNG to KTX2 conversion completed");
    console.log("API: Original size:", compressionResult.originalSize);
    console.log("API: Compressed size:", compressionResult.compressedSize);
    console.log("API: Compression ratio:", compressionResult.compressionRatio.toFixed(2) + "%");
    console.log("API: Compression savings:", (compressionResult.originalSize - compressionResult.compressedSize), "bytes");
    
    // Return compressed KTX2 data with enhanced headers
    return new Response(compressionResult.buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': compressionResult.compressedSize.toString(),
        'Access-Control-Allow-Origin': '*',
        'X-Original-Size': compressionResult.originalSize.toString(),
        'X-Compressed-Size': compressionResult.compressedSize.toString(),
        'X-Compression-Ratio': compressionResult.compressionRatio.toFixed(2) + '%',
        'X-Compression-Savings': (compressionResult.originalSize - compressionResult.compressedSize).toString(),
        'X-Output-Format': 'KTX2',
        'X-Basis-Mode': compressionSettings.basisUniversalMode || 'ETC1S',
        'X-Format': compressionSettings.format || 'ETC1S',
        'X-Quality': compressionSettings.quality?.toString() || '100',
        'X-Generate-Mipmaps': compressionSettings.generateMipmaps?.toString() || 'true',
        'X-Use-Zstandard': compressionSettings.useZstandard?.toString() || 'true',
        'X-OETF': compressionSettings.oetf || 'srgb',
        'X-Custom-Basis-Params': (compressionSettings.basisParams || compressionSettings.customBasisParams) ? 'true' : 'false'
      },
    });
    
  } catch (error) {
    console.error("API: PNG to KTX2 compression failed:", error);
    console.error("API: Error details:", error instanceof Error ? error.stack : "Unknown error type");

    // Determine appropriate HTTP status code based on error type
    let statusCode = 500;
    let errorCategory = "Internal Server Error";

    if (error instanceof Error) {
      const errorMsg = error.message.toLowerCase();
      if (errorMsg.includes('content-type') || errorMsg.includes('multipart/form-data')) {
        statusCode = 400;
        errorCategory = "Bad Request - Invalid Content-Type";
      } else if (errorMsg.includes('no image file') || errorMsg.includes('invalid image field') || errorMsg.includes('empty image file')) {
        statusCode = 400;
        errorCategory = "Bad Request - Missing or Invalid File";
      } else if (errorMsg.includes('basisparams') || errorMsg.includes('format') || errorMsg.includes('flipy')) {
        statusCode = 400;
        errorCategory = "Bad Request - Invalid Parameters";
      } else if (errorMsg.includes('arrayBuffer') || errorMsg.includes('corrupted') || errorMsg.includes('too large')) {
        statusCode = 422;
        errorCategory = "Unprocessable Entity - File Processing Error";
      }
    }

    return c.json(
      {
        message: "PNG to KTX2 compression failed",
        category: errorCategory,
        error: error instanceof Error ? error.message : "Unknown error",
        details: {
          endpoint: "/texture/png-to-ktx2",
          expectedContentType: "multipart/form-data",
          requiredFields: ["image (File)"],
          optionalFields: ["format (string: 'ETC1S' or 'UASTC')", "basisParams (JSON string)"],
          exampleUsage: "Send multipart form with 'image' file field and optional 'format' and 'basisParams' fields"
        },
        troubleshooting: getTroubleshootingTips(error instanceof Error ? error : new Error(String(error))),
        timestamp: new Date().toISOString()
      },
      statusCode as 400 | 422 | 500
    );
  }
});

/**
 * POST /texture/image-to-ktx2 - Enhanced image to KTX2 conversion with customizable settings
 */
textureRoutes.post('/image-to-ktx2', async (c) => {
  console.log("API: Starting enhanced image to KTX2 compression endpoint");

  try {
    // Validate Content-Type header first
    const contentType = c.req.header('content-type');
    validateContentType(contentType, ['multipart/form-data', 'application/x-www-form-urlencoded']);

    // Parse multipart form data to get the image file and settings
    const formData = await c.req.formData();
    const imageFileRaw = formData.get('image');
    const formatParam = formData.get('format') as string;
    const basisParamsParam = formData.get('basisParams') as string;

    // Log FormData contents for debugging
    console.log("API: Image endpoint FormData contents:");
    console.log("API: - image file type:", typeof imageFileRaw, "instance:", imageFileRaw?.constructor?.name);
    console.log("API: - format:", formatParam);
    console.log("API: - basisParams type:", typeof basisParamsParam, "value:", basisParamsParam);

    // Validate file object before processing
    const imageFile = validateFileObject(imageFileRaw, 'image');

    console.log(`API: Received valid file: ${imageFile.name}, Size: ${imageFile.size}, Type: ${imageFile.type}`);

    // Convert File to ArrayBuffer with error handling
    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await imageFile.arrayBuffer();
    } catch (error) {
      throw new Error(`Failed to read image file: ${error instanceof Error ? error.message : 'Unknown error'}. The file may be corrupted or too large.`);
    }
    verifyInputType(arrayBuffer, "IMAGE");
    
    console.log(`API: Received image data, Size: ${arrayBuffer.byteLength}`);
    
    // Validate and prepare enhanced compression settings
    const compressionSettings: KTX2CompressionSettings = {
      // Default settings (same as original png-to-ktx2 endpoint)
      format: KTX2TranscoderFormat.ETC1S,
      basisUniversalMode: 'ETC1S',
      quality: 100,
      oetf: 'srgb',
      generateMipmaps: true,
      useZstandard: true
    };
    
    // Override format if provided
    if (formatParam) {
      const newFormat = validateFormat(formatParam);
      compressionSettings.format = newFormat;
      compressionSettings.basisUniversalMode = newFormat === KTX2TranscoderFormat.UASTC_4x4 ? 'UASTC' : 'ETC1S';
      console.log(`API: Using custom format: ${newFormat} (legacy: ${compressionSettings.basisUniversalMode})`);
    }
    // Parse and validate custom basis parameters if provided
    if (basisParamsParam) {
      try {
        const validatedParams = validateAndParseBasisParams(basisParamsParam);
        compressionSettings.basisParams = validatedParams;
        // Keep legacy support
        compressionSettings.customBasisParams = validatedParams;
        console.log("API: Using custom basis parameters:", JSON.stringify(compressionSettings.basisParams, null, 2));
      } catch (error) {
        console.error("API: basisParams parsing error:", error);
        throw error; // Re-throw the detailed error from validateAndParseBasisParams
      }
    }

    console.log("API: Starting enhanced image to KTX2 conversion...");
    
    // Compress image to KTX2 with custom settings
    const compressionResult = await compressImageToKTX2(arrayBuffer, compressionSettings);
    
    console.log("API: Enhanced image to KTX2 conversion completed");
    console.log("API: Original size:", compressionResult.originalSize);
    console.log("API: Compressed size:", compressionResult.compressedSize);
    console.log("API: Compression ratio:", compressionResult.compressionRatio.toFixed(2) + "%");
    console.log("API: Compression savings:", (compressionResult.originalSize - compressionResult.compressedSize), "bytes");
    
    // Return compressed KTX2 data with enhanced headers
    return new Response(compressionResult.buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': compressionResult.compressedSize.toString(),
        'Access-Control-Allow-Origin': '*',
        'X-Original-Size': compressionResult.originalSize.toString(),
        'X-Compressed-Size': compressionResult.compressedSize.toString(),
        'X-Compression-Ratio': compressionResult.compressionRatio.toFixed(2) + '%',
        'X-Compression-Savings': (compressionResult.originalSize - compressionResult.compressedSize).toString(),
        'X-Output-Format': 'KTX2',
        'X-Basis-Mode': compressionSettings.basisUniversalMode || 'ETC1S',
        'X-Format': compressionSettings.format || 'ETC1S',
        'X-Quality': compressionSettings.quality?.toString() || '100',
        'X-Generate-Mipmaps': compressionSettings.generateMipmaps?.toString() || 'true',
        'X-Use-Zstandard': compressionSettings.useZstandard?.toString() || 'true',
        'X-OETF': compressionSettings.oetf || 'srgb',
        'X-Custom-Basis-Params': (compressionSettings.basisParams || compressionSettings.customBasisParams) ? 'true' : 'false'
      },
    });
    
  } catch (error) {
    console.error("API: Enhanced image to KTX2 compression failed:", error);
    console.error("API: Error details:", error instanceof Error ? error.stack : "Unknown error type");

    // Determine appropriate HTTP status code based on error type
    let statusCode = 500;
    let errorCategory = "Internal Server Error";

    if (error instanceof Error) {
      const errorMsg = error.message.toLowerCase();
      if (errorMsg.includes('content-type') || errorMsg.includes('multipart/form-data')) {
        statusCode = 400;
        errorCategory = "Bad Request - Invalid Content-Type";
      } else if (errorMsg.includes('no image file') || errorMsg.includes('invalid image field') || errorMsg.includes('empty image file')) {
        statusCode = 400;
        errorCategory = "Bad Request - Missing or Invalid File";
      } else if (errorMsg.includes('basisparams') || errorMsg.includes('format') || errorMsg.includes('flipy')) {
        statusCode = 400;
        errorCategory = "Bad Request - Invalid Parameters";
      } else if (errorMsg.includes('arrayBuffer') || errorMsg.includes('corrupted') || errorMsg.includes('too large')) {
        statusCode = 422;
        errorCategory = "Unprocessable Entity - File Processing Error";
      }
    }

    return c.json(
      {
        message: "Enhanced image to KTX2 compression failed",
        category: errorCategory,
        error: error instanceof Error ? error.message : "Unknown error",
        details: {
          endpoint: "/texture/image-to-ktx2",
          expectedContentType: "multipart/form-data",
          requiredFields: ["image (File)"],
          optionalFields: ["format (string: 'ETC1S' or 'UASTC')", "basisParams (JSON string)"],
          exampleUsage: "Send multipart form with 'image' file field and optional 'format' and 'basisParams' fields",
          supportedImageTypes: ["PNG", "JPG", "JPEG", "WebP", "BMP", "TIFF"]
        },
        troubleshooting: getTroubleshootingTips(error instanceof Error ? error : new Error(String(error))),
        timestamp: new Date().toISOString()
      },
      statusCode as 400 | 422 | 500
    );
  }
});

/**
 * POST /texture/glb-textures - Enhanced GLB texture compression with KTX2
 * Accepts either:
 * 1. Raw binary GLB data (application/octet-stream) - for backward compatibility
 * 2. Multipart form data with optional parameters:
 *    - glb: GLB file (required)
 *    - format: "ETC1S" or "UASTC" (optional, default: "ETC1S")
 *    - flipY: boolean (optional, default: true)
 *    - basisParams: JSON object with compression settings (optional)
 */
textureRoutes.post('/glb-textures', async (c) => {
  console.log("API: Starting enhanced GLB texture compression endpoint");
  
  try {
    const contentType = c.req.header('content-type') || '';
    let arrayBuffer: ArrayBuffer;
    let format = KTX2TranscoderFormat.ETC1S; // Default format for better compression
    let flipY = true; // Default flipY for GLB compatibility
    let basisParams: any = undefined;

    // Log the incoming content type for debugging
    console.log("API: GLB endpoint Content-Type:", contentType);

    if (contentType.includes('multipart/form-data')) {
      // New multipart form data handling
      console.log("API: Processing multipart form data");

      const formData = await c.req.formData();
      const glbFileRaw = formData.get('glb');

      // Extract optional parameters
      const formatParam = formData.get('format') as string;
      const flipYParam = formData.get('flipY') as string;
      const basisParamsParam = formData.get('basisParams') as string;

      // Log FormData contents for debugging
      console.log("API: GLB endpoint FormData contents:");
      console.log("API: - glb file type:", typeof glbFileRaw, "instance:", glbFileRaw?.constructor?.name);
      console.log("API: - format:", formatParam);
      console.log("API: - flipY:", flipYParam);
      console.log("API: - basisParams type:", typeof basisParamsParam, "value:", basisParamsParam);

      // Validate file object before processing
      const glbFile = validateFileObject(glbFileRaw, 'glb');

      // Validate and set format
      if (formatParam) {
        format = validateFormat(formatParam);
      }

      // Validate and set flipY
      if (flipYParam) {
        flipY = validateFlipY(flipYParam);
      }

      // Validate and set basisParams
      if (basisParamsParam) {
        try {
          basisParams = validateAndParseBasisParams(basisParamsParam);
        } catch (error) {
          console.error("API: GLB basisParams parsing error:", error);
          throw error; // Re-throw the detailed error from validateAndParseBasisParams
        }
      }

      // Convert File to ArrayBuffer with error handling
      try {
        arrayBuffer = await glbFile.arrayBuffer();
      } catch (error) {
        throw new Error(`Failed to read GLB file: ${error instanceof Error ? error.message : 'Unknown error'}. The file may be corrupted or too large.`);
      }
      console.log(`API: Received GLB file: ${glbFile.name}, Size: ${glbFile.size}`);
      console.log(`API: Parameters - Format: ${format}, FlipY: ${flipY}, BasisParams: ${basisParamsParam ? 'provided' : 'default'}`);
      
    } else if (contentType.includes('application/octet-stream') || contentType.includes('application/binary') || contentType === '') {
      // Legacy binary data handling for backward compatibility
      console.log("API: Processing raw binary data (legacy mode)");
      try {
        arrayBuffer = await c.req.arrayBuffer();
      } catch (error) {
        throw new Error(`Failed to read binary GLB data: ${error instanceof Error ? error.message : 'Unknown error'}. The request body may be corrupted or too large.`);
      }
    } else {
      // Invalid content type
      throw new Error(`Unsupported Content-Type for GLB endpoint: ${contentType}. Supported types: 'multipart/form-data' (for file upload with options) or 'application/octet-stream' (for raw binary data).`);
    }
    
    verifyInputType(arrayBuffer, "GLB");
    console.log(`API: Received GLB data, Size: ${arrayBuffer.byteLength}`);
    
    // Check if it looks like a GLB file
    const header = new Uint8Array(arrayBuffer.slice(0, 4));
    const isGLB = header[0] === 0x67 && // 'g'
                  header[1] === 0x6C && // 'l'  
                  header[2] === 0x54 && // 'T'
                  header[3] === 0x46;   // 'F'
    
    if (!isGLB) {
      console.log("API: Warning - Input doesn't appear to be a GLB file");
    } else {
      console.log("API: Confirmed GLB file format");
    }
    
    console.log("API: Starting enhanced GLB texture compression...");
    
    // Compress GLB textures with KTX2 using customizable parameters
    const compressionResult = await compressGLBTexturesKTX2(arrayBuffer, {
      format: format,
      flipY: flipY,
      basisParams: basisParams,
      generateMipmaps: true,
      useZstandard: true,
      oetf: 'srgb'
    });
    
    console.log("API: Enhanced GLB texture compression completed");
    console.log("API: Original size:", compressionResult.originalSize);
    console.log("API: Compressed size:", compressionResult.compressedSize);
    console.log("API: Compression ratio:", compressionResult.compressionRatio.toFixed(2) + "%");
    console.log("API: Textures processed:", compressionResult.texturesProcessed);
    
    // Return compressed GLB data
    return new Response(compressionResult.buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': compressionResult.buffer.byteLength.toString(),
        'Access-Control-Allow-Origin': '*',
        'X-Original-Size': compressionResult.originalSize.toString(),
        'X-Compressed-Size': compressionResult.compressedSize.toString(),
        'X-Compression-Ratio': compressionResult.compressionRatio.toFixed(2) + '%',
        'X-Compression-Savings': (compressionResult.originalSize - compressionResult.compressedSize).toString(),
        'X-Textures-Processed': compressionResult.texturesProcessed?.toString() || '0',
        'X-Format': format === KTX2TranscoderFormat.ETC1S ? 'ETC1S' : 'UASTC',
        'X-FlipY': flipY.toString(),
        'X-Custom-Basis-Params': basisParams ? 'true' : 'false',
        'X-Output-Format': 'GLB-with-KTX2'
      },
    });
    
  } catch (error) {
    console.error("API: Enhanced GLB texture compression failed:", error);
    console.error("API: Error details:", error instanceof Error ? error.stack : "Unknown error type");

    // Determine appropriate HTTP status code based on error type
    let statusCode = 500;
    let errorCategory = "Internal Server Error";

    if (error instanceof Error) {
      const errorMsg = error.message.toLowerCase();
      if (errorMsg.includes('content-type') || errorMsg.includes('unsupported content-type')) {
        statusCode = 400;
        errorCategory = "Bad Request - Invalid Content-Type";
      } else if (errorMsg.includes('no glb file') || errorMsg.includes('invalid glb field') || errorMsg.includes('empty glb file')) {
        statusCode = 400;
        errorCategory = "Bad Request - Missing or Invalid File";
      } else if (errorMsg.includes('basisparams') || errorMsg.includes('format') || errorMsg.includes('flipy')) {
        statusCode = 400;
        errorCategory = "Bad Request - Invalid Parameters";
      } else if (errorMsg.includes('arrayBuffer') || errorMsg.includes('corrupted') || errorMsg.includes('too large')) {
        statusCode = 422;
        errorCategory = "Unprocessable Entity - File Processing Error";
      }
    }

    return c.json(
      {
        message: "Enhanced GLB texture compression failed",
        category: errorCategory,
        error: error instanceof Error ? error.message : "Unknown error",
        details: {
          endpoint: "/texture/glb-textures",
          supportedContentTypes: [
            "multipart/form-data (for file upload with options)",
            "application/octet-stream (for raw binary GLB data)"
          ],
          requiredFields: ["glb (File when using multipart, or raw binary data)"],
          optionalFields: [
            "format (string: 'ETC1S' or 'UASTC')",
            "flipY (string: 'true' or 'false')",
            "basisParams (JSON string)"
          ],
          exampleUsage: {
            multipart: "Send multipart form with 'glb' file field and optional parameters",
            binary: "Send raw GLB binary data with Content-Type: application/octet-stream"
          }
        },
        troubleshooting: getTroubleshootingTips(error instanceof Error ? error : new Error(String(error))),
        timestamp: new Date().toISOString()
      },
      statusCode as 400 | 422 | 500
    );
  }
});

/**
 * GET /texture/health - Texture compression health check
 */
textureRoutes.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'texture-compression',
    formats: {
      input: ['PNG', 'JPG', 'JPEG', 'WebP', 'GLB'],
      output: ['KTX2', 'GLB-with-KTX2']
    },
    compression: {
      modes: ['ETC1S', 'UASTC'],
      formats: ['ETC1S', 'UASTC_4x4'],
      customizable: true,
      defaultSettings: {
        format: 'ETC1S',
        quality: 100,
        oetf: 'srgb',
        generateMipmaps: true,
        useZstandard: true
      },
      supportedBasisParams: [
        'uastc', 'verbose', 'generateMipmaps', 'mipmapFilter', 'perceptual', 'zstdLevel',
        'qualityLevel', 'maxEndpoints', 'maxSelectors',
        'rdo_uastc', 'rdo_uastc_quality_scalar', 'normalMap', 'checkForAlpha'
      ]
    },
    endpoints: {
      'png-to-ktx2': 'Backward compatible PNG compression (supports optional format & basisParams)',
      'image-to-ktx2': 'Enhanced image compression with full customization',
      'glb-textures': 'GLB texture compression'
    }
  });
});

export default textureRoutes;