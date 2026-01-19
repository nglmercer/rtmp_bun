import { RtmpHeader, ChunkType } from './types';

/**
 * RTMP Parsers Module
 * 
 * Contains parsers for RTMP protocol data structures.
 * Separated from connection.ts for better modularity and testability.
 */

/**
 * Parses RTMP chunk headers and extracts packet information
 * @param buffer Buffer containing RTMP data
 * @returns Object with header info and bytes consumed, or null if insufficient data
 */
export function parseChunkHeader(buffer: Buffer): { header: RtmpHeader; bytesConsumed: number } | null {
  if (buffer.length < 1) return null;

  const basicHeader = buffer[0];
  const chunkStreamId = basicHeader & 0x3f;
  const chunkType = (basicHeader >> 6) & 0x03;

  let bytesConsumed = 1;
  let timestampDelta = 0;
  let messageLength = 0;
  let messageTypeId = 0;
  let messageStreamId = 0;
  let timestamp = 0;

  // Parse based on chunk type
  switch (chunkType) {
    case ChunkType.FULL: // Full header (12 bytes)
      if (buffer.length < 12) return null;
      timestamp = buffer.readUIntBE(1, 3);
      messageLength = buffer.readUIntBE(4, 3);
      messageTypeId = buffer.readUInt8(7);
      messageStreamId = buffer.readUInt32LE(8);
      bytesConsumed = 12;

      // Extended timestamp (4 additional bytes)
      if (timestamp === 0xffffff) {
        if (buffer.length < 16) return null;
        timestamp = buffer.readUInt32BE(12);
        timestampDelta = 0;
        bytesConsumed = 16;
      }
      break;

    case ChunkType.RELATIVE: // Type 1 - timestamp delta (4 bytes)
      if (buffer.length < 4) return null;
      timestampDelta = buffer.readUIntBE(1, 3);
      bytesConsumed = 4;
      break;

    case ChunkType.LARGE_ABSOLUTE: // Type 2 - timestamp delta (3 bytes)
      if (buffer.length < 3) return null;
      timestampDelta = buffer.readUIntBE(1, 2);
      bytesConsumed = 3;
      break;

    case ChunkType.ABSOLUTE: // Type 3 - no header (1 byte)
      bytesConsumed = 1;
      break;

    default:
      throw new Error(`Invalid chunk type: ${chunkType}`);
  }

  if (buffer.length < bytesConsumed) return null;

  const header: RtmpHeader = {
    timestamp: timestamp || timestampDelta,
    messageLength,
    messageTypeId,
    messageStreamId,
    chunkStreamId,
    extendedTimestamp: timestamp >= 0xffffff,
  };

  return { header, bytesConsumed };
}

/**
 * Validates if a buffer contains enough data for a complete RTMP chunk
 * @param buffer Buffer containing RTMP data
 * @param header Parsed RTMP header
 * @param bytesConsumed Bytes consumed by the header
 * @returns True if buffer contains complete chunk data
 */
export function hasCompleteChunk(buffer: Buffer, header: RtmpHeader, bytesConsumed: number): boolean {
  return buffer.length >= bytesConsumed + header.messageLength;
}

/**
 * Extracts payload from RTMP chunk
 * @param buffer Buffer containing RTMP data
 * @param bytesConsumed Bytes consumed by the header
 * @param messageLength Length of the message payload
 * @returns Extracted payload buffer
 */
export function extractChunkPayload(buffer: Buffer, bytesConsumed: number, messageLength: number): Buffer {
  return buffer.subarray(bytesConsumed, bytesConsumed + messageLength);
}

/**
 * Calculates the number of chunks needed for a message
 * @param messageLength Total message length
 * @param chunkSize RTMP chunk size
 * @returns Number of chunks needed
 */
export function calculateChunkCount(messageLength: number, chunkSize: number): number {
  if (messageLength === 0) return 1;
  return Math.ceil(messageLength / chunkSize);
}

/**
 * Validates chunk type
 * @param chunkType Chunk type to validate
 * @returns True if chunk type is valid
 */
export function isValidChunkType(chunkType: number): boolean {
  return chunkType >= ChunkType.FULL && chunkType <= ChunkType.ABSOLUTE;
}

/**
 * Parses basic header to extract chunk stream ID and chunk type
 * @param basicHeader First byte of RTMP chunk header
 * @returns Object with chunkStreamId and chunkType
 */
export function parseBasicHeader(basicHeader: number): { chunkStreamId: number; chunkType: number } {
  const chunkStreamId = basicHeader & 0x3f;
  const chunkType = (basicHeader >> 6) & 0x03;
  
  return { chunkStreamId, chunkType };
}

/**
 * Validates extended timestamp
 * @param timestamp Timestamp value
 * @param buffer Buffer containing RTMP data
 * @param offset Offset in buffer where timestamp is located
 * @returns True if extended timestamp is valid
 */
export function validateExtendedTimestamp(timestamp: number, buffer: Buffer, offset: number): boolean {
  if (timestamp !== 0xffffff) return true;
  return buffer.length >= offset + 4;
}
