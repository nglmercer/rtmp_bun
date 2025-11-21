import type { RestApi } from "./api.js";
import { FFmpegCommand } from "ffmpeg-lib";

export class MSEStreaming {
  private api: RestApi;
  private streamBuffer: Map<
    string,
    { header: Uint8Array | null; chunks: Uint8Array[] }
  > = new Map();
  private flvHeaders: Map<string, Uint8Array> = new Map();
  private sequenceNumbers: Map<string, number> = new Map();
  public hlsProcesses: Map<string, any> = new Map();

  constructor(api: RestApi) {
    this.api = api;
  }

  /**
   * Normalize streamKey to ensure consistency between RTMP server and WebSocket clients
   * RTMP server uses: "/stream/streamKey"
   * WebSocket clients connect to: "/stream/streamKey" but expect: "streamKey"
   */
  private normalizeStreamKey(streamKey: string): string {
    // Remove /stream/ prefix if present
    if (streamKey.startsWith("/stream/")) {
      return streamKey.substring(8); // Remove '/stream/'
    }
    // Remove stream/ prefix if present
    if (streamKey.startsWith("stream/")) {
      return streamKey.substring(7); // Remove 'stream/'
    }
    return streamKey;
  }

  public startStreaming(streamKey: string): void {
    // Normalize streamKey to ensure consistency
    const normalizedKey = this.normalizeStreamKey(streamKey);
    console.log(
      `🎬 Starting MSE streaming for: ${streamKey} → ${normalizedKey}`,
    );

    // Initialize stream data
    this.streamBuffer.set(normalizedKey, {
      header: null,
      chunks: [],
    });
    this.sequenceNumbers.set(normalizedKey, 0);

    // Create FLV header for this stream
    const flvHeader = this.createFLVHeader();
    this.flvHeaders.set(normalizedKey, flvHeader);

    // Send initial FLV header to normalized key
    this.api.broadcastToStream(normalizedKey, flvHeader.buffer);

    // Send metadata tag to normalized key
    const metadataTag = this.createMetadataTag();
    this.api.broadcastToStream(normalizedKey, metadataTag.buffer);
  }

  public stopStreaming(streamKey: string): void {
    // Normalize streamKey
    const normalizedKey = this.normalizeStreamKey(streamKey);
    console.log(
      `🛑 Stopping MSE streaming for: ${streamKey} → ${normalizedKey}`,
    );

    // Send end stream signal to normalized key
    const endTag = this.createStreamEndTag();
    this.api.broadcastToStream(normalizedKey, endTag.buffer);

    // Clean up stream data with normalized key
    this.streamBuffer.delete(normalizedKey);
    this.flvHeaders.delete(normalizedKey);
    this.sequenceNumbers.delete(normalizedKey);
  }

  public addMediaChunk(
    data: Uint8Array,
    streamKey: string,
    type: "audio" | "video",
  ): void {
    try {
      // Normalize streamKey for consistency
      const normalizedKey = this.normalizeStreamKey(streamKey);

      // Initialize stream if not exists (using normalized key)
      if (!this.streamBuffer.has(normalizedKey)) {
        this.startStreaming(normalizedKey);
      }

      // Convert RTMP data to FLV tag
      const flvTag = this.convertRTMPToFLV(data, type, normalizedKey);

      // Send the FLV tag to all WebSocket clients (using normalized key)
      this.api.broadcastToStream(normalizedKey, flvTag.buffer);

      console.log(
        `📡 Sent ${type} chunk: ${flvTag.length} bytes to ${streamKey} → ${normalizedKey}`,
      );
    } catch (error) {
      console.error(
        `❌ Error processing ${type} chunk for ${streamKey}:`,
        error,
      );
    }
  }

