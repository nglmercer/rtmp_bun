import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../../src/api";
import { AppConfig } from "../../../src/config";
import { StreamForwarder } from "../../../src/forwarder";
import WebSocket from "ws";

describe("BroadcastToStream Functionality Test", () => {
  let api: RestApi;
  let forwarder: StreamForwarder;
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
      restApiPort: 3008, // Use different port for testing
    },
    targets: [],
  };

  beforeAll(async () => {
    console.log("🚀 Setting up broadcast test environment...");

    forwarder = new StreamForwarder(testConfig);
    api = new RestApi(testConfig, forwarder);

    await api.start();

    // Wait for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log("✅ Broadcast test environment ready");
  });

  afterAll(async () => {
    console.log("🧹 Cleaning up broadcast test environment...");
    await api.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("✅ Cleanup complete");
  });

  it("should broadcast string message to connected client", async () => {
    console.log("🔍 Testing string message broadcasting...");

    const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/broadcast-string`);

    const messagePromise = new Promise<{ received: boolean; content?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ received: false });
      }, 3000);

      ws.on('message', (data) => {
        clearTimeout(timeout);
        const content = data.toString();
        console.log("📨 Received:", content);
        resolve({ received: true, content });
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error("❌ WebSocket error:", error);
        resolve({ received: false });
      });
    });

    // Wait for connection and then broadcast
    await new Promise((resolve) => {
      ws.on('open', () => {
        console.log("📡 WebSocket connected, broadcasting test message");

        // Direct broadcast test
        const testMessage = JSON.stringify({
          type: "test-broadcast",
          message: "Hello World!",
          timestamp: new Date().toISOString()
        });

        api.broadcastToStream("broadcast-string", testMessage);
        resolve(undefined);
      });

      ws.on('error', () => resolve(undefined));
    });

    const result = await messagePromise;

    expect(result.received).toBe(true);
    expect(result.content).toBeDefined();
    expect(result.content).toContain("Hello World!");

    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it("should broadcast binary message to connected client", async () => {
    console.log("🔍 Testing binary message broadcasting...");

    const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/broadcast-binary`);

    const messagePromise = new Promise<{ received: boolean; byteLength?: number; data?: Uint8Array }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ received: false });
      }, 3000);

      ws.on('message', (data) => {
        clearTimeout(timeout);
        const bytes = new Uint8Array(data);
        console.log("📨 Received binary data:", bytes.length, "bytes");
        console.log("📨 First few bytes:", Array.from(bytes.slice(0, 10)));
        resolve({ received: true, byteLength: bytes.length, data: bytes });
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error("❌ WebSocket error:", error);
        resolve({ received: false });
      });
    });

    // Wait for connection and then broadcast
    await new Promise((resolve) => {
      ws.on('open', () => {
        console.log("📡 WebSocket connected, broadcasting binary test data");

        // Create test binary data with a recognizable pattern
        const testBinary = new Uint8Array([
          0xDE, 0xAD, 0xBE, 0xEF, // Magic bytes
          0x01, 0x02, 0x03, 0x04, // Test sequence
          0xFF, 0xFF, 0xFF, 0xFF, // End marker
        ]);

        api.broadcastToStream("broadcast-binary", testBinary);
        resolve(undefined);
      });

      ws.on('error', () => resolve(undefined));
    });

    const result = await messagePromise;

    expect(result.received).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
    expect(result.data).toBeDefined();

    // Verify the magic bytes
    if (result.data && result.data.length >= 4) {
      expect(result.data[0]).toBe(0xDE);
      expect(result.data[1]).toBe(0xAD);
      expect(result.data[2]).toBe(0xBE);
      expect(result.data[3]).toBe(0xEF);
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it("should handle multiple rapid broadcasts", async () => {
    console.log("🔍 Testing multiple rapid broadcasts...");

    const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/broadcast-rapid`);

    let receivedCount = 0;
    const expectedMessages = 5;

    const messagePromise = new Promise<{ received: boolean; count: number }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ received: false, count: receivedCount });
      }, 5000);

      ws.on('message', (data) => {
        receivedCount++;
        console.log(`📨 Received message ${receivedCount}:`, data.toString().slice(0, 50));

        if (receivedCount >= expectedMessages) {
          clearTimeout(timeout);
          resolve({ received: true, count: receivedCount });
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error("❌ WebSocket error:", error);
        resolve({ received: false, count: receivedCount });
      });
    });

    // Wait for connection and then broadcast multiple messages
    await new Promise((resolve) => {
      ws.on('open', () => {
        console.log("📡 WebSocket connected, sending multiple broadcasts");

        // Send multiple messages rapidly
        for (let i = 1; i <= expectedMessages; i++) {
          setTimeout(() => {
            const message = JSON.stringify({
              type: "rapid-test",
              sequence: i,
              total: expectedMessages,
              timestamp: new Date().toISOString()
            });

            console.log(`📡 Broadcasting message ${i}/${expectedMessages}`);
            api.broadcastToStream("broadcast-rapid", message);
          }, i * 50); // 50ms between messages
        }

        resolve(undefined);
      });

      ws.on('error', () => resolve(undefined));
    });

    const result = await messagePromise;

    expect(result.received).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(expectedMessages - 1); // Allow for some timing issues

    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it("should handle broadcasts to non-existent stream", async () => {
    console.log("🔍 Testing broadcast to non-existent stream...");

    // This should not throw an error and should be handled gracefully
    expect(() => {
      api.broadcastToStream("non-existent-stream", "test message");
    }).not.toThrow();

    // Also test binary data
    expect(() => {
      api.broadcastToStream("non-existent-stream", new Uint8Array([1, 2, 3, 4]));
    }).not.toThrow();

    console.log("✅ Broadcast to non-existent stream handled gracefully");
  });

  it("should show client count in API status", async () => {
    console.log("🔍 Testing client count tracking...");

    // Get initial status
    const initialResponse = await fetch(`http://localhost:${testConfig.server.restApiPort}/api/status`);
    const initialStatus = await initialResponse.json();

    console.log("📊 Initial status:", initialStatus.websocket);

    const initialClients = initialStatus.websocket?.totalClients || 0;

    // Connect WebSocket
    const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/status-test`);

    await new Promise((resolve) => {
      ws.on('open', resolve);
      ws.on('error', resolve);
    });

    // Wait for connection to be registered
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check status again
    const afterResponse = await fetch(`http://localhost:${testConfig.server.restApiPort}/api/status`);
    const afterStatus = await afterResponse.json();

    console.log("📊 Status after connection:", afterStatus.websocket);

    const afterClients = afterStatus.websocket?.totalClients || 0;

    expect(afterClients).toBeGreaterThan(initialClients);

    // Close connection
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Final status check
    const finalResponse = await fetch(`http://localhost:${testConfig.server.restApiPort}/api/status`);
    const finalStatus = await finalResponse.json();

    console.log("📊 Final status:", finalStatus.websocket);

    const finalClients = finalStatus.websocket?.totalClients || 0;
    expect(finalClients).toBeLessThanOrEqual(afterClients);
  });
});
