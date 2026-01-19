import { AmfDataType, AmfObject, AmfArray } from './types';

/**
 * AMF (Action Message Format) Serialization and Deserialization
 *
 * This module provides utilities for parsing and serializing AMF data,
 * which is used in RTMP protocol for command and data messages.
 */

export enum AmfType {
  NUMBER = 0x00,
  BOOLEAN = 0x01,
  STRING = 0x02,
  OBJECT = 0x03,
  NULL = 0x05,
  UNDEFINED = 0x06,
  ARRAY = 0x0a,
  OBJECT_END = 0x09,
}

/**
 * AMF Parser - Deserializes AMF data from Buffer
 */
export class AmfParser {
  /**
   * Extract AMF data type from buffer at specified index
   * @param buffer Buffer containing AMF data
   * @param index Index of the AMF item to extract
   * @returns Parsed AMF data type
   */
  public extractAmfType(buffer: Buffer, index: number): AmfDataType {
    let offset = 0;
    for (let i = 0; i <= index; i++) {
      if (offset >= buffer.length) return null;

      const type = buffer[offset];
      offset += 1;

      switch (type) {
        case AmfType.NUMBER: // Number
          offset += 8;
          break;
        case AmfType.BOOLEAN: // Boolean
          offset += 1;
          break;
        case AmfType.STRING: // String
          const strLen = buffer.readUInt16BE(offset);
          offset += 2 + strLen;
          break;
        case AmfType.NULL: // Null
          break;
        case AmfType.OBJECT: // Object
          // Skip all properties until we hit 0x00 0x00 0x09 (end of object)
          while (offset < buffer.length) {
            if (
              buffer[offset] === 0x00 &&
              buffer[offset + 1] === 0x00 &&
              buffer[offset + 2] === AmfType.OBJECT_END
            ) {
              offset += 3;
              break;
            }
            // Skip key length
            offset += 2;
            const keyLen = buffer.readUInt16BE(offset - 2);
            offset += keyLen;
            // Skip value
            offset += this.getAmfLength(buffer, offset);
          }
          break;
        case AmfType.ARRAY: // Array
          const arrayLen = buffer.readUInt32BE(offset);
          offset += 4;
          for (let j = 0; j < arrayLen; j++) {
            offset += this.getAmfLength(buffer, offset);
          }
          break;
        default:
          break;
      }
    }

    // Actually parse the value
    offset = 0;
    for (let i = 0; i <= index; i++) {
      if (offset >= buffer.length) return null;

      const type = buffer[offset];
      offset += 1;

      switch (type) {
        case AmfType.NUMBER: {
          // Number
          if (offset + 8 > buffer.length) return null;
          const value = buffer.readDoubleBE(offset);
          offset += 8;
          if (i === index) return value;
          break;
        }
        case AmfType.BOOLEAN: {
          // Boolean
          if (offset + 1 > buffer.length) return null;
          const value = buffer.readUInt8(offset) === 1;
          offset += 1;
          if (i === index) return value;
          break;
        }
        case AmfType.STRING: {
          // String
          if (offset + 2 > buffer.length) return null;
          const strLen = buffer.readUInt16BE(offset);
          offset += 2;
          if (offset + strLen > buffer.length) return null;
          const value = buffer.toString("utf8", offset, offset + strLen);
          offset += strLen;
          if (i === index) return value;
          break;
        }
        case AmfType.NULL: {
          // Null
          if (i === index) return null;
          break;
        }
        case AmfType.OBJECT: {
          // Object
          if (i === index) {
            const obj: AmfObject = {};
            while (offset < buffer.length) {
              if (
                buffer[offset] === 0x00 &&
                buffer[offset + 1] === 0x00 &&
                buffer[offset + 2] === AmfType.OBJECT_END
              ) {
                offset += 3;
                break;
              }
              if (offset + 2 > buffer.length) break;
              const keyLen = buffer.readUInt16BE(offset);
              offset += 2;
              if (offset + keyLen > buffer.length) break;
              const key = buffer.toString("utf8", offset, offset + keyLen);
              offset += keyLen;

              // Parse the value at current offset
              if (offset >= buffer.length) break;
              const valueType = buffer[offset];
              let value: AmfDataType = null;

              switch (valueType) {
                case AmfType.NUMBER:
                  if (offset + 9 > buffer.length) break;
                  value = buffer.readDoubleBE(offset + 1);
                  offset += 9;
                  break;
                case AmfType.BOOLEAN:
                  if (offset + 2 > buffer.length) break;
                  value = buffer.readUInt8(offset + 1) === 1;
                  offset += 2;
                  break;
                case AmfType.STRING:
                  if (offset + 3 > buffer.length) break;
                  const strLen = buffer.readUInt16BE(offset + 1);
                  if (offset + 3 + strLen > buffer.length) break;
                  value = buffer.toString("utf8", offset + 3, offset + 3 + strLen);
                  offset += 3 + strLen;
                  break;
                case AmfType.NULL:
                  value = null;
                  offset += 1;
                  break;
                default:
                  // Skip unknown types
                  const len = this.getAmfLength(buffer, offset);
                  offset += len;
                  break;
              }
              obj[key] = value;
            }
            return obj;
          }
          // Skip object
          while (offset < buffer.length) {
            if (
              buffer[offset] === 0x00 &&
              buffer[offset + 1] === 0x00 &&
              buffer[offset + 2] === AmfType.OBJECT_END
            ) {
              offset += 3;
              break;
            }
            offset += 2;
            const keyLen = buffer.readUInt16BE(offset - 2);
            offset += keyLen;
            offset += this.getAmfLength(buffer, offset);
          }
          break;
        }
        case AmfType.ARRAY: {
          // Array
          if (i === index) {
            if (offset + 4 > buffer.length) return null;
            const arrayLen = buffer.readUInt32BE(offset);
            offset += 4;
            const arr: AmfDataType[] = [];

            for (let j = 0; j < arrayLen; j++) {
              if (offset >= buffer.length) break;

              const valueType = buffer[offset];
              let value: AmfDataType = null;

              switch (valueType) {
                case AmfType.NUMBER:
                  if (offset + 9 > buffer.length) break;
                  value = buffer.readDoubleBE(offset + 1);
                  offset += 9;
                  break;
                case AmfType.BOOLEAN:
                  if (offset + 2 > buffer.length) break;
                  value = buffer.readUInt8(offset + 1) === 1;
                  offset += 2;
                  break;
                case AmfType.STRING:
                  if (offset + 3 > buffer.length) break;
                  const strLen = buffer.readUInt16BE(offset + 1);
                  if (offset + 3 + strLen > buffer.length) break;
                  value = buffer.toString("utf8", offset + 3, offset + 3 + strLen);
                  offset += 3 + strLen;
                  break;
                case AmfType.NULL:
                  value = null;
                  offset += 1;
                  break;
                case AmfType.OBJECT:
                  // Parse nested object
                  if (offset + 1 > buffer.length) break;
                  const nestedObj: AmfObject = {};
                  offset += 1; // Skip object type byte

                  while (offset < buffer.length) {
                    if (
                      buffer[offset] === 0x00 &&
                      buffer[offset + 1] === 0x00 &&
                      buffer[offset + 2] === AmfType.OBJECT_END
                    ) {
                      offset += 3;
                      break;
                    }
                    if (offset + 2 > buffer.length) break;
                    const keyLen = buffer.readUInt16BE(offset);
                    offset += 2;
                    if (offset + keyLen > buffer.length) break;
                    const key = buffer.toString("utf8", offset, offset + keyLen);
                    offset += keyLen;

                    if (offset >= buffer.length) break;
                    const nestedValueType = buffer[offset];
                    let nestedValue: AmfDataType = null;

                    switch (nestedValueType) {
                      case AmfType.NUMBER:
                        if (offset + 9 > buffer.length) break;
                        nestedValue = buffer.readDoubleBE(offset + 1);
                        offset += 9;
                        break;
                      case AmfType.BOOLEAN:
                        if (offset + 2 > buffer.length) break;
                        nestedValue = buffer.readUInt8(offset + 1) === 1;
                        offset += 2;
                        break;
                      case AmfType.STRING:
                        if (offset + 3 > buffer.length) break;
                        const nestedStrLen = buffer.readUInt16BE(offset + 1);
                        if (offset + 3 + nestedStrLen > buffer.length) break;
                        nestedValue = buffer.toString("utf8", offset + 3, offset + 3 + nestedStrLen);
                        offset += 3 + nestedStrLen;
                        break;
                      case AmfType.NULL:
                        nestedValue = null;
                        offset += 1;
                        break;
                      default:
                        const len = this.getAmfLength(buffer, offset);
                        offset += len;
                        break;
                    }
                    nestedObj[key] = nestedValue;
                  }
                  value = nestedObj;
                  break;
                default:
                  // Skip unknown types
                  const len = this.getAmfLength(buffer, offset);
                  offset += len;
                  break;
              }
              arr.push(value);
            }
            return arr;
          }
          // Skip array
          if (offset + 4 > buffer.length) break;
          const skipArrayLen = buffer.readUInt32BE(offset);
          offset += 4;
          for (let j = 0; j < skipArrayLen; j++) {
            offset += this.getAmfLength(buffer, offset);
          }
          break;
        }
        default:
          break;
      }
    }

    return null;
  }

