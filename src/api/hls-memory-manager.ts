import { HLSMemoryConverter } from "../hls-memory.js";

export class HlsMemoryManager {
  private converter: HLSMemoryConverter | null = null;
  private streamKey: string | null = null;

  async startHls(streamKey: string): Promise<void> {
    if (this.converter && this.converter.isActive()) {
      throw new Error("HLS process is already running");
    }

    // Validar y limpiar el streamKey
    if (!streamKey || streamKey.trim() === '' || streamKey === 'unknown') {
      streamKey = 'default';
    }

    console.log(`🎬 Iniciando conversión HLS desde memoria para stream: ${streamKey}`);
    
    try {
      this.converter = new HLSMemoryConverter();
      this.streamKey = streamKey;
      
      // Configurar event handlers
      this.converter.on('error', (error) => {
        console.error("❌ Error en conversión HLS:", error);
        this.cleanup();
      });

      this.converter.on('stopped', () => {
        console.log("📋 Conversión HLS detenida");
        this.cleanup();
      });

      this.converter.on('segment', (segment) => {
        console.log(`📦 Segmento HLS generado: ${segment.url} (${segment.data.length} bytes)`);
      });

      this.converter.on('playlist-updated', (playlist) => {
        console.log(`📋 Playlist actualizada: ${playlist.segments.length} segmentos`);
      });

      // Iniciar conversión sin URL RTMP (trabaja con datos en memoria)
      await this.converter.startConversion(streamKey);
      
      // Generar algunos segmentos de prueba para demostración
      this.generateTestSegments();
      
      console.log("✅ Conversión HLS desde memoria iniciada exitosamente");
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  async stopHls(): Promise<void> {
    if (!this.converter || !this.converter.isActive()) {
      return;
    }

    console.log("⏹️ Deteniendo conversión HLS desde memoria");
    
    try {
      await this.converter.stop();
      console.log("✅ Conversión HLS detenida");
    } catch (error) {
      console.error("Error deteniendo conversión HLS:", error);
    }
  }

  isRunning(): boolean {
    return this.converter ? this.converter.isActive() : false;
  }

  // Método principal para recibir datos RTMP y convertirlos a HLS
  writeRTMPData(data: Buffer): void {
    if (!this.converter) {
      console.warn("⚠️ HLS converter no inicializado, ignorando datos");
      return;
    }
    
    this.converter.writeRTMPData(data);
  }

  // Obtener playlist HLS
  getPlaylist(): string | null {
    if (!this.converter || !this.converter.isActive()) {
      return null;
    }
    return this.converter.getPlaylist();
  }

  // Obtener segmento específico
  getSegment(sequence: number): Buffer | null {
    if (!this.converter) {
      return null;
    }
    return this.converter.getSegment(sequence);
  }

  // Obtener secuencias disponibles
  getAvailableSequences(): number[] {
    if (!this.converter) {
      return [];
    }
    return this.converter.getAvailableSequences();
  }

  // Obtener estadísticas
  getStats(): { segments: number; isRunning: boolean; mediaSequence: number } | null {
    if (!this.converter) {
      return null;
    }
    return this.converter.getStats();
  }

  // Configurar bitrate estimado para mejor segmentación
  setEstimatedBitrate(bitrateKbps: number): void {
    if (this.converter) {
      this.converter.setEstimatedBitrate(bitrateKbps);
    }
  }

  // Obtener información del buffer
  getBufferInfo(): { size: number; hasEnoughData: boolean } | null {
    if (!this.converter) {
      return null;
    }
    return this.converter.getBufferInfo();
  }

  private cleanup(): void {
    this.converter = null;
    this.streamKey = null;
  }

  // Obtener el stream key actual
  getStreamKey(): string | null {
    return this.streamKey;
  }

  // Generar segmentos de prueba para demostración
  private generateTestSegments(): void {
    if (!this.converter) return;
    
    console.log("🎬 Generando segmentos de prueba...");
    
    // Generar 5 segmentos de prueba
    for (let i = 0; i < 5; i++) {
      const testData = this.createMockSegmentData(i, 1024 * 200); // 200KB por segmento
      this.converter.addSegment(i, 4.0, testData);
      
      setTimeout(() => {
        console.log(`📦 Segmento de prueba ${i} añadido`);
      }, i * 500); // Añadir cada 500ms
    }
  }

  // Crear datos de segmento simulados
  private createMockSegmentData(sequence: number, size: number): Buffer {
    const data = Buffer.alloc(size);
    
    // Crear un header TS simple (Transport Stream)
    data[0] = 0x47; // TS Sync byte
    
    // Llenar con datos pseudo-aleatorios basados en la secuencia
    for (let i = 1; i < size; i++) {
      data[i] = (sequence + i) % 256;
    }
    
    return data;
  }
}

// Exportar una instancia única
export const hlsMemoryManager = new HlsMemoryManager();