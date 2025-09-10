/**
 * Compression Service - Main Export Module
 * 
 * This module provides server-side GLTF compression capabilities with both
 * Draco geometry compression and server-side texture processing.
 * 
 * USAGE EXAMPLES:
 * 
 * 1. Mesh compression only:
 *    const compressedBuffer = await compressGLTFMeshOnly(inputBuffer);
 * 
 * 2. Texture processing only (server-side):
 *    const compressedBuffer = await compressGLTFTexturesOnly(inputBuffer);
 * 
 * 3. Full compression pipeline:
 *    const meshCompressed = await compressGLTFMeshOnly(inputBuffer);
 *    const fullyCompressed = await compressGLTFTexturesOnly(meshCompressed);
 * 
 * COMPRESSION FEATURES:
 * - Draco geometry compression (edgebreaker method, best compression)
 * - Server-side texture processing (preparation for KTX2 compression)
 * - Automatic detection of already compressed content
 * - Detailed logging and compression statistics
 * - Error handling and graceful fallbacks
 * - Node.js compatible (no client-side dependencies)
 */

// Main compression functions
export { compressGLTFMeshOnly } from './meshCompression.js';
export { 
  compressPNGToKTX2, 
  compressImageToKTX2, 
  compressGLBTexturesKTX2
} from './ktx2TextureCompression.js';

export type {
  KTX2TranscoderFormat,
  BasisParams,
  KTX2CompressionSettings,
  KTX2CompressionResult
} from './ktx2TextureCompression.js';

// Utility types and functions
export type {
  CompressionStats,
  TextureCompressionOptions,
  MeshCompressionOptions,
  CompressionResult
} from './compressionUtils.js';

export {
  calculateCompressionStats,
  logCompressionStats,
  isDracoCompressed,
  hasCompressibleGeometry,
  isKtx2Compressed,
  getTextureInfo,
  getMeshInfo,
  DEFAULT_TEXTURE_OPTIONS,
  DEFAULT_MESH_OPTIONS,
  validateBuffer,
  createErrorResult
} from './compressionUtils.js';

// Import for function usage
import { compressGLTFMeshOnly } from './meshCompression.js';
import { 
  compressGLBTexturesKTX2 
} from './ktx2TextureCompression.js';
import type {
  CompressionResult,
  CompressionStats
} from './compressionUtils.js';
import {
  calculateCompressionStats,
  logCompressionStats,
  validateBuffer,
  createErrorResult
} from './compressionUtils.js';

/**
 * Combined compression function that applies both mesh and texture compression
 * @param inputBuffer - The ArrayBuffer of the glTF/glb file to compress
 * @param options - Compression options
 * @returns Promise that resolves to a CompressionResult
 */
export const compressGLTFComplete = async (
  inputBuffer: ArrayBuffer,
  options: {
    compressMesh?: boolean;
    compressTextures?: boolean;
  } = { compressMesh: true, compressTextures: true }
): Promise<CompressionResult> => {
  try {
    validateBuffer(inputBuffer);
    
    let currentBuffer = inputBuffer;
    let meshCompressed = false;
    let textureCompressed = false;
    const errors: string[] = [];

    // Step 1: Mesh compression
    if (options.compressMesh) {
      try {
        console.log("Starting mesh compression phase...");
        currentBuffer = await compressGLTFMeshOnly(currentBuffer);
        meshCompressed = true;
      } catch (error) {
        const errorMessage = `Mesh compression failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(errorMessage);
        errors.push(errorMessage);
      }
    }

    // Step 2: Texture compression
    if (options.compressTextures) {
      try {
        console.log("Starting texture compression phase...");
        const result = await compressGLBTexturesKTX2(currentBuffer);
        currentBuffer = result.buffer;
        textureCompressed = true;
        if (result.errors && result.errors.length > 0) {
          errors.push(...result.errors);
        }
      } catch (error) {
        const errorMessage = `Texture compression failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(errorMessage);
        errors.push(errorMessage);
      }
    }

    const stats = calculateCompressionStats(inputBuffer.byteLength, currentBuffer.byteLength);
    logCompressionStats(stats, "Complete GLTF compression");

    return {
      buffer: currentBuffer,
      stats,
      meshCompressed,
      textureCompressed,
      errors: errors.length > 0 ? errors : []
    };

  } catch (error) {
    const errorMessage = `Complete compression failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMessage);
    return createErrorResult(inputBuffer, error instanceof Error ? error : new Error(errorMessage));
  }
};