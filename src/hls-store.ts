// Tipos para definir qué guardamos
type FileRecord = {
  data: Uint8Array; // Uint8Array es más ligero que Buffer en Bun
  contentType: string;
  size: number;
  updatedAt: number;
};

type StreamContext = {
  lastActivity: number;
  playlist: FileRecord | null;   // Solo hay 1 .m3u8 activo a la vez
  preview: FileRecord | null;    // Solo hay 1 .jpg activo a la vez
  segments: Map<string, FileRecord>; // Múltiples .ts
};

export class HlsRamStore {
  // Mapa principal: streamKey -> Contexto
  private streams = new Map<string, StreamContext>();
  
  // Estadísticas globales
  private currentTotalSize = 0;
  
  // Configuración
  private readonly MAX_TOTAL_RAM = 512 * 1024 * 1024; // 512 MB Límite duro
  private readonly MAX_SEGMENT_AGE = 60000; // 60s vida útil (fallback)
  private readonly MAX_STREAM_IDLE = 120000; // 2 min sin actividad = stream muerto
  
  constructor() {
    // Limpieza cada 10s (más frecuente pero más ligera)
    setInterval(() => this.gc(), 10000);
  }

  /**
   * Guarda o actualiza un archivo en memoria
   */
  saveFile(streamKey: string, filename: string, data: ArrayBuffer, contentType: string): boolean {
    const size = data.byteLength;

    // 1. Protección de Memoria Global
    if (this.currentTotalSize + size > this.MAX_TOTAL_RAM) {
      console.error(`[RAM] ⚠️ Memoria llena. Rechazando escritura para ${streamKey}`);
      // Aquí podrías implementar una lógica de "Evicción de Emergencia" si quisieras
      return false; 
    }

    // 2. Obtener o crear contexto del stream
    let ctx = this.streams.get(streamKey);
    if (!ctx) {
      ctx = {
        lastActivity: Date.now(),
        playlist: null,
        preview: null,
        segments: new Map()
      };
      this.streams.set(streamKey, ctx);
    }

    ctx.lastActivity = Date.now();
    const fileRecord: FileRecord = {
      data: new Uint8Array(data),
      contentType,
      size,
      updatedAt: Date.now()
    };

    // 3. Guardado Inteligente (Evita duplicados en RAM)
    if (filename.endsWith('.m3u8')) {
      // Si ya existía, restamos su peso anterior antes de sobrescribir
      if (ctx.playlist) this.currentTotalSize -= ctx.playlist.size;
      ctx.playlist = fileRecord;
    } 
    else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
      if (ctx.preview) this.currentTotalSize -= ctx.preview.size;
      ctx.preview = fileRecord;
    } 
    else {
      // Es un segmento .ts
      // Verificar si existía (raro en TS pero posible) para ajustar peso
      const existing = ctx.segments.get(filename);
      if (existing) this.currentTotalSize -= existing.size;
      
      ctx.segments.set(filename, fileRecord);
    }

    // Sumar nuevo peso
    this.currentTotalSize += size;
    return true;
  }

  /**
   * Recupera un archivo
   */
  getFile(streamKey: string, filename: string): FileRecord | undefined {
    const ctx = this.streams.get(streamKey);
    if (!ctx) return undefined;

    // Actualizamos actividad para que el GC no lo mate
    // (Opcional: solo actualizar en escrituras si prefieres lectura pasiva)
    // ctx.lastActivity = Date.now(); 

    if (filename.endsWith('.m3u8')) return ctx.playlist || undefined;
    if (filename.endsWith('.jpg')) return ctx.preview || undefined;
    return ctx.segments.get(filename);
  }

  /**
   * Borra un archivo específico (Llamado por FFmpeg DELETE)
   */
  deleteFile(streamKey: string, filename: string) {
    const ctx = this.streams.get(streamKey);
    if (!ctx) return;

    if (filename.endsWith('.m3u8')) {
      // Raramente borramos el playlist mientras stremea, pero por si acaso
      if (ctx.playlist) {
        this.currentTotalSize -= ctx.playlist.size;
        ctx.playlist = null;
      }
    } else if (filename.endsWith('.jpg')) {
        if (ctx.preview) {
            this.currentTotalSize -= ctx.preview.size;
            ctx.preview = null;
        }
    } else {
      const segment = ctx.segments.get(filename);
      if (segment) {
        this.currentTotalSize -= segment.size;
        ctx.segments.delete(filename);
        // console.log(`[RAM] Segmento eliminado: ${filename}`);
      }
    }
  }

  /**
   * Garbage Collector Optimizado
   * Complejidad: O(S + k) donde S=Streams y k=Segmentos expirados
   */
  private gc() {
    const now = Date.now();
    let streamsRemoved = 0;
    let segmentsRemoved = 0;

    for (const [streamKey, ctx] of this.streams) {
      // CASO 1: Stream abandonado (FFmpeg murió hace rato)
      if (now - ctx.lastActivity > this.MAX_STREAM_IDLE) {
        // Calcular memoria liberada
        let freedBytes = 0;
        if (ctx.playlist) freedBytes += ctx.playlist.size;
        if (ctx.preview) freedBytes += ctx.preview.size;
        for (const seg of ctx.segments.values()) freedBytes += seg.size;

        this.currentTotalSize -= freedBytes;
        this.streams.delete(streamKey);
        streamsRemoved++;
        continue; // Pasamos al siguiente stream
      }

      // CASO 2: Limpieza de segmentos viejos (Fallback si FFmpeg no manda DELETE)
      for (const [filename, segment] of ctx.segments) {
        if (now - segment.updatedAt > this.MAX_SEGMENT_AGE) {
          this.currentTotalSize -= segment.size;
          ctx.segments.delete(filename);
          segmentsRemoved++;
        }
      }
    }

    if (streamsRemoved > 0 || segmentsRemoved > 0) {
        // Log de depuración ligero
        // console.log(`[GC] Streams purgados: ${streamsRemoved}, Segmentos purgados: ${segmentsRemoved}. RAM Uso: ${(this.currentTotalSize / 1024 / 1024).toFixed(2)} MB`);
    }
  }

  // Utilidad para monitoreo
  getStats() {
    return {
      totalStreams: this.streams.size,
      memoryUsageMB: (this.currentTotalSize / 1024 / 1024).toFixed(2),
      memoryUsagePercent: ((this.currentTotalSize / this.MAX_TOTAL_RAM) * 100).toFixed(1) + '%'
    };
  }
}

export const ramStore = new HlsRamStore();