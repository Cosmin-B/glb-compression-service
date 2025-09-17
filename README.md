# Compression Service

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)

A high-performance, production-ready compression service for 3D models and textures. Built with the modern Hono framework, this service provides efficient Draco mesh compression and KTX2 texture compression capabilities through a simple REST API.

## 🚀 Features

- **High-Performance Compression**: Achieve up to 95% file size reduction for 3D models
- **Intelligent Compression**: Auto-detects existing Draco compression and selects optimal strategy
- **Dual Compression Support**: 
  - Draco 3D geometry compression for meshes
  - KTX2 Basis Universal texture compression
- **Smart Format Selection**: Automatic normal map detection with manual override options
- **Modern Architecture**: Built with TypeScript and Hono framework
- **Multi-Format Support**: PNG, JPG, JPEG, WebP texture processing
- **Flexible API**: Individual or combined compression workflows with advanced parameters
- **Production Ready**: Docker support with health monitoring
- **CORS Enabled**: Ready for web application integration
- **Comprehensive Logging**: Detailed request/response tracking

## 📊 Performance Benchmarks

| Asset Type | Original Size | Compressed Size | Reduction |
|------------|---------------|-----------------|-----------|
| Mesh (Draco) | 135 KB | 6.6 KB | 95.1% |
| Texture (KTX2/ETC1S) | 7.8 MB | 281 KB | 96.4% |
| Combined GLB | 4.1 MB | 495 KB | 87.9% |

## 🛠️ Installation

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn package manager

### Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd compression-service
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the service**
   ```bash
   # Development mode with hot reload
   npm run dev

   # Production mode
   npm run build
   npm run start
   ```

The service will be available at `http://localhost:3117`

### Docker Deployment

```bash
# Build and run with Docker
npm run docker:build
npm run docker:run

# Or use Docker Compose
npm run docker:compose
```

## 📖 API Documentation

### Health Check

**GET** `/health`

Check service status and availability.

```bash
curl http://localhost:3117/health
```

```json
{
  "status": "ok",
  "timestamp": "2023-12-01T10:00:00.000Z",
  "service": "compression-service"
}
```

### Service Information

**GET** `/`

Get available endpoints and service information.

### Compression Endpoints

#### 1. Mesh Compression (Draco)

**POST** `/compress/mesh`

Apply Draco geometry compression to 3D models.

```bash
curl -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@model.glb" \
  http://localhost:3117/compress/mesh \
  -o compressed.glb
```

**Response Headers:**
- `X-Original-Size`: Original file size in bytes
- `X-Compressed-Size`: Compressed file size in bytes
- `X-Compression-Ratio`: Compression percentage
- `X-Compression-Savings`: Bytes saved

#### 2. Texture Compression (KTX2)

**POST** `/compress/textures`

Apply KTX2 texture compression while preserving geometry.

```bash
# Basic compression with default ETC1S format
curl -X POST \
  -F "glb=@model.glb" \
  http://localhost:3117/compress/textures \
  -o compressed.glb

# High-quality UASTC compression
curl -X POST \
  -F "glb=@model.glb" \
  -F "format=UASTC" \
  -F "flipY=true" \
  http://localhost:3117/compress/textures \
  -o compressed.glb

# Force ETC1S for all textures (including normal maps)
curl -X POST \
  -F "glb=@model.glb" \
  -F "format=ETC1S" \
  -F "forceFormat=true" \
  http://localhost:3117/compress/textures \
  -o compressed.glb
```

**Supported Formats:**
- **ETC1S**: High compression ratio (recommended for mobile/web)
- **UASTC**: Higher quality with moderate compression

**Advanced Parameters:**
- `forceFormat=true`: Override normal map detection and use the specified format for all textures
  - Normal maps are automatically detected and compressed with UASTC for quality preservation
  - Use `forceFormat=true` to force ETC1S for maximum compression (80%+ vs -18% for normal maps)

#### 3. Full Compression

**POST** `/compress/full`

Apply both mesh and texture compression for maximum reduction with intelligent compression strategy selection.

```bash
# Basic full compression with intelligent Draco detection
curl -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@model.glb" \
  http://localhost:3117/compress/full \
  -o fully_compressed.glb

# Force full compression even if Draco is already present
curl -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@model.glb" \
  "http://localhost:3117/compress/full?ignoreDraco=true" \
  -o fully_compressed.glb
```

**Intelligent Compression Strategy:**
- **Auto-Detection**: The service automatically analyzes GLB files to detect existing Draco compression
- **Smart Routing**: Files with existing Draco compression are routed to texture-only compression
- **Optimal Results**: Achieves better compression ratios by avoiding conflicts (83% vs 0.74% for pre-compressed files)
- **Override Option**: Use `ignoreDraco=true` to force full compression regardless of existing compression

#### 4. Individual Texture Processing

**POST** `/texture/image-to-ktx2`

Convert individual images to KTX2 format.

```bash
# Basic conversion
curl -X POST \
  -F "image=@texture.png" \
  http://localhost:3117/texture/image-to-ktx2 \
  -o texture.ktx2

# With custom parameters
curl -X POST \
  -F "image=@texture.jpg" \
  -F "format=UASTC" \
  -F 'basisParams={"rdo_uastc_quality_scalar": 3}' \
  http://localhost:3117/texture/image-to-ktx2 \
  -o texture.ktx2
```

## 🔧 Configuration

### Compression Formats

#### ETC1S (Efficient Texture Compression)
- **Best for**: Color textures, albedo maps
- **Compression**: Very high (90%+ reduction)
- **Quality**: Good for most use cases
- **Use case**: Mobile applications, web deployment

#### UASTC (Universal Adaptive Scalable Texture Compression)
- **Best for**: Normal maps, high-quality assets
- **Compression**: Moderate (70-80% reduction) 
- **Quality**: Excellent detail preservation
- **Use case**: High-end visualization, PBR workflows

### Intelligent Compression System

The service includes advanced analysis capabilities to optimize compression strategies:

#### Auto-Detection Features
- **Draco Detection**: Automatically identifies files with existing Draco mesh compression
- **Normal Map Detection**: Recognizes normal maps and applies appropriate compression format
- **Content Analysis**: Analyzes texture types, mesh complexity, and file structure
- **Strategy Selection**: Chooses optimal compression approach based on file analysis

#### Override Parameters
- `forceFormat=true`: Force specific texture format for all textures
- `ignoreDraco=true`: Bypass Draco detection and force full compression
- `flipY=true/false`: Control texture vertical orientation

### Advanced Parameters

The service supports custom compression parameters through the `basisParams` field:

```json
{
  "qualityLevel": 128,
  "maxEndpoints": 8192,
  "generateMipmaps": true,
  "rdo_uastc_quality_scalar": 3,
  "zstdLevel": 10
}
```

## 🏗️ Architecture

```
compression-service/
├── src/
│   ├── compression/           # Core compression logic
│   │   ├── meshCompression.ts
│   │   └── ktx2TextureCompression.ts
│   ├── routes/               # API endpoints
│   │   ├── compression.ts
│   │   └── textureCompression.ts
│   ├── middleware/           # Request handling
│   └── types/               # TypeScript definitions
├── public/                  # Static WASM files
│   ├── draco_*.wasm
│   └── ktx2/
├── docker-compose.yml       # Container orchestration
└── Dockerfile              # Container definition
```

## 🔍 Use Cases

### Game Development
- Reduce asset loading times
- Optimize mobile game performance
- Prepare assets for web deployment

### Web Applications
- Faster 3D model loading
- Reduced bandwidth usage
- Improved user experience

### AR/VR Applications
- Optimize streaming content
- Reduce memory footprint
- Improve rendering performance

### Content Distribution
- Efficient asset delivery
- CDN optimization
- Bandwidth cost reduction

## 🚨 Troubleshooting

### Common Issues

#### WASM Files Not Found
```bash
# Verify WASM files exist
ls -la public/draco_*.wasm public/ktx2/

# Re-copy WASM files if missing
mkdir -p public/ktx2
cp node_modules/draco3dgltf/draco_*.wasm public/
```

#### Port Already in Use
```bash
# Check what's using port 3117
lsof -i :3117

# Use different port
PORT=3118 npm start
```

#### Compression Fails
Check the logs for detailed error information:
```bash
# Docker logs
docker-compose logs -f compression-service

# Direct logs
npm run dev
```

### Memory Issues

For large files, increase Node.js memory:
```bash
node --max-old-space-size=4096 dist/index.js
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Ensure all tests pass: `npm test`
5. Commit using conventional commits
6. Push and create a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [Issue Tracker](<repository-issues-url>)
- [Discussions](<repository-discussions-url>)
- [Changelog](CHANGELOG.md)

## 🙏 Acknowledgments

- [glTF-Transform](https://github.com/donmccurdy/glTF-Transform) - Powerful glTF processing
- [Draco 3D](https://github.com/google/draco) - Google's 3D compression library
- [Basis Universal](https://github.com/BinomialLLC/basis_universal) - Texture compression
- [Hono](https://hono.dev/) - Lightweight web framework

---

**Made with ❤️ for the 3D web community**