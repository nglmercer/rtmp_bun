import type { RouteHandler } from "../types.js";
import { ResponseUtils } from "../utils/response.js";

export const healthHandler: RouteHandler = (req, ctx) => {
  return ResponseUtils.json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
};

export const rootHandler: RouteHandler = (req, ctx) => {
  return ResponseUtils.json({
    name: "RTMP Bun Server",
    version: "1.0.0",
    status: "running",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "/health",
      config: "/api/config",
      targets: "/api/targets",
      status: "/api/status",
      hls: "/api/hls",
      static: "/",
    }
  });
};
