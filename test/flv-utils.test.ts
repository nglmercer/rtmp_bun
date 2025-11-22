import { describe, test, expect } from "bun:test";
import { FLVWrapper } from "../src/flv-utils";

describe("FLVWrapper Tests", () => {
  test("getHeader() should return valid FLV header", () => {
    const header = FLVWrapper.getHeader();
    
    expect(header.length).toBe(13);
    expect(header.toString('utf8', 0, 3)).toBe('FLV');
    expect(header[3]).toBe(1); // Version
    expect(header[4]).toBe(5); // Audio + Video flags
    expect(header.readUInt32BE(5)).toBe(9); // Data offset
    expect(header.readUInt32BE(9)).toBe(0); // PreviousTagSize0
  });

  test("wrapTag() should create valid FLV tags", () => {
    const payload = Buffer.from('test data');
    const tag = FLVWrapper.wrapTag(8, 1000, payload); // Audio tag
    
    expect(tag.length).toBe(11 + payload.length + 4);
    expect(tag[0]).toBe(8); // Audio type
    expect(tag.readUIntBE(1, 3)).toBe(payload.length); // Data size
    expect(tag.readUIntBE(4, 3)).toBe(1000 & 0xffffff); // Timestamp low
    expect(tag[7]).toBe((1000 >> 24) & 0xff); // Timestamp extended
    expect(tag.readUIntBE(8, 3)).toBe(0); // Stream ID
    expect(tag.readUInt32BE(11 + payload.length)).toBe(11 + payload.length); // PreviousTagSize
  });

  test("wrapTag() should handle video tags correctly", () => {
    const payload = Buffer.from('video data');
    const tag = FLVWrapper.wrapTag(9, 5000, payload); // Video tag
    
    expect(tag[0]).toBe(9); // Video type
    expect(tag.readUIntBE(1, 3)).toBe(payload.length);
  });

  test("wrapTag() should handle script data tags", () => {
    const payload = Buffer.from('script data');
    const tag = FLVWrapper.wrapTag(18, 0, payload); // Script tag
    
    expect(tag[0]).toBe(18); // Script data type
  });
});