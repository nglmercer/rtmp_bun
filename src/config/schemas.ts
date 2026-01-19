import { type } from "arktype";
import type { Type } from "arktype";

// Target configuration schema - represents an RTMP destination like YouTube, Twitch, etc.
export const targetConfigSchema = type({
  id: "string <= 50",
  url: "string",
  key: "string",
  enabled: "boolean",
});

// Server configuration schema - settings for the RTMP server
// Fixed: ArkType 2.x uses 'number' type with narrows for integer constraints
export const serverConfigSchema = type({
  port: type.number.narrow(
    (n) => Number.isInteger(n) && n >= 1024 && n <= 65535,
  ),
  host: "string",
  chunkSize: type.number.narrow(
    (n) => Number.isInteger(n) && n >= 128 && n <= 65535,
  ),
  windowAckSize: type.number.narrow(
    (n) => Number.isInteger(n) && n >= 1 && n <= 4294967295,
  ),
  peerBandwidth: type.number.narrow(
    (n) => Number.isInteger(n) && n >= 1 && n <= 4294967295,
  ),
  logLevel: "string",
  logFile: "string",
  enableRestApi: "boolean",
  restApiPort: type.number.narrow(
    (n) => Number.isInteger(n) && n >= 1 && n <= 65535,
  ),
});

// Full RTMP server configuration schema
export const rtmpConfigSchema = type({
  server: serverConfigSchema,
  targets: targetConfigSchema.array(),
});

// Exported types for TypeScript
export type TargetConfig = typeof targetConfigSchema.infer;
export type ServerConfig = typeof serverConfigSchema.infer;
export type RtmpConfig = typeof rtmpConfigSchema.infer;

// Create a default configuration
export function createDefaultConfig(): RtmpConfig {
  return {
    server: {
      port: 1935,
      host: "0.0.0.0",
      chunkSize: 4096,
      windowAckSize: 2500000,
      peerBandwidth: 2500000,
      logLevel: "info",
      logFile: "./logs/rtmp.log",
      enableRestApi: true,
      restApiPort: 3000,
    },
    targets: [],
  };
}
