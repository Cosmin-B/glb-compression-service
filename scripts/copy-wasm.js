#!/usr/bin/env node
/**
 * Copy WASM files from node_modules to public directory for distribution
 * This script ensures that the required WebAssembly files are available
 * for the compression service to function properly.
 */

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const publicDir = join(projectRoot, 'public');
const ktx2Dir = join(publicDir, 'ktx2');

// Ensure directories exist
if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}
if (!existsSync(ktx2Dir)) {
  mkdirSync(ktx2Dir, { recursive: true });
}

const filesToCopy = [
  {
    src: join(projectRoot, 'node_modules', 'draco3dgltf', 'draco_decoder_gltf.wasm'),
    dest: join(publicDir, 'draco_decoder_gltf.wasm'),
    required: true
  },
  {
    src: join(projectRoot, 'node_modules', 'draco3dgltf', 'draco_encoder.wasm'),
    dest: join(publicDir, 'draco_encoder.wasm'),
    required: true
  }
];

let copyCount = 0;
let errorCount = 0;

console.log('🔄 Copying WASM files for compression service...');

for (const file of filesToCopy) {
  try {
    if (existsSync(file.src)) {
      copyFileSync(file.src, file.dest);
      copyCount++;
      console.log(`✅ Copied: ${file.dest}`);
    } else if (file.required) {
      console.error(`❌ Required file not found: ${file.src}`);
      errorCount++;
    } else {
      console.warn(`⚠️  Optional file not found: ${file.src}`);
    }
  } catch (error) {
    console.error(`❌ Failed to copy ${file.src}: ${error.message}`);
    errorCount++;
  }
}

// Note about KTX2 files
console.log('\n📋 KTX2 Files:');
console.log('   KTX2 files (libktx.js, libktx.wasm) should be manually placed in public/ktx2/');
console.log('   These files are typically provided by the Basis Universal library.');

console.log(`\n📊 Summary: ${copyCount} files copied, ${errorCount} errors`);

if (errorCount > 0) {
  console.error('\n❌ Some required WASM files could not be copied.');
  console.error('   Make sure all dependencies are installed: npm install');
  process.exit(1);
} else {
  console.log('\n✅ WASM files ready for compression service!');
}