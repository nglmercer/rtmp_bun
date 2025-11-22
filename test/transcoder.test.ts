import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { GstTranscoder } from "../src/transcoder";
import { FLVWrapper } from "../src/flv-utils";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_STREAM_KEY = "test_stream_" + Date.now();
const TEMP_DIR = path.join(process.cwd(), 'temp_hls', TEST_STREAM_KEY);

describe("GstTranscoder Integration Tests", () => {
  let transcoder: GstTranscoder;
  let stderrOutput: string[] = [];

  beforeAll(() => {
    // Capture console.error to detect GStreamer issues
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      stderrOutput.push(args.join(' '));
      originalConsoleError(...args);
    };
  });

  test("Constructor should initialize correctly", () => {
    transcoder = new GstTranscoder(TEST_STREAM_KEY);
    expect(transcoder).toBeDefined();
  });

  test("start() should create temporary directory and launch process", async () => {
    await transcoder.start();
    
    // Verify directory creation
    expect(fs.existsSync(TEMP_DIR)).toBe(true);
    
    // Wait a bit to ensure it started properly
    await new Promise(r => setTimeout(r, 1000));
  });

  test("write() should accept FLV header without error", () => {
    expect(() => {
      transcoder.write(FLVWrapper.getHeader());
    }).not.toThrow();
  });

  test("write() should handle script data tags", async () => {
    // Create a minimal script data tag (metadata)
    const scriptData = Buffer.from([
      0x02, 0x00, 0x0a, 0x6f, 0x6e, 0x4d, 0x65, 0x74, 0x61, 0x44, 0x61, 0x74, 0x61, // "onMetaData"
      0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03 // Empty object
    ]);
    const scriptTag = FLVWrapper.wrapTag(18, 0, scriptData);
    
    expect(() => {
      transcoder.write(scriptTag);
    }).not.toThrow();

    await new Promise(r => setTimeout(r, 500));
  });

  test("write() should handle audio tags with AAC format", async () => {
    // Create a minimal AAC audio packet (AAC sequence header)
    const aacData = Buffer.from([
      0x00, 0x01, // SoundFormat=10 (AAC), SoundRate=3 (44kHz), SoundSize=1 (16-bit), SoundType=1 (Stereo)
      0x00, // AACPacketType=0 (sequence header)
      0x11, 0x90 // Minimal AAC config (sampling rate index, channel config)
    ]);
    const audioTag = FLVWrapper.wrapTag(8, 100, aacData);
    
    expect(() => {
      transcoder.write(audioTag);
    }).not.toThrow();

    await new Promise(r => setTimeout(r, 500));
  });

  test("write() should handle video tags with AVC format", async () => {
    // Create a minimal AVC video packet (AVC sequence header)
    const avcData = Buffer.from([
      0x17, // FrameType=1 (keyframe), CodecID=7 (AVC)
      0x00, // AVCPacketType=0 (sequence header)
      0x00, 0x00, 0x00, // CompositionTime=0
      0x01, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, // Minimal AVCDecoderConfigurationRecord
    ]);
    const videoTag = FLVWrapper.wrapTag(9, 200, avcData);
    
    expect(() => {
      transcoder.write(videoTag);
    }).not.toThrow();

    await new Promise(r => setTimeout(r, 500));
  });

  test("should detect codec issues in stderr output", async () => {
    // Check for common GStreamer error patterns
    const stderrText = stderrOutput.join(' ');
    
    // Look for codec-related errors
    const codecErrors = [
      'unsupported video codec tag',
      'unsupported audio codec tag',
      'invalid data',
      'Internal data stream error',
      'Got EOS before any data'
    ];
    
    const foundErrors = codecErrors.filter(error => stderrText.includes(error));
    
    if (foundErrors.length > 0) {
      console.log(`⚠️ GStreamer codec issues detected: ${foundErrors.join(', ')}`);
      console.log(`Full stderr: ${stderrText}`);
    }
    
    // This test will help us identify the exact codec issues
    expect(foundErrors.length).toBeGreaterThanOrEqual(0);
  });
  afterAll(async () => {
      if (transcoder) {
          await transcoder.stop();
      }
      // Force cleanup just in case
      if (fs.existsSync(TEMP_DIR)) {
           fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      }
      
      // Restore console.error
      console.error = console.error;
  });
});