import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../src/api";
import { AppConfig } from "../../src/config";
import { StreamForwarder } from "../../src/forwarder";

describe("WebSocket Debug Tests", () => {
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
      restApiPort: 3004, // Use different port for testing
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

  it("should test basic HTTP endpoint", async () => {
    const response = await fetch("http://localhost:3004/health");
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  it("should test WebSocket upgrade via HTTP", async () => {
    console.log(
      "🔍 Testing WebSocket upgrade to ws://localhost:3004/stream/test",
    );

    // Test WebSocket upgrade via HTTP request
    const response = await fetch("http://localhost:3004/stream/test", {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      },
    });

    console.log("📋 Response status:", response.status);
    console.log(
      "📋 Response headers:",
      Object.fromEntries(response.headers.entries()),
    );

    // Should get 101 for WebSocket upgrade
    expect(response.status).toBe(101);

    // Also test that regular HTTP requests work
    const healthResponse = await fetch("http://localhost:3004/health");
    expect(healthResponse.ok).toBe(true);
  });

  it("should test API status endpoint", async () => {
    console.log("🔍 Testing API status endpoint");

    const response = await fetch("http://localhost:3004/api/status");
    expect(response.ok).toBe(true);

    const status = await response.json();
    console.log("📋 API status:", status);

    expect(status.websocket).toBeDefined();
    expect(status.websocket.activeStreams).toEqual(expect.any(Array));
    expect(status.websocket.totalClients).toEqual(expect.any(Number));
  });
});
