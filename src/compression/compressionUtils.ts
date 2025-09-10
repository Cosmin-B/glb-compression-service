/**
 * Shared compression utilities
 * Common functions and types used across mesh and texture compression modules
 */

import { Document } from "@gltf-transform/core";

/**
 * Compression statistics interface
 */
export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  compressionPercentage: string;
}

/**
 * Compression options for texture compression
 */
export interface TextureCompressionOptions {
  basisUniversalMode: 'UASTC' | 'ETC1S';
  quality: number;
  generateMipmaps: boolean;
  useZstandard: boolean;
  oetf: 'srgb' | 'linear';
  format?: 'UASTC_4x4' | 'ETC1S'; // New format option
  flipY?: boolean;
}

/**
 * Compression options for mesh compression
 */
export interface MeshCompressionOptions {
  method: 'edgebreaker' | 'sequential';
  encodeSpeed: number; // 0-10, 0 = slowest/best compression
  decodeSpeed: number; // 0-10, 0 = slowest/best compression
  quantizationVolume: 'mesh' | 'scene';
}

/**
 * Combined compression result
 */
export interface CompressionResult {
  buffer: ArrayBuffer;
  stats: CompressionStats;
  meshCompressed: boolean;
  textureCompressed: boolean;
  errors?: string[];
}

/**
 * Calculate compression statistics
 * @param originalSize - Original buffer size
 * @param compressedSize - Compressed buffer size
 * @returns Compression statistics
 */
export const calculateCompressionStats = (originalSize: number, compressedSize: number): CompressionStats => {
  const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;
  const compressionPercentage = originalSize > 0 ? 
    ((originalSize - compressedSize) / originalSize * 100).toFixed(2) + "%" : 
    "0%";

  return {
    originalSize,
    compressedSize,
    compressionRatio,
    compressionPercentage
  };
};

/**
 * Log compression statistics in a consistent format
 * @param stats - Compression statistics to log
 * @param operation - The compression operation performed
 */
export const logCompressionStats = (stats: CompressionStats, operation: string): void => {
  console.log(`${operation} complete!`);
  console.log(`Original size: ${stats.originalSize} bytes`);
  console.log(`Compressed size: ${stats.compressedSize} bytes`);
  console.log(`Compression ratio: ${stats.compressionRatio.toFixed(4)}`);
  console.log(`Compression percentage: ${stats.compressionPercentage}`);
};

/**
 * Check if a GLTF document has already been Draco compressed
 * @param document - The GLTF document to check
 * @returns Boolean indicating if Draco compression is already applied
 */
export const isDracoCompressed = (document: Document): boolean => {
  const meshes = document.getRoot().listMeshes();
  
  for (const mesh of meshes) {
    const primitives = mesh.listPrimitives();
    for (const primitive of primitives) {
      if (primitive.getExtension('KHR_draco_mesh_compression')) {
        return true;
      }
    }
  }
  
  return false;
};

/**
 * Check if a GLTF document has compressible geometry
 * @param document - The GLTF document to check
 * @returns Boolean indicating if there is geometry that can be compressed
 */
export const hasCompressibleGeometry = (document: Document): boolean => {
  const meshes = document.getRoot().listMeshes();
  
  for (const mesh of meshes) {
    const primitives = mesh.listPrimitives();
    for (const primitive of primitives) {
      const attributes = primitive.listAttributes();
      if (attributes.length > 0) {
        return true;
      }
    }
  }
  
  return false;
};

/**
 * Check if a GLTF document has textures that are already KTX2 compressed
 * @param document - The GLTF document to check
 * @returns Boolean indicating if KTX2 compression is already applied
 */
export const isKtx2Compressed = (document: Document): boolean => {
  const textures = document.getRoot().listTextures();
  
  for (const texture of textures) {
    if (texture.getMimeType() === 'image/ktx2') {
      return true;
    }
  }
  
  return false;
};

/**
 * Get texture information from a GLTF document
 * @param document - The GLTF document to analyze
 * @returns Array of texture information
 */
export const getTextureInfo = (document: Document) => {
  const textures = document.getRoot().listTextures();
  
  return textures.map((texture, index) => ({
    index,
    name: texture.getName() || `texture_${index}`,
    mimeType: texture.getMimeType() || 'unknown',
    size: texture.getImage()?.length || 0,
    isKtx2: texture.getMimeType() === 'image/ktx2'
  }));
};

/**
 * Get mesh information from a GLTF document
 * @param document - The GLTF document to analyze
 * @returns Mesh information summary
 */
export const getMeshInfo = (document: Document) => {
  const meshes = document.getRoot().listMeshes();
  const accessors = document.getRoot().listAccessors();
  
  let totalPrimitives = 0;
  let totalAttributes = 0;
  let dracoCompressed = 0;
  
  for (const mesh of meshes) {
    const primitives = mesh.listPrimitives();
    totalPrimitives += primitives.length;
    
    for (const primitive of primitives) {
      const attributes = primitive.listAttributes();
      totalAttributes += attributes.length;
      
      if (primitive.getExtension('KHR_draco_mesh_compression')) {
        dracoCompressed++;
      }
    }
  }
  
  return {
    meshCount: meshes.length,
    accessorCount: accessors.length,
    primitiveCount: totalPrimitives,
    attributeCount: totalAttributes,
    dracoCompressedPrimitives: dracoCompressed,
    isDracoCompressed: dracoCompressed > 0
  };
};

/**
 * Default texture compression options
 */
export const DEFAULT_TEXTURE_OPTIONS: TextureCompressionOptions = {
  basisUniversalMode: 'UASTC',
  quality: 80,
  generateMipmaps: true,
  useZstandard: true,
  oetf: 'srgb',
  format: 'UASTC_4x4',
  flipY: false
};

/**
 * Default mesh compression options
 */
export const DEFAULT_MESH_OPTIONS: MeshCompressionOptions = {
  method: 'edgebreaker',
  encodeSpeed: 0, // Slowest encoding for best compression
  decodeSpeed: 0, // Slowest decoding for best compression
  quantizationVolume: 'mesh'
};

/**
 * Validate buffer input
 * @param buffer - ArrayBuffer to validate
 * @param minSize - Minimum size in bytes (default: 1)
 * @throws Error if buffer is invalid
 */
export const validateBuffer = (buffer: ArrayBuffer, minSize: number = 1): void => {
  if (!buffer) {
    throw new Error("Input buffer is null or undefined");
  }
  
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error("Input must be an ArrayBuffer");
  }
  
  if (buffer.byteLength < minSize) {
    throw new Error(`Input buffer too small: ${buffer.byteLength} bytes (minimum: ${minSize})`);
  }
};

/**
 * Create error result for failed compression
 * @param originalBuffer - Original buffer
 * @param error - Error that occurred
 * @returns CompressionResult with error
 */
export const createErrorResult = (originalBuffer: ArrayBuffer, error: Error): CompressionResult => {
  return {
    buffer: originalBuffer,
    stats: calculateCompressionStats(originalBuffer.byteLength, originalBuffer.byteLength),
    meshCompressed: false,
    textureCompressed: false,
    errors: [error.message]
  };
};