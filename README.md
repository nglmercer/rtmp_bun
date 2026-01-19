# RTMP Bun Server

A high-performance RTMP streaming server built with Bun, featuring arktype validation, TOML configuration, and comprehensive handshake protocol implementation.

## Features

- **RTMP Protocol**: Complete RTMP (Real-Time Messaging Protocol) server implementation
- **Validation**: Arktype validation for all configuration with runtime type safety
- **Configuration**: TOML-based configuration with auto-reload support
- **Handshake**: Complete RTMP handshake implementation with proper protocol support
- **REST API**: Built-in REST API for server metrics and configuration management
- **Stream Forwarding**: Support for forwarding streams to multiple targets (YouTube, Twitch, Facebook, Custom)
- **Testing**: Comprehensive bun:test unit tests

## Project Structure

```
rtmp_bun/
├── src/
│   ├── config/
│   │   ├── loader.ts       # TOML/JSON config loader with arktype validation
│   │   └── schemas.ts      # Arktype validation schemas
│   ├── handshake/
│   │   └── index.ts        # RTMP handshake protocol implementation
│   ├── rtmp/
│   │   └── connection.ts   # RTMP connection handler with packet parsing
│   └── main.ts             # Main RTMP server entry point
├── test/
│   ├── handshake.test.ts   # Handshake module tests
│   └── config.test.ts      # Configuration module tests
├── config.toml             # Main configuration file
└── config.json             # Alternative JSON configuration
```

## Installation

```bash
# Install dependencies
bun install
```

## Usage

### Quick Start

```bash
# Run the development server
bun run dev

# Run the production server
bun run start

# Run tests
bun run test

# Type checking
bun run typecheck

# Linting
bun run lint
```

### Configuration

Create a `config.toml` file in the project root:

```toml
[server]
port = 1935
host = "0.0.0.0"

# RTMP protocol settings
chunkSize = 4096
windowAckSize = 2500000
peerBandwidth = 2500000

# Logging
logLevel = "info"
logFile = "./logs/rtmp.log"

# REST API (optional)
enableRestApi = true
restApiPort = 3000

# Connection settings
timeoutMs = 10000
maxConnections = 100
enableRequests = true

# Stream Targets (RTMP destinations)
[[targets]]
id = "youtube"
url = "rtmp://a.rtmp.youtube.com/live2"
key = "your-youtube-stream-key"
enabled = false

[[targets]]
id = "twitch"
url = "rtmp://live.twitch.tv/app"
key = "your-twitch-stream-key"
enabled = false

[[targets]]
id = "facebook"
url = "rtmps://live-api-s.facebook.com:443/rtmp"
key = "your-facebook-stream-key"
enabled = false
```

### Using the Configuration Loader

```typescript
import { ConfigLoader, loadConfig, createDefaultConfigFile } from "./src/config/loader";
import { createDefaultConfig } from "./src/config/schemas";

// Load configuration
const config = await loadConfig({ configPath: "./config.toml" });

// Create a default config file
await createDefaultConfigFile("./config.toml", "toml");

// Use ConfigLoader for advanced features (auto-reload, validation)
const loader = new ConfigLoader({
    configPath: "./config.toml",
    watch: true,  // Auto-reload on config changes
    format: "auto"  // Detect JSON/TOML by extension
});

// Listen for config updates
loader.onUpdate((newConfig) => {
    console.log("Configuration updated:", newConfig.server.port);
});

await loader.load();
```

### Using the Handshake Module

```typescript
import { RtmpHandshake, RtmpServerHandshake, performHandshakeSimulation } from "./src/handshake/index";

// Create client-side handshake
const client = new RtmpHandshake();
const c0c1 = client.generateClientHandshake();

// Create server-side handshake
const server = new RtmpServerHandshake();
const s0s1s2 = server.generateServerResponse(c0c1);

// Process server response and generate C2
const c2 = client.generateC2(s0s1s2.subarray(1, 1537));

// Or use the simulation helper
const handshakeResult = await performHandshakeSimulation(client, server);
if (handshakeResult.success) {
    console.log("Handshake completed");
}
```

### RTMP Connection Handling

