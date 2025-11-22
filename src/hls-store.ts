import { type Context } from "hono";

interface InMemoryFile {
  buffer: Buffer;
  createdAt: number;
  contentType: string;
}

class HLSMemoryStore {
  // Estructura: Map<"streamKey/filename", FileData>
  private storage = new Map<string, InMemoryFile>();

  saveFile(streamKey: string, filename: string, data: Buffer | ArrayBuffer, contentType: string) {
    const key = `${streamKey}/${filename}`;
    
    this.storage.set(key, {
      buffer: Buffer.isBuffer(data) ? data : Buffer.from(data),
      createdAt: Date.now(),
      contentType
    });
  }

  getFile(streamKey: string, filename: string): InMemoryFile | undefined {
    return this.storage.get(`${streamKey}/${filename}`);
  }

  deleteFile(streamKey: string, filename: string) {
    this.storage.delete(`${streamKey}/${filename}`);
  }

  // Limpieza de basura: borra segmentos viejos que FFmpeg quizás olvidó borrar
  cleanup(maxAgeMs = 60000) {
    const now = Date.now();
    for (const [key, file] of this.storage.entries()) {
      if (now - file.createdAt > maxAgeMs) {
        this.storage.delete(key);
      }
    }
  }
}

export const hlsStore = new HLSMemoryStore();

// Ejecutar limpieza cada 30s
setInterval(() => hlsStore.cleanup(), 30000);