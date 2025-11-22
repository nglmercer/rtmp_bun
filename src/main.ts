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

app.get("/live/:filename", async (c) => {
  const filename = c.req.param("filename");
  
  // Validación básica
  if (!filename || !filename.endsWith('.flv')) {
    return c.text("Formato invalido. Se requiere .flv", 400);
  }

  const streamKey = filename.replace('.flv', '');
  
  // Verificar existencia del stream
  const stream = flvStreamManager.getOrCreateStream(streamKey);
  
  // Opcional: Si quieres ser estricto y devolver 404 si no hay nadie transmitiendo
  if (!stream.isActive) {
     return c.text("Stream offline", 404);
  }

  const body = new ReadableStream({
    start(controller) {
      console.log(`[FLV] 🎥 Nuevo espectador conectado: ${streamKey}`);

      // DEFINIR EL CALLBACK
      const callback = (data: Buffer) => {
        // Solo enviamos si el cliente sigue conectado
        if (controller.desiredSize !== null) {
           controller.enqueue(data);
        }
      };

      // --- CORRECCIÓN AQUÍ ---
      // ❌ NO HACER ESTO (Tu código anterior):
      // controller.enqueue(FLVWrapper.getHeader()); // Esto enviaba doble cabecera o cabecera sin config
      // stream.subscribers.add(callback); // Esto se saltaba el cache de headers

      // ✅ HACER ESTO (Usar la lógica del Manager):
      // El método subscribe se encarga de enviar:
      // 1. FLV Header (si está en cache)
      // 2. MetaData (si está en cache)
      // 3. Video Sequence Header (CRÍTICO: SPS/PPS para decodificar)
      // 4. Audio Sequence Header
      flvStreamManager.subscribe(streamKey, callback);
      
      // Manejar desconexión
      c.req.raw.signal.addEventListener('abort', () => {
        console.log(`[FLV] 📡 Espectador desconectado: ${streamKey}`);
        // Usar el método unsubscribe del manager
        flvStreamManager.unsubscribe(streamKey, callback);
      });
    },
    cancel() {
       // Limpieza adicional si fuera necesaria
    }
  });

  return new Response(body, {
    headers: {
      "Content-Type": "video/x-flv",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive",
      "Cache-Control": "no-cache, no-store, must-revalidate", // Importante para live
      "Pragma": "no-cache",
      "Expires": "0"
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