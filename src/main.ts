import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
// Asegúrate de importar tu clase RTMPServer correctamente
import { RTMPServer } from "./rtmp-server"; 
import { ramStore } from "./hls-store";

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

// Servir frontend si lo tienes
app.use('*', serveStatic({ 
  root: './public',
  rewriteRequestPath: (path) => path.replace(/^\/public/, '/'),
}));

console.log(`🚀 Servidor HTTP/HLS corriendo en http://localhost:${PORT}`);
const rtmpServer = new RTMPServer(1935);

// Exportar para Bun
export default {
  port: PORT,
  fetch: app.fetch,
  // maxRequestBodySize: 1024 * 1024 * 50 // Opcional: Aumentar límite si es necesario (50MB)
};