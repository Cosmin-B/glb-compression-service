/**
 * Server-side GLTF mesh compression utilities
 * Extracted from compressGLTFServer.ts and adapted for standalone service
 */

import { NodeIO, WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, draco } from "@gltf-transform/functions";
import * as path from 'path';

/**
 * Server-side GLTF mesh compression only (NO TEXTURE COMPRESSION)
 * @param inputBuffer - The ArrayBuffer of the glTF/glb file to compress
 * @returns Promise that resolves to the mesh-compressed ArrayBuffer
 */
export const compressGLTFMeshOnly = async (inputBuffer: ArrayBuffer): Promise<ArrayBuffer> => {
  console.log("Starting GLTF mesh compression only...");
  console.log("Input buffer size:", inputBuffer.byteLength);

  // Dynamic import for draco3dgltf to avoid server-side issues
  let draco3d: any = null;

  const loadDraco3d = async () => {
    if (typeof (globalThis as any).window === 'undefined') {
      // Server-side: try to load anyway since this is server-side module
      console.log("Loading Draco compression for server-side...");
      try {
        if (!draco3d) {
          draco3d = await import("draco3dgltf");
        }
        return draco3d;
      } catch (error) {
        console.error("Failed to load Draco module on server:", error);
        return null;
      }
    } else {
      // Client-side: should not happen in server module
      console.log("Draco compression not available on client-side");
      return null;
    }
  };

  const draco3dModule = await loadDraco3d();

  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies(
      draco3dModule ? {
        "draco3d.encoder": await draco3dModule.createEncoderModule({
          locateFile: (fileName: string) => {
            // For server-side Node.js environment, use absolute file path
            if (typeof (globalThis as any).window === 'undefined') {
              return path.join(process.cwd(), 'public', fileName);
            }
            // For client-side (if ever needed), use relative URL
            return `/public/${fileName}`;
          },
        }),
      } : {}
    );

  // Convert ArrayBuffer to Uint8Array before reading
  const uint8Input = new Uint8Array(inputBuffer);

  // Read the glTF/glb data from the ArrayBuffer
  const document = await io.readBinary(uint8Input);
  
  console.log("Document loaded successfully");
  console.log("Number of meshes before compression:", document.getRoot().listMeshes().length);
  console.log("Number of accessors before compression:", document.getRoot().listAccessors().length);

  // Check if file is already compressed
  const meshes = document.getRoot().listMeshes();
  let alreadyDracoCompressed = false;
  let hasCompressibleGeometry = false;
  
  // Check for existing Draco compression
  for (const mesh of meshes) {
    const primitives = mesh.listPrimitives();
    console.log(`Mesh has ${primitives.length} primitives`);
    
    for (const primitive of primitives) {
      if (primitive.getExtension('KHR_draco_mesh_compression')) {
        alreadyDracoCompressed = true;
        console.log("File is already Draco compressed!");
        break;
      }
      
      // Check if primitive has geometry that can be compressed
      const attributes = primitive.listAttributes();
      if (attributes.length > 0) {
        hasCompressibleGeometry = true;
        console.log(`Primitive has ${attributes.length} attributes that can be compressed`);
        
        // Log attribute details
        for (const [semantic, accessor] of Object.entries(attributes)) {
          console.log(`  - ${semantic}: ${(accessor as any).getCount()} vertices`);
        }
      }
    }
    if (alreadyDracoCompressed) break;
  }

  // Skip if already compressed
  if (alreadyDracoCompressed) {
    console.log("Skipping compression - file already Draco compressed");
    return inputBuffer;
  }

  if (!hasCompressibleGeometry) {
    console.log("No compressible geometry found");
    return inputBuffer;
  }

  // Build transformation pipeline
  const transforms = [prune(), dedup()];

  // Add Draco compression if geometry exists and isn't already compressed
  if (hasCompressibleGeometry && !alreadyDracoCompressed && draco3dModule) {
    console.log("Applying Draco geometry compression...");
    transforms.push(
      draco({
        method: 'edgebreaker',
        encodeSpeed: 0, // Slowest encoding for best compression
        decodeSpeed: 0, // Slowest decoding for best compression
        quantizationVolume: 'mesh'
      })
    );
  }

  // Apply geometry transformations
  await document.transform(...transforms);

  console.log("Number of meshes after compression:", document.getRoot().listMeshes().length);
  console.log("Number of accessors after compression:", document.getRoot().listAccessors().length);

  // Serialize the compressed glTF back to an ArrayBuffer
  const compressedArrayBuffer = (await io.writeBinary(
    document
  )) as unknown as ArrayBuffer;

  console.log("Mesh compression complete!");
  console.log("Original size:", inputBuffer.byteLength);
  console.log("Compressed size:", compressedArrayBuffer.byteLength);
  console.log("Compression ratio:", ((inputBuffer.byteLength - compressedArrayBuffer.byteLength) / inputBuffer.byteLength * 100).toFixed(2) + "%");

  return compressedArrayBuffer;
};