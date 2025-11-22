import { Buffer } from "node:buffer";

// flv-utils.ts
export class FLVWrapper {
  /**
   * Genera la cabecera inicial del archivo FLV.
   * GStreamer necesita esto como los primeros bytes para reconocer el formato.
   */
  static getHeader(): Buffer {
    const header = Buffer.alloc(13);

    // 'F', 'L', 'V'
    header.write('FLV');
    
    // Versión 1
    header[3] = 1;
    
    // Flags: Audio (4) + Video (1) = 5
    header[4] = 5; 
    
    // DataOffset: Tamaño de la cabecera (9)
    header.writeUInt32BE(9, 5);
    
    // PreviousTagSize0: Siempre 0 después de la cabecera
    header.writeUInt32BE(0, 9);

    return header;
  }

  /**
   * Envuelve el payload de Audio/Video en un TAG FLV Estándar.
   * @param type 8 para Audio, 9 para Video, 18 para Data
   * @param timestamp Tiempo absoluto en ms
   * @param data El payload crudo (H.264 o AAC packet)
   */
  static wrapTag(type: number, timestamp: number, data: Buffer): Buffer {
    const dataSize = data.length;
    const totalSize = 11 + dataSize + 4; // Header (11) + Data + PreviousTagSize (4)
    
    const buffer = Buffer.alloc(totalSize);

    // 1. Tag Type
    buffer[0] = type;

    // 2. Data Size (3 bytes)
    buffer.writeUIntBE(dataSize, 1, 3);

    // 3. Timestamp (3 bytes + 1 byte extendido)
    // Los 24 bits bajos
    buffer.writeUIntBE(timestamp & 0xffffff, 4, 3);
    // El byte alto (Timestamp Extended)
    buffer[7] = (timestamp >> 24) & 0xff;

    // 4. StreamID (3 bytes) - Siempre 0
    buffer.writeUIntBE(0, 8, 3);

    // 5. Payload Data
    data.copy(buffer, 11);

    // 6. PreviousTagSize (4 bytes) al final
    // Es el tamaño del Tag anterior (header + data)
    buffer.writeUInt32BE(11 + dataSize, 11 + dataSize);

    return buffer;
  }
}