  /**
   * Get the length of AMF data starting at specified position
   * @param buffer Buffer containing AMF data
   * @param start Starting position in buffer
   * @returns Length of AMF data in bytes
   */
  public getAmfLength(buffer: Buffer, start: number): number {
    if (start >= buffer.length) return 0;

    const type = buffer[start];
    let offset = 1;

    switch (type) {
      case AmfType.NUMBER: // Number
        return offset + 8;
      case AmfType.BOOLEAN: // Boolean
        return offset + 1;
      case AmfType.STRING: {
        // String
        const strLen = buffer.readUInt16BE(start + 1);
        return offset + 2 + strLen;
      }
      case AmfType.NULL: // Null
        return offset;
      case AmfType.OBJECT: {
        // Object
        while (start + offset < buffer.length) {
          if (
            buffer[start + offset] === 0x00 &&
            buffer[start + offset + 1] === 0x00 &&
            buffer[start + offset + 2] === AmfType.OBJECT_END
          ) {
            return offset + 3;
          }
          offset += 2;
          const keyLen = buffer.readUInt16BE(start + offset - 2);
          offset += keyLen;
          const valueLen = this.getAmfLength(buffer, start + offset);
          offset += valueLen;
        }
        return buffer.length - start;
      }
      case AmfType.ARRAY: {
        // Array
        const arrayLen = buffer.readUInt32BE(start + 1);
        offset += 4;
        for (let i = 0; i < arrayLen; i++) {
          offset += this.getAmfLength(buffer, start + offset);
        }
        return offset;
      }
      default:
        return 0;
    }
  }
}

