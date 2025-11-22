import { describe, test, expect,beforeEach } from "bun:test";
import { Router } from "../src/api/routes/router.js";

describe("Router HLS Memory Segment Routes", () => {
  let router: Router;

  // Setup antes de cada test
  beforeEach(async () => {
    router = await createTestRouter();
  });

  test("debe hacer match con ruta de segmento HLS con extensión .ts", () => {
    const result = router.handle("GET", "/hls-memory/segment-010.ts");
    
    expect(result.handler).toBeDefined();
    expect(result.params).toBeDefined();
    expect(result.params!.sequence).toBe("010.ts");
  });

  test("debe hacer match con ruta de segmento HLS con ceros a la izquierda", () => {
    const result = router.handle("GET", "/hls-memory/segment-009.ts");
    
    expect(result.handler).toBeDefined();
    expect(result.params).toBeDefined();
    expect(result.params!.sequence).toBe("009.ts");
  });

  test("debe hacer match con ruta de segmento HLS sin ceros a la izquierda", () => {
    const result = router.handle("GET", "/hls-memory/segment-9.ts");
    
    expect(result.handler).toBeDefined();
    expect(result.params).toBeDefined();
    expect(result.params!.sequence).toBe("9.ts");
  });

  test("debe hacer match con ruta de segmento HLS sin extensión", () => {
    const result = router.handle("GET", "/hls-memory/segment-010");
    
    expect(result.handler).toBeDefined();
    expect(result.params).toBeDefined();
    expect(result.params!.sequence).toBe("010");
  });

  test("debe hacer match con playlist HLS", () => {
    const result = router.handle("GET", "/hls-memory/playlist.m3u8");
    
    expect(result.handler).toBeDefined();
    expect(result.params).toBeUndefined();
  });
});

// Función auxiliar para crear un router de prueba
async function createTestRouter(): Promise<Router> {
  const router = new Router();
  
  // Mock handler para segmentos
  const mockSegmentHandler = async (req: any, ctx: any) => {
    return new Response(`Segment: ${ctx.params?.sequence}`);
  };
  
  // Mock handler para playlist
  const mockPlaylistHandler = async (req: any, ctx: any) => {
    return new Response("#EXTM3U\n#EXT-X-VERSION:3\n");
  };
  
  // Añadir rutas de prueba
  router.add("GET", "/hls-memory/playlist.m3u8", mockPlaylistHandler);
  router.add("GET", "/hls-memory/segment-:sequence", mockSegmentHandler);
  
  return router;
}