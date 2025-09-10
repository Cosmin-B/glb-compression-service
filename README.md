# Compression Service

A standalone compression service built with Hono framework, designed for 3D model compression using glTF-Transform and Draco compression.

## Features

- **Hono Framework**: Fast, lightweight web framework
- **TypeScript Support**: Full TypeScript implementation
- **glTF Compression**: Integrated with @gltf-transform libraries
- **Draco Compression**: Support for Draco 3D geometry compression
- **Health Check**: Built-in health monitoring endpoint

## Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn

### Installation

1. Clone or navigate to the project directory:
   ```bash
   cd compression-service
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

The server will start on port 3117.

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the TypeScript project
- `npm run start` - Start the production server

## API Endpoints

### Health Check
- **GET** `/health` - Returns service health status

### Root
- **GET** `/` - Returns service information and available endpoints

## Project Structure

```
compression-service/
├── src/
│   ├── middleware/
│   │   └── errorHandler.ts    # Global error handling
│   └── index.ts              # Main server file
├── package.json              # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── .gitignore              # Git ignore rules
└── README.md               # This file
```

## Dependencies

### Core Dependencies
- **hono**: Web framework
- **@gltf-transform/core**: Core glTF processing
- **@gltf-transform/extensions**: glTF extensions support
- **@gltf-transform/functions**: glTF transformation functions
- **draco3dgltf**: Draco 3D compression

### Development Dependencies
- **typescript**: TypeScript compiler
- **tsx**: TypeScript execution for development
- **@types/node**: Node.js type definitions

## Development

The service is ready for extending with compression endpoints. The basic structure includes:

- Error handling middleware
- CORS support
- Request logging
- Health monitoring

Add your compression endpoints in the main `src/index.ts` file or create separate route modules as needed.