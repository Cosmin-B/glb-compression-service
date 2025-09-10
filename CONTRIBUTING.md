# Contributing to glTF Compression Service

Thank you for your interest in contributing to the glTF Compression Service! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)
- [Development Guidelines](#development-guidelines)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone. Please be kind and constructive in all interactions.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Set up the development environment
4. Create a branch for your changes
5. Make your changes
6. Test your changes
7. Submit a pull request

## Development Setup

### Prerequisites

- Node.js 18.0.0 or higher
- npm 8.0.0 or higher
- Git

### Installation

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/gltf-compression-service.git
cd gltf-compression-service

# Install dependencies
npm install

# Build the project
npm run build

# Start development server
npm run dev
```

### Project Structure

```
compression-service/
├── src/
│   ├── compression/          # Core compression functionality
│   ├── routes/              # API route handlers
│   ├── middleware/          # Express middleware
│   ├── types/               # TypeScript type definitions
│   └── index.ts             # Main application entry point
├── public/                  # Static WASM files
├── scripts/                 # Build and utility scripts
├── docs/                    # Documentation
└── dist/                    # Compiled output (generated)
```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-webp-support` - New features
- `fix/memory-leak-in-compression` - Bug fixes
- `docs/update-api-examples` - Documentation updates
- `refactor/optimize-texture-pipeline` - Code refactoring

### Commit Messages

Follow conventional commit format:
- `feat: add WebP texture compression support`
- `fix: resolve memory leak in Draco compression`
- `docs: update API usage examples`
- `refactor: optimize texture compression pipeline`
- `test: add unit tests for mesh compression`

## Submitting Changes

### Pull Request Process

1. **Update Documentation**: Ensure README.md and API documentation reflect your changes
2. **Add Tests**: Include unit tests for new functionality
3. **Update CHANGELOG**: Add your changes to the unreleased section
4. **Check Build**: Ensure `npm run build` passes without errors
5. **Test Locally**: Verify your changes work with `npm run dev`

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Testing
- [ ] Unit tests pass (`npm test`)
- [ ] Manual testing completed
- [ ] Documentation updated

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No breaking changes (or clearly documented)
```

## Reporting Issues

### Bug Reports

Include:
- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, OS, etc.)
- Sample files if applicable (compressed as .zip)

### Feature Requests

Include:
- Clear description of the requested feature
- Use case and benefits
- Proposed implementation approach (if any)
- Willingness to contribute the implementation

## Development Guidelines

### Code Style

- **TypeScript**: Use TypeScript for all new code
- **ESLint**: Follow existing linting rules
- **Formatting**: Use consistent formatting (2 spaces, semicolons)
- **Naming**: Use camelCase for variables and functions, PascalCase for classes

### API Design

- **RESTful**: Follow REST principles for new endpoints
- **Versioning**: Consider backward compatibility
- **Error Handling**: Return appropriate HTTP status codes and error messages
- **Documentation**: Update OpenAPI/Swagger specs for new endpoints

### Testing

- **Unit Tests**: Write tests for new functionality
- **Integration Tests**: Test API endpoints end-to-end
- **Performance**: Consider performance implications of changes
- **Memory**: Watch for memory leaks in compression operations

### Dependencies

- **Security**: Check dependencies for known vulnerabilities
- **Licensing**: Ensure new dependencies use compatible licenses (MIT, Apache-2.0, BSD)
- **Size**: Consider bundle size impact
- **Maintenance**: Prefer well-maintained packages

### Compression Standards

- **glTF**: Follow glTF 2.0 specification
- **Draco**: Use optimal Draco compression settings
- **KTX2**: Implement proper KTX2/Basis Universal compression
- **Standards**: Stay current with 3D graphics standards

## Areas for Contribution

### High Priority
- **Test Coverage**: Expand unit and integration test coverage
- **Performance**: Optimize compression algorithms
- **Documentation**: Improve API documentation and examples
- **Error Handling**: Enhanced error reporting and recovery

### Medium Priority
- **New Formats**: Support for additional texture formats
- **CLI Tool**: Command-line interface for batch processing
- **Monitoring**: Health checks and metrics
- **Caching**: Implement compression result caching

### Nice to Have
- **WebAssembly**: Port more compression to WASM for performance
- **Streaming**: Support for streaming compression
- **Plugin System**: Extensible compression pipeline
- **GUI**: Web-based compression interface

## Getting Help

- **Issues**: Check existing issues for similar problems
- **Discussions**: Use GitHub Discussions for general questions
- **Documentation**: Refer to README.md and API documentation
- **Examples**: Check the examples in the documentation

## Recognition

Contributors will be recognized in:
- README.md contributors section
- CHANGELOG.md for significant contributions
- GitHub contributors graph

Thank you for contributing to the glTF Compression Service!