import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../src/api";
import { AppConfig } from "../../src/config";
import { StreamForwarder } from "../../src/forwarder";
import { MSEStreaming } from "../../src/mse-streaming";
import WebSocket from "ws";

describe("Video Streaming Fixes Verification", () => {
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
      logFile: "./logs/video-streaming-fixes.log",
      enableRestApi: true,
      restApiPort: 3015,
    },
    targets: [],
  };

  beforeAll(async () => {
    console.log("🚀 Setting up video streaming fixes verification...");

    forwarder = new StreamForwarder(testConfig);
    api = new RestApi(testConfig, forwarder);
    mseStreaming = new MSEStreaming(api);

    await api.start();
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log("✅ Video streaming fixes verification ready");
  });

  afterAll(async () => {
    console.log("🧹 Cleaning up video streaming fixes verification...");
    await api.stop();
  });

  describe("StreamKey Normalization", () => {
    it("should normalize streamKeys correctly", () => {
      console.log("\n🔍 Testing streamKey normalization...");

      // Test cases for streamKey normalization
      const testCases = [
        { input: "test123", expected: "test123", description: "plain key" },
        {
          input: "/stream/test123",
          expected: "test123",
          description: "full path key",
        },
        {
          input: "stream/test123",
          expected: "test123",
          description: "partial path key",
        },
        { input: "/stream/", expected: "", description: "empty path" },
        { input: "stream/", expected: "", description: "empty partial path" },
      ];

      for (const testCase of testCases) {
        // Access private method through type assertion for testing
        const mseAny = mseStreaming as any;
        const normalized = mseAny.normalizeStreamKey(testCase.input);

        console.log(
          `📋 ${testCase.description}: ${testCase.input} → ${normalized}`,
        );

        expect(normalized).toBe(testCase.expected);
      }
    });

    it("should work with RTMP-style streamKeys", async () => {
      console.log("\n🔍 Testing RTMP-style streamKey handling...");

      const streamKey = "live123";
      const rtmpStyleKey = `/stream/${streamKey}`; // This is what RTMP server generates

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/${streamKey}`,
      );
      let messagesReceived = 0;
      let audioCount = 0;
      let videoCount = 0;

      ws.on("message", (data) => {
        messagesReceived++;
        const bytes = new Uint8Array(data);

        // Check for FLV header first
        if (
          bytes.length >= 3 &&
          bytes[0] === 0x46 &&
          bytes[1] === 0x4c &&
          bytes[2] === 0x56
        ) {
          console.log(`📨 FLV header message: ${bytes.length} bytes`);
        }
        // Check for FLV tag structure (skip FLV header)
        else if (bytes.length >= 11) {
          const tagType = bytes[0]; // First byte is tag type in standalone messages

          if (tagType === 8) {
            audioCount++;
            console.log(`🎵 Audio message ${audioCount}: tagType=${tagType}`);
          } else if (tagType === 9) {
            videoCount++;
            console.log(`🎥 Video message ${videoCount}: tagType=${tagType}`);
          } else if (tagType === 18) {
            console.log(`📊 Metadata message: tagType=${tagType}`);
          } else {
            console.log(
              `📨 Other FLV message: tagType=${tagType}, length=${bytes.length}`,
            );
          }
        } else {
          console.log(
            `📨 Short message: ${bytes.length} bytes, firstByte=${bytes[0]}`,
          );
        }
      });

      await new Promise((resolve) => {
        ws.on("open", () => {
          console.log(`✅ Connected to stream: ${streamKey}`);
          console.log(`📡 Using RTMP-style key: ${rtmpStyleKey}`);

          // Start streaming with RTMP-style key
          mseStreaming.startStreaming(rtmpStyleKey);

          // Add audio with RTMP-style key
          setTimeout(() => {
            const audioData = new Uint8Array([
              0xaf, 0x01, 0x00, 0x00, 0x00, 0x01,
            ]);
            mseStreaming.addMediaChunk(audioData, rtmpStyleKey, "audio");
          }, 100);

          // Add video with RTMP-style key
          setTimeout(() => {
            const videoData = new Uint8Array([
              0x17, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01,
            ]);
            mseStreaming.addMediaChunk(videoData, rtmpStyleKey, "video");
          }, 200);

          setTimeout(resolve, 1500);
        });

        ws.on("error", (error) => {
          console.error("❌ WebSocket error:", error);
          resolve(null);
        });
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      console.log(`📊 Results:`);
      console.log(`  Total messages: ${messagesReceived}`);
      console.log(`  Audio messages: ${audioCount}`);
      console.log(`  Video messages: ${videoCount}`);

      // Should receive all message types after normalization
      expect(messagesReceived).toBeGreaterThan(2); // At least FLV header + audio + video
      expect(audioCount).toBeGreaterThan(0);
      expect(videoCount).toBeGreaterThan(0);
    });
  });

  describe("Video Sequence Header Fix", () => {
    it("should handle video sequence headers correctly", async () => {
      console.log("\n🔍 Testing video sequence header handling...");

      const streamKey = "video-seq-test";
      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/${streamKey}`,
      );

      let flvHeaderReceived = false;
      let metadataReceived = false;
      let sequenceHeaderReceived = false;
      let videoFrameReceived = false;
      const messageDetails: Array<{
        type: string;
        bytes: number;
        firstByte?: number;
      }> = [];

      ws.on("message", (data) => {
        const bytes = new Uint8Array(data);
        const messageInfo = {
          type: "unknown",
          bytes: bytes.length,
          firstByte: bytes.length > 0 ? bytes[0] : undefined,
        };

        // Check for FLV header
        if (
          bytes.length >= 3 &&
          bytes[0] === 0x46 &&
          bytes[1] === 0x4c &&
          bytes[2] === 0x56
        ) {
          flvHeaderReceived = true;
          messageInfo.type = "FLV header";
          console.log(`✅ FLV header received: ${bytes.length} bytes`);
        }
        // Check for FLV tag (standalone messages don't have FLV header)
        else if (bytes.length >= 1) {
          const tagType = bytes[0];

          // Check for script data (metadata) - tag type 18
          if (tagType === 18) {
            metadataReceived = true;
            messageInfo.type = "Script data (metadata)";
            console.log(
              `✅ Metadata received: ${bytes.length} bytes, tagType=${tagType}`,
            );
          }
          // Check for video data - tag type 9
          else if (tagType === 9) {
            messageInfo.type = "Video data";
            console.log(
              `✅ Video data received: ${bytes.length} bytes, tagType=${tagType}`,
            );

            // Check if it's a sequence header (keyframe + AVC packet type 0)
            // In FLV tags, video data starts after 11-byte header
            if (bytes.length >= 14) {
              const frameType = (bytes[11] >> 4) & 0x0f;
              const codecId = bytes[11] & 0x0f;
              const avcPacketType = bytes[12];

              if (codecId === 7) {
                // AVC/H.264
                if (frameType === 1 && avcPacketType === 0) {
                  sequenceHeaderReceived = true;
                  messageInfo.type = "Video sequence header (SPS/PPS)";
                  console.log(
                    `✅ Video sequence header received: frameType=${frameType}, codecId=${codecId}, avcPacketType=${avcPacketType}`,
                  );
                } else if (frameType === 1 && avcPacketType === 1) {
                  videoFrameReceived = true;
                  messageInfo.type = "Video frame (NALU)";
                  console.log(
                    `✅ Video frame received: frameType=${frameType}, codecId=${codecId}, avcPacketType=${avcPacketType}`,
                  );
                } else {
                  console.log(
                    `📥 Video details: frameType=${frameType}, codecId=${codecId}, avcPacketType=${avcPacketType}`,
                  );
                }
              } else {
                console.log(
                  `📥 Video with non-AVC codec: frameType=${frameType}, codecId=${codecId}, avcPacketType=${avcPacketType}`,
                );
              }
            }
          }
          // Check for audio data - tag type 8
          else if (tagType === 8) {
            messageInfo.type = "Audio data";
            console.log(
              `✅ Audio data received: ${bytes.length} bytes, tagType=${tagType}`,
            );
          } else {
            console.log(
              `📨 Unknown FLV tag: tagType=${tagType}, length=${bytes.length}`,
            );
          }
        } else {
          console.log(`📨 Empty message received`);
        }

        messageDetails.push(messageInfo);
      });

      await new Promise((resolve) => {
        ws.on("open", () => {
          console.log(`✅ Connected, testing video sequence headers...`);

          // 1. Start streaming (should send FLV header + metadata)
          mseStreaming.startStreaming(streamKey);

          // 2. Simulate AVC sequence header (SPS/PPS) - this should now be sent
          setTimeout(() => {
            console.log(`📡 Sending AVC sequence header...`);
            const avcSequenceHeader = new Uint8Array([
              0x17, // Frame type: keyframe (1), Codec: AVC (7)
              0x00, // AVC packet type: sequence header
              0x00,
              0x00,
              0x00, // Composition time
              0x00,
              0x00,
              0x00,
              0x01,
              0x67,
              0x42,
              0x00,
              0x1e,
              0x8d,
              0x40, // SPS/PPS data
            ]);
            mseStreaming.addMediaChunk(avcSequenceHeader, streamKey, "video");
          }, 100);

          // 3. Simulate AVC NALU (actual video frame)
          setTimeout(() => {
            console.log(`📡 Sending AVC NALU frame...`);
            const avcNalu = new Uint8Array([
              0x17, // Frame type: keyframe (1), Codec: AVC (7)
              0x01, // AVC packet type: NALU
              0x00,
              0x00,
              0x00, // Composition time
              0x00,
              0x00,
              0x00,
              0x01,
              0x67,
              0x42,
              0x00,
              0x1e, // Video frame data
            ]);
            mseStreaming.addMediaChunk(avcNalu, streamKey, "video");
          }, 200);

          setTimeout(resolve, 1500);
        });

        ws.on("error", (error) => {
          console.error("❌ WebSocket error:", error);
          resolve(null);
        });
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      console.log(`\n📊 Video Sequence Header Results:`);
      console.log(`  FLV header: ${flvHeaderReceived}`);
      console.log(`  Metadata: ${metadataReceived}`);
      console.log(`  Video sequence header: ${sequenceHeaderReceived}`);
      console.log(`  Video frame: ${videoFrameReceived}`);
      console.log(`  Total messages: ${messageDetails.length}`);
      console.log(
        `  Message types:`,
        messageDetails.map((m) => m.type),
      );

      // All should be received with the fix
      expect(flvHeaderReceived).toBe(true);
      expect(metadataReceived).toBe(true);
      expect(sequenceHeaderReceived).toBe(true);
      expect(videoFrameReceived).toBe(true);
    });

    it("should handle sendInitSegment with streamKey parameter", async () => {
      console.log("\n🔍 Testing sendInitSegment with streamKey...");

      const streamKey = "init-seg-test";
      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/${streamKey}`,
      );

      let initMessagesReceived = 0;
      let flvHeaderReceived = false;
      let metadataReceived = false;

      ws.on("message", (data) => {
        initMessagesReceived++;
        const bytes = new Uint8Array(data);

        if (
          bytes.length >= 3 &&
          bytes[0] === 0x46 &&
          bytes[1] === 0x4c &&
          bytes[2] === 0x56
        ) {
          flvHeaderReceived = true;
          console.log(`✅ FLV header from init segment`);
        } else if (bytes.length >= 1 && bytes[0] === 18) {
          metadataReceived = true;
          console.log(
            `✅ Metadata from init segment: ${bytes.length} bytes, tagType=18`,
          );
        } else {
          console.log(
            `📨 Other init segment message: ${bytes.length} bytes, firstByte=${bytes[0]}`,
          );
        }

        console.log(
          `📨 Init segment message ${initMessagesReceived}: ${bytes.length} bytes`,
        );
      });

      await new Promise((resolve) => {
        ws.on("open", () => {
          console.log(`✅ Connected, testing sendInitSegment...`);

          // Call sendInitSegment with specific streamKey
          mseStreaming.sendInitSegment(streamKey);

          setTimeout(resolve, 1000);
        });

        ws.on("error", (error) => {
          console.error("❌ WebSocket error:", error);
          resolve(null);
        });
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      console.log(`📊 Init Segment Results:`);
      console.log(`  Messages received: ${initMessagesReceived}`);
      console.log(`  FLV header: ${flvHeaderReceived}`);
      console.log(`  Metadata: ${metadataReceived}`);

      expect(initMessagesReceived).toBeGreaterThan(0);
      expect(flvHeaderReceived).toBe(true);
      expect(metadataReceived).toBe(true);
    });
  });

  describe("Complete Video Streaming Flow", () => {
    it("should work end-to-end with fixes applied", async () => {
      console.log("\n🔍 Testing complete video streaming flow with fixes...");

      const streamKey = "complete-flow";
      const rtmpStyleKey = `/stream/${streamKey}`; // Simulate RTMP server

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/${streamKey}`,
      );

      const results = {
        flvHeader: false,
        metadata: false,
        audioSequence: false,
        audioFrame: false,
        videoSequence: false,
        videoFrame: false,
        totalMessages: 0,
      };

      ws.on("message", (data) => {
        results.totalMessages++;
        const bytes = new Uint8Array(data);

        console.log(
          `📨 Message ${results.totalMessages}: ${bytes.length} bytes`,
        );

        // FLV header
        if (
          bytes.length >= 3 &&
          bytes[0] === 0x46 &&
          bytes[1] === 0x4c &&
          bytes[2] === 0x56
        ) {
          results.flvHeader = true;
          console.log(`  ✅ FLV header`);
        }
        // Check FLV tags (standalone messages)
        else if (bytes.length >= 1) {
          const tagType = bytes[0];

          // Script data (metadata)
          if (tagType === 18) {
            results.metadata = true;
            console.log(`  ✅ Metadata (tagType=18)`);
          }
          // Audio data
          else if (tagType === 8 && bytes.length >= 12) {
            // In FLV tags, audio data starts after 11-byte header
            const soundFormat = (bytes[11] >> 4) & 0x0f;
            const aacPacketType = bytes.length >= 13 ? bytes[12] : -1;

            if (soundFormat === 10 && aacPacketType === 0) {
              // AAC sequence header
              results.audioSequence = true;
              console.log(
                `  ✅ Audio sequence header (AAC, packetType=${aacPacketType})`,
              );
            } else if (aacPacketType === 1) {
              // AAC frame
              results.audioFrame = true;
              console.log(
                `  ✅ Audio frame (AAC, packetType=${aacPacketType})`,
              );
            } else {
              console.log(
                `  📥 Audio: soundFormat=${soundFormat}, aacPacketType=${aacPacketType}`,
              );
            }
          }
          // Video data
          else if (tagType === 9 && bytes.length >= 12) {
            // In FLV tags, video data starts after 11-byte header
            const frameType = (bytes[11] >> 4) & 0x0f;
            const codecId = bytes[11] & 0x0f;
            const avcPacketType = bytes[12];

            if (codecId === 7) {
              // AVC/H.264
              if (frameType === 1 && avcPacketType === 0) {
                results.videoSequence = true;
                console.log(
                  `  ✅ Video sequence header (AVC, frameType=${frameType}, packetType=${avcPacketType})`,
                );
              } else if (avcPacketType === 1) {
                results.videoFrame = true;
                console.log(
                  `  ✅ Video frame (AVC, frameType=${frameType}, packetType=${avcPacketType})`,
                );
              } else {
                console.log(
                  `  📥 Video: frameType=${frameType}, codecId=${codecId}, avcPacketType=${avcPacketType}`,
                );
              }
            } else {
              console.log(`  📥 Video with codecId=${codecId} (not AVC)`);
            }
          } else {
            console.log(`  📥 Other FLV tag: tagType=${tagType}`);
          }
        } else {
          console.log(`  📥 Empty message`);
        }
      });

      await new Promise((resolve) => {
        ws.on("open", () => {
          console.log(
            `✅ Connected, testing complete flow with RTMP-style key: ${rtmpStyleKey}`,
          );

          // 1. Start streaming with RTMP-style key
          mseStreaming.startStreaming(rtmpStyleKey);

          // 2. Add audio sequence header
          setTimeout(() => {
            const audioSeqHeader = new Uint8Array([0xaf, 0x00, 0x11, 0x90]); // AAC config
            mseStreaming.addMediaChunk(audioSeqHeader, rtmpStyleKey, "audio");
          }, 50);

          // 3. Add video sequence header (SPS/PPS)
          setTimeout(() => {
            const videoSeqHeader = new Uint8Array([
              0x17,
              0x00,
              0x00,
              0x00,
              0x00, // AVC sequence header
              0x00,
              0x00,
              0x00,
              0x01,
              0x67,
              0x42,
              0x00,
              0x1e,
            ]);
            mseStreaming.addMediaChunk(videoSeqHeader, rtmpStyleKey, "video");
          }, 100);

          // 4. Add audio frame
          setTimeout(() => {
            const audioFrame = new Uint8Array([
              0xaf, 0x01, 0x00, 0x00, 0x00, 0x01,
            ]);
            mseStreaming.addMediaChunk(audioFrame, rtmpStyleKey, "audio");
          }, 150);

          // 5. Add video frame
          setTimeout(() => {
            const videoFrame = new Uint8Array([
              0x17,
              0x01,
              0x00,
              0x00,
              0x00, // AVC NALU
              0x00,
              0x00,
              0x00,
              0x01,
              0x67,
              0x42,
              0x00,
              0x1e,
            ]);
            mseStreaming.addMediaChunk(videoFrame, rtmpStyleKey, "video");
          }, 200);

          setTimeout(resolve, 2000);
        });

        ws.on("error", (error) => {
          console.error("❌ WebSocket error:", error);
          resolve(null);
        });
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      console.log(`\n📊 Complete Flow Results:`);
      console.log(`  Total messages: ${results.totalMessages}`);
      console.log(`  FLV header: ${results.flvHeader}`);
      console.log(`  Metadata: ${results.metadata}`);
      console.log(`  Audio sequence: ${results.audioSequence}`);
      console.log(`  Audio frame: ${results.audioFrame}`);
      console.log(`  Video sequence: ${results.videoSequence}`);
      console.log(`  Video frame: ${results.videoFrame}`);

      // Verify all components are working with the fixes
      expect(results.totalMessages).toBeGreaterThan(5);
      expect(results.flvHeader).toBe(true);
      expect(results.metadata).toBe(true);
      expect(results.videoSequence).toBe(true); // This was the main issue
      expect(results.videoFrame).toBe(true);
    });
  });
});
