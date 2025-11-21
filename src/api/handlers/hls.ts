import type { RequestContext, RouteHandler } from "../types.js";
import { ResponseUtils } from "../utils/response.js";
import { hlsManager } from "../hls-manager.js";

// Servir playlist HLS
export const servePlaylist: RouteHandler = async (request, context) => {
  try {
    const playlist = hlsManager.getPlaylist();
    
    if (!playlist) {
      return ResponseUtils.notFound("No HLS stream is currently active");
    }

    return new Response(playlist, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  } catch (error) {
    console.error("Error serving HLS playlist:", error);
    return ResponseUtils.serverError("Failed to serve HLS playlist");
  }
};

// Servir segmentos HLS
export const serveSegment: RouteHandler = async (request, context) => {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const segmentName = pathParts[pathParts.length - 1];
    
    // Extraer número de secuencia del nombre del segmento (ej: segment-001.ts -> 1)
    const sequenceMatch = segmentName.match(/segment-(\d+)\.ts/);
    if (!sequenceMatch) {
      return ResponseUtils.notFound("Invalid segment format");
    }
    
    const sequence = parseInt(sequenceMatch[1]);
    const segmentData = hlsManager.getSegment(sequence);
    
    if (!segmentData) {
      return ResponseUtils.notFound("Segment not found");
    }

    return new Response(segmentData, {
      status: 200,
      headers: {
        "Content-Type": "video/mp2t",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  } catch (error) {
    console.error("Error serving HLS segment:", error);
    return ResponseUtils.serverError("Failed to serve HLS segment");
  }
};

// Iniciar conversión HLS
export const startHls: RouteHandler = async (request, context) => {
  try {
    const url = new URL(request.url);
    const streamKey = url.searchParams.get('streamKey') || 'default';
    
    await hlsManager.startHls(streamKey);
    
    return ResponseUtils.success("HLS conversion started", {
      streamKey,
      playlistUrl: `/hls/playlist.m3u8`
    });
  } catch (error) {
    console.error("Error starting HLS conversion:", error);
    return ResponseUtils.serverError(error instanceof Error ? error.message : "Failed to start HLS conversion");
  }
};

// Detener conversión HLS
export const stopHls: RouteHandler = async (request, context) => {
  try {
    await hlsManager.stopHls();
    
    return ResponseUtils.success("HLS conversion stopped");
  } catch (error) {
    console.error("Error stopping HLS conversion:", error);
    return ResponseUtils.serverError("Failed to stop HLS conversion");
  }
};

// Obtener estado HLS
export const getHlsStatus: RouteHandler = async (request, context) => {
  try {
    const stats = hlsManager.getStats();
    const streamKey = hlsManager.getStreamKey();
    const isRunning = hlsManager.isRunning();
    const availableSequences = hlsManager.getAvailableSequences();
    
    return ResponseUtils.success("HLS status retrieved", {
      isRunning,
      streamKey,
      stats,
      availableSequences,
      playlistUrl: isRunning ? "/hls/playlist.m3u8" : null,
      segmentCount: availableSequences.length
    });
  } catch (error) {
    console.error("Error getting HLS status:", error);
    return ResponseUtils.serverError("Failed to get HLS status");
  }
};
