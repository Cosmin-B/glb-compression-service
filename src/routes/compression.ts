import { Hono } from 'hono';
import { compressGLTFMeshOnly, compressGLTFComplete, compressGLBTexturesKTX2 } from '../compression/index.js';
import { KTX2TranscoderFormat, KTX2CompressionSettings } from '../compression/ktx2TextureCompression.js';
import { analyzeGLB, getOptimalCompressionStrategy } from '../utils/gltfAnalyzer.js';

const compression = new Hono();

// Helper function to calculate compression statistics
const calculateCompressionStats = (originalSize: number, compressedSize: number) => {
  const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(2);
  return {
    originalSize,
    compressedSize,
    compressionRatio: `${compressionRatio}%`,
    savings: originalSize - compressedSize
  };
};

// Helper function to verify input type for Cloudflare Workers compatibility
const verifyInputType = (arrayBuffer: ArrayBuffer): void => {
  console.log("API: Input type verification:");
  console.log(`API: - Type: ${typeof arrayBuffer}`);
  console.log(`API: - Is ArrayBuffer: ${arrayBuffer instanceof ArrayBuffer}`);
  console.log(`API: - Constructor name: ${arrayBuffer.constructor.name}`);
  console.log(`API: - Size: ${arrayBuffer.byteLength} bytes`);
};

// Helper function to add compression statistics to headers
const addCompressionHeaders = (headers: Record<string, string>, stats: ReturnType<typeof calculateCompressionStats>) => {
  headers['X-Original-Size'] = stats.originalSize.toString();
  headers['X-Compressed-Size'] = stats.compressedSize.toString();
  headers['X-Compression-Ratio'] = stats.compressionRatio;
  headers['X-Compression-Savings'] = stats.savings.toString();
};

/**
 * POST /compress/mesh - Mesh-only compression (Draco)
 * Accepts raw binary data (ArrayBuffer/Buffer) and returns compressed binary
 */
compression.post('/mesh', async (c) => {
  try {
    console.log("API: Starting mesh-only compression endpoint");
    
    // Get raw binary data from request body (ArrayBuffer from Cloudflare Workers)
    const arrayBuffer = await c.req.arrayBuffer();
    
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      console.error("API: No binary data received");
      return c.json({ message: "No binary data uploaded" }, 400);
    }

    // Verify input type for Cloudflare Workers compatibility
    verifyInputType(arrayBuffer);
    console.log("API: Received binary data, Size:", arrayBuffer.byteLength);
    
    // Apply mesh-only compression
    console.log("API: Starting mesh compression...");
    const compressedArrayBuffer = await compressGLTFMeshOnly(arrayBuffer);
    console.log("API: Mesh compression completed");
    
    // Calculate compression statistics
    const stats = calculateCompressionStats(arrayBuffer.byteLength, compressedArrayBuffer.byteLength);
    console.log("API: Original buffer size:", stats.originalSize);
    console.log("API: Compressed buffer size:", stats.compressedSize);
    console.log("API: Compression ratio:", stats.compressionRatio);
    console.log("API: Compression savings:", stats.savings, "bytes");

    // Remove Node.js Buffer dependency - use ArrayBuffer directly for Cloudflare Workers
    console.log("API: Response ArrayBuffer size:", compressedArrayBuffer.byteLength);
    console.log("API: Response type:", compressedArrayBuffer.constructor.name);
    
    // Prepare response headers with compression statistics
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': compressedArrayBuffer.byteLength.toString()
    };
    addCompressionHeaders(responseHeaders, stats);
    
    return new Response(compressedArrayBuffer, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("API: Mesh compression failed:", error);
    console.error("API: Error details:", error instanceof Error ? error.stack : "Unknown error type");
    return c.json(
      { 
        message: "Mesh compression failed", 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      500
    );
  }
});

// Helper function to validate format parameter
const validateFormat = (format: string): KTX2TranscoderFormat => {
  if (format === 'ETC1S') {
    return KTX2TranscoderFormat.ETC1S;
  }
  if (format === 'UASTC') {
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
 * POST /compress/textures - Texture-only compression (KTX2)
 * Accepts either:
 * 1. Raw binary GLB data (application/octet-stream) - for backward compatibility
 * 2. Multipart form data with optional parameters:
 *    - glb: GLB file (required)
 *    - format: "ETC1S" or "UASTC" (optional, default: "ETC1S")
 *    - flipY: boolean (optional, default: true)
 *    - forceFormat: boolean (optional, default: false) - if true, overrides normal map auto-detection
 *    - basisParams: JSON object with compression settings (optional)
 */
compression.post('/textures', async (c) => {
  try {
    console.log("API: Starting texture-only compression endpoint");
    
    const contentType = c.req.header('content-type') || '';
    let arrayBuffer: ArrayBuffer;
    let format = KTX2TranscoderFormat.ETC1S; // Default format
    let flipY = true; // Default flipY for GLB compatibility
    let forceFormat = false; // Default: allow normal map auto-detection
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
      const forceFormatParam = formData.get('forceFormat') as string;
      const basisParamsParam = formData.get('basisParams') as string;
      
      // Validate and set format
      if (formatParam) {
        format = validateFormat(formatParam);
      }
      
      // Validate and set flipY
      if (flipYParam) {
        flipY = validateFlipY(flipYParam);
      }
      
      // Validate and set forceFormat
      if (forceFormatParam) {
        forceFormat = validateFlipY(forceFormatParam); // Reuse same boolean validation
      }
      
      // Validate and set basisParams
      if (basisParamsParam) {
        basisParams = validateBasisParams(basisParamsParam);
      }
      
      arrayBuffer = await glbFile.arrayBuffer();
      console.log(`API: Received GLB file: ${glbFile.name}, Size: ${glbFile.size}`);
      console.log(`API: Parameters - Format: ${format}, FlipY: ${flipY}, ForceFormat: ${forceFormat}, BasisParams: ${basisParamsParam ? 'provided' : 'default'}`);
      
    } else {
      // Legacy binary data handling for backward compatibility
      console.log("API: Processing raw binary data (legacy mode)");
      arrayBuffer = await c.req.arrayBuffer();
      
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        console.error("API: No binary data received");
        return c.json({ message: "No binary data uploaded" }, 400);
      }
    }

    // Verify input type for Cloudflare Workers compatibility
    verifyInputType(arrayBuffer);
    console.log("API: Received binary data, Size:", arrayBuffer.byteLength);
    
    // Apply texture-only compression with customizable parameters
    console.log("API: Starting GLB texture compression...");
    const compressionSettings: KTX2CompressionSettings = {
      format: format,
      flipY: flipY,
      forceFormat: forceFormat,
      basisParams: basisParams
    };
    const compressionResult = await compressGLBTexturesKTX2(arrayBuffer, compressionSettings);
    const compressedArrayBuffer = compressionResult.buffer;
    console.log("API: GLB texture compression completed");
    
    // Calculate compression statistics
    const stats = calculateCompressionStats(arrayBuffer.byteLength, compressedArrayBuffer.byteLength);
    console.log("API: Original buffer size:", stats.originalSize);
    console.log("API: Compressed buffer size:", stats.compressedSize);
    console.log("API: Compression ratio:", stats.compressionRatio);
    console.log("API: Compression savings:", stats.savings, "bytes");

    // Remove Node.js Buffer dependency - use ArrayBuffer directly for Cloudflare Workers
    console.log("API: Response ArrayBuffer size:", compressedArrayBuffer.byteLength);
    console.log("API: Response type:", compressedArrayBuffer.constructor.name);
    
    // Prepare response headers with compression statistics
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': compressedArrayBuffer.byteLength.toString()
    };
    addCompressionHeaders(responseHeaders, stats);
    
    // Add texture compression specific headers
    responseHeaders['X-Textures-Processed'] = compressionResult.texturesProcessed?.toString() || '0';
    responseHeaders['X-Format'] = format === KTX2TranscoderFormat.ETC1S ? 'ETC1S' : 'UASTC';
    responseHeaders['X-FlipY'] = flipY.toString();
    responseHeaders['X-Custom-Basis-Params'] = basisParams ? 'true' : 'false';
    if (compressionResult.errors && compressionResult.errors.length > 0) {
      responseHeaders['X-Compression-Warnings'] = compressionResult.errors.join('; ');
    }
    
    return new Response(compressedArrayBuffer, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("API: Texture compression failed:", error);
    console.error("API: Error details:", error instanceof Error ? error.stack : "Unknown error type");
    return c.json(
      { 
        message: "Texture compression failed", 
        error: error instanceof Error ? error.message : "Unknown error",
        details: "Use multipart/form-data with 'glb' file and optional 'format' ('ETC1S'/'UASTC'), 'flipY' (true/false), and 'basisParams' (JSON) parameters"
      },
      500
    );
  }
});

/**
 * POST /compress/full - Intelligent full compression (mesh and/or texture based on analysis)
 * Accepts raw binary data (ArrayBuffer/Buffer) and returns compressed binary
 * Automatically detects existing Draco compression to avoid conflicts
 * 
 * Query parameters:
 * - ignoreDraco=true: Skip Draco detection and force full compression anyway
 */
compression.post('/full', async (c) => {
  try {
    console.log("API: Starting intelligent full compression endpoint");
    
    // Get raw binary data from request body (ArrayBuffer from Cloudflare Workers)
    const arrayBuffer = await c.req.arrayBuffer();
    
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      console.error("API: No binary data received");
      return c.json({ message: "No binary data uploaded" }, 400);
    }

    // Verify input type for Cloudflare Workers compatibility
    verifyInputType(arrayBuffer);
    console.log("API: Received binary data, Size:", arrayBuffer.byteLength);
    
    // Check for ignoreDraco query parameter
    const ignoreDraco = c.req.query('ignoreDraco') === 'true';
    console.log("API: Ignore Draco detection:", ignoreDraco);
    
    // Analyze GLB to determine optimal compression strategy
    console.log("API: Analyzing GLB file structure...");
    const analysis = analyzeGLB(arrayBuffer);
    let strategy = getOptimalCompressionStrategy(analysis);
    
    // Override strategy if ignoreDraco is enabled
    if (ignoreDraco) {
      console.log("API: Ignoring Draco detection, forcing full compression");
      strategy = {
        shouldCompressMesh: analysis.hasMeshes,
        shouldCompressTextures: analysis.hasTextures,
        reason: 'Forced full compression (ignoreDraco=true)',
        recommendedEndpoint: '/compress/full'
      };
    }
    
    console.log("API: GLB Analysis Results:", {
      hasTextures: analysis.hasTextures,
      hasMeshes: analysis.hasMeshes,
      hasDracoCompression: analysis.hasDracoCompression,
      textureCount: analysis.textureCount,
      meshCount: analysis.meshCount
    });
    
    console.log("API: Compression Strategy:", {
      shouldCompressMesh: strategy.shouldCompressMesh,
      shouldCompressTextures: strategy.shouldCompressTextures,
      reason: strategy.reason,
      recommendedEndpoint: strategy.recommendedEndpoint
    });

    let compressedArrayBuffer: ArrayBuffer;
    let compressionResult: any;
    
    if (!strategy.shouldCompressMesh && !strategy.shouldCompressTextures) {
      // No compression needed
      console.log("API: No compression needed, returning original file");
      compressedArrayBuffer = arrayBuffer;
      compressionResult = {
        buffer: arrayBuffer,
        meshCompressed: false,
        textureCompressed: false,
        errors: [`No compression applied: ${strategy.reason}`]
      };
    } else if (strategy.shouldCompressMesh && strategy.shouldCompressTextures) {
      // Full compression (original behavior)
      console.log("API: Applying full compression (mesh + textures)...");
      compressionResult = await compressGLTFComplete(arrayBuffer);
      compressedArrayBuffer = compressionResult.buffer;
    } else if (strategy.shouldCompressTextures && !strategy.shouldCompressMesh) {
      // Texture-only compression (avoids Draco conflict)
      console.log("API: Applying texture-only compression (Draco mesh already present)...");
      const textureCompressionSettings: KTX2CompressionSettings = {
        format: KTX2TranscoderFormat.ETC1S,
        flipY: true,
        forceFormat: true // Use ETC1S for all textures for maximum compression
      };
      const textureResult = await compressGLBTexturesKTX2(arrayBuffer, textureCompressionSettings);
      compressedArrayBuffer = textureResult.buffer;
      compressionResult = {
        buffer: textureResult.buffer,
        meshCompressed: false,
        textureCompressed: true,
        texturesProcessed: textureResult.texturesProcessed,
        errors: textureResult.errors || []
      };
    } else if (strategy.shouldCompressMesh && !strategy.shouldCompressTextures) {
      // Mesh-only compression
      console.log("API: Applying mesh-only compression...");
      compressedArrayBuffer = await compressGLTFMeshOnly(arrayBuffer);
      compressionResult = {
        buffer: compressedArrayBuffer,
        meshCompressed: true,
        textureCompressed: false,
        errors: []
      };
    } else {
      // Fallback - should not reach here
      console.log("API: Fallback to original full compression...");
      compressionResult = await compressGLTFComplete(arrayBuffer);
      compressedArrayBuffer = compressionResult.buffer;
    }
    
    console.log("API: Compression completed");
    
    // Calculate compression statistics
    const stats = calculateCompressionStats(arrayBuffer.byteLength, compressedArrayBuffer.byteLength);
    console.log("API: Original buffer size:", stats.originalSize);
    console.log("API: Compressed buffer size:", stats.compressedSize);
    console.log("API: Compression ratio:", stats.compressionRatio);
    console.log("API: Compression savings:", stats.savings, "bytes");

    // Remove Node.js Buffer dependency - use ArrayBuffer directly for Cloudflare Workers
    console.log("API: Response ArrayBuffer size:", compressedArrayBuffer.byteLength);
    console.log("API: Response type:", compressedArrayBuffer.constructor.name);
    
    // Prepare response headers with compression statistics
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': compressedArrayBuffer.byteLength.toString()
    };
    addCompressionHeaders(responseHeaders, stats);
    
    // Add additional headers for intelligent compression results
    responseHeaders['X-Mesh-Compressed'] = compressionResult.meshCompressed.toString();
    responseHeaders['X-Texture-Compressed'] = compressionResult.textureCompressed.toString();
    responseHeaders['X-Had-Draco-Compression'] = analysis.hasDracoCompression.toString();
    responseHeaders['X-Ignored-Draco-Detection'] = ignoreDraco.toString();
    responseHeaders['X-Compression-Strategy'] = strategy.reason;
    responseHeaders['X-Textures-Processed'] = compressionResult.texturesProcessed?.toString() || '0';
    if (compressionResult.errors && compressionResult.errors.length > 0) {
      responseHeaders['X-Compression-Warnings'] = compressionResult.errors.join('; ');
    }
    
    return new Response(compressedArrayBuffer, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("API: Full compression failed:", error);
    console.error("API: Error details:", error instanceof Error ? error.stack : "Unknown error type");
    return c.json(
      { 
        message: "Full compression failed", 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      500
    );
  }
});

// Health check for compression service
compression.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'compression-routes',
    endpoints: [
      'POST /compress/mesh - Mesh-only compression (Draco)',
      'POST /compress/textures - Texture-only compression (KTX2)',
      'POST /compress/full - Full compression (mesh + textures)'
    ],
    timestamp: new Date().toISOString()
  });
});

export { compression };