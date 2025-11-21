import { HLSConverter } from "../hls.js";

export class HlsManager {
  private converter: HLSConverter | null = null;
  private streamKey: string | null = null;

  async startHls(streamKey: string, rtmpUrl?: string): Promise<void> {
    if (this.converter && this.converter.isActive()) {
      throw new Error("HLS process is already running");
    }

    console.log(`🎬 Iniciando conversión HLS para stream: ${streamKey}`);
    
    try {
      this.converter = new HLSConverter();
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

      this.converter.on('ready', () => {
        console.log("✅ FFmpeg conectado al stream RTMP");
      });

      this.converter.on('segment', (segment) => {
        console.log(`📦 Segmento HLS generado: ${segment.url}`);
      });

      this.converter.on('progress', (data) => {
        console.log(`⏱️ Progreso conversión: ${data.time}s`);
      });

      // Iniciar conversión con URL RTMP opcional
      await this.converter.startConversion(streamKey, rtmpUrl);
      console.log("✅ Conversión HLS iniciada exitosamente");
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  async stopHls(): Promise<void> {
    if (!this.converter || !this.converter.isActive()) {
      return;
    }

    console.log("⏹️ Deteniendo conversión HLS");
    
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

  // Método obsoleto - ya no escribimos datos RTMP directamente
  writeRTMPData(data: Buffer): void {
    console.warn("⚠️ writeRTMPData() está obsoleto. FFmpeg ahora lee directamente desde RTMP URL");
    // Este método se mantiene por compatibilidad pero no hace nada
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

  private cleanup(): void {
    this.converter = null;
    this.streamKey = null;
  }

  // Obtener el stream key actual
  getStreamKey(): string | null {
    return this.streamKey;
  }
}

// Exportar una instancia única
export const hlsManager = new HlsManager();
