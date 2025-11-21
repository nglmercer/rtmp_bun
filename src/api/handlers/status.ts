import type { RouteHandler } from "../types.js";
import { ResponseUtils } from "../utils/response.js";
import { memoryStore } from "../../store.js";
import { hlsManager } from "../hls-manager.js";

export const getStatusHandler: RouteHandler = (req, ctx) => {
  const status = {
    server: {
      port: ctx.config.server.port,
      host: ctx.config.server.host,
      uptime: process.uptime(),
    },
    targets: ctx.config.targets.map((target) => ({
      id: target.id,
      url: target.url,
      enabled: target.enabled,
      hasKey: !!target.key,
      active: ctx.forwarder.getActiveTargets().includes(target.id),
    })),
    activeTargets: ctx.forwarder.getActiveTargets(),
    hls: {
      segments: Array.from(memoryStore.keys()).filter(key => key.endsWith('.ts')).length,
      playlists: Array.from(memoryStore.keys()).filter(key => key.endsWith('.m3u8')).length,
      isRunning: hlsManager.isRunning(),
    }
  };
  return ResponseUtils.json(status);
};

// HLS Handlers
export const hlsIngestHandler: RouteHandler = async (req, ctx) => {
  const url = new URL(req.url);
  const path = url.pathname;
  
  const data = await req.arrayBuffer();
  memoryStore.set(path, new Uint8Array(data));
  console.log(`📦 Recibido en RAM: ${path} (${data.byteLength} bytes)`);
  console.log(`📋 Total archivos en RAM: ${memoryStore.size}`);
  console.log(`📋 Archivos: ${Array.from(memoryStore.keys()).join(', ')}`);
  return ResponseUtils.success("File received");
};

export const hlsDeleteHandler: RouteHandler = async (req, ctx) => {
  const url = new URL(req.url);
  const path = url.pathname;
  
  memoryStore.delete(path);
  console.log(`🗑️ Eliminado de RAM: ${path}`);
  return ResponseUtils.success("File deleted");
};

export const hlsServeHandler: RouteHandler = async (req, ctx) => {
  const url = new URL(req.url);
  const path = url.pathname;
  
  const fileData = memoryStore.get(path);
  
  if (!fileData) {
    return ResponseUtils.notFound("File not found");
  }

  return new Response(fileData, {
    headers: {
      "Content-Type": path.endsWith(".m3u8") 
        ? "application/vnd.apple.mpegurl" 
        : "video/mp2t",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    }
  });
};

export const startHlsHandler: RouteHandler = async (req, ctx) => {
  try {
    const requestData = await req.json() as { inputUrl?: string };
    const inputUrl = requestData.inputUrl || 'rtmp://localhost/live/entrada';
    
    await hlsManager.startHls(inputUrl);
    return ResponseUtils.success("HLS conversion started", {
      inputUrl,
      outputUrl: `http://127.0.0.1:${ctx.config.server.restApiPort}/hls_ingest/stream.m3u8`
    });
  } catch (error) {
    console.error("Error starting HLS:", error);
    return ResponseUtils.serverError("Failed to start HLS conversion");
  }
};

export const stopHlsHandler: RouteHandler = async (req, ctx) => {
  try {
    await hlsManager.stopHls();
    return ResponseUtils.success("HLS conversion stopped");
  } catch (error) {
    console.error("Error stopping HLS:", error);
    return ResponseUtils.serverError("Failed to stop HLS conversion");
  }
};

export const hlsStatusHandler: RouteHandler = (req, ctx) => {
  const status = {
    isRunning: hlsManager.isRunning(),
    segments: Array.from(memoryStore.keys()).filter(key => key.endsWith('.ts')).length,
    playlists: Array.from(memoryStore.keys()).filter(key => key.endsWith('.m3u8')).length,
    outputUrl: `http://127.0.0.1:${ctx.config.server.restApiPort}/hls_ingest/stream.m3u8`
  };
  return ResponseUtils.json(status);
};
