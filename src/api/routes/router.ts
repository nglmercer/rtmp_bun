import type { RouteHandler, RequestContext } from "../types.js";

export class Router {
  private routes: Map<string, Map<string, RouteHandler>> = new Map();

  add(method: string, path: string, handler: RouteHandler): void {
    if (!this.routes.has(method)) {
      this.routes.set(method, new Map());
    }
    this.routes.get(method)!.set(path, handler);
  }

  // Maneja rutas con parámetros (ej: /api/targets/:id)
  handle(method: string, path: string): { handler?: RouteHandler; params?: Record<string, string> } {
    const methodRoutes = this.routes.get(method);
    if (!methodRoutes) return {};

    // Primero busca coincidencia exacta
    if (methodRoutes.has(path)) {
      return { handler: methodRoutes.get(path)! };
    }

    // Luego busca rutas con parámetros
    for (const [routePath, handler] of methodRoutes) {
      const params = this.matchPath(routePath, path);
      if (params !== null) {
        return { handler, params };
      }
    }

    return {};
  }

  private matchPath(routePath: string, actualPath: string): Record<string, string> | null {
    const routeParts = routePath.split('/');
    const pathParts = actualPath.split('/');

    if (routeParts.length !== pathParts.length) return null;

    const params: Record<string, string> = {};

    for (let i = 0; i < routeParts.length; i++) {
      const routePart = routeParts[i];
      const pathPart = pathParts[i];

      if (routePart.startsWith(':')) {
        params[routePart.slice(1)] = pathPart;
      } else if (routePart !== pathPart) {
        return null;
      }
    }

    return params;
  }
}

// Función para crear y configurar el router con todas las rutas
export async function createRouter(): Promise<Router> {
  const router = new Router();

  // Importar todos los handlers
  const {
    healthHandler,
    rootHandler
  } = await import("../handlers/health.js");

  const {
    getConfigHandler,
    updateConfigHandler
  } = await import("../handlers/config.js");

  const {
    getTargetsHandler,
    addTargetHandler,
    enableTargetHandler,
    disableTargetHandler,
    deleteTargetHandler,
    updateTargetHandler
  } = await import("../handlers/targets.js");

  const {
    getStatusHandler,
    hlsIngestHandler,
    hlsDeleteHandler,
    hlsServeHandler,
    startHlsHandler,
    stopHlsHandler,
    hlsStatusHandler
  } = await import("../handlers/status.js");

  const {
    servePlaylist,
    serveSegment,
    startHls,
    stopHls,
    getHlsStatus
  } = await import("../handlers/hls.js");

  // Rutas de salud y estado
  router.add("GET", "/", rootHandler);
  router.add("GET", "/health", healthHandler);

  // Rutas de configuración
  router.add("GET", "/api/config", getConfigHandler);
  router.add("PUT", "/api/config", updateConfigHandler);

  // Rutas de targets
  router.add("GET", "/api/targets", getTargetsHandler);
  router.add("POST", "/api/targets", addTargetHandler);
  router.add("POST", "/api/targets/enable", enableTargetHandler);
  router.add("POST", "/api/targets/disable", disableTargetHandler);
  router.add("DELETE", "/api/targets/:id", deleteTargetHandler);
  router.add("PUT", "/api/targets/:id", updateTargetHandler);

  // Rutas de estado
  router.add("GET", "/api/status", getStatusHandler);

  // Rutas HLS (HTTP Callback) - Mantener las existentes por compatibilidad
  router.add("PUT", "/hls_ingest/*", hlsIngestHandler);
  router.add("DELETE", "/hls_ingest/*", hlsDeleteHandler);
  router.add("GET", "/hls_ingest/*", hlsServeHandler);

  // Rutas HLS nuevas (usando ffmpeg-lib)
  router.add("GET", "/hls/playlist.m3u8", servePlaylist);
  router.add("GET", "/hls/segment-:sequence.ts", serveSegment);

  // Rutas de control HLS (API REST)
  router.add("POST", "/api/hls/start", startHls);
  router.add("POST", "/api/hls/stop", stopHls);
  router.add("GET", "/api/hls/status", getHlsStatus);
  
  // Mantener las rutas antiguas por compatibilidad
  router.add("POST", "/api/hls/start-legacy", startHlsHandler);
  router.add("POST", "/api/hls/stop-legacy", stopHlsHandler);
  router.add("GET", "/api/hls/status-legacy", hlsStatusHandler);
  
  // Ruta de debug para inspeccionar archivos en memoria
  router.add("GET", "/debug/files", async (req, ctx) => {
    const { memoryStore } = await import("../../store.js");
    const files = Array.from(memoryStore.entries()).map(([path, data]) => ({
      path,
      size: data.byteLength,
      type: path.endsWith('.m3u8') ? 'playlist' : path.endsWith('.ts') ? 'segment' : 'other'
    }));
    return new Response(JSON.stringify(files, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  });

  return router;
}
