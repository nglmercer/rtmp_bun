import type { RouteHandler } from "../types.js";
import type { StreamTarget } from "../../config.js";
import { saveConfig } from "../../config.js";
import { ResponseUtils } from "../utils/response.js";

export const getTargetsHandler: RouteHandler = (req, ctx) => {
  return ResponseUtils.json(ctx.config.targets);
};

export const addTargetHandler: RouteHandler = async (req, ctx) => {
  try {
    const newTarget = await req.json() as StreamTarget;
    
    // Validate required fields
    if (!newTarget.id || !newTarget.url) {
      return ResponseUtils.badRequest("Missing required fields: id, url");
    }

    // Check if target already exists
    if (ctx.config.targets.find(t => t.id === newTarget.id)) {
      return ResponseUtils.badRequest(`Target with id '${newTarget.id}' already exists`);
    }

    ctx.config.targets.push(newTarget);
    saveConfig(ctx.config);
    return ResponseUtils.success("Target added", { target: newTarget });
  } catch (error) {
    console.error("Error adding target:", error);
    return ResponseUtils.badRequest("Invalid JSON data");
  }
};

export const enableTargetHandler: RouteHandler = async (req, ctx) => {
  try {
    const requestData = await req.json() as {
      targetId: string;
      enabled: boolean;
      key?: string;
    };
    const { targetId, enabled, key } = requestData;
    
    const target = ctx.config.targets.find((t) => t.id === targetId);
    if (!target) {
      return ResponseUtils.notFound("Target not found");
    }

    target.enabled = enabled;
    if (key !== undefined) target.key = key;
    
    saveConfig(ctx.config);
    return ResponseUtils.success(`Target ${targetId} ${enabled ? "enabled" : "disabled"}`, { target });
  } catch (error) {
    console.error("Error enabling target:", error);
    return ResponseUtils.badRequest("Invalid JSON data");
  }
};

export const disableTargetHandler: RouteHandler = async (req, ctx) => {
  try {
    const requestData = await req.json() as { targetId: string };
    const { targetId } = requestData;
    
    const target = ctx.config.targets.find((t) => t.id === targetId);
    if (!target) {
      return ResponseUtils.notFound("Target not found");
    }

    target.enabled = false;
    saveConfig(ctx.config);
    return ResponseUtils.success(`Target ${targetId} disabled`, { target });
  } catch (error) {
    console.error("Error disabling target:", error);
    return ResponseUtils.badRequest("Invalid JSON data");
  }
};

export const deleteTargetHandler: RouteHandler = (req, ctx) => {
  const targetId = ctx.params?.id;
  if (!targetId) {
    return ResponseUtils.badRequest("Target ID required");
  }

  const index = ctx.config.targets.findIndex((t) => t.id === targetId);
  if (index === -1) {
    return ResponseUtils.notFound("Target not found");
  }

  const removed = ctx.config.targets.splice(index, 1)[0];
  saveConfig(ctx.config);
  return ResponseUtils.success("Target deleted", { target: removed });
};

export const updateTargetHandler: RouteHandler = async (req, ctx) => {
  const targetId = ctx.params?.id;
  if (!targetId) {
    return ResponseUtils.badRequest("Target ID required");
  }

  try {
    const updatedTarget = await req.json() as Partial<StreamTarget>;
    const index = ctx.config.targets.findIndex((t) => t.id === targetId);
    
    if (index === -1) {
      return ResponseUtils.notFound("Target not found");
    }

    // Don't allow updating the ID
    if (updatedTarget.id && updatedTarget.id !== targetId) {
      return ResponseUtils.badRequest("Cannot update target ID");
    }

    ctx.config.targets[index] = Object.assign({}, ctx.config.targets[index], updatedTarget);
    saveConfig(ctx.config);
    return ResponseUtils.success("Target updated", { target: ctx.config.targets[index] });
  } catch (error) {
    console.error("Error updating target:", error);
    return ResponseUtils.badRequest("Invalid JSON data");
  }
};