/**
 * AMF Serializer - Serializes data to AMF format
 */
export class AmfSerializer {
  /**
   * Serialize item to AMF format
   * @param item Item to serialize
   * @returns Buffer containing AMF data
   */
  public serializeItem(item: unknown): Buffer {
    if (typeof item === "number") {
      const buffer = Buffer.alloc(1 + 8);
      buffer[0] = AmfType.NUMBER; // Number
      buffer.writeDoubleBE(item, 1);
      return buffer;
    } else if (typeof item === "string") {
      const buffer = Buffer.alloc(3 + Buffer.byteLength(item));
      buffer[0] = AmfType.STRING; // String
      buffer.writeUInt16BE(Buffer.byteLength(item), 1);
      buffer.write(item, 3);
      return buffer;
    } else if (typeof item === "boolean") {
      const buffer = Buffer.alloc(2);
      buffer[0] = AmfType.BOOLEAN; // Boolean
      buffer[1] = item ? 0x01 : 0x00;
      return buffer;
    } else if (item === null || item === undefined) {
      const buffer = Buffer.alloc(1);
      buffer[0] = AmfType.NULL; // Null (or 0x06 for undefined)
      return buffer;
    } else if (Array.isArray(item)) {
      const buffer = Buffer.alloc(1024);
      buffer[0] = AmfType.ARRAY; // Array
      buffer.writeUInt32BE(item.length, 1);
      let offset = 5;

      for (const subItem of item) {
        const serialized = this.serializeItem(subItem);
        serialized.copy(buffer, offset);
        offset += serialized.length;
      }

      return buffer.subarray(0, offset);
    } else if (typeof item === "object") {
      const buffer = Buffer.alloc(2048);
      buffer[0] = AmfType.OBJECT; // Object
      let offset = 1;

      for (const [key, value] of Object.entries(item)) {
        // Write key
        const keyBuffer = Buffer.from(key, "utf8");
        buffer.writeUInt16BE(keyBuffer.length, offset);
        offset += 2;
        keyBuffer.copy(buffer, offset);
        offset += keyBuffer.length;

        // Write value
        const valueBuffer = this.serializeItem(value);
        valueBuffer.copy(buffer, offset);
        offset += valueBuffer.length;
      }

      // End of object
      buffer.writeUInt16BE(0, offset);
      offset += 3;

      return buffer.subarray(0, offset);
    }

    return Buffer.alloc(0);
  }
}

/**
 * AMF Utility class combining parser and serializer
 */
export class AmfUtility {
  private parser: AmfParser;
  private serializer: AmfSerializer;

  constructor() {
    this.parser = new AmfParser();
    this.serializer = new AmfSerializer();
  }

  /**
   * Parse AMF data from buffer
   * @param buffer Buffer containing AMF data
   * @param index Index of item to extract
   * @returns Parsed AMF data
   */
  public parse(buffer: Buffer, index: number = 0): AmfDataType {
    return this.parser.extractAmfType(buffer, index);
  }

  /**
   * Get length of AMF data
   * @param buffer Buffer containing AMF data
   * @param start Starting position
   * @returns Length in bytes
   */
  public getLength(buffer: Buffer, start: number = 0): number {
    return this.parser.getAmfLength(buffer, start);
  }

  /**
   * Serialize data to AMF format
   * @param item Data to serialize
   * @returns Buffer containing AMF data
   */
  public serialize(item: unknown): Buffer {
    return this.serializer.serializeItem(item);
  }
}

// Export singleton instance for convenience
export const amf = new AmfUtility();
