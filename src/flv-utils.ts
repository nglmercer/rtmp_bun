import { Buffer } from "node:buffer";

export class FLVWrapper {
  // Cabecera estándar FLV (9 bytes + 4 bytes de First Tag Size)
  static getHeader(): Buffer {
    const header = Buffer.alloc(13);
    
    // Signature 'FLV'
    header.write("FLV"); 
    // Version 1
    header[3] = 1; 
    // Flags: Audio (4) + Video (1) = 5
    header[4] = 5; 
    // DataOffset: 9 header bytes
    header.writeUInt32BE(9, 5); 
    
    // PreviousTagSize0: Siempre 0 para empezar
    header.writeUInt32BE(0, 9);

    return header;
  }

  static wrapTag(type: number, timestamp: number, data: Buffer): Buffer {
    const dataSize = data.length;
    const totalSize = 11 + dataSize + 4; // Header (11) + Data + PreviousTagSize (4)
    const buffer = Buffer.alloc(totalSize);

    // 1. Tag Type (8=Audio, 9=Video, 18=Script)
    buffer[0] = type;

    // 2. Data Size (24 bits)
    buffer[1] = (dataSize >> 16) & 0xff;
    buffer[2] = (dataSize >> 8) & 0xff;
    buffer[3] = dataSize & 0xff;

    // 3. Timestamp (24 bits) & Timestamp Extended (8 bits)
    // flv.js espera el Timestamp Extended en el byte 7
    const tsLower = timestamp & 0xffffff;
    const tsUpper = (timestamp >> 24) & 0xff;

    buffer[4] = (tsLower >> 16) & 0xff;
    buffer[5] = (tsLower >> 8) & 0xff;
    buffer[6] = tsLower & 0xff;
    buffer[7] = tsUpper; // Timestamp Extended

    // 4. StreamID (Siempre 0, 24 bits)
    buffer[8] = 0;
    buffer[9] = 0;
    buffer[10] = 0;

    // 5. Data (Payload real)
    data.copy(buffer, 11);

    // 6. PreviousTagSize (Tamaño del tag anterior, para navegación inversa)
    // Se coloca al final de ESTE tag. Tamaño = 11 (Header) + DataSize
    const tagSize = 11 + dataSize;
    buffer.writeUInt32BE(tagSize, 11 + dataSize);

    return buffer;
  }
}