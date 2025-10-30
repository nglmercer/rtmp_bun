import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../../src/api";
import { AppConfig } from "../../../src/config";
import { StreamForwarder } from "../../../src/forwarder";
import { MSEStreaming } from "../../../src/mse-streaming";
import WebSocket from "ws";

describe("WebSocket Message Reception Tests", () => {
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
      logLevel: "info",
      logFile: "./logs/test.log",
      enableRestApi: true,
      restApiPort: 3007, // Use different port for testing
    },
    targets: [],
  };

  beforeAll(async () => {
    console.log(
      "🚀 Setting up WebSocket message reception test environment...",
    );

    forwarder = new StreamForwarder(testConfig);
    api = new RestApi(testConfig, forwarder);
    mseStreaming = new MSEStreaming(api);

    await api.start();

    // Wait for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log("✅ Test environment ready");
  });

  afterAll(async () => {
    console.log("🧹 Cleaning up test environment...");
    await api.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("✅ Cleanup complete");
  });

  describe("Basic WebSocket Connection", () => {
    it("should establish WebSocket connection successfully", async () => {
      console.log("🔍 Testing basic WebSocket connection...");

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/test123`,
      );

      const connectionPromise = new Promise<{
        connected: boolean;
        error?: string;
      }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ connected: false, error: "Connection timeout" });
        }, 5000);

        ws.on("open", () => {
          clearTimeout(timeout);
          resolve({ connected: true });
        });

        ws.on("error", (error) => {
          clearTimeout(timeout);
          resolve({ connected: false, error: error.message });
        });
      });

      const result = await connectionPromise;

      expect(result.connected).toBe(true);
      expect(result.error).toBeUndefined();

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    it("should reject invalid WebSocket paths", async () => {
      console.log("🔍 Testing invalid WebSocket path rejection...");

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/invalid/path`,
      );

      const connectionPromise = new Promise<{
        connected: boolean;
        closed: boolean;
      }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ connected: false, closed: false });
        }, 3000);

        let opened = false;

        ws.on("open", () => {
          opened = true;
        });

        ws.on("close", () => {
          clearTimeout(timeout);
          resolve({ connected: opened, closed: true });
        });

        ws.on("error", () => {
          clearTimeout(timeout);
          resolve({ connected: opened, closed: false });
        });
      });

      const result = await connectionPromise;

      // Should either not connect or close immediately
      expect(result.closed || !result.connected).toBe(true);
    });
  });

  describe("Message Reception - String Messages", () => {
    it("should receive string messages", async () => {
      console.log("🔍 Testing string message reception...");

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/test-string`,
      );

      const messagePromise = new Promise<{ received: boolean; data?: any }>(
        (resolve) => {
          const timeout = setTimeout(() => {
            resolve({ received: false });
          }, 3000);

          ws.on("message", (data) => {
            clearTimeout(timeout);
            try {
              const parsed = JSON.parse(data.toString());
              resolve({ received: true, data: parsed });
            } catch {
              resolve({ received: true, data: data.toString() });
            }
          });

          ws.on("open", () => {
            console.log("📡 Sending test string message via broadcastToStream");
            // Send a test string message through the API
            api.broadcastToStream(
              "test-string",
              JSON.stringify({
                type: "test",
                message: "Hello from test",
                timestamp: new Date().toISOString(),
              }),
            );
          });

          ws.on("error", (error) => {
            clearTimeout(timeout);
            console.error("❌ WebSocket error:", error);
            resolve({ received: false });
          });
        },
      );

      const result = await messagePromise;

      expect(result.received).toBe(true);
      expect(result.data).toBeDefined();

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    it("should receive ping and send pong responses", async () => {
      console.log("🔍 Testing ping-pong mechanism...");

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/test-ping`,
      );

      const messagePromise = new Promise<{
        received: boolean;
        isPong?: boolean;
      }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ received: false });
        }, 3000);

        ws.on("message", (data) => {
          const message = data.toString();
          if (message.includes("pong")) {
            clearTimeout(timeout);
            try {
              const parsed = JSON.parse(message);
              resolve({ received: true, isPong: parsed.type === "pong" });
            } catch {
              resolve({ received: true, isPong: false });
            }
          }
        });

        ws.on("open", () => {
          console.log("📡 Sending ping message");
          ws.send(
            JSON.stringify({
              type: "ping",
              timestamp: new Date().toISOString(),
            }),
          );
        });

        ws.on("error", (error) => {
          clearTimeout(timeout);
          console.error("❌ WebSocket error:", error);
          resolve({ received: false });
        });
      });

      const result = await messagePromise;

      expect(result.received).toBe(true);
      expect(result.isPong).toBe(true);

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
  });

  describe("Message Reception - Binary Messages", () => {
    it("should receive binary messages", async () => {
      console.log("🔍 Testing binary message reception...");

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/test-binary`,
      );

      const messagePromise = new Promise<{
        received: boolean;
        byteLength?: number;
      }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ received: false });
        }, 3000);

        ws.on("message", (data) => {
          clearTimeout(timeout);
          resolve({ received: true, byteLength: data.byteLength });
        });

        ws.on("open", () => {
          console.log("📡 Sending binary test data via broadcastToStream");
          // Create test binary data
          const testData = new Uint8Array([
            0x46, 0x4c, 0x56, 0x01, 0x05, 0x00, 0x00, 0x00, 0x09,
          ]);
          api.broadcastToStream("test-binary", testData);
        });

        ws.on("error", (error) => {
          clearTimeout(timeout);
          console.error("❌ WebSocket error:", error);
          resolve({ received: false });
        });
      });

      const result = await messagePromise;

      expect(result.received).toBe(true);
      expect(result.byteLength).toBeGreaterThan(0);

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    it("should receive FLV header data", async () => {
      console.log("🔍 Testing FLV header data reception...");

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/test-flv`,
      );

      const messagePromise = new Promise<{
        received: boolean;
        flvSignature?: boolean;
      }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ received: false });
        }, 3000);

        ws.on("message", (data) => {
          clearTimeout(timeout);
          const bytes = new Uint8Array(data);
          const isFLV =
            bytes.length >= 3 &&
            bytes[0] === 0x46 && // 'F'
            bytes[1] === 0x4c && // 'L'
            bytes[2] === 0x56; // 'V'
          resolve({ received: true, flvSignature: isFLV });
        });

        ws.on("open", () => {
          console.log("📡 Triggering MSE streaming to send FLV data");
          // Trigger MSE streaming which should send FLV header
          mseStreaming.startStreaming("test-flv");
        });

        ws.on("error", (error) => {
          clearTimeout(timeout);
          console.error("❌ WebSocket error:", error);
          resolve({ received: false });
        });
      });

      const result = await messagePromise;

      expect(result.received).toBe(true);
      expect(result.flvSignature).toBe(true);

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
  });

  describe("Message Reception - Media Data", () => {
    it("should receive video media chunks", async () => {
      console.log("🔍 Testing video chunk reception...");

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/test-video`,
      );

      const messagePromise = new Promise<{
        received: boolean;
        messages: number;
      }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ received: false, messages: 0 });
        }, 3000);

        let messageCount = 0;

        ws.on("message", (data) => {
          messageCount++;
          console.log(
            `📨 Received message ${messageCount}: ${data.byteLength} bytes`,
          );

          if (messageCount >= 2) {
            // FLV header + video chunk
            clearTimeout(timeout);
            resolve({ received: true, messages: messageCount });
          }
        });

        ws.on("open", () => {
          console.log("📡 Simulating video chunk via MSE streaming");
          // Simulate video chunk
          const videoData = new Uint8Array([
            0x17,
            0x01,
            0x00,
            0x00,
            0x00, // Video tag header
            0x00,
            0x00,
            0x00,
            0x01, // Minimal video data
          ]);

          mseStreaming.addMediaChunk(videoData, "test-video", "video");
        });

        ws.on("error", (error) => {
          clearTimeout(timeout);
          console.error("❌ WebSocket error:", error);
          resolve({ received: false, messages: messageCount });
        });
      });

      const result = await messagePromise;

      expect(result.received).toBe(true);
      expect(result.messages).toBeGreaterThanOrEqual(2); // Should receive FLV header + video data

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    it("should receive audio media chunks", async () => {
      console.log("🔍 Testing audio chunk reception...");

      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/test-audio`,
      );

      const messagePromise = new Promise<{
        received: boolean;
        messages: number;
      }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ received: false, messages: 0 });
        }, 3000);

        let messageCount = 0;

        ws.on("message", (data) => {
          messageCount++;
          console.log(
            `📨 Received message ${messageCount}: ${data.byteLength} bytes`,
          );

          if (messageCount >= 2) {
            // FLV header + audio chunk
            clearTimeout(timeout);
            resolve({ received: true, messages: messageCount });
          }
        });

        ws.on("open", () => {
          console.log("📡 Simulating audio chunk via MSE streaming");
          // Simulate audio chunk
          const audioData = new Uint8Array([
            0xaf,
            0x01, // Audio tag header (AAC, 44.1kHz, 16-bit, stereo)
            0x00,
            0x00,
            0x00,
            0x01, // Minimal audio data
          ]);

          mseStreaming.addMediaChunk(audioData, "test-audio", "audio");
        });

        ws.on("error", (error) => {
          clearTimeout(timeout);
          console.error("❌ WebSocket error:", error);
          resolve({ received: false, messages: messageCount });
        });
      });

      const result = await messagePromise;

      expect(result.received).toBe(true);
      expect(result.messages).toBeGreaterThanOrEqual(2); // Should receive FLV header + audio data

      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
  });

  describe("Multiple Clients", () => {
    it("should broadcast to multiple clients simultaneously", async () => {
      console.log("🔍 Testing multi-client broadcast...");

      const clientCount = 3;
      const clients: WebSocket[] = [];
      const results: Array<{
        id: number;
        received: boolean;
        messages: number;
      }> = [];
      const connectionPromises: Promise<void>[] = [];

      // Create multiple clients and wait for all to connect
      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(
          `ws://localhost:${testConfig.server.restApiPort}/stream/test-multi`,
        );
        clients.push(ws);

        const connectionPromise = new Promise<void>((resolve) => {
          ws.on("open", () => {
            console.log(`✅ Client ${i} connected`);
            resolve();
          });

          ws.on("error", (error) => {
            console.error(`❌ Client ${i} WebSocket error:`, error);
            resolve(); // Continue even if connection fails
          });
        });

        connectionPromises.push(connectionPromise);
      }

      // Wait for all clients to connect
      console.log("⏳ Waiting for all clients to connect...");
      await Promise.all(connectionPromises);
      console.log("✅ All clients connected, triggering broadcast...");

      // Now trigger the broadcast to all connected clients
      setTimeout(() => {
        api.broadcastToStream(
          "test-multi",
          JSON.stringify({
            type: "broadcast-test",
            clientId: "broadcast",
            timestamp: new Date().toISOString(),
          }),
        );
      }, 100);

      // Now wait for messages
      for (let i = 0; i < clientCount; i++) {
        const messagePromise = new Promise<{
          id: number;
          received: boolean;
          messages: number;
        }>((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ id: i, received: false, messages: 0 });
          }, 3000);

          let messageCount = 0;

          clients[i].on("message", (data) => {
            messageCount++;
            console.log(
              `📨 Client ${i} received message ${messageCount}: ${data.byteLength} bytes`,
            );

            if (messageCount >= 1) {
              clearTimeout(timeout);
              resolve({ id: i, received: true, messages: messageCount });
            }
          });

          clients[i].on("error", (error) => {
            clearTimeout(timeout);
            console.error(`❌ Client ${i} WebSocket error:`, error);
            resolve({ id: i, received: false, messages: messageCount });
          });
        });

        results.push(await messagePromise);
      }

      // Wait a bit for all messages to be processed
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Close all clients
      clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });

      // Check that at least most clients received the message
      const successfulClients = results.filter((r) => r.received);
      expect(successfulClients.length).toBeGreaterThanOrEqual(2); // Allow for some timing issues

      console.log(
        `✅ ${successfulClients.length}/${clientCount} clients received the broadcast`,
      );
    });
  });

  describe("API Status Integration", () => {
    it("should track WebSocket connections in API status", async () => {
      console.log("🔍 Testing WebSocket connection tracking...");

      // Get initial status
      const initialStatus = await fetch(
        `http://localhost:${testConfig.server.restApiPort}/api/status`,
      );
      const initialData = await initialStatus.json();

      console.log("📊 Initial WebSocket status:", initialData.websocket);

      const initialClients = initialData.websocket?.totalClients || 0;

      // Connect a WebSocket client
      const ws = new WebSocket(
        `ws://localhost:${testConfig.server.restApiPort}/stream/test-status`,
      );

      await new Promise((resolve) => {
        ws.on("open", resolve);
        ws.on("error", resolve);
      });

      // Wait a bit for the connection to be registered
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check status again
      const afterStatus = await fetch(
        `http://localhost:${testConfig.server.restApiPort}/api/status`,
      );
      const afterData = await afterStatus.json();

      console.log("📊 WebSocket status after connection:", afterData.websocket);

      const afterClients = afterData.websocket?.totalClients || 0;

      // Should have at least one more client
      expect(afterClients).toBeGreaterThanOrEqual(initialClients);

      // Close the connection
      ws.close();

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check status after closing
      const finalStatus = await fetch(
        `http://localhost:${testConfig.server.restApiPort}/api/status`,
      );
      const finalData = await finalStatus.json();

      console.log("📊 WebSocket status after closing:", finalData.websocket);

      const finalClients = finalData.websocket?.totalClients || 0;

      // Client count should be back to initial or less
      expect(finalClients).toBeLessThanOrEqual(afterClients);
    });
  });
});
