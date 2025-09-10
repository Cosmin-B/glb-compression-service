// src/routes/textureCompression.ts
/**
 * Texture compression routes for PNG to KTX2 conversion
 */

import { Hono } from 'hono';
import { compressPNGToKTX2, compressImageToKTX2, compressGLBTexturesKTX2, KTX2TranscoderFormat, KTX2CompressionSettings } from '../compression/ktx2TextureCompression.js';
import type { BasisParams } from '../compression/ktx2TextureCompression.js';

const textureRoutes = new Hono();

/**
 * Helper functions for parameter validation
 */

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
const validateBasisParams = (basisParams: string): any => {
  try {
    const parsed = JSON.parse(basisParams);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('basisParams must be a valid JSON object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid basisParams JSON: ${error instanceof Error ? error.message : 'Unknown parsing error'}`);
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
    // Parse multipart form data to get the image file and optional settings
    const formData = await c.req.formData();
    const imageFile = formData.get('image') as File;
    const formatParam = formData.get('format') as string;
    const basisParamsParam = formData.get('basisParams') as string;
    
    if (!imageFile) {
      throw new Error('No image file provided in form data');
    }
    
    console.log(`API: Received file: ${imageFile.name}, Size: ${imageFile.size}, Type: ${imageFile.type}`);
    
    // Convert File to ArrayBuffer
    const arrayBuffer = await imageFile.arrayBuffer();
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
      quality: 100,                 // Original quality setting 
      oetf: 'srgb',                // Original oetf setting for color textures
      generateMipmaps: true,        // Original mipmap setting
      useZstandard: true            // Original zstandard setting
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
        const parsedBasisParams = JSON.parse(basisParamsParam);
        const validatedParams = validateBasisParams(parsedBasisParams);
        compressionSettings.basisParams = validatedParams;
        // Keep legacy support
        compressionSettings.customBasisParams = validatedParams;
        console.log("API: Using custom basis parameters:", JSON.stringify(compressionSettings.basisParams, null, 2));
      } catch (error) {
        throw new Error(`Invalid basisParams JSON: ${error instanceof Error ? error.message : 'Unknown parsing error'}`);
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
    
    return c.json(
      { 
        message: "PNG to KTX2 compression failed", 
        error: error instanceof Error ? error.message : "Unknown error",
        details: "Optionally use 'format' parameter to specify 'ETC1S' or 'UASTC', and 'basisParams' parameter for custom compression settings as JSON."
      },
      { status: 500 }
    );
  }
});

/**
 * POST /texture/image-to-ktx2 - Enhanced image to KTX2 conversion with customizable settings
 */
textureRoutes.post('/image-to-ktx2', async (c) => {
  console.log("API: Starting enhanced image to KTX2 compression endpoint");
  
  try {
    // Parse multipart form data to get the image file and settings
    const formData = await c.req.formData();
    const imageFile = formData.get('image') as File;
    const formatParam = formData.get('format') as string;
    const basisParamsParam = formData.get('basisParams') as string;
    
    if (!imageFile) {
      throw new Error('No image file provided in form data');
    }
    
    console.log(`API: Received file: ${imageFile.name}, Size: ${imageFile.size}, Type: ${imageFile.type}`);
    
    // Convert File to ArrayBuffer
    const arrayBuffer = await imageFile.arrayBuffer();
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
        const parsedBasisParams = JSON.parse(basisParamsParam);
        const validatedParams = validateBasisParams(parsedBasisParams);
        compressionSettings.basisParams = validatedParams;
        // Keep legacy support
        compressionSettings.customBasisParams = validatedParams;
        console.log("API: Using custom basis parameters:", JSON.stringify(compressionSettings.basisParams, null, 2));
      } catch (error) {
        throw new Error(`Invalid basisParams JSON: ${error instanceof Error ? error.message : 'Unknown parsing error'}`);
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
    
    return c.json(
      { 
        message: "Enhanced image to KTX2 compression failed", 
        error: error instanceof Error ? error.message : "Unknown error",
        details: "Use 'format' parameter to specify 'ETC1S' or 'UASTC', and 'basisParams' parameter for custom compression settings as JSON."
      },
      { status: 500 }
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
    
    if (contentType.includes('multipart/form-data')) {
      // New multipart form data handling
      console.log("API: Processing multipart form data");
      
      const formData = await c.req.formData();
      const glbFile = formData.get('glb') as File;
      
      if (!glbFile) {
        return c.json({ 
          message: "No GLB file provided in form data",
          details: "Include GLB file as 'glb' field in multipart form data"
        }, 400);
      }
      
      // Extract optional parameters
      const formatParam = formData.get('format') as string;
      const flipYParam = formData.get('flipY') as string;
      const basisParamsParam = formData.get('basisParams') as string;
      
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
        basisParams = validateBasisParams(basisParamsParam);
      }
      
      arrayBuffer = await glbFile.arrayBuffer();
      console.log(`API: Received GLB file: ${glbFile.name}, Size: ${glbFile.size}`);
      console.log(`API: Parameters - Format: ${format}, FlipY: ${flipY}, BasisParams: ${basisParamsParam ? 'provided' : 'default'}`);
      
    } else {
      // Legacy binary data handling for backward compatibility
      console.log("API: Processing raw binary data (legacy mode)");
      arrayBuffer = await c.req.arrayBuffer();
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
    
    return c.json(
      { 
        message: "Enhanced GLB texture compression failed", 
        error: error instanceof Error ? error.message : "Unknown error",
        details: "Use multipart/form-data with 'glb' file and optional 'format' ('ETC1S'/'UASTC'), 'flipY' (true/false), and 'basisParams' (JSON) parameters"
      },
      { status: 500 }
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