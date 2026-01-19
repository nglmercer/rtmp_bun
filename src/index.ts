// RTMP Bun Server - Entry Point
// Re-export and consolidate all main classes and utilities for easier imports

// Export core RTMP server
export { RTMPServer } from "./main";

// Export RTMP connection management
export {
  RtmpConnection,
  createRtmpConnection,
  type ConnectionState,
  type MediaStreamType,
} from "./rtmp/connection";

// Export handshake module
export * from "./handshake/index";

// Export configuration
export {
  ConfigLoader,
  loadConfig,
  createDefaultConfigFile,
} from "./config/loader";
export {
  serverConfigSchema,
  targetConfigSchema,
  rtmpConfigSchema,
  createDefaultConfig,
  type RtmpConfig,
  type ServerConfig,
  type TargetConfig,
} from "./config/schemas";

// Export types
export type {
  RtmpHeader,
  RtmpPacket,
  ConnectionConfig,
  RtmpEventHandlers,
} from "./rtmp/connection";