  public sendInitSegment(streamKey?: string): void {
    // If no streamKey provided, send to all active streams
    if (!streamKey) {
      console.log(`📦 Sending init segment to all active streams`);
      for (const [key] of this.streamBuffer) {
        this.sendInitSegment(key);
      }
      return;
    }

    // Normalize streamKey
    const normalizedKey = this.normalizeStreamKey(streamKey);

    if (!this.flvHeaders.has(normalizedKey)) {
      this.startStreaming(normalizedKey);
    }

    const header = this.flvHeaders.get(normalizedKey)!;
    const metadataTag = this.createMetadataTag();

    this.api.broadcastToStream(normalizedKey, header.buffer);
    this.api.broadcastToStream(normalizedKey, metadataTag.buffer);

    console.log(`📦 Sent init segment for: ${streamKey} → ${normalizedKey}`);
  }

  private createFLVHeader(): Uint8Array {
    // FLV header: "FLV" + version + flags + header size + previous tag size
    return new Uint8Array([
      0x46,
      0x4c,
      0x56, // "FLV" signature
      0x01, // version 1
      0x05, // audio and video present
      0x00,
      0x00,
      0x00,
      0x09, // header length (9 bytes)
      0x00,
      0x00,
      0x00,
      0x00, // previous tag size 0
    ]);
  }

  private createMetadataTag(): Uint8Array {
    const metadata = {
      duration: 0, // Live stream
      width: 1280,
      height: 720,
      videodatarate: 2500, // kbps
      framerate: 30,
      videocodecid: 7, // AVC/H.264
      audiodatarate: 128, // kbps
      audiosamplerate: 44100,
      audiosamplesize: 16,
      stereo: true,
      audiocodecid: 10, // AAC
      filesize: 0,
    };

    // Create AMF metadata object
    const amfMetadata = this.encodeAMF0Metadata(metadata);

    // Create FLV tag for script data (type 18)
    return this.createFLVTag(18, 0, amfMetadata);
  }

  private encodeAMF0Metadata(metadata: Record<string, any>): Uint8Array {
    const parts: Uint8Array[] = [];

    // ECMA array marker
    parts.push(new Uint8Array([0x08]));

    // Array length (number of properties)
    const propertyCount = Object.keys(metadata).length;
    parts.push(
      new Uint8Array([
        (propertyCount >> 24) & 0xff,
        (propertyCount >> 16) & 0xff,
        (propertyCount >> 8) & 0xff,
        propertyCount & 0xff,
      ]),
    );

    // Encode each property
    for (const [key, value] of Object.entries(metadata)) {
      // Property name (string)
      const keyBytes = new TextEncoder().encode(key);
      parts.push(new Uint8Array([keyBytes.length]));
      parts.push(keyBytes);

      // Property value (various types)
      if (typeof value === "number") {
        // Number (type 0)
        parts.push(new Uint8Array([0x00]));
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setFloat64(0, value);
        parts.push(new Uint8Array(buffer));
      } else if (typeof value === "boolean") {
        // Boolean (type 1)
        parts.push(new Uint8Array([0x01, value ? 1 : 0]));
      }
    }

    // End of object marker
    parts.push(new Uint8Array([0x00, 0x00, 0x09]));

    // Combine all parts
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }

    return result;
  }

  private createFLVTag(
    type: number,
    timestamp: number,
    data: Uint8Array,
  ): Uint8Array {
    const dataSize = data.length;

    // Tag header (11 bytes)
    const tagHeader = new Uint8Array([
      type, // Tag type
      (dataSize >> 16) & 0xff, // Data size (3 bytes, big-endian)
      (dataSize >> 8) & 0xff,
      dataSize & 0xff,
      (timestamp >> 16) & 0xff, // Timestamp (3 bytes, big-endian)
      (timestamp >> 8) & 0xff,
      timestamp & 0xff,
      (timestamp >> 24) & 0xff, // Timestamp extended
      0x00,
      0x00,
      0x00, // Stream ID (always 0)
    ]);

    // Previous tag size (4 bytes, big-endian)
    const previousTagSize = new Uint8Array([
      ((11 + dataSize) >> 24) & 0xff,
      ((11 + dataSize) >> 16) & 0xff,
      ((11 + dataSize) >> 8) & 0xff,
      (11 + dataSize) & 0xff,
    ]);

    // Combine header + data + previous tag size
    const result = new Uint8Array(
      tagHeader.length + data.length + previousTagSize.length,
    );
    let offset = 0;

    result.set(tagHeader, offset);
    offset += tagHeader.length;

    result.set(data, offset);
    offset += data.length;

    result.set(previousTagSize, offset);

    return result;
  }

  private convertRTMPToFLV(
    rtmpData: Uint8Array,
    type: "audio" | "video",
    streamKey: string,
  ): Uint8Array {
    const sequence = this.sequenceNumbers.get(streamKey) || 0;
    const timestamp = sequence * 40; // Assume 25fps for video, ~40ms per frame
    this.sequenceNumbers.set(streamKey, sequence + 1);

    let flvTagType: number;
    let flvData: Uint8Array;

    if (type === "audio") {
      flvTagType = 8; // Audio tag type

      // Check if the rtmpData already contains FLV audio header
      if (rtmpData.length >= 1) {
        // If the data already starts with proper audio header, use it as-is
        const soundFormat = (rtmpData[0] >> 4) & 0x0f;
        if (soundFormat === 10) {
          // AAC format
          // Data already has proper FLV audio header
          flvData = rtmpData;
          console.log(
            `🎵 Using existing FLV audio header: ${rtmpData.length} bytes, soundFormat=${soundFormat}`,
          );
        } else {
          // Create AAC header for the data
          const flvAudioHeader = 0xaf; // AAC, 44.1kHz, 16-bit, stereo
          flvData = new Uint8Array(1 + rtmpData.length);
          flvData[0] = flvAudioHeader;
          flvData.set(rtmpData, 1);
          console.log(
            `🎵 Added FLV audio header: ${rtmpData.length} → ${flvData.length} bytes`,
          );
        }
      } else {
        // Fallback: create AAC header
        flvData = new Uint8Array([0xaf]); // Just the audio header
        console.log(`🎵 Created minimal FLV audio header`);
      }
    } else {
      flvTagType = 9; // Video tag type

      // Check if the rtmpData already contains FLV video header
      if (rtmpData.length >= 2) {
        const frameType = (rtmpData[0] >> 4) & 0x0f;
        const codecId = rtmpData[0] & 0x0f;

        if (frameType > 0 && frameType <= 2 && codecId === 7) {
          // Valid FLV video header
          // Data already has proper FLV video header
          flvData = rtmpData;
          console.log(
            `🎬 Using existing FLV video header: ${rtmpData.length} bytes, frameType=${frameType}, codecId=${codecId}`,
          );
        } else {
          // Create FLV video header for the data
          const frameType = 1; // Keyframe
          const codecId = 7; // AVC
          const avcPacketType = rtmpData.length >= 1 ? rtmpData[0] : 1; // Use first byte as packet type or default to NALU

          flvData = new Uint8Array(5 + rtmpData.length);
          flvData[0] = (frameType << 4) | codecId; // Frame type + codec
          flvData[1] = avcPacketType; // AVC packet type
          flvData[2] = 0; // Composition time (24-bit, big-endian)
          flvData[3] = 0;
          flvData[4] = 0;
          flvData.set(rtmpData, 5);

          console.log(
            `🎬 Added FLV video header: ${rtmpData.length} → ${flvData.length} bytes, packetType=${avcPacketType}`,
          );
        }
      } else {
        // Fallback: create minimal video tag (keyframe + AVC + sequence header)
        flvData = new Uint8Array([0x17, 0x00, 0, 0, 0]); // Frame type 1 + codec 7, AVC packet type 0
        console.log(`🎬 Created minimal FLV video header (sequence header)`);
      }
    }

    return this.createFLVTag(flvTagType, timestamp, flvData);
  }

  private createStreamEndTag(): Uint8Array {
    // Create a simple end notification
    const endData = new TextEncoder().encode("end");
    return this.createFLVTag(8, 0, endData);
  }
}
