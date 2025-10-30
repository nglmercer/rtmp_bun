import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../src/api";
import { AppConfig } from "../../src/config";
import { StreamForwarder } from "../../src/forwarder";
import { MSEStreaming } from "../../src/mse-streaming";
import WebSocket from "ws";

describe("Video Streaming Diagnosis", () => {
  let api: RestApi;
  let forwarder: StreamForwarder;
  let mseStreaming: MSEStreaming;
  const testConfig: AppConfig = {
    server: {
      port: 1935,
      host: "0.0.0.0",
      chunkSize: 4096,
      windowAckSize: 2500000,
      peerBandwidth: 2500000,
      logLevel: "debug",
      logFile: "./logs/video-streaming-test.log",
      enableRestApi: true,
      restApiPort: 3013,
    },
    targets: [],
  };

  beforeAll(async () => {
    console.log("🚀 Setting up video streaming diagnosis...");

    forwarder = new StreamForwarder(testConfig);
    api = new RestApi(testConfig, forwarder);
    mseStreaming = new MSEStreaming(api);

    await api.start();
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log("✅ Video streaming diagnosis ready");
  });

  afterAll(async () => {
    console.log("🧹 Cleaning up video streaming diagnosis...");
    await api.stop();
  });

  describe("Stream Key Issues", () => {
    it("should identify stream key mismatch problem", async () => {
      console.log("\n🔍 Testing stream key compatibility...");

      // Test with different stream key formats
      const testCases = [
        { streamKey: "test", description: "simple key" },
        { streamKey: "/stream/test", description: "full path key" },
        { streamKey: "stream/test", description: "partial path key" }
      ];

      for (const testCase of testCases) {
        console.log(`\n📡 Testing: ${testCase.description} (${testCase.streamKey})`);

        const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/${testCase.streamKey.replace('/stream/', '')}`);
        let receivedMessages = 0;
        const messages: Array<{ type: string; data: any }> = [];

        ws.on('message', (data) => {
          receivedMessages++;
          const bytes = new Uint8Array(data);
          messages.push({
            type: 'binary',
            data: {
              byteLength: bytes.length,
              firstBytes: Array.from(bytes.slice(0, 10)),
              flvType: bytes.length > 0 ? bytes[0] : null
            }
          });

          console.log(`📨 Message ${receivedMessages}: ${bytes.length} bytes, first byte: 0x${bytes[0]?.toString(16) || 'undefined'}`);
        });

        await new Promise((resolve) => {
          ws.on('open', () => {
            console.log(`✅ Connected, broadcasting to: ${testCase.streamKey}`);

            // Send test data
            const testData = new Uint8Array([0x46, 0x4c, 0x56, 0x01]); // FLV header start
            api.broadcastToStream(testCase.streamKey, testData);

            // Also test MSE streaming
            mseStreaming.addMediaChunk(
              new Uint8Array([0x17, 0x01, 0x00, 0x00, 0x00, 0x00]),
              testCase.streamKey,
              "video"
            );

            setTimeout(resolve, 1000);
          });

          ws.on('error', () => resolve(null));
        });

        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }

        console.log(`📊 Results for ${testCase.description}: ${receivedMessages} messages`);
        if (receivedMessages > 0) {
          console.log(`📊 Message types:`, messages.map(m => m.type));
        }
      }
    });
  });

  describe("Video Data Processing", () => {
    it("should test video sequence header processing", async () => {
      console.log("\n🔍 Testing video sequence header handling...");

      const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/video-test`);
      let receivedMessages = 0;
      let flvHeaderReceived = false;
      let videoDataReceived = false;

      ws.on('message', (data) => {
        receivedMessages++;
        const bytes = new Uint8Array(data);

        console.log(`📨 Message ${receivedMessages}: ${bytes.length} bytes`);
        console.log(`📨 First bytes: ${Array.from(bytes.slice(0, 10)).map(b => `0x${b.toString(16)}`).join(' ')}`);

        // Check for FLV header (46 4C 56 = 'FLV')
        if (bytes.length >= 3 && bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56) {
          flvHeaderReceived = true;
          console.log("✅ FLV header received");
        }

        // Check for video tag (tag type 9)
        if (bytes.length >= 11) {
          const tagType = bytes[11]; // After FLV header (9 bytes) + previous tag size (4 bytes) = position 11
          if (tagType === 9) {
            videoDataReceived = true;
            console.log("✅ Video data tag received");
          }
        }
      });

      await new Promise((resolve) => {
        ws.on('open', () => {
          console.log("✅ Connected, testing video data processing...");

          // 1. Start streaming (should send FLV header + metadata)
          mseStreaming.startStreaming("video-test");

          // 2. Simulate AVC sequence header (config data)
          setTimeout(() => {
            console.log("📡 Simulating AVC sequence header...");
            const avcSequenceHeader = new Uint8Array([
              0x17, // Frame type: keyframe, Codec: AVC
              0x00, // AVC packet type: sequence header
              0x00, 0x00, 0x00, // Composition time
              0x00, 0x00, 0x00, 0x01, 0x42, 0x00, 0x1e, 0x8d, 0x40, // SPS/PPS data
            ]);
            mseStreaming.addMediaChunk(avcSequenceHeader, "video-test", "video");
          }, 100);

          // 3. Simulate AVC NALU (actual video frame)
          setTimeout(() => {
            console.log("📡 Simulating AVC NALU...");
            const avcNalu = new Uint8Array([
              0x17, // Frame type: keyframe, Codec: AVC
              0x01, // AVC packet type: NALU
              0x00, 0x00, 0x00, // Composition time
              0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x1e, // Video frame data
            ]);
            mseStreaming.addMediaChunk(avcNalu, "video-test", "video");
          }, 200);

          setTimeout(resolve, 1500);
        });

        ws.on('error', (error) => {
          console.error("❌ WebSocket error:", error);
          resolve(null);
        });
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      console.log("\n📊 Video Processing Results:");
      console.log(`✅ Messages received: ${receivedMessages}`);
      console.log(`✅ FLV header received: ${flvHeaderReceived}`);
      console.log(`✅ Video data received: ${videoDataReceived}`);

      expect(receivedMessages).toBeGreaterThan(0);
      expect(flvHeaderReceived).toBe(true);
    });

    it("should compare audio vs video processing", async () => {
      console.log("\n🔍 Comparing audio vs video processing...");

      const results = { audio: { messages: 0 }, video: { messages: 0 } };

      // Test audio
      const audioWs = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/audio-compare`);

      audioWs.on('message', (data) => {
        results.audio.messages++;
        const bytes = new Uint8Array(data);
        console.log(`🎵 Audio message ${results.audio.messages}: ${bytes.length} bytes, first byte: 0x${bytes[0]?.toString(16)}`);
      });

      await new Promise((resolve) => {
        audioWs.on('open', () => {
          mseStreaming.addMediaChunk(
            new Uint8Array([0xaf, 0x01, 0x00, 0x00, 0x00, 0x01]),
            "audio-compare",
            "audio"
          );
          setTimeout(resolve, 500);
        });
        audioWs.on('error', () => resolve(null));
      });

      if (audioWs.readyState === WebSocket.OPEN) {
        audioWs.close();
      }

      // Test video
      const videoWs = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/video-compare`);

      videoWs.on('message', (data) => {
        results.video.messages++;
        const bytes = new Uint8Array(data);
        console.log(`🎥 Video message ${results.video.messages}: ${bytes.length} bytes, first byte: 0x${bytes[0]?.toString(16)}`);
      });

      await new Promise((resolve) => {
        videoWs.on('open', () => {
          mseStreaming.addMediaChunk(
            new Uint8Array([0x17, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01]),
            "video-compare",
            "video"
          );
          setTimeout(resolve, 500);
        });
        videoWs.on('error', () => resolve(null));
      });

      if (videoWs.readyState === WebSocket.OPEN) {
        videoWs.close();
      }

      console.log("\n📊 Comparison Results:");
      console.log(`🎵 Audio messages: ${results.audio.messages}`);
      console.log(`🎥 Video messages: ${results.video.messages}`);

      // Both should send messages, but there might be differences in processing
      expect(results.audio.messages).toBeGreaterThan(0);
    });
  });

  describe("RTMP to FLV Conversion", () => {
    it("should test RTMP video data conversion", () => {
      console.log("\n🔍 Testing RTMP to FLV video conversion...");

      // Simulate RTMP video payload (as it would come from RTMP server)
      const rtmpVideoPayload = new Buffer([
        0x17, // Frame type: keyframe (1) + Codec: AVC (7)
        0x01, // AVC packet type: NALU (1)
        0x00, 0x00, 0x00, // Composition time: 0
        0x00, 0x00, 0x00, 0x01, // NALU header
        0x67, 0x42, 0x00, 0x1e, 0x8d, 0x40, // Video data
      ]);

      // Test the conversion logic from extractMediaData
      const frameType = (rtmpVideoPayload[0] >> 4) & 0x0f;
      const codecId = rtmpVideoPayload[0] & 0x0f;
      const avcPacketType = rtmpVideoPayload[1];

      console.log(`📊 RTMP Video Analysis:`);
      console.log(`  Frame Type: ${frameType} (${frameType === 1 ? 'keyframe' : 'other'})`);
      console.log(`  Codec ID: ${codecId} (${codecId === 7 ? 'AVC/H.264' : 'other'})`);
      console.log(`  AVC Packet Type: ${avcPacketType} (${avcPacketType === 0 ? 'sequence header' : avcPacketType === 1 ? 'NALU' : 'other'})`);

      expect(codecId).toBe(7); // Should be AVC/H.264
      expect(avcPacketType).toBe(1); // Should be NALU data

      // Test the slice operation from extractMediaData
      const extractedData = rtmpVideoPayload.slice(5); // Skip 5 bytes header
      console.log(`  Extracted data length: ${extractedData.length}`);
      console.log(`  Extracted data: ${Array.from(extractedData).map(b => `0x${b.toString(16)}`).join(' ')}`);

      expect(extractedData.length).toBeGreaterThan(0);
    });

    it("should test RTMP audio data conversion", () => {
      console.log("\n🔍 Testing RTMP to FLV audio conversion...");

      // Simulate RTMP audio payload
      const rtmpAudioPayload = new Buffer([
        0xaf, // Sound format: AAC (10) + rate: 44kHz (3) + size: 16-bit (1) + type: stereo (1)
        0x01, // AAC packet type: raw data (1)
        0x00, 0x00, 0x00, 0x01, // Audio data
      ]);

      // Test the conversion logic from extractMediaData
      const soundFormat = (rtmpAudioPayload[0] >> 4) & 0x0f;
      const aacPacketType = rtmpAudioPayload[1];

      console.log(`📊 RTMP Audio Analysis:`);
      console.log(`  Sound Format: ${soundFormat} (${soundFormat === 10 ? 'AAC' : 'other'})`);
      console.log(`  AAC Packet Type: ${aacPacketType} (${aacPacketType === 0 ? 'sequence header' : aacPacketType === 1 ? 'raw data' : 'other'})`);

      expect(soundFormat).toBe(10); // Should be AAC
      expect(aacPacketType).toBe(1); // Should be raw data

      // Test the slice operation
      const extractedData = rtmpAudioPayload.slice(2); // Skip 2 bytes header
      console.log(`  Extracted data length: ${extractedData.length}`);
      console.log(`  Extracted data: ${Array.from(extractedData).map(b => `0x${b.toString(16)}`).join(' ')}`);

      expect(extractedData.length).toBeGreaterThan(0);
    });
  });

  describe("Integration Issues", () => {
    it("should test complete video streaming flow", async () => {
      console.log("\n🔍 Testing complete video streaming flow...");

      const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/complete-test`);
      let messageCount = 0;
      const messageTypes: string[] = [];

      ws.on('message', (data) => {
        messageCount++;
        const bytes = new Uint8Array(data);

        if (bytes.length >= 3 && bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56) {
          messageTypes.push('FLV header');
        } else if (bytes.length >= 12) {
          // Look for tag type after FLV header (if present) or at start
          const tagType = bytes.length > 11 ? bytes[11] : bytes[0];
          if (tagType === 18) messageTypes.push('Script data');
          else if (tagType === 8) messageTypes.push('Audio');
          else if (tagType === 9) messageTypes.push('Video');
          else messageTypes.push(`Unknown (${tagType})`);
        } else {
          messageTypes.push('Other');
        }

        console.log(`📨 Message ${messageCount}: ${bytes.length} bytes - ${messageTypes[messageTypes.length - 1]}`);
      });

      await new Promise((resolve) => {
        ws.on('open', () => {
          console.log("✅ Connected, testing complete flow...");

          // 1. Start streaming
          mseStreaming.startStreaming("complete-test");

          // 2. Add video data
          setTimeout(() => {
            mseStreaming.addMediaChunk(
              new Uint8Array([0x17, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01]),
              "complete-test",
              "video"
            );
          }, 100);

          // 3. Add audio data
          setTimeout(() => {
            mseStreaming.addMediaChunk(
              new Uint8Array([0xaf, 0x01, 0x00, 0x00, 0x00, 0x01]),
              "complete-test",
              "audio"
            );
          }, 200);

          setTimeout(resolve, 1000);
        });

        ws.on('error', (error) => {
          console.error("❌ WebSocket error:", error);
          resolve(null);
        });
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      console.log("\n📊 Complete Flow Results:");
      console.log(`✅ Total messages: ${messageCount}`);
      console.log(`✅ Message types: ${messageTypes.join(', ')}`);

      // Should receive FLV header + metadata + video + audio
      expect(messageCount).toBeGreaterThan(2);
      expect(messageTypes).toContain('FLV header');
    });
  });
});
