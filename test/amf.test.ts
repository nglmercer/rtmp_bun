import { describe, it, expect, beforeEach } from "bun:test";
import { AmfParser, AmfSerializer, AmfUtility, AmfType, amf } from "../src/rtmp/amf";
import { AmfDataType, AmfObject } from "../src/rtmp/types";
import { Buffer } from "buffer";

describe("AMF Module", () => {
  let parser: AmfParser;
  let serializer: AmfSerializer;
  let utility: AmfUtility;

  beforeEach(() => {
    parser = new AmfParser();
    serializer = new AmfSerializer();
    utility = new AmfUtility();
  });

  describe("AMF Parser", () => {
    describe("extractAmfType - Number", () => {
      it("should parse AMF number correctly", () => {
        const buffer = Buffer.alloc(9);
        buffer[0] = AmfType.NUMBER; // Number type
        buffer.writeDoubleBE(42.5, 1);

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toBe(42.5);
      });

      it("should parse negative AMF number", () => {
        const buffer = Buffer.alloc(9);
        buffer[0] = AmfType.NUMBER;
        buffer.writeDoubleBE(-123.45, 1);

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toBe(-123.45);
      });

      it("should parse zero number", () => {
        const buffer = Buffer.alloc(9);
        buffer[0] = AmfType.NUMBER;
        buffer.writeDoubleBE(0, 1);

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toBe(0);
      });
    });

    describe("extractAmfType - Boolean", () => {
      it("should parse true boolean", () => {
        const buffer = Buffer.alloc(2);
        buffer[0] = AmfType.BOOLEAN;
        buffer[1] = 0x01;

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toBe(true);
      });

      it("should parse false boolean", () => {
        const buffer = Buffer.alloc(2);
        buffer[0] = AmfType.BOOLEAN;
        buffer[1] = 0x00;

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toBe(false);
      });
    });

    describe("extractAmfType - String", () => {
      it("should parse simple string", () => {
        const str = "Hello World";
        const buffer = Buffer.alloc(3 + str.length);
        buffer[0] = AmfType.STRING;
        buffer.writeUInt16BE(str.length, 1);
        buffer.write(str, 3);

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toBe(str);
      });

      it("should parse empty string", () => {
        const str = "";
        const buffer = Buffer.alloc(3 + str.length);
        buffer[0] = AmfType.STRING;
        buffer.writeUInt16BE(0, 1);

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toBe("");
      });

      it("should parse string with special characters", () => {
        const str = "Hello\nWorld\t!";
        const buffer = Buffer.alloc(3 + str.length);
        buffer[0] = AmfType.STRING;
        buffer.writeUInt16BE(str.length, 1);
        buffer.write(str, 3);

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toBe(str);
      });
    });

    describe("extractAmfType - Null", () => {
      it("should parse null value", () => {
        const buffer = Buffer.alloc(1);
        buffer[0] = AmfType.NULL;

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toBe(null);
      });
    });

    describe("extractAmfType - Object", () => {
      it("should parse simple object", () => {
        const buffer = Buffer.alloc(100);
        let offset = 0;

        // Object type
        buffer[offset++] = AmfType.OBJECT;

        // Key "name"
        const key1 = "name";
        buffer.writeUInt16BE(key1.length, offset);
        offset += 2;
        buffer.write(key1, offset);
        offset += key1.length;

        // Value "test"
        const value1 = "test";
        buffer[offset++] = AmfType.STRING;
        buffer.writeUInt16BE(value1.length, offset);
        offset += 2;
        buffer.write(value1, offset);
        offset += value1.length;

        // Key "age"
        const key2 = "age";
        buffer.writeUInt16BE(key2.length, offset);
        offset += 2;
        buffer.write(key2, offset);
        offset += key2.length;

        // Value 25
        buffer[offset++] = AmfType.NUMBER;
        buffer.writeDoubleBE(25, offset);
        offset += 8;

        // End of object
        buffer.writeUInt16BE(0, offset);
        offset += 2;
        buffer[offset++] = AmfType.OBJECT_END;

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toEqual({ name: "test", age: 25 });
      });

      it("should parse empty object", () => {
        const buffer = Buffer.alloc(4);
        buffer[0] = AmfType.OBJECT;
        buffer.writeUInt16BE(0, 1);
        buffer[3] = AmfType.OBJECT_END;

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toEqual({});
      });

      it("should parse nested object", () => {
        const buffer = Buffer.alloc(200);
        let offset = 0;

        // Outer object
        buffer[offset++] = AmfType.OBJECT;

        // Key "user"
        const key1 = "user";
        buffer.writeUInt16BE(key1.length, offset);
        offset += 2;
        buffer.write(key1, offset);
        offset += key1.length;

        // Inner object value
        buffer[offset++] = AmfType.OBJECT;

        // Key "name"
        const innerKey = "name";
        buffer.writeUInt16BE(innerKey.length, offset);
        offset += 2;
        buffer.write(innerKey, offset);
        offset += innerKey.length;

        // Value "John"
        const innerValue = "John";
        buffer[offset++] = AmfType.STRING;
        buffer.writeUInt16BE(innerValue.length, offset);
        offset += 2;
        buffer.write(innerValue, offset);
        offset += innerValue.length;

        // End of inner object
        buffer.writeUInt16BE(0, offset);
        offset += 2;
        buffer[offset++] = AmfType.OBJECT_END;

        // End of outer object
        buffer.writeUInt16BE(0, offset);
        offset += 2;
        buffer[offset++] = AmfType.OBJECT_END;

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toEqual({ user: { name: "John" } });
      });
    });

    describe("extractAmfType - Array", () => {
      it("should parse simple array", () => {
        const buffer = Buffer.alloc(100);
        let offset = 0;

        // Array type with 3 elements
        buffer[offset++] = AmfType.ARRAY;
        buffer.writeUInt32BE(3, offset);
        offset += 4;

        // Element 1: string "hello"
        buffer[offset++] = AmfType.STRING;
        const str1 = "hello";
        buffer.writeUInt16BE(str1.length, offset);
        offset += 2;
        buffer.write(str1, offset);
        offset += str1.length;

        // Element 2: number 42
        buffer[offset++] = AmfType.NUMBER;
        buffer.writeDoubleBE(42, offset);
        offset += 8;

        // Element 3: boolean true
        buffer[offset++] = AmfType.BOOLEAN;
        buffer[offset++] = 0x01;

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toEqual(["hello", 42, true]);
      });

      it("should parse empty array", () => {
        const buffer = Buffer.alloc(5);
        buffer[0] = AmfType.ARRAY;
        buffer.writeUInt32BE(0, 1);

        const result = parser.extractAmfType(buffer, 0);
        expect(result).toEqual([]);
      });
    });

    describe("extractAmfType - Indexed access", () => {
      it("should extract correct item by index", () => {
        const buffer = Buffer.alloc(50);
        let offset = 0;

        // String "first"
        buffer[offset++] = AmfType.STRING;
        const str1 = "first";
        buffer.writeUInt16BE(str1.length, offset);
        offset += 2;
        buffer.write(str1, offset);
        offset += str1.length;

        // Number 42
        buffer[offset++] = AmfType.NUMBER;
        buffer.writeDoubleBE(42, offset);
        offset += 8;

        // String "third"
        buffer[offset++] = AmfType.STRING;
        const str2 = "third";
        buffer.writeUInt16BE(str2.length, offset);
        offset += 2;
        buffer.write(str2, offset);
        offset += str2.length;

        expect(parser.extractAmfType(buffer, 0)).toBe("first");
        expect(parser.extractAmfType(buffer, 1)).toBe(42);
        expect(parser.extractAmfType(buffer, 2)).toBe("third");
      });

      it("should return null for out of bounds index", () => {
        const buffer = Buffer.alloc(10);
        buffer[0] = AmfType.STRING;
        buffer.writeUInt16BE(3, 1);
        buffer.write("abc", 3);

        const result = parser.extractAmfType(buffer, 5);
        expect(result).toBe(null);
      });
    });
  });

  describe("AMF Serializer", () => {
    describe("serializeItem - Number", () => {
      it("should serialize positive number", () => {
        const result = serializer.serializeItem(42.5);
        expect(result[0]).toBe(AmfType.NUMBER);
        expect(result.readDoubleBE(1)).toBe(42.5);
      });

      it("should serialize negative number", () => {
        const result = serializer.serializeItem(-123.45);
        expect(result[0]).toBe(AmfType.NUMBER);
        expect(result.readDoubleBE(1)).toBe(-123.45);
      });

      it("should serialize zero", () => {
        const result = serializer.serializeItem(0);
        expect(result[0]).toBe(AmfType.NUMBER);
        expect(result.readDoubleBE(1)).toBe(0);
      });
    });

    describe("serializeItem - Boolean", () => {
      it("should serialize true boolean", () => {
        const result = serializer.serializeItem(true);
        expect(result[0]).toBe(AmfType.BOOLEAN);
        expect(result[1]).toBe(0x01);
      });

      it("should serialize false boolean", () => {
        const result = serializer.serializeItem(false);
        expect(result[0]).toBe(AmfType.BOOLEAN);
        expect(result[1]).toBe(0x00);
      });
    });

    describe("serializeItem - String", () => {
      it("should serialize simple string", () => {
        const str = "Hello World";
        const result = serializer.serializeItem(str);

        expect(result[0]).toBe(AmfType.STRING);
        expect(result.readUInt16BE(1)).toBe(str.length);
        expect(result.toString("utf8", 3)).toBe(str);
      });

      it("should serialize empty string", () => {
        const result = serializer.serializeItem("");

        expect(result[0]).toBe(AmfType.STRING);
        expect(result.readUInt16BE(1)).toBe(0);
        expect(result.length).toBe(3);
      });

      it("should serialize string with special characters", () => {
        const str = "Hello\nWorld\t!";
        const result = serializer.serializeItem(str);

        expect(result[0]).toBe(AmfType.STRING);
        expect(result.readUInt16BE(1)).toBe(str.length);
        expect(result.toString("utf8", 3)).toBe(str);
      });
    });

    describe("serializeItem - Null/Undefined", () => {
      it("should serialize null", () => {
        const result = serializer.serializeItem(null);
        expect(result[0]).toBe(AmfType.NULL);
        expect(result.length).toBe(1);
      });

      it("should serialize undefined as null", () => {
        const result = serializer.serializeItem(undefined);
        expect(result[0]).toBe(AmfType.NULL);
        expect(result.length).toBe(1);
      });
    });

    describe("serializeItem - Object", () => {
      it("should serialize simple object", () => {
        const obj = { name: "test", age: 25 };
        const result = serializer.serializeItem(obj);

        expect(result[0]).toBe(AmfType.OBJECT);

        // Parse the result to verify structure
        const parsed = parser.extractAmfType(result, 0);
        expect(parsed).toEqual(obj);
      });

      it("should serialize empty object", () => {
        const result = serializer.serializeItem({});
        expect(result[0]).toBe(AmfType.OBJECT);
        expect(result.length).toBe(4); // Type + end marker
      });

      it("should serialize nested object", () => {
        const obj = { user: { name: "John", age: 30 } };
        const result = serializer.serializeItem(obj);

        expect(result[0]).toBe(AmfType.OBJECT);

        // Parse the result to verify structure
        const parsed = parser.extractAmfType(result, 0);
        expect(parsed).toEqual(obj);
      });
    });

    describe("serializeItem - Array", () => {
      it("should serialize simple array", () => {
        const arr = ["hello", 42, true];
        const result = serializer.serializeItem(arr);

        expect(result[0]).toBe(AmfType.ARRAY);

        // Parse the result to verify structure
        const parsed = parser.extractAmfType(result, 0);
        expect(parsed).toEqual(arr);
      });

      it("should serialize empty array", () => {
        const result = serializer.serializeItem([]);
        expect(result[0]).toBe(AmfType.ARRAY);
        expect(result.readUInt32BE(1)).toBe(0);
      });

      it("should serialize array with mixed types", () => {
        const arr = [1, "two", null, false, { key: "value" }];
        const result = serializer.serializeItem(arr);

        expect(result[0]).toBe(AmfType.ARRAY);

        // Parse the result to verify structure
        const parsed = parser.extractAmfType(result, 0);
        expect(parsed).toEqual(arr);
      });
    });

    describe("serializeItem - Unknown types", () => {
      it("should return empty buffer for unsupported types", () => {
        const result = serializer.serializeItem(Symbol("test"));
        expect(result.length).toBe(0);

        const result2 = serializer.serializeItem(() => {});
        expect(result2.length).toBe(0);
      });
    });
  });

  describe("AMF Utility", () => {
    describe("parse method", () => {
      it("should parse using utility parse method", () => {
        const buffer = Buffer.alloc(9);
        buffer[0] = AmfType.NUMBER;
        buffer.writeDoubleBE(42.5, 1);

        const result = utility.parse(buffer, 0);
        expect(result).toBe(42.5);
      });

      it("should use default index 0 when not specified", () => {
        const buffer = Buffer.alloc(9);
        buffer[0] = AmfType.NUMBER;
        buffer.writeDoubleBE(42.5, 1);

        const result = utility.parse(buffer);
        expect(result).toBe(42.5);
      });
    });

    describe("getLength method", () => {
      it("should get length of number", () => {
        const buffer = Buffer.alloc(9);
        buffer[0] = AmfType.NUMBER;
        buffer.writeDoubleBE(42.5, 1);

        const result = utility.getLength(buffer, 0);
        expect(result).toBe(9);
      });

      it("should get length of string", () => {
        const str = "hello";
        const buffer = Buffer.alloc(3 + str.length);
        buffer[0] = AmfType.STRING;
        buffer.writeUInt16BE(str.length, 1);
        buffer.write(str, 3);

        const result = utility.getLength(buffer, 0);
        expect(result).toBe(8);
      });

      it("should use default start 0 when not specified", () => {
        const buffer = Buffer.alloc(9);
        buffer[0] = AmfType.NUMBER;
        buffer.writeDoubleBE(42.5, 1);

        const result = utility.getLength(buffer);
        expect(result).toBe(9);
      });
    });

    describe("serialize method", () => {
      it("should serialize using utility serialize method", () => {
        const result = utility.serialize(42.5);
        expect(result[0]).toBe(AmfType.NUMBER);
        expect(result.readDoubleBE(1)).toBe(42.5);
      });
    });
  });

  describe("Singleton instance", () => {
    it("should use singleton instance", () => {
      const buffer = Buffer.alloc(9);
      buffer[0] = AmfType.NUMBER;
      buffer.writeDoubleBE(42.5, 1);

      const result = amf.parse(buffer, 0);
      expect(result).toBe(42.5);
    });

    it("should have same functionality as utility class", () => {
      const testValue = { test: "value", number: 123 };

      const utilityResult = utility.serialize(testValue);
      const singletonResult = amf.serialize(testValue);

      expect(utilityResult).toEqual(singletonResult);
    });
  });

  describe("Round-trip serialization/deserialization", () => {
    it("should round-trip number", () => {
      const original = 42.5;
      const serialized = serializer.serializeItem(original);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toBe(original);
    });

    it("should round-trip boolean", () => {
      const original = true;
      const serialized = serializer.serializeItem(original);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toBe(original);
    });

    it("should round-trip string", () => {
      const original = "Hello World";
      const serialized = serializer.serializeItem(original);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toBe(original);
    });

    it("should round-trip null", () => {
      const original = null;
      const serialized = serializer.serializeItem(original);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toBe(original);
    });

    it("should round-trip object", () => {
      const original = { name: "test", age: 25, active: true };
      const serialized = serializer.serializeItem(original);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toEqual(original);
    });

    it("should round-trip array", () => {
      const original = [1, "two", null, false];
      const serialized = serializer.serializeItem(original);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toEqual(original);
    });

    it("should round-trip complex nested structure", () => {
      const original = {
        user: {
          name: "John",
          age: 30,
          settings: {
            theme: "dark",
            notifications: true
          }
        },
        items: [1, 2, 3],
        active: true
      };

      const serialized = serializer.serializeItem(original);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toEqual(original);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty buffer", () => {
      const buffer = Buffer.alloc(0);
      const result = parser.extractAmfType(buffer, 0);
      expect(result).toBe(null);
    });

    it("should handle buffer with only type byte", () => {
      const buffer = Buffer.alloc(1);
      buffer[0] = AmfType.NUMBER;
      const result = parser.extractAmfType(buffer, 0);
      expect(result).toBe(null);
    });

    it("should handle malformed object without end marker", () => {
      const buffer = Buffer.alloc(10);
      buffer[0] = AmfType.OBJECT;
      buffer.writeUInt16BE(3, 1); // key length
      buffer.write("key", 3); // key

      const result = parser.extractAmfType(buffer, 0);
      expect(result).toBe(null);
    });

    it("should handle very large numbers", () => {
      const largeNumber = Number.MAX_SAFE_INTEGER;
      const serialized = serializer.serializeItem(largeNumber);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toBe(largeNumber);
    });

    it("should handle very small numbers", () => {
      const smallNumber = Number.MIN_SAFE_INTEGER;
      const serialized = serializer.serializeItem(smallNumber);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toBe(smallNumber);
    });
  });

  describe("Real-world RTMP scenarios", () => {
    it("should parse RTMP connect command structure", () => {
      // Simulate RTMP connect command: ["connect", 1, {app: "test", flashVer: "FMLE/3.0"}]
      const buffer = Buffer.alloc(512);
      let offset = 0;

      // "connect" string
      buffer[offset++] = AmfType.STRING;
      const connectStr = "connect";
      buffer.writeUInt16BE(connectStr.length, offset);
      offset += 2;
      buffer.write(connectStr, offset);
      offset += connectStr.length;

      // Transaction ID (number 1)
      buffer[offset++] = AmfType.NUMBER;
      buffer.writeDoubleBE(1, offset);
      offset += 8;

      // Command object
      buffer[offset++] = AmfType.OBJECT;

      // "app" key
      const appKey = "app";
      buffer.writeUInt16BE(appKey.length, offset);
      offset += 2;
      buffer.write(appKey, offset);
      offset += appKey.length;

      // "test" value
      const appValue = "test";
      buffer[offset++] = AmfType.STRING;
      buffer.writeUInt16BE(appValue.length, offset);
      offset += 2;
      buffer.write(appValue, offset);
      offset += appValue.length;

      // "flashVer" key
      const flashVerKey = "flashVer";
      buffer.writeUInt16BE(flashVerKey.length, offset);
      offset += 2;
      buffer.write(flashVerKey, offset);
      offset += flashVerKey.length;

      // "FMLE/3.0" value
      const flashVerValue = "FMLE/3.0";
      buffer[offset++] = AmfType.STRING;
      buffer.writeUInt16BE(flashVerValue.length, offset);
      offset += 2;
      buffer.write(flashVerValue, offset);
      offset += flashVerValue.length;

      // End of object
      buffer.writeUInt16BE(0, offset);
      offset += 2;
      buffer[offset++] = AmfType.OBJECT_END;

      const commandName = parser.extractAmfType(buffer, 0);
      const transactionId = parser.extractAmfType(buffer, 1);
      const commandObject = parser.extractAmfType(buffer, 2);

      expect(commandName).toBe("connect");
      expect(transactionId).toBe(1);
      expect(commandObject).toEqual({ app: "test", flashVer: "FMLE/3.0" });
    });

    it("should serialize RTMP onStatus response", () => {
      // Create onStatus response similar to what RTMP server sends
      const onStatusData = {
        code: "NetConnection.Connect.Success",
        level: "status",
        description: "Connection accepted"
      };

      const serialized = serializer.serializeItem(onStatusData);
      const deserialized = parser.extractAmfType(serialized, 0);

      expect(deserialized).toEqual(onStatusData);
    });
  });
});
