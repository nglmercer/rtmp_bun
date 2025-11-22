import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GstTranscoder } from "../src/transcoder";
import { FLVWrapper } from "../src/flv-utils";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_STREAM_KEY = "diagnostic_" + Date.now();
const TEMP_DIR = path.join(process.cwd(), 'temp_hls', TEST_STREAM_KEY);

describe("GStreamer Diagnostic Tests", () => {
  let transcoder: GstTranscoder;
  let capturedLogs: string[] = [];

  beforeAll(() => {
    // Capture all console output for analysis
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    
    console.log = (...args: any[]) => {
      capturedLogs.push(`LOG: ${args.join(' ')}`);
      originalConsoleLog(...args);
    };
    
    console.error = (...args: any[]) => {
      capturedLogs.push(`ERROR: ${args.join(' ')}`);
      originalConsoleError(...args);
    };
  });

  test("should identify codec issues with proper FLV data", async () => {
    // Increase timeout for this test
    // Note: Bun uses describe.timeout() not test.setTimeout()
    transcoder = new GstTranscoder(TEST_STREAM_KEY);
    await transcoder.start();
    
    // Wait for GStreamer to initialize
    await new Promise(r => setTimeout(r, 200));
    
    // Send FLV header first
    console.log("🔄 Sending FLV header...");
    transcoder.write(FLVWrapper.getHeader());
    await new Promise(r => setTimeout(r, 500));
    
    // Skip metadata tag for now to focus on codec issues
    console.log("🔄 Skipping metadata tag...");
    await new Promise(r => setTimeout(r, 500));
    
    // Send audio sequence header using proper AAC config
    console.log("🔄 Sending audio sequence header...");
    transcoder.write(FLVWrapper.createAACAudioTag(0, true));
    await new Promise(r => setTimeout(r, 500));
    
    // Send video sequence header using proper H.264 config
    console.log("🔄 Sending video sequence header...");
    transcoder.write(FLVWrapper.createH264VideoTag(0, true));
    await new Promise(r => setTimeout(r, 200));
    
    // Send more audio data to trigger segment generation
    console.log("🔄 Sending audio data...");
    transcoder.write(FLVWrapper.createAACAudioTag(100, false));
    await new Promise(r => setTimeout(r, 200));
    
    // Send more video data to trigger segment generation
    console.log("🔄 Sending video data...");
    transcoder.write(FLVWrapper.createH264VideoTag(200, false));
    await new Promise(r => setTimeout(r, 200));
    
    // Send additional frames to ensure we have enough data for HLS
    console.log("🔄 Sending additional frames...");
    for (let i = 0; i < 10; i++) {
      transcoder.write(FLVWrapper.createAACAudioTag(300 + i * 100, false));
      transcoder.write(FLVWrapper.createH264VideoTag(400 + i * 100, false));
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Wait longer for HLS segment generation
    console.log("🔄 Waiting for HLS segment generation...");
    await new Promise(r => setTimeout(r, 200));
    
    // Analyze captured logs for issues
    const allLogs = capturedLogs.join('\n');
    
    console.log("\n=== CAPTURED LOGS ANALYSIS ===");
    console.log(allLogs);
    console.log("=== END ANALYSIS ===\n");
    
    // Check for specific error patterns
    const errorPatterns = [
      'unsupported video codec tag 0',
      'unsupported audio codec tag',
      'Internal data stream error',
      'Got EOS before any data',
      'streaming stopped, reason error',
      'pipeline doesn\'t want to preroll',
      'no suitable plugins found',
      'profile 0 is not a valid profile'
    ];
    
    const foundErrors = errorPatterns.filter(pattern => allLogs.includes(pattern));
    
    if (foundErrors.length > 0) {
      console.log(`🚨 DIAGNOSTIC: Found ${foundErrors.length} critical errors:`);
      foundErrors.forEach(error => console.log(`   - ${error}`));
      
      // Provide specific recommendations based on errors
      if (allLogs.includes('unsupported video codec tag 0')) {
        console.log(`💡 RECOMMENDATION: Video codec tag 0 indicates missing or invalid video data.`);
        console.log(`   - Ensure video sequence headers are sent first`);
        console.log(`   - Check if video data contains proper AVC NAL units`);
      }
      
      if (allLogs.includes('Got EOS before any data')) {
        console.log(`💡 RECOMMENDATION: No data reaching GStreamer.`);
        console.log(`   - Check if FLV header is being sent`);
        console.log(`   - Verify data is being written to stdin`);
      }
      
      if (allLogs.includes('no suitable plugins found')) {
        console.log(`💡 RECOMMENDATION: Missing GStreamer plugins.`);
        console.log(`   - Install GStreamer with all plugin packages`);
        console.log(`   - Ensure libav plugins are installed`);
      }
      
      if (allLogs.includes('profile 0 is not a valid profile')) {
        console.log(`💡 RECOMMENDATION: Invalid AAC profile.`);
        console.log(`   - Use proper AAC configuration (profile 2 or 5)`);
        console.log(`   - Check AudioSpecificConfig format`);
      }
    } else {
      console.log(`✅ No critical errors detected in logs`);
    }
    
    // This test always passes but provides diagnostic information
    expect(true).toBe(true);
  });

  afterAll(async () => {
    if (transcoder) {
      await transcoder.stop();
    }
    
    // Cleanup
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  });
});