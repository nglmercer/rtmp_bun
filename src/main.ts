import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { RTMPServer } from "./rtmp-server"; // Tu servidor RTMP existente
import { hlsStore } from "./hls-store";     // El nuevo store en memoria

const PORT = 3000;
const app = new Hono();

// 1. Configurar CORS
app.use("/*", cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE"],
}));

// -----------------------------------------------------------------------
// A. RUTAS INTERNAS (FFmpeg -> Hono)
// FFmpeg usa estas rutas para "subir" (PUT) y "borrar" (DELETE) archivos
// -----------------------------------------------------------------------
app.put("/internal/publish/:streamKey/:filename", async (c) => {
  const streamKey = c.req.param("streamKey");
  const filename = c.req.param("filename");
  
  // Leer el binario que manda FFmpeg
  const data = await c.req.arrayBuffer();

  // Determinar Content-Type
  let contentType = "application/octet-stream";
  if (filename.endsWith(".m3u8")) contentType = "application/vnd.apple.mpegurl";
  else if (filename.endsWith(".ts")) contentType = "video/MP2T";
  else if (filename.endsWith(".jpg")) contentType = "image/jpeg";

  // Guardar en RAM
  hlsStore.saveFile(streamKey, filename, data, contentType);

  return c.text("OK");
});

app.delete("/internal/publish/:streamKey/:filename", async (c) => {
  const streamKey = c.req.param("streamKey");
  const filename = c.req.param("filename");
  
  // Borrar de RAM
  hlsStore.deleteFile(streamKey, filename);
  
  return c.text("OK");
});

// -----------------------------------------------------------------------
// B. RUTAS PÚBLICAS (Clientes -> Hono)
// Servir los archivos desde la RAM
// -----------------------------------------------------------------------
app.get("/live/:streamKey/:filename", (c) => {
  const streamKey = c.req.param("streamKey");
  const filename = c.req.param("filename");

  const file = hlsStore.getFile(streamKey, filename);

  if (!file) {
    return c.notFound();
  }

  // Headers importantes para baja latencia
  c.header("Content-Type", file.contentType);
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  
  return c.body(file.buffer);
});

// 3. Servir archivos estáticos normales (tu frontend, player, etc)
app.use('*', serveStatic({ 
  root: './public',
  rewriteRequestPath: (path) => path.replace(/^\/public/, '/'),
}));

// Endpoint de estado
app.get("/", (c) => {
  return c.json({ 
    status: "online", 
    mode: "In-Memory HLS (Zero Disk Write)",
    endpoints: {
      rtmp: `rtmp://localhost:1935/live/{streamKey}`,
      hls: `http://localhost:${PORT}/live/{streamKey}/index.m3u8`,
      preview: `http://localhost:${PORT}/live/{streamKey}/preview.jpg`
    }
  });
});

// Iniciar Servidor RTMP
// Asegúrate de pasarle el puerto HTTP a FFmpegTranscoder dentro de RTMPServer si lo modificaste
const rtmpServer = new RTMPServer(1935);

export default {
  port: PORT,
  fetch: app.fetch,
};