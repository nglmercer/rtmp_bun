import { expect, test, describe } from "bun:test";
import { 
  parseChunkHeader, 
  hasCompleteChunk, 
  calculateChunkCount, 
  parseBasicHeader 
} from "../src/rtmp/parsers";
import { ChunkType } from "../src/rtmp/types";

describe("RTMP Parsers", () => {
  
  describe("parseBasicHeader", () => {
    test("should extract CSID and Chunk Type correctly", () => {
      // 0x42 = 01 000010 (Type 1, CSID 2)
      const { chunkStreamId, chunkType } = parseBasicHeader(0x42);
      expect(chunkStreamId).toBe(2);
      expect(chunkType).toBe(ChunkType.RELATIVE);
    });
  });

  describe("parseChunkHeader", () => {
    test("should return null for empty buffer", () => {
      const result = parseChunkHeader(Buffer.alloc(0));
      expect(result).toBeNull();
    });

    test("should parse Type 0 (FULL) header correctly", () => {
      const buffer = Buffer.alloc(12);
      // Type 0, CSID 3
      buffer[0] = 0x03; 
      // Timestamp: 1000 (0x0003E8)
      buffer.writeUintBE(1000, 1, 3);
      // Body Length: 128
      buffer.writeUintBE(128, 4, 3);
      // Type ID: 20 (AMF0 Command)
      buffer[7] = 20;
      // Stream ID: 1 (Little Endian)
      buffer.writeUint32LE(1, 8);

      const result = parseChunkHeader(buffer);
      
      expect(result).not.toBeNull();
      expect(result?.header.chunkStreamId).toBe(3);
      expect(result?.header.messageLength).toBe(128);
      expect(result?.header.messageTypeId).toBe(20);
      expect(result?.bytesConsumed).toBe(12);
    });

    test("should handle extended timestamp (0xFFFFFF)", () => {
      const buffer = Buffer.alloc(16);
      buffer[0] = 0x03; // Type 0
      buffer.writeUintBE(0xffffff, 1, 3); // Trigger extended
      buffer.writeUint32BE(2000000, 12); // Actual timestamp

      const result = parseChunkHeader(buffer);
      expect(result?.header.timestamp).toBe(2000000);
      expect(result?.bytesConsumed).toBe(16);
    });

    test("should return null if buffer is too short for Type 0", () => {
      const buffer = Buffer.alloc(5);
      buffer[0] = 0x00; // Type 0 requires 12 bytes
      expect(parseChunkHeader(buffer)).toBeNull();
    });
  });

  describe("Utility Functions", () => {
    test("calculateChunkCount should split messages correctly", () => {
      expect(calculateChunkCount(100, 128)).toBe(1);
      expect(calculateChunkCount(256, 128)).toBe(2);
      expect(calculateChunkCount(257, 128)).toBe(3);
      expect(calculateChunkCount(0, 128)).toBe(1);
    });

    test("hasCompleteChunk should validate buffer length", () => {
      const header = { messageLength: 100 } as any;
      const bytesConsumed = 12;
      
      const smallBuffer = Buffer.alloc(50);
      const largeBuffer = Buffer.alloc(112);
      
      expect(hasCompleteChunk(smallBuffer, header, bytesConsumed)).toBe(false);
      expect(hasCompleteChunk(largeBuffer, header, bytesConsumed)).toBe(true);
    });
  });
});