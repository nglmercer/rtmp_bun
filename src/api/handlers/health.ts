import type { RouteHandler } from "../types.js";
import { ResponseUtils } from "../utils/response.js";

export const healthHandler: RouteHandler = (req, ctx) => {
  return ResponseUtils.json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
};