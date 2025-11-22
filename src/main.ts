import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
// Asegúrate de importar tu clase RTMPServer correctamente
import { RTMPServer } from "./rtmp-server";
import { flvStreamManager } from "./flv-stream-manager";
import { FLVWrapper } from "./flv-utils";

const PORT = 3000;
const app = new Hono();

// 1. Configurar CORS (Vital para que el reproductor web funcione)
app.use("/*", cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE"],
  exposeHeaders: ["Content-Length", "Content-Type"],
}));

// -----------------------------------------------------------------------
// A. RUTAS INTERNAS - ELIMINADAS PARA FLV
// -----------------------------------------------------------------------
// Ya no necesitamos rutas internas para HLS/segmentos
// El stream FLV se maneja directamente vía pipe

// -----------------------------------------------------------------------
// B. RUTAS PÚBLICAS (Clientes -> Hono)
// -----------------------------------------------------------------------

// Ruta principal para streaming FLV vía HTTP
app.get("/live/:filename", async (c) => {
  // 1. Capturamos todo el nombre del archivo, ej: "obs_stream.flv"
  const filename = c.req.param("filename");

  console.log(`[Debug] Petición recibida para: ${filename}`);

  // 2. Validación de seguridad básica
  if (!filename || !filename.endsWith('.flv')) {
    return c.text("Formato invalido. Se requiere .flv", 400);
  }

  // 3. Limpiamos la extensión para obtener la Key real
  // "obs_stream.flv" -> "obs_stream"
  const streamKey = filename.replace('.flv', '');
  
  console.log(`[Debug] StreamKey limpia: ${streamKey}`);

  if (!streamKey) {
      return c.text("StreamKey vacía", 400);
  }

  // --- A PARTIR DE AQUI TU LÓGICA ORIGINAL ---

  // Obtener o crear stream FLV
  const stream = flvStreamManager.getOrCreateStream(streamKey);
  
  if (!stream) {
    console.error(`[FLV] ❌ Stream no encontrado en Manager: ${streamKey}`);
    return c.text("Stream no activo", 404);
  }

  // Crear un Response con streaming
  const body = new ReadableStream({
    start(controller) {
      console.log(`[FLV] 🎥 Cliente HTTP conectado: ${streamKey}`);
      
      // Enviar cabecera FLV inicial
      controller.enqueue(FLVWrapper.getHeader());
      
      const callback = (data: Buffer) => {
        // Verificar que el controller no esté cerrado antes de enviar
        if (controller.desiredSize !== null) {
             controller.enqueue(data);
        }
      };
      
      stream.subscribers.add(callback);
      
      // Manejar desconexión (abort signal)
      c.req.raw.signal.addEventListener('abort', () => {
        console.log(`[FLV] 📡 Cliente desconectado: ${streamKey}`);
        stream.subscribers.delete(callback);
      });
    },
    cancel() {
       // Lógica de limpieza extra si es necesaria
    }
  });

  return new Response(body, {
    headers: {
      "Content-Type": "video/x-flv",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive",
      "Cache-Control": "no-cache"
    }
  });
});

// Ruta para obtener estadísticas del stream
app.get("/live/:streamKey/status", (c) => {
  const streamKey = c.req.param("streamKey");
  const stats = flvStreamManager.getStreamStats(streamKey);
  
  if (!stats) {
    return c.json({ error: "Stream no encontrado" }, 404);
  }
  
  return c.json(stats);
});

// Servir frontend si lo tienes
app.use('*', serveStatic({ 
  root: './public',
  rewriteRequestPath: (path) => path.replace(/^\/public/, '/'),
}));

console.log(`🚀 Servidor HTTP/FLV corriendo en http://localhost:${PORT}`);
const rtmpServer = new RTMPServer(1935);

// Exportar para Bun
export default {
  port: PORT,
  fetch: app.fetch,
  // maxRequestBodySize: 1024 * 1024 * 50 // Opcional: Aumentar límite si es necesario (50MB)
};