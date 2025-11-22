import { flvStreamManager } from "./flv-stream-manager";
import { FLVWrapper } from "./flv-utils";
import { Buffer } from "node:buffer"; // Asegurar importación

export class FFmpegTranscoder {
  private streamKey: string;
  private isActive: boolean = false;
  private headerSent: boolean = false;

  constructor(streamKey: string) {
    this.streamKey = streamKey;
  }

  start() {
    console.log(`[Transcoder] 🎬 Iniciando stream: ${this.streamKey}`);
    this.isActive = true;
    this.headerSent = false;
    
    flvStreamManager.getOrCreateStream(this.streamKey);
    flvStreamManager.activateStream(this.streamKey);
    
    // Enviar cabecera FLV global al iniciar
    this.sendFLVHeader(); 
  }

  stop() {
    if (this.isActive) {
      console.log(`[Transcoder] 🛑 Deteniendo stream: ${this.streamKey}`);
      this.isActive = false;
      flvStreamManager.deactivateStream(this.streamKey);
    }
  }

  write(data: Buffer) {
    if (!this.isActive || !this.streamKey) return;
    flvStreamManager.writeToStream(this.streamKey, data);
  }

  writeVideo(timestamp: number, data: Buffer) {
    if (!this.isActive || data.length < 2) return;

    // --- INSPECCIÓN DE SEGURIDAD ---
    // Byte 0 en Video Payload:
    // High 4 bits = Frame Type (1=Key, 2=Inter, etc.)
    // Low 4 bits  = Codec ID (7=AVC/H.264)
    
    const frameType = (data[0] >> 4) & 0x0f;
    const codecId = data[0] & 0x0f;

    // 🚨 CRÍTICO: flv.js SOLO soporta CodecID 7 (AVC)
    // Si recibes 3, es basura o un codec viejo. Si recibes 12, es HEVC (no soportado standard)
    if (codecId !== 7) {
        // Opcional: Logs verbose solo la primera vez para no saturar
        // console.warn(`[Transcoder] ⚠️ Codec de video no soportado ignorado: ${codecId}`);
        return; 
    }

    const flvTag = FLVWrapper.wrapTag(9, timestamp, data);
    this.write(flvTag);
  }

  writeAudio(timestamp: number, data: Buffer) {
    if (!this.isActive || data.length < 2) return;

    // Byte 0 en Audio Payload:
    // High 4 bits = SoundFormat (10=AAC, 2=MP3)
    const soundFormat = (data[0] >> 4) & 0x0f;

    // Aceptamos AAC (10) y MP3 (2). Codec 3 (PCM LE) a veces da problemas si no se configura bien
    if (soundFormat !== 10 && soundFormat !== 2) {
       return; 
    }

    const flvTag = FLVWrapper.wrapTag(8, timestamp, data);
    this.write(flvTag);
  }

  private sendFLVHeader() {
    if (!this.headerSent && this.isActive && this.streamKey) {
      const header = FLVWrapper.getHeader();
      flvStreamManager.writeToStream(this.streamKey, header);
      this.headerSent = true;
    }
  }
}