```typescript
import { RtmpConnection } from "./src/rtmp/connection";

const connection = new RtmpConnection(
    // Configuration
    {
        chunkSize: 4096,
        windowAckSize: 2500000,
        peerBandwidth: 2500000
    },
    // Event handlers
    {
        onConnect: (client) => console.log("Connected"),
        onDisconnect: (client, reason) => console.log("Disconnected:", reason),
        onMessage: (message, client) => console.log("Message:", message.type),
        onStreamPublishStart: (streamName, client) => console.log("Publish started:", streamName),
        onStreamPlayStart: (streamName, client) => console.log("Play started:", streamName)
    }
);
```

### Using the RTMP Server

```typescript
import RTMPServer from "./src/main";

const server = new RTMPServer({
    configPath: "./config.toml",
    watchConfig: true,  // Watch for config changes
    autoStart: false
});

// Load configuration
await server.loadConfig();

// Start the server
await server.start();

// Get server stats
console.log(server.getStats());
// { running: true, connections: 2, config: {...} }

// Update targets dynamically
await server.updateTargets([
    {
        id: "custom",
        url: "rtmp://your-server.com",
        key: "stream-key",
        enabled: true
    }
]);

// Stop the server
await server.stop();
```

## Testing

The project includes comprehensive unit tests for the handshake and configuration modules.

```bash
# Run all tests
bun test

# Run specific test file
bun test test/handshake.test.ts

# Run with coverage (if supported by bun test)
bun test --coverage
```

### Test Coverage

- **Handshake Module**:
  - Shared secret generation
  - Digest creation and validation
  - C0, C1, C2 packet generation
  - Server response processing
  - State management
  - Error handling
  - Complete handshake simulation

- **Configuration Module**:
  - Schema validation (arktype)
  - TOML/JSON parsing
  - Auto-reload watching
  - File creation and saving
  - Configuration updates
  - Error handling

## Validation with Arktype

All configuration is validated using arktype schemas:

```typescript
import { rtmpConfigSchema, serverConfigSchema, targetConfigSchema } from "./src/config/schemas";

// Validate server config
const result = serverConfigSchema({
    port: 1935,
    host: "0.0.0.0",
    chunkSize: 4096,
    // ... more fields
});

if (result.problems) {
    console.error("Validation failed:", result.problems);
} else {
    console.log("Valid config:", result.data);
}
```

## Architecture

### Configuration Layer
- **loader.ts**: Handles TOML/JSON parsing, file I/O, validation, and watching
- **schemas.ts**: Arktype schemas for type-safe configuration validation

### Handshake Layer
- **index.ts**: Complete RTMP handshake implementation with C0/C1/C2/S0/S1/S2
- Supports simulated and real handshake scenarios
- Includes digest validation and shared secret generation

### RTMP Protocol Layer
- **connection.ts**: RTMP packet parsing, chunking, and message handling
- Implements AMF0/AMF3 serialization for RTMP commands
- Handles all standard RTMP message types

### Main Server
- **main.ts**: TCP server, REST API, stream forwarding logic
- Manages connection lifecycle and event propagation

## Performance

- **Zero-overhead node_modules**: Uses Bun's native runtime
- **Fast config parsing**: TOML parsing with native Bun APIs
- **Efficient buffer handling**: Optimized Buffer operations throughout
- **Async I/O**: Non-blocking server operations

## Error Handling

All modules include comprehensive error handling:

- Configuration validation errors
- Malformed TOML/JSON detection
- Handshake protocol errors
- Network timeout handling
- Stream forwarding errors

## TypeScript Support

Full TypeScript support with strict typing throughout:

```typescript
import type {
    RtmpConfig,
    ServerConfig,
    TargetConfig,
    HandshakeResult,
    HandshakeContext,
    ConnectionState,
    RtmpPacket,
    RtmpMessage
} from "./src/index";
```

## Dependencies

- **arktype**: Runtime type validation and inference
- **@iarna/toml**: TOML parsing and stringification
- **@types/node**: Node.js type definitions
- **bun-types**: Bun runtime type definitions

## License

MIT

## Contributing

Contributions are welcome! Please ensure all tests pass before submitting pull requests.

```bash
# Run tests before committing
bun test
```

## Troubleshooting

### Port Already in Use
```bash
# Find and kill process using port 1935
lsof -ti:1935 | xargs kill -9
```

### Config Validation Errors
- Ensure all required fields are present
- Check port ranges (1024-65535)
- Verify boolean values for `enabled` flags

### Handshake Errors
- Ensure proper RTMP client protocol support
- Check network connectivity
- Verify stream key validity