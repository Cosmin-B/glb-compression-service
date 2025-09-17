/**
 * GLB/glTF analysis utilities for detecting compression and optimization status
 */

/**
 * GLB binary format constants
 */
const GLB_MAGIC = 0x46546C67; // "glTF" in little-endian
const GLB_VERSION = 2;
const GLB_CHUNK_TYPE_JSON = 0x4E4F534A; // "JSON" in little-endian
const GLB_CHUNK_TYPE_BIN = 0x004E4942; // "BIN\0" in little-endian

/**
 * Interface for GLB analysis results
 */
export interface GLBAnalysis {
  isValid: boolean;
  hasTextures: boolean;
  hasDracoCompression: boolean;
  hasMeshes: boolean;
  hasAnimations: boolean;
  extensionsUsed: string[];
  extensionsRequired: string[];
  textureCount: number;
  meshCount: number;
  nodeCount: number;
  fileSize: number;
  estimatedUncompressedSize?: number;
}

/**
 * Parse GLB binary format and extract JSON chunk
 * @param buffer GLB file as ArrayBuffer
 * @returns Parsed glTF JSON object or null if parsing fails
 */
function parseGLBToJSON(buffer: ArrayBuffer): any | null {
  try {
    const view = new DataView(buffer);
    let offset = 0;

    // Read GLB header (12 bytes)
    const magic = view.getUint32(offset, true);
    offset += 4;
    
    if (magic !== GLB_MAGIC) {
      console.log('GLB: Invalid magic number, not a valid GLB file');
      return null;
    }

    const version = view.getUint32(offset, true);
    offset += 4;
    
    if (version !== GLB_VERSION) {
      console.log('GLB: Unsupported GLB version:', version);
      return null;
    }

    const length = view.getUint32(offset, true);
    offset += 4;

    if (length !== buffer.byteLength) {
      console.log('GLB: File length mismatch');
      return null;
    }

    // Read first chunk (should be JSON)
    const chunkLength = view.getUint32(offset, true);
    offset += 4;

    const chunkType = view.getUint32(offset, true);
    offset += 4;

    if (chunkType !== GLB_CHUNK_TYPE_JSON) {
      console.log('GLB: First chunk is not JSON');
      return null;
    }

    // Extract JSON data
    const jsonBytes = new Uint8Array(buffer, offset, chunkLength);
    const jsonString = new TextDecoder().decode(jsonBytes);
    
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('GLB: Error parsing GLB file:', error);
    return null;
  }
}

/**
 * Analyze a GLB file to detect its current compression and optimization status
 * @param buffer GLB file as ArrayBuffer
 * @returns Analysis results
 */
export function analyzeGLB(buffer: ArrayBuffer): GLBAnalysis {
  console.log('GLB Analysis: Starting analysis of GLB file...');
  
  const gltf = parseGLBToJSON(buffer);
  
  if (!gltf) {
    return {
      isValid: false,
      hasTextures: false,
      hasDracoCompression: false,
      hasMeshes: false,
      hasAnimations: false,
      extensionsUsed: [],
      extensionsRequired: [],
      textureCount: 0,
      meshCount: 0,
      nodeCount: 0,
      fileSize: buffer.byteLength
    };
  }

  // Extract extensions with detailed logging
  const extensionsUsed = gltf.extensionsUsed || [];
  const extensionsRequired = gltf.extensionsRequired || [];
  
  console.log('GLB Analysis: Raw extensions data:', {
    extensionsUsed: extensionsUsed,
    extensionsRequired: extensionsRequired,
    extensionsUsedType: typeof extensionsUsed,
    extensionsRequiredType: typeof extensionsRequired,
    rawGltfExtensions: {
      extensionsUsed: gltf.extensionsUsed,
      extensionsRequired: gltf.extensionsRequired
    }
  });
  
  // Detect Draco compression with enhanced logic
  let hasDracoCompression = false;
  
  // Check in extensionsUsed array
  if (Array.isArray(extensionsUsed)) {
    hasDracoCompression = extensionsUsed.includes('KHR_draco_mesh_compression');
    console.log('GLB Analysis: Checked extensionsUsed array:', extensionsUsed, 'Draco found:', hasDracoCompression);
  }
  
  // Check in extensionsRequired array
  if (!hasDracoCompression && Array.isArray(extensionsRequired)) {
    hasDracoCompression = extensionsRequired.includes('KHR_draco_mesh_compression');
    console.log('GLB Analysis: Checked extensionsRequired array:', extensionsRequired, 'Draco found:', hasDracoCompression);
  }
  
  // Additional check: look for Draco in mesh primitives
  if (!hasDracoCompression && gltf.meshes) {
    for (const mesh of gltf.meshes) {
      if (mesh.primitives) {
        for (const primitive of mesh.primitives) {
          if (primitive.extensions && primitive.extensions.KHR_draco_mesh_compression) {
            hasDracoCompression = true;
            console.log('GLB Analysis: Found Draco in mesh primitive extensions');
            break;
          }
        }
      }
      if (hasDracoCompression) break;
    }
  }
  
  console.log('GLB Analysis: Final Draco detection result:', hasDracoCompression);

  // Count assets
  const textureCount = gltf.textures ? gltf.textures.length : 0;
  const meshCount = gltf.meshes ? gltf.meshes.length : 0;
  const nodeCount = gltf.nodes ? gltf.nodes.length : 0;
  
  // Detect content types
  const hasTextures = textureCount > 0;
  const hasMeshes = meshCount > 0;
  const hasAnimations = gltf.animations && gltf.animations.length > 0;

  const analysis: GLBAnalysis = {
    isValid: true,
    hasTextures,
    hasDracoCompression,
    hasMeshes,
    hasAnimations,
    extensionsUsed,
    extensionsRequired,
    textureCount,
    meshCount,
    nodeCount,
    fileSize: buffer.byteLength
  };

  console.log('GLB Analysis: Results:', {
    fileSize: `${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`,
    hasTextures: `${hasTextures} (${textureCount} textures)`,
    hasMeshes: `${hasMeshes} (${meshCount} meshes)`,
    hasDracoCompression,
    hasAnimations,
    extensionsUsed: extensionsUsed.join(', ') || 'none',
    extensionsRequired: extensionsRequired.join(', ') || 'none'
  });

  return analysis;
}

/**
 * Determine the optimal compression strategy based on GLB analysis
 * @param analysis GLB analysis results
 * @returns Compression strategy recommendation
 */
export interface CompressionStrategy {
  shouldCompressMesh: boolean;
  shouldCompressTextures: boolean;
  reason: string;
  recommendedEndpoint: '/compress/mesh' | '/compress/textures' | '/compress/full';
}

export function getOptimalCompressionStrategy(analysis: GLBAnalysis): CompressionStrategy {
  if (!analysis.isValid) {
    return {
      shouldCompressMesh: false,
      shouldCompressTextures: false,
      reason: 'Invalid GLB file',
      recommendedEndpoint: '/compress/full'
    };
  }

  // If already has Draco compression, only compress textures
  if (analysis.hasDracoCompression && analysis.hasTextures) {
    return {
      shouldCompressMesh: false,
      shouldCompressTextures: true,
      reason: 'File already has Draco mesh compression, only textures need compression',
      recommendedEndpoint: '/compress/textures'
    };
  }

  // If has Draco but no textures, no further compression needed
  if (analysis.hasDracoCompression && !analysis.hasTextures) {
    return {
      shouldCompressMesh: false,
      shouldCompressTextures: false,
      reason: 'File already has Draco compression and no textures to compress',
      recommendedEndpoint: '/compress/full' // Will be a no-op but consistent
    };
  }

  // If has both meshes and textures but no Draco, compress both
  if (analysis.hasMeshes && analysis.hasTextures) {
    return {
      shouldCompressMesh: true,
      shouldCompressTextures: true,
      reason: 'File has uncompressed meshes and textures',
      recommendedEndpoint: '/compress/full'
    };
  }

  // If only has meshes, only compress meshes
  if (analysis.hasMeshes && !analysis.hasTextures) {
    return {
      shouldCompressMesh: true,
      shouldCompressTextures: false,
      reason: 'File has uncompressed meshes but no textures',
      recommendedEndpoint: '/compress/mesh'
    };
  }

  // If only has textures, only compress textures
  if (!analysis.hasMeshes && analysis.hasTextures) {
    return {
      shouldCompressMesh: false,
      shouldCompressTextures: true,
      reason: 'File has textures but no meshes to compress',
      recommendedEndpoint: '/compress/textures'
    };
  }

  // Default case - no significant assets to compress
  return {
    shouldCompressMesh: false,
    shouldCompressTextures: false,
    reason: 'File has no significant assets to compress',
    recommendedEndpoint: '/compress/full'
  };
}