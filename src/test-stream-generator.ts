import { GstTranscoder } from "./transcoder";
import { FLVWrapper } from "./flv-utils";
import { ramStore } from "./hls-store";

/**
 * Generador de stream de prueba para testing
 * Crea un stream HLS sintético usando GStreamer sin necesidad de RTMP
 */
export class TestStreamGenerator {
  private transcoder: GstTranscoder | null = null;
  private streamKey: string;
  private interval: NodeJS.Timeout | null = null;

  constructor(streamKey: string = "default") {
    this.streamKey = streamKey;
  }

  async start() {
    console.log(`🧪 Iniciando stream de prueba para: ${this.streamKey}`);
    
    try {
      // Iniciar transcodificador
      this.transcoder = new GstTranscoder(this.streamKey);
      await this.transcoder.start();
      
      // Enviar cabecera FLV
      this.transcoder.write(FLVWrapper.getHeader());
      
      // Enviar metadatos
      this.transcoder.write(FLVWrapper.createMetadataTag());
      
      // Generar frames de prueba periódicamente
      let frameCount = 0;
      this.interval = setInterval(() => {
        if (!this.transcoder) return;
        
        const timestamp = Date.now() - (Date.now() % 1000);
        
        // Enviar frame de video (keyframe cada 2 segundos)
        const isKeyframe = frameCount % 30 === 0; // Asumiendo 30fps
        const videoTag = FLVWrapper.createH264VideoTag(timestamp, isKeyframe);
        this.transcoder.write(videoTag);
        
        // Enviar frame de audio
        const audioTag = FLVWrapper.createAACAudioTag(timestamp, frameCount === 0);
        this.transcoder.write(audioTag);
        
        frameCount++;
      }, 33); // ~30fps
      
      console.log(`✅ Stream de prueba iniciado para ${this.streamKey}`);
      console.log(`📺 Puedes verlo en: http://localhost:3000/live/${this.streamKey}/playlist.m3u8`);
      
    } catch (error) {
      console.error(`❌ Error iniciando stream de prueba:`, error);
      throw error;
    }
  }

  async stop() {
    console.log(`🛑 Deteniendo stream de prueba para: ${this.streamKey}`);
    
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    if (this.transcoder) {
      await this.transcoder.stop();
      this.transcoder = null;
    }
    
    console.log(`✅ Stream de prueba detenido`);
  }
}

// Función para crear un stream de prueba directamente desde main.ts
export async function createTestStream(streamKey: string = "default") {
  const generator = new TestStreamGenerator(streamKey);
  await generator.start();
  return generator;
}