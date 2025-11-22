import { HLSMemoryConverter, createRealisticSegment } from "../hls-memory.js";

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
    
    // NO generar segmentos de prueba automáticamente
    // En su lugar, configurar el bitrate para que el sistema RTMP genere segmentos más grandes
    this.converter.setEstimatedBitrate(1000); // 1000 kbps = 1 Mbps
    console.log("🎊 Configurado bitrate estimado para generar segmentos más grandes");
    
    // Generar solo algunos segmentos iniciales para asegurar que haya contenido
    for (let i = 0; i < 3; i++) {
      const testData = createRealisticSegment(i, 4.0); // 4 segundos por segmento
      this.converter.addSegment(i, 4.0, testData);
      console.log(`📦 Segmento inicial ${i} añadido (${testData.length} bytes)`);
    }
  }
}

// Exportar una instancia única
export const hlsMemoryManager = new HlsMemoryManager();