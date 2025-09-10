# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Professional open source documentation
- Contributing guidelines
- MIT License
- Comprehensive troubleshooting guide

## [1.0.0] - 2025-01-10

### Added
- Initial release of Compression Service
- Hono framework-based REST API
- Draco mesh compression support
- KTX2 texture compression with Basis Universal
- Multi-format image support (PNG, JPG, JPEG, WebP)
- GLB texture processing and compression
- Individual and combined compression workflows
- Docker containerization with Docker Compose
- Health monitoring endpoints
- CORS support for web applications
- Comprehensive logging and error handling
- Static WASM file serving
- Response headers with compression statistics

### Endpoints Added
- `GET /health` - Service health check
- `GET /` - Service information and available endpoints
- `POST /compress/mesh` - Draco mesh compression
- `POST /compress/textures` - KTX2 texture compression
- `POST /compress/full` - Combined mesh and texture compression
- `POST /texture/png-to-ktx2` - PNG to KTX2 conversion (legacy)
- `POST /texture/image-to-ktx2` - Enhanced image to KTX2 conversion
- `POST /texture/glb-textures` - GLB texture compression
- `GET /compress/health` - Compression service status

### Features
- **High Performance**: Up to 95% compression ratio for meshes
- **Texture Quality Control**: ETC1S and UASTC format support
- **Automatic Normal Map Detection**: Intelligent format selection
- **Configurable Parameters**: Custom compression settings
- **Y-Flip Support**: Coordinate system compatibility
- **Production Ready**: Docker deployment with health checks
- **TypeScript**: Full type safety and modern development

### Technical Specifications
- Node.js 18.0.0+ requirement
- TypeScript implementation
- WebAssembly integration for compression libraries
- Comprehensive error handling
- Request/response logging
- Cross-origin resource sharing (CORS)

---

## Version History Format

### [Version] - Date

#### Added
- New features and capabilities

#### Changed  
- Changes to existing functionality

#### Deprecated
- Features marked for removal

#### Removed
- Features removed in this version

#### Fixed
- Bug fixes and corrections

#### Security
- Security-related changes

---

## Release Process

1. Update version in `package.json`
2. Update this CHANGELOG.md
3. Create git tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
4. Push tag: `git push origin --tags`
5. Create GitHub release
6. Update Docker images if applicable

## Performance Benchmarks by Version

### v1.0.0
- Mesh compression: 95.1% reduction (135KB → 6.6KB)
- Texture compression: 96.4% reduction (7.8MB → 281KB) 
- Combined GLB: 87.9% reduction (4.1MB → 495KB)
- Processing time: <2s for typical models

---

*For breaking changes and migration guides, see the [Migration Guide](docs/MIGRATION.md).*