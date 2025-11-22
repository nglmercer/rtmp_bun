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

  /**
   * Crea un tag de audio AAC válido con configuración proper
   */
  static createAACAudioTag(timestamp: number, isSequenceHeader: boolean, audioData?: Buffer): Buffer {
    if (isSequenceHeader) {
      // AAC Sequence Header con configuración válida
      const aacConfig = Buffer.from([
        0x12, 0x10 // AudioSpecificConfig: AAC-LC, 44.1kHz, Stereo
      ]);
      
      const payload = Buffer.concat([
        Buffer.from([0xaf, 0x00]), // SoundFormat=10 (AAC), SoundRate=3 (44kHz), SoundSize=1 (16-bit), SoundType=1 (Stereo), AACPacketType=0
        aacConfig
      ]);
      
      return this.wrapTag(8, timestamp, payload);
    } else {
      // AAC Audio Data
      const payload = Buffer.concat([
        Buffer.from([0xaf, 0x01]), // SoundFormat=10 (AAC), AACPacketType=1 (raw data)
        audioData || Buffer.from([0x00, 0x01, 0x00, 0x01]) // Minimal AAC frame
      ]);
      
      return this.wrapTag(8, timestamp, payload);
    }
  }

  /**
   * Crea un tag de video H.264 válido con configuración proper
   */
  static createH264VideoTag(timestamp: number, isSequenceHeader: boolean, naluData?: Buffer): Buffer {
    if (isSequenceHeader) {
      // AVC Sequence Header (AVCDecoderConfigurationRecord) - Baseline profile
      const avcConfig = Buffer.from([
        0x01,        // configurationVersion
        0x42, 0x00, 0x1e, // AVCProfileIndication (Baseline), profile_compatibility
        0xff,        // AVCLevelIndication
        0xff,        // lengthSizeMinusOne (4 bytes)
        0xe1,        // numOfSPS (1)
        0x00, 0x0d,  // SPS length (13)
        0x00, 0x0c, 0x42, 0x00, 0x1e, 0x8b, 0x68, 0x02, 0x80, 0x2d, 0xd8, 0x08, // SPS data
        0x01,        // numOfPPS (1)
        0x00, 0x04,  // PPS length (4)
        0x00, 0x04, 0xce, 0x3c, 0x80 // PPS data
      ]);
      
      const payload = Buffer.concat([
        Buffer.from([0x17, 0x00, 0x00, 0x00, 0x00]), // FrameType=1 (keyframe), CodecID=7 (AVC), AVCPacketType=0, CompositionTime=0
        avcConfig
      ]);
      
      return this.wrapTag(9, timestamp, payload);
    } else {
      // H.264 NALU Data - Simple IDR frame
      const payload = Buffer.concat([
        Buffer.from([0x27, 0x01, 0x00, 0x00, 0x00]), // FrameType=2 (inter frame), AVCPacketType=1, CompositionTime=0
        naluData || Buffer.from([0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00, 0x01]) // Simple IDR frame NALU
      ]);
      
      return this.wrapTag(9, timestamp, payload);
    }
  }

  /**
   * Crea un tag de metadatos FLV válido
   */
  static createMetadataTag(): Buffer {
    // Crear un objeto de metadatos AMF más simple pero válido
    const metadata = Buffer.concat([
      // String: "onMetaData"
      Buffer.from([0x02]), // String marker
      Buffer.from([0x00, 0x0a]), // String length (10)
      Buffer.from('onMetaData'),
      
      // Object marker
      Buffer.from([0x08]),
      
      // Property: width (Number: 1280)
      Buffer.from([0x00, 0x05]), // Property name length (5)
      Buffer.from('width'),
      Buffer.from([0x00]), // Number marker
      Buffer.from([0x40, 0xa0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), // 1280.0 (double)
      
      // Property: height (Number: 720)
      Buffer.from([0x00, 0x06]), // Property name length (6)
      Buffer.from('height'),
      Buffer.from([0x00]), // Number marker
      Buffer.from([0x40, 0x86, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00]), // 720.0 (double)
      
      // Property: duration (Number: 0)
      Buffer.from([0x00, 0x08]), // Property name length (8)
      Buffer.from('duration'),
      Buffer.from([0x00]), // Number marker
      Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), // 0.0 (double)
      
      // Property: framerate (Number: 30)
      Buffer.from([0x00, 0x09]), // Property name length (9)
      Buffer.from('framerate'),
      Buffer.from([0x00]), // Number marker
      Buffer.from([0x40, 0x3e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), // 30.0 (double)
      
      // Object end marker
      Buffer.from([0x00, 0x00, 0x09])
    ]);
    
    return this.wrapTag(18, 0, metadata);
  }
}