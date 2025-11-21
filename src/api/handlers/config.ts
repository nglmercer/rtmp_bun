import type { RouteHandler } from "../types.js";
import { saveConfig } from "../../config.js";
import { ResponseUtils } from "../utils/response.js";

export const getConfigHandler: RouteHandler = (req, ctx) => {
  return ResponseUtils.json(ctx.config);
};

export const updateConfigHandler: RouteHandler = async (req, ctx) => {
  try {
    const newConfig = await req.json();
    const updatedConfig = Object.assign({}, ctx.config, newConfig);
    ctx.updateConfig(updatedConfig);
    saveConfig(updatedConfig);
    return ResponseUtils.success("Configuration updated", { config: updatedConfig });
  } catch (error) {
    console.error("Error updating config:", error);
    return ResponseUtils.badRequest("Invalid JSON data");
  }
};
