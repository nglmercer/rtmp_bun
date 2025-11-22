import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
// Asegúrate de importar tu clase RTMPServer correctamente
import { RTMPServer } from "./rtmp-server";
import { ramStore } from "./hls-store";
import { TestStreamGenerator, createTestStream } from "./test-stream-generator";

const PORT = 3000;
const app = new Hono();

// 1. Configurar CORS (Vital para que el reproductor web funcione)
app.use("/*", cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE"],
  exposeHeaders: ["Content-Length", "Content-Type"],
}));

// -----------------------------------------------------------------------
// A. RUTAS INTERNAS (FFmpeg -> Hono)
// -----------------------------------------------------------------------

// PUT: FFmpeg sube archivos (.m3u8, .ts, .jpg)
app.put("/internal/publish/:streamKey/:filename", async (c) => {
  const streamKey = c.req.param("streamKey");
  const filename = c.req.param("filename");
  
  // Consumir el stream de entrada INMEDIATAMENTE para evitar timeouts (-10053)
  const data = await c.req.arrayBuffer();

  let contentType = "application/octet-stream";
  if (filename.endsWith(".m3u8")) contentType = "application/vnd.apple.mpegurl";
  else if (filename.endsWith(".ts")) contentType = "video/MP2T";
  else if (filename.endsWith(".jpg")) contentType = "image/jpeg";

  ramStore.saveFile(streamKey, filename, data, contentType);

  return c.text("OK", 200);
});

// DELETE: FFmpeg ordena borrar segmentos viejos
app.delete("/internal/publish/:streamKey/:filename", async (c) => {
  const streamKey = c.req.param("streamKey");
  const filename = c.req.param("filename");
  
  ramStore.deleteFile(streamKey, filename);
  
  return c.text("OK", 200);
});

// -----------------------------------------------------------------------
// B. RUTAS PÚBLICAS (Clientes -> Hono)
// -----------------------------------------------------------------------

app.get("/live/:streamKey/:filename", (c) => {
  const streamKey = c.req.param("streamKey");
  const filename = c.req.param("filename");

  const file = ramStore.getFile(streamKey, filename);

  if (!file) {
    return c.notFound();
  }

  // Headers anti-cache para archivos en vivo
  c.header("Content-Type", file.contentType);
  c.header("Access-Control-Allow-Origin", "*");
  
  if (filename.endsWith('.m3u8') || filename.endsWith('.jpg')) {
      c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  } else {
      // Los segmentos .ts se pueden cachear un poco más (son inmutables)
      c.header("Cache-Control", "public, max-age=10");
  }

  return new Response(file.data, {
    headers: c.res.headers
  });
});

// -----------------------------------------------------------------------
// C. RUTAS DE DIAGNÓSTICO Y TESTING
// -----------------------------------------------------------------------

// Ruta de diagnóstico para verificar el estado del sistema
app.get("/debug/status", (c) => {
  const stats = ramStore.getStats();
  
  // Verificar si hay archivos para el stream "default" como ejemplo
  const defaultPlaylist = ramStore.getFile("default", "playlist.m3u8");
  const defaultPreview = ramStore.getFile("default", "preview.jpg");
  
  // Contar segmentos .ts para el stream default (los primeros 10 para no sobrecargar)
  let segmentCount = 0;
  for (let i = 0; i < 10; i++) {
    const segmentName = `segment_${String(i).padStart(5, '0')}.ts`;
    if (ramStore.getFile("default", segmentName)) {
      segmentCount++;
    }
  }

  return c.json({
    status: "running",
    memory: stats,
    defaultStream: {
      hasPlaylist: !!defaultPlaylist,
      hasPreview: !!defaultPreview,
      segmentCount: segmentCount,
      playlistSize: defaultPlaylist?.size || 0
    },
    timestamp: new Date().toISOString(),
    message: "Para iniciar un stream de prueba, haz POST a /debug/start-test-stream/default"
  });
});

// Ruta para iniciar un stream de prueba
app.post("/debug/start-test-stream/:streamKey?", async (c) => {
  const streamKey = c.req.param("streamKey") || "default";
  
  try {
    await createTestStream(streamKey);
    return c.json({
      success: true,
      message: `Stream de prueba iniciado para: ${streamKey}`,
      playlistUrl: `/live/${streamKey}/playlist.m3u8`
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

// Servir frontend si lo tienes
app.use('*', serveStatic({
  root: './public',
  rewriteRequestPath: (path) => path.replace(/^\/public/, '/'),
}));

console.log(`🚀 Servidor HTTP/HLS corriendo en http://localhost:${PORT}`);
console.log(`📊 Diagnóstico disponible en: http://localhost:${PORT}/debug/status`);
console.log(`🧪 Para iniciar stream de prueba: POST http://localhost:${PORT}/debug/start-test-stream/default`);

// Opcional: Iniciar stream de prueba automáticamente si no hay streams activos
setTimeout(async () => {
  const stats = ramStore.getStats();
  if (stats.totalStreams === 0) {
    console.log(`🔍 No se detectaron streams activos, iniciando stream de prueba...`);
    try {
      await createTestStream("default");
      console.log(`✅ Stream de prueba iniciado. Visita: http://localhost:${PORT}/live/default/playlist.m3u8`);
    } catch (error) {
      console.error(`❌ No se pudo iniciar stream de prueba:`, error);
      console.log(`💡 Para iniciar manualmente: curl -X POST http://localhost:${PORT}/debug/start-test-stream/default`);
    }
  }
}, 2000); // Esperar 2 segundos a que el servidor se inicie completamente

const rtmpServer = new RTMPServer(1935);

// Exportar para Bun
export default {
  port: PORT,
  fetch: app.fetch,
  // maxRequestBodySize: 1024 * 1024 * 50 // Opcional: Aumentar límite si es necesario (50MB)
};