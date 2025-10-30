import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../src/api";
import { AppConfig } from "../../src/config";
import { StreamForwarder } from "../../src/forwarder";

describe("WebSocket Endpoint Tests", () => {
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
      restApiPort: 3002, // Use different port for testing
    },
    targets: [],
  };

  beforeAll(async () => {
    // Initialize test server
    forwarder = new StreamForwarder(testConfig);
    api = new RestApi(testConfig, forwarder);
    await api.start();

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    await api.stop();
  });

  it("should accept WebSocket upgrade requests to /stream/test", async () => {
    // Test WebSocket upgrade via HTTP request
    const response = await fetch("http://localhost:3002/stream/test", {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      },
    });

    expect(response.status).toBe(101);
  });

  it("should reject WebSocket connections to invalid paths", async () => {
    const ws = new WebSocket(`ws://localhost:3002/invalid/path`);

    const connectionPromise = new Promise((resolve, reject) => {
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

  it("should handle FLV data broadcasting", async () => {
    // Send test FLV data via API
    const response = await fetch("http://localhost:3002/api/test-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.message).toContain("Test stream sent");

    // Test status endpoint to verify streaming capability
    const statusResponse = await fetch("http://localhost:3002/api/status");
    expect(statusResponse.ok).toBe(true);

    const status = await statusResponse.json();
    expect(status.websocket).toBeDefined();
    expect(status.websocket.totalClients).toEqual(expect.any(Number));
  });

  it("should track WebSocket client functionality", async () => {
    // Test multiple test-stream calls to simulate client activity
    const response1 = await fetch("http://localhost:3002/api/test-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ streamKey: "test1" }),
    });

    const response2 = await fetch("http://localhost:3002/api/test-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ streamKey: "test1" }),
    });

    expect(response1.ok).toBe(true);
    expect(response2.ok).toBe(true);

    // Check status via API
    const response = await fetch("http://localhost:3002/api/status");
    expect(response.ok).toBe(true);

    const status = await response.json();
    expect(status.websocket).toBeDefined();
    expect(status.websocket.totalClients).toEqual(expect.any(Number));
  });

  it("should handle stream key validation correctly", async () => {
    const testKeys = ["test", "live", "unknown", "stream123"];

    for (const streamKey of testKeys) {
      // Test WebSocket upgrade via HTTP request
      const response = await fetch(
        `http://localhost:3002/stream/${streamKey}`,
        {
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
          },
        },
      );

      expect(response.status).toBe(101);
    }
  });
});
