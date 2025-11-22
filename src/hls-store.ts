// Tipos para definir la estructura de los archivos en memoria
export type FileRecord = {
  data: Uint8Array; // Uint8Array es más eficiente en memoria que Buffer
  contentType: string;
  size: number;
  updatedAt: number;
};

type StreamContext = {
  lastActivity: number;
  playlist: FileRecord | null;    // index.m3u8 (solo uno activo)
  preview: FileRecord | null;     // preview.jpg (solo uno activo)
  segments: Map<string, FileRecord>; // segmentos .ts (múltiples)
};

export class HlsRamStore {
  // Mapa principal: streamKey -> Contexto
  private streams = new Map<string, StreamContext>();
  
  // Estadísticas globales
  private currentTotalSize = 0;
  
  // Configuración (Ajustable)
  private readonly MAX_TOTAL_RAM = 512 * 1024 * 1024; // 512 MB Límite duro
  private readonly MAX_SEGMENT_AGE = 60000; // 60s vida útil para segmentos viejos
  private readonly MAX_STREAM_IDLE = 120000; // 2 min sin actividad = stream eliminado
  
  constructor() {
    // Limpieza automática cada 10 segundos
    setInterval(() => this.gc(), 10000);
  }

  /**
   * Guarda o actualiza un archivo en memoria
   */
  saveFile(streamKey: string, filename: string, data: Buffer | ArrayBuffer, contentType: string): boolean {
    const size = data.byteLength;

    // 1. Protección de Memoria Global
    if (this.currentTotalSize + size > this.MAX_TOTAL_RAM) {
      console.warn(`[RAM] ⚠️ Memoria llena (${this.getStats().memoryUsageMB} MB). Rechazando escritura para ${streamKey}/${filename}`);
      // Opcional: Forzar un GC de emergencia aquí
      this.gc();
      if (this.currentTotalSize + size > this.MAX_TOTAL_RAM) return false;
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
    
    // Convertir a Uint8Array para consistencia
    const fileRecord: FileRecord = {
      data: new Uint8Array(data),
      contentType,
      size,
      updatedAt: Date.now()
    };

    // 3. Guardado Inteligente (Gestión de Memoria)
    if (filename.endsWith('.m3u8')) {
      // Si existe una playlist previa, liberar su espacio
      if (ctx.playlist) this.currentTotalSize -= ctx.playlist.size;
      ctx.playlist = fileRecord;
    } 
    else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
      // Si existe un preview previo, liberar su espacio
      if (ctx.preview) this.currentTotalSize -= ctx.preview.size;
      ctx.preview = fileRecord;
    } 
    else {
      // Es un segmento .ts o init.mp4
      const existing = ctx.segments.get(filename);
      // Si ya existía este segmento específico (raro en HLS live, pero posible), restar peso anterior
      if (existing) this.currentTotalSize -= existing.size;
      
      ctx.segments.set(filename, fileRecord);
    }

    // Sumar el peso del nuevo archivo
    this.currentTotalSize += size;
    return true;
  }

  /**
   * Recupera un archivo para servirlo vía HTTP
   */
  getFile(streamKey: string, filename: string): FileRecord | undefined {
    const ctx = this.streams.get(streamKey);
    if (!ctx) return undefined;

    // Opcional: Actualizar lastActivity en lectura mantiene el stream vivo
    // ctx.lastActivity = Date.now(); 

    if (filename.endsWith('.m3u8')) return ctx.playlist || undefined;
    if (filename.endsWith('.jpg')) return ctx.preview || undefined;
    return ctx.segments.get(filename);
  }

  /**
   * Borra un archivo específico
   */
  deleteFile(streamKey: string, filename: string) {
    const ctx = this.streams.get(streamKey);
    if (!ctx) return;

    if (filename.endsWith('.m3u8')) {
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
      }
    }
  }

  /**
   * Garbage Collector Optimizado
   */
  private gc() {
    const now = Date.now();
    let streamsRemoved = 0;
    let segmentsRemoved = 0;

    for (const [streamKey, ctx] of this.streams) {
      // CASO 1: Stream inactivo completo
      if (now - ctx.lastActivity > this.MAX_STREAM_IDLE) {
        let freedBytes = 0;
        if (ctx.playlist) freedBytes += ctx.playlist.size;
        if (ctx.preview) freedBytes += ctx.preview.size;
        for (const seg of ctx.segments.values()) freedBytes += seg.size;

        this.currentTotalSize -= freedBytes;
        this.streams.delete(streamKey);
        streamsRemoved++;
        continue;
      }

      // CASO 2: Limpieza de segmentos viejos dentro de un stream activo
      for (const [filename, segment] of ctx.segments) {
        if (now - segment.updatedAt > this.MAX_SEGMENT_AGE) {
          this.currentTotalSize -= segment.size;
          ctx.segments.delete(filename);
          segmentsRemoved++;
        }
      }
    }

    // Log solo si hubo cambios significativos para no saturar la consola
    if (streamsRemoved > 0 || segmentsRemoved > 5) {
        console.log(`[GC] Limpieza: ${streamsRemoved} streams muertos, ${segmentsRemoved} segmentos viejos. RAM en uso: ${this.getStats().memoryUsageMB} MB`);
    }
  }

  getStats() {
    return {
      totalStreams: this.streams.size,
      memoryUsageMB: (this.currentTotalSize / 1024 / 1024).toFixed(2),
      memoryUsagePercent: ((this.currentTotalSize / this.MAX_TOTAL_RAM) * 100).toFixed(1) + '%'
    };
  }
}

// Exportar instancia singleton
export const ramStore = new HlsRamStore();