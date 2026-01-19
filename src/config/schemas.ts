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
export const serverConfigSchema = type({
  port: ["integer >= 1024 & <= 65535", "number"],
  host: "string",
  chunkSize: ["integer >= 128 & <= 65535", "number"],
  windowAckSize: ["integer >= 1 & <= 4294967295", "number"],
  peerBandwidth: ["integer >= 1 & <= 4294967295", "number"],
  logLevel: "string",
  logFile: "string",
  enableRestApi: "boolean",
  restApiPort: ["string", "number"],
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
