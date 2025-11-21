import type { RequestContext, RouteHandler } from "../types.js";
import { ResponseUtils } from "../utils/response.js";
import { hlsMemoryManager } from "../hls-memory-manager.js";

// Servir playlist HLS desde memoria
export const serveMemoryPlaylist: RouteHandler = async (request, context) => {
  try {
    const playlist = hlsMemoryManager.getPlaylist();
    
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
    console.error("Error serving HLS playlist from memory:", error);
    return ResponseUtils.serverError("Failed to serve HLS playlist");
  }
};

// Servir segmentos HLS desde memoria
export const serveMemorySegment: RouteHandler = async (request, context) => {
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
    const segmentData = hlsMemoryManager.getSegment(sequence);
    
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
    console.error("Error serving HLS segment from memory:", error);
    return ResponseUtils.serverError("Failed to serve HLS segment");
  }
};

// Iniciar conversión HLS desde memoria
export const startMemoryHls: RouteHandler = async (request, context) => {
  try {
    let streamKey = 'default'; // Valor por defecto
    
    console.log("DEBUG: Request content-type:", request.headers.get('content-type'));
    console.log("DEBUG: Request URL:", request.url);
    
    // Parsear body JSON si es una petición POST con content-type application/json
    if (request.method === 'POST' && request.headers.get('content-type')?.includes('application/json')) {
      try {
        const bodyText = await request.text();
        console.log("DEBUG: Raw body text:", bodyText);
        
        if (bodyText) {
          const body = JSON.parse(bodyText);
          console.log("DEBUG: Parsed body:", body);
          if (body.streamKey) {
            streamKey = body.streamKey;
            console.log("DEBUG: Stream key from body:", streamKey);
          }
        }
      } catch (e) {
        console.log("DEBUG: Error parsing body:", e);
        // Si falla el parseo del JSON, usar query params
      }
    }
    
    // Si no hay streamKey en el body, intentar con query params
    if (streamKey === 'default') {
      const url = new URL(request.url);
      const queryStreamKey = url.searchParams.get('streamKey');
      if (queryStreamKey) {
        streamKey = queryStreamKey;
        console.log("DEBUG: Stream key from query:", streamKey);
      }
    }
    
    // Validar que no sea vacío, null, "unknown" o "undefined"
    if (!streamKey || streamKey.trim() === '' || streamKey === 'unknown' || streamKey === 'undefined') {
      streamKey = 'default';
    }
    
    console.log("DEBUG: Final stream key:", streamKey);
    
    const bitrateKbps = new URL(request.url).searchParams.get('bitrate') ? parseInt(new URL(request.url).searchParams.get('bitrate')!) : undefined;
    
    await hlsMemoryManager.startHls(streamKey);
    
    // Configurar bitrate si se proporcionó
    if (bitrateKbps && !isNaN(bitrateKbps)) {
      hlsMemoryManager.setEstimatedBitrate(bitrateKbps);
    }
    
    return ResponseUtils.success("HLS conversion from memory started", {
      streamKey,
      playlistUrl: "/hls-memory/playlist.m3u8",
      bitrateKbps
    });
  } catch (error) {
    console.error("Error starting HLS conversion from memory:", error);
    return ResponseUtils.serverError(error instanceof Error ? error.message : "Failed to start HLS conversion from memory");
  }
};

// Detener conversión HLS desde memoria
export const stopMemoryHls: RouteHandler = async (request, context) => {
  try {
    await hlsMemoryManager.stopHls();
    
    return ResponseUtils.success("HLS conversion from memory stopped");
  } catch (error) {
    console.error("Error stopping HLS conversion from memory:", error);
    return ResponseUtils.serverError("Failed to stop HLS conversion from memory");
  }
};

// Obtener estado HLS desde memoria
export const getMemoryHlsStatus: RouteHandler = async (request, context) => {
  try {
    const stats = hlsMemoryManager.getStats();
    const streamKey = hlsMemoryManager.getStreamKey();
    const isRunning = hlsMemoryManager.isRunning();
    const availableSequences = hlsMemoryManager.getAvailableSequences();
    const bufferInfo = hlsMemoryManager.getBufferInfo();
    
    return ResponseUtils.success("HLS status retrieved", {
      isRunning,
      streamKey,
      stats,
      availableSequences,
      bufferInfo,
      playlistUrl: isRunning ? "/hls-memory/playlist.m3u8" : null,
      segmentCount: availableSequences.length
    });
  } catch (error) {
    console.error("Error getting HLS status from memory:", error);
    return ResponseUtils.serverError("Failed to get HLS status from memory");
  }
};

// Configurar bitrate estimado
export const setBitrate: RouteHandler = async (request, context) => {
  try {
    const url = new URL(request.url);
    const bitrateKbps = url.searchParams.get('bitrate');
    
    if (!bitrateKbps || isNaN(parseInt(bitrateKbps))) {
      return ResponseUtils.badRequest("Valid bitrate parameter is required");
    }
    
    const bitrate = parseInt(bitrateKbps);
    hlsMemoryManager.setEstimatedBitrate(bitrate);
    
    return ResponseUtils.success("Bitrate configured", {
      bitrateKbps: bitrate
    });
  } catch (error) {
    console.error("Error setting bitrate:", error);
    return ResponseUtils.serverError("Failed to set bitrate");
  }
};