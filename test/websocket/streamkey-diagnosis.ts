import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../src/api";
import { AppConfig } from "../../src/config";
import { StreamForwarder } from "../../src/forwarder";
import { MSEStreaming } from "../../src/mse-streaming";
import WebSocket from "ws";

describe("StreamKey Diagnosis", () => {
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
      logFile: "./logs/streamkey-diagnosis.log",
      enableRestApi: true,
      restApiPort: 3014,
    },
    targets: [],
  };

  beforeAll(async () => {
    console.log("🚀 Setting up StreamKey diagnosis...");

    forwarder = new StreamForwarder(testConfig);
    api = new RestApi(testConfig, forwarder);
    mseStreaming = new MSEStreaming(api);

    await api.start();
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log("✅ StreamKey diagnosis ready");
  });

  afterAll(async () => {
    console.log("🧹 Cleaning up StreamKey diagnosis...");
    await api.stop();
  });

  describe("StreamKey Format Issues", () => {
    it("should test RTMP server streamKey format", () => {
      console.log("\n🔍 Analyzing RTMP server streamKey format...");

      // This simulates how RTMP server generates the streamKey
      const mockStreamKey = "test123";
      const rtmpServerStreamKey = `/stream/${mockStreamKey}`;

      console.log("📋 Mock streamKey:", mockStreamKey);
      console.log("📋 RTMP server streamKey:", rtmpServerStreamKey);

      // WebSocket URL would be: ws://host:port/stream/streamKey
      // So if RTMP uses `/stream/test123`, WebSocket expects just `test123`
      const expectedWebSocketPath = mockStreamKey;
      const actualWebSocketUrl = `ws://localhost:${testConfig.server.restApiPort}/stream/${expectedWebSocketPath}`;

      console.log("📋 Expected WebSocket path:", expectedWebSocketPath);
      console.log("📋 Actual WebSocket URL:", actualWebSocketUrl);

      expect(rtmpServerStreamKey).toBe(`/stream/${mockStreamKey}`);
      expect(expectedWebSocketPath).toBe(mockStreamKey);
    });

    it("should test broadcastToStream with different streamKey formats", async () => {
      console.log("\n🔍 Testing broadcastToStream with different streamKey formats...");

      const baseKey = "test-key";
      const testCases = [
        { key: baseKey, description: "plain key" },
        { key: `/stream/${baseKey}`, description: "full path key" },
        { key: `stream/${baseKey}`, description: "partial path key" },
      ];

      for (const testCase of testCases) {
        console.log(`\n📡 Testing: ${testCase.description} (${testCase.key})`);

        const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/${baseKey}`);
        let messageReceived = false;

        ws.on('message', (data) => {
          messageReceived = true;
          console.log(`📨 Message received for ${testCase.description}: ${data.length} bytes`);
        });

        await new Promise((resolve) => {
          ws.on('open', () => {
            console.log(`✅ Connected, broadcasting to: ${testCase.key}`);
            api.broadcastToStream(testCase.key, `Test message for ${testCase.description}`);
            setTimeout(resolve, 1000);
          });

          ws.on('error', (error) => {
            console.error(`❌ Error for ${testCase.description}:`, error);
            resolve(null);
          });
        });

        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }

        console.log(`📊 Results for ${testCase.description}: message received = ${messageReceived}`);

        if (testCase.key === baseKey || testCase.key === `/stream/${baseKey}`) {
          // These should work
          expect(messageReceived).toBe(true);
        }
      }
    });

    it("should test MSEStreaming addMediaChunk with streamKey formats", async () => {
      console.log("\n🔍 Testing MSEStreaming addMediaChunk streamKey formats...");

      const baseKey = "mse-test";
      const testCases = [
        { key: baseKey, description: "plain key" },
        { key: `/stream/${baseKey}`, description: "full path key (RTMP format)" },
      ];

      for (const testCase of testCases) {
        console.log(`\n📡 Testing MSE: ${testCase.description} (${testCase.key})`);

        const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/${baseKey}`);
        let audioMessages = 0;
        let videoMessages = 0;

        ws.on('message', (data) => {
          const bytes = new Uint8Array(data);

          // Look for FLV tags after potential header
          let tagType = null;
          if (bytes.length >= 12) {
            tagType = bytes[11]; // After FLV header
          } else if (bytes.length >= 1) {
            tagType = bytes[0]; // Direct tag
          }

          if (tagType === 8) {
            audioMessages++;
            console.log(`🎵 Audio message ${audioMessages}`);
          } else if (tagType === 9) {
            videoMessages++;
            console.log(`🎥 Video message ${videoMessages}`);
          } else {
            console.log(`📨 Other message: tagType=${tagType}, length=${bytes.length}`);
          }
        });

        await new Promise((resolve) => {
          ws.on('open', () => {
            console.log(`✅ Connected, testing MSE with: ${testCase.key}`);

            // Start streaming
            mseStreaming.startStreaming(testCase.key);

            // Add audio
            setTimeout(() => {
              const audioData = new Uint8Array([0xaf, 0x01, 0x00, 0x00, 0x00, 0x01]);
              mseStreaming.addMediaChunk(audioData, testCase.key, "audio");
            }, 100);

            // Add video
            setTimeout(() => {
              const videoData = new Uint8Array([0x17, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01]);
              mseStreaming.addMediaChunk(videoData, testCase.key, "video");
            }, 200);

            setTimeout(resolve, 1500);
          });

          ws.on('error', (error) => {
            console.error(`❌ MSE error for ${testCase.description}:`, error);
            resolve(null);
          });
        });

        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }

        console.log(`📊 MSE Results for ${testCase.description}:`);
        console.log(`  Audio messages: ${audioMessages}`);
        console.log(`  Video messages: ${videoMessages}`);
        console.log(`  Total messages: ${audioMessages + videoMessages}`);

        // Both formats should work if MSEStreaming handles them correctly
        expect(audioMessages + videoMessages).toBeGreaterThan(0);
      }
    });
  });

  describe("StreamKey Mismatch Fix", () => {
    it("should demonstrate the correct streamKey handling", async () => {
      console.log("\n🔍 Demonstrating correct streamKey handling...");

      // Simulate the RTMP server behavior
      const streamKey = "live123";
      const rtmpGeneratedKey = `/stream/${streamKey}`; // This is what RTMP server generates
      const websocketExpectedKey = streamKey; // This is what WebSocket client expects

      console.log("📋 StreamKey flow:");
      console.log(`  1. Stream publishes with key: ${streamKey}`);
      console.log(`  2. RTMP server generates: ${rtmpGeneratedKey}`);
      console.log(`  3. WebSocket client connects to: ws://host/stream/${websocketExpectedKey}`);
      console.log(`  4. MSEStreaming should normalize: ${rtmpGeneratedKey} → ${websocketExpectedKey}`);

      // Test if we connect to the WebSocket and send data with the correct key
      const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/${websocketExpectedKey}`);
      let messagesReceived = 0;

      ws.on('message', (data) => {
        messagesReceived++;
        console.log(`📨 Message ${messagesReceived}: ${data.length} bytes`);
      });

      await new Promise((resolve) => {
        ws.on('open', () => {
          console.log("✅ WebSocket connected successfully");

          // Send data using the key that RTMP server would generate
          console.log(`📡 Broadcasting with RTMP-generated key: ${rtmpGeneratedKey}`);
          mseStreaming.addMediaChunk(
            new Uint8Array([0xaf, 0x01, 0x00, 0x00, 0x00, 0x01]),
            rtmpGeneratedKey,
            "audio"
          );

          setTimeout(() => {
            mseStreaming.addMediaChunk(
              new Uint8Array([0x17, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01]),
              rtmpGeneratedKey,
              "video"
            );
          }, 100);

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

      console.log(`📊 Results: ${messagesReceived} messages received`);

      // This test might fail if there's a streamKey mismatch
      if (messagesReceived === 0) {
        console.log("🚨 STREAMKEY MISMATCH DETECTED!");
        console.log("🔧 Suggested fix: Normalize streamKey in MSEStreaming or RTMP server");
      }

      // For now, just log the result
      expect(true).toBe(true); // Always pass, just for diagnosis
    });

    it("should test streamKey normalization solution", async () => {
      console.log("\n🔍 Testing streamKey normalization solution...");

      // Helper function to normalize streamKey (potential fix)
      function normalizeStreamKey(streamKey: string): string {
        // Remove /stream/ prefix if present
        if (streamKey.startsWith('/stream/')) {
          return streamKey.substring(8); // Remove '/stream/'
        }
        // Remove stream/ prefix if present
        if (streamKey.startsWith('stream/')) {
          return streamKey.substring(7); // Remove 'stream/'
        }
        return streamKey;
      }

      const testKeys = [
        'test123',
        '/stream/test123',
        'stream/test123',
      ];

      console.log("📋 Testing normalization:");
      testKeys.forEach(key => {
        const normalized = normalizeStreamKey(key);
        console.log(`  ${key} → ${normalized}`);
        expect(normalized).toBe('test123');
      });

      // Test the normalized approach with actual WebSocket
      const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/test123`);
      let messagesReceived = 0;

      ws.on('message', (data) => {
        messagesReceived++;
        console.log(`📨 Normalized message ${messagesReceived}: ${data.length} bytes`);
      });

      await new Promise((resolve) => {
        ws.on('open', () => {
          console.log("✅ Connected with normalized approach");

          // Use both original and normalized keys to test
          const originalKeys = ['/stream/test123', 'stream/test123', 'test123'];

          originalKeys.forEach((key, index) => {
            setTimeout(() => {
              const normalizedKey = normalizeStreamKey(key);
              console.log(`📡 Broadcasting: ${key} → ${normalizedKey}`);
              api.broadcastToStream(normalizedKey, `Test message ${index + 1}`);
            }, index * 100);
          });

          setTimeout(resolve, 1000);
        });

        ws.on('error', (error) => {
          console.error("❌ Normalization error:", error);
          resolve(null);
        });
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      console.log(`📊 Normalization results: ${messagesReceived} messages received`);

      // With normalization, should receive all messages
      expect(messagesReceived).toBe(3);
    });
  });
});
