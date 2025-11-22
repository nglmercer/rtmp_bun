import { Buffer } from "node:buffer";

export interface FLVStreamStats {
  streamKey: string;
  isActive: boolean;
  startTime: number;
  bytesWritten: number;
  clientsCount: number;
}

interface FLVStream {
  streamKey: string;
  isActive: boolean;
  subscribers: Set<(data: Buffer) => void>;
  
  // Cache Crítico
  flvHeader: Buffer | null; // "FLV..."
  metaData: Buffer | null;  // ScriptData
  videoSequenceHeader: Buffer | null; // AVCC Configuration
  audioSequenceHeader: Buffer | null; // AAC Configuration
  
  // Stats
  startTime: number;
  bytesWritten: number;
  lastActivity: number;
}

class FLVStreamManager {
  private streams = new Map<string, FLVStream>();

  getOrCreateStream(streamKey: string): FLVStream {
    let stream = this.streams.get(streamKey);
    if (!stream) {
      stream = {
        streamKey,
        isActive: false,
        subscribers: new Set(),
        flvHeader: null,
        metaData: null,
        videoSequenceHeader: null,
        audioSequenceHeader: null,
        startTime: Date.now(),
        bytesWritten: 0,
        lastActivity: Date.now()
      };
      this.streams.set(streamKey, stream);
    }
    return stream;
  }

  activateStream(streamKey: string) {
    const stream = this.getOrCreateStream(streamKey);
    stream.isActive = true;
    stream.startTime = Date.now();
    // Reiniciar headers dinámicos, mantener FLV Header estático si existe
    stream.videoSequenceHeader = null;
    stream.audioSequenceHeader = null;
  }

  deactivateStream(streamKey: string) {
    const stream = this.streams.get(streamKey);
    if (stream) {
        stream.isActive = false;
        // Cerrar conexiones abiertas
        const empty = Buffer.alloc(0);
        stream.subscribers.forEach(cb => cb(empty));
        stream.subscribers.clear();
    }
  }

  writeToStream(streamKey: string, data: Buffer): boolean {
    const stream = this.streams.get(streamKey);
    if (!stream || !stream.isActive) return false;

    stream.bytesWritten += data.length;
    stream.lastActivity = Date.now();

    // --- Lógica de Cache (Packet sniffing) ---
    // data es un FLV TAG completo (Header 11 bytes + Data + PrevTagSize 4 bytes)
    
    // Comprobamos si es el Header Global FLV (empieza por 'F')
    if (data[0] === 0x46 && data[1] === 0x4C && data[2] === 0x56) { 
       stream.flvHeader = data;
    } 
    // Si es un Tag (longitud mínima 11 bytes)
    else if (data.length > 15) {
        const tagType = data[0]; // Byte 0
        // El payload empieza en el byte 11
        const packetType = data[12]; // Byte 12 es el segundo byte del payload (AVCPacketType / AACPacketType)

        if (tagType === 9 && packetType === 0) { // Video + Sequence Header
             stream.videoSequenceHeader = data;
        } else if (tagType === 8 && packetType === 0) { // Audio + Sequence Header
             stream.audioSequenceHeader = data;
        } else if (tagType === 18) { // Script (MetaData)
             stream.metaData = data;
        }
    }

    // Broadcast
    for (const subscriber of stream.subscribers) {
      subscriber(data);
    }
    return true;
  }

  subscribe(streamKey: string, callback: (data: Buffer) => void) {
    const stream = this.streams.get(streamKey);
    if (!stream) return;

    stream.subscribers.add(callback);

    // FAST START: Enviar cabeceras cacheadas al nuevo cliente
    if (stream.flvHeader) callback(stream.flvHeader);
    if (stream.metaData) callback(stream.metaData);
    if (stream.videoSequenceHeader) callback(stream.videoSequenceHeader);
    if (stream.audioSequenceHeader) callback(stream.audioSequenceHeader);
  }

  unsubscribe(streamKey: string, callback: (data: Buffer) => void) {
      const stream = this.streams.get(streamKey);
      if(stream) stream.subscribers.delete(callback);
  }

  getStreamStats(streamKey: string): FLVStreamStats | null {
     const stream = this.streams.get(streamKey);
     if(!stream) return null;
     return {
         streamKey,
         isActive: stream.isActive,
         startTime: stream.startTime,
         bytesWritten: stream.bytesWritten,
         clientsCount: stream.subscribers.size
     }
  }
}

export const flvStreamManager = new FLVStreamManager();