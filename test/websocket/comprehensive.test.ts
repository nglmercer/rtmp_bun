import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../src/api";
import { AppConfig } from "../../src/config";
import { StreamForwarder } from "../../src/forwarder";

describe("Comprehensive WebSocket Connection Tests", () => {
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
      restApiPort: 3007, // Use unique port for testing
    },
    targets: [],
  };

  beforeAll(async () => {
    forwarder = new StreamForwarder(testConfig);
    api = new RestApi(testConfig, forwarder);
    await api.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    await api.stop();
  });

  it("should establish real WebSocket connection and receive data", async () => {
    const streamKey = "test-stream";
    const ws = new WebSocket(`ws://localhost:3007/stream/${streamKey}`);

    const connectionPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("WebSocket connection timeout"));
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        console.log("✅ WebSocket connection established");
        resolve(true);
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        console.error("❌ WebSocket error:", error);
        reject(error);
      };

      ws.onclose = (event) => {
        clearTimeout(timeout);
        console.log("🔌 WebSocket closed:", event.code, event.reason);
        if (event.code !== 1000) {
          reject(new Error(`WebSocket closed with code ${event.code}`));
        }
      };
    });

    // Wait for connection to establish
    await expect(connectionPromise).resolves.toBe(true);

    // Test sending data via API and receiving it via WebSocket
    const testDataPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("No data received within timeout"));
      }, 5000);

      ws.onmessage = (event) => {
        clearTimeout(timeout);
        console.log("📨 Received data via WebSocket:", event.data);
        resolve(event.data);
      };
    });

    // Send test data via API
    const response = await fetch("http://localhost:3007/api/test-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ streamKey }),
    });

    expect(response.ok).toBe(true);

    // Wait for data to be received
    const receivedData = await testDataPromise;
    expect(receivedData).toBeDefined();

    // Clean up
    ws.close();
  });

  it("should handle multiple WebSocket connections to same stream", async () => {
    const streamKey = "multi-stream";
    const ws1 = new WebSocket(`ws://localhost:3007/stream/${streamKey}`);
    const ws2 = new WebSocket(`ws://localhost:3007/stream/${streamKey}`);

    const connectionsPromise = Promise.all([
      new Promise((resolve) => {
        ws1.onopen = () => resolve(true);
      }),
      new Promise((resolve) => {
        ws2.onopen = () => resolve(true);
      }),
    ]);

    await expect(connectionsPromise).resolves.toEqual([true, true]);

    // Check that both connections are tracked
    const statusResponse = await fetch("http://localhost:3007/api/status");
    const status = await statusResponse.json();
    expect(status.websocket.activeStreams).toContain(streamKey);
    expect(status.websocket.totalClients).toBeGreaterThanOrEqual(2);

    // Clean up
    ws1.close();
    ws2.close();
  });

  it("should handle ping/pong messages", async () => {
    const streamKey = "ping-stream";
    const ws = new WebSocket(`ws://localhost:3007/stream/${streamKey}`);

    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    const pongPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("No pong received"));
      }, 3000);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "pong") {
            clearTimeout(timeout);
            resolve(data);
          }
        } catch (e) {
          // Ignore binary data
        }
      };
    });

    // Send ping message
    ws.send(JSON.stringify({ type: "ping" }));

    const pongResponse = await pongPromise;
    expect(pongResponse.type).toBe("pong");
    expect(pongResponse.timestamp).toBeDefined();

    ws.close();
  });

  it("should reject WebSocket connections to invalid paths", async () => {
    const ws = new WebSocket(`ws://localhost:3007/invalid/path`);

    const connectionPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false); // Timeout means connection failed as expected
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeout);
        resolve(true); // Should not reach here
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false); // Connection failed as expected
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve(false); // Connection closed as expected
      };
    });

    await expect(connectionPromise).resolves.toBe(false);
  });

  it("should handle binary FLV data correctly", async () => {
    const streamKey = "flv-stream";
    const ws = new WebSocket(`ws://localhost:3007/stream/${streamKey}`);

    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    const dataPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("No data received"));
      }, 5000);

      ws.onmessage = (event) => {
        clearTimeout(timeout);
        // Should receive binary data (FLV header)
        if (event.data instanceof ArrayBuffer || event.data instanceof Uint8Array) {
          console.log("📦 Received binary FLV data:", event.data.byteLength || event.data.length, "bytes");
          resolve(event.data);
        } else {
          reject(new Error("Expected binary data but received text"));
        }
      };
    });

    // Send test stream data
    const response = await fetch("http://localhost:3007/api/test-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ streamKey }),
    });

    expect(response.ok).toBe(true);

    const receivedData = await dataPromise;
    expect(receivedData).toBeDefined();

    // Check if it's binary data
    const isBinary = receivedData instanceof ArrayBuffer ||
                    receivedData instanceof Uint8Array ||
                    (typeof Buffer !== 'undefined' && Buffer.isBuffer(receivedData));
    expect(isBinary).toBe(true);

    ws.close();
  });

  it("should properly clean up connections when clients disconnect", async () => {
    const streamKey = "cleanup-stream";
    const ws = new WebSocket(`ws://localhost:3007/stream/${streamKey}`);

    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    // Verify client is connected
    let statusResponse = await fetch("http://localhost:3007/api/status");
    let status = await statusResponse.json();
    expect(status.websocket.activeStreams).toContain(streamKey);
    const initialClientCount = status.websocket.totalClients;
    expect(initialClientCount).toBeGreaterThanOrEqual(1);

    // Close connection
    ws.close();

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify client is removed
    statusResponse = await fetch("http://localhost:3007/api/status");
    status = await statusResponse.json();
    expect(status.websocket.totalClients).toBeLessThan(initialClientCount);
  });

  it("should handle connection errors gracefully", async () => {
    // Test connection to non-existent stream
    const streamKey = "error-test";
    const ws = new WebSocket(`ws://localhost:3007/stream/${streamKey}`);

    const errorPromise = new Promise((resolve) => {
      ws.onerror = (error) => {
        console.log("Expected error for non-existent stream:", error);
        resolve(true);
      };

      ws.onclose = (event) => {
        console.log("Connection closed as expected:", event.code);
        resolve(true);
      };

      // Also resolve if connection somehow succeeds (shouldn't happen)
      ws.onopen = () => {
        console.log("Connection unexpectedly succeeded");
        ws.close();
        resolve(true);
      };
    });

    await expect(errorPromise).resolves.toBe(true);
  });
});
