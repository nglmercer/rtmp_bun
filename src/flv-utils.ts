import { Buffer } from "node:buffer";

export class FLVWrapper {
  // Genera la cabecera del archivo FLV
  static getHeader(): Buffer {
    return Buffer.from([
      0x46, 0x4c, 0x56, // 'F', 'L', 'V'
      0x01,             // Version 1
      0x05,             // Flags: Audio (0x04) + Video (0x01) = 0x05
      0x00, 0x00, 0x00, 0x09, // DataOffset (9 bytes)
      0x00, 0x00, 0x00, 0x00  // PreviousTagSize 0
    ]);
  }

  // Envuelve un paquete de Audio/Video en un Tag FLV
  static wrapTag(type: number, timestamp: number, data: Buffer, streamId: number = 0): Buffer {
    const tagHeader = Buffer.alloc(11);
    
    // Tag Type (8: Audio, 9: Video, 18: Script/Data)
    tagHeader.writeUInt8(type, 0);
    
    // Data Size (3 bytes)
    tagHeader.writeUIntBE(data.length, 1, 3);
    
    // Timestamp (3 bytes + 1 byte extended)
    // FLV usa un formato raro donde el byte más alto va al final
    tagHeader.writeUIntBE(timestamp & 0xffffff, 4, 3);
    tagHeader.writeUInt8((timestamp >> 24) & 0xff, 7);
    
    // Stream ID (3 bytes, siempre 0)
    tagHeader.writeUIntBE(0, 8, 3);

    // PreviousTagSize (4 bytes al final del tag para navegación hacia atrás)
    const prevTagSize = Buffer.alloc(4);
    prevTagSize.writeUInt32BE(11 + data.length, 0);

    return Buffer.concat([tagHeader, data, prevTagSize]);
  }
}