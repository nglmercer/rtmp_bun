import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../src/api";
import { AppConfig } from "../../src/config";
import { StreamForwarder } from "../../src/forwarder";
import WebSocket from "ws";

describe("Simple WebSocket Diagnosis", () => {
  let api: RestApi;
  let forwarder: StreamForwarder;
  const testConfig: AppConfig = {
    server: {
      port: 1935,
      host: "0.0.0.0",
      chunkSize: 4096,
      windowAckSize: 2500000,
      peerBandwidth: 2500000,
      logLevel: "debug",
      logFile: "./logs/test-diagnosis.log",
      enableRestApi: true,
      restApiPort: 3011, // Use different port for testing
    },
    targets: [],
  };

  beforeAll(async () => {
    console.log("🚀 Setting up simple WebSocket diagnosis...");

    forwarder = new StreamForwarder(testConfig);
    api = new RestApi(testConfig, forwarder);

    await api.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log("✅ Setup complete");
  });

  afterAll(async () => {
    console.log("🧹 Cleaning up...");
    await api.stop();
  });

  it("should receive ANY message from WebSocket", async () => {
    console.log("\n🔍 Testing WebSocket message reception...");

    const ws = new WebSocket(`ws://localhost:${testConfig.server.restApiPort}/stream/test-any`);
    let messageReceived = false;
    let messageContent: any = null;
    let connectionError: Error | null = null;

    // Set up message handler BEFORE connection opens
    ws.on('message', (data) => {
      console.log("📨 MESSAGE RECEIVED!");
      console.log("📨 Type:", typeof data);
      console.log("📨 Length:", data.length || data.byteLength);

      if (typeof data === 'string') {
        console.log("📨 Content (string):", data);
        try {
          messageContent = JSON.parse(data);
          console.log("📨 Parsed JSON:", messageContent);
        } catch {
          messageContent = data;
        }
      } else {
        console.log("📨 Content (binary):", Array.from(new Uint8Array(data).slice(0, 20)));
        messageContent = `Binary (${data.byteLength} bytes)`;
      }

      messageReceived = true;
    });

    ws.on('error', (error) => {
      console.error("❌ WebSocket Error:", error);
      connectionError = error;
    });

    ws.on('open', () => {
      console.log("✅ WebSocket connected");

      // IMMEDIATELY send multiple types of messages
      console.log("📡 Sending test messages...");

      // 1. String message
      api.broadcastToStream("test-any", "Hello World!");

      // 2. JSON message
      api.broadcastToStream("test-any", JSON.stringify({
        type: "test",
        message: "Test JSON",
        timestamp: new Date().toISOString()
      }));

      // 3. Binary message
      const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xDE, 0xAD, 0xBE, 0xEF]);
      api.broadcastToStream("test-any", binaryData);

      // 4. Another message after delay
      setTimeout(() => {
        console.log("📡 Sending delayed message...");
        api.broadcastToStream("test-any", JSON.stringify({
          type: "delayed",
          message: "This should work",
          timestamp: new Date().toISOString()
        }));
      }, 100);
    });

    ws.on('close', (code, reason) => {
      console.log("🔌 WebSocket closed:", code, reason?.toString());
    });

    // Wait for messages
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log("⏰ Timeout - no messages received");
        resolve(null);
      }, 3000);

      // Check for messages periodically
      const checkInterval = setInterval(() => {
        if (messageReceived) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 100);

      // Also resolve if there was an error
      ws.on('error', () => {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve(null);
      });
    });

    // Clean up
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }

    // Debug information
    console.log("\n🔍 DIAGNOSTIC RESULTS:");
    console.log("✅ Message Received:", messageReceived);
    console.log("✅ Message Content:", messageContent);
    console.log("❌ Connection Error:", connectionError?.message);
    console.log("📊 WebSocket Ready State:", ws.readyState);

    // Check API status
    try {
      const statusResponse = await fetch(`http://localhost:${testConfig.server.restApiPort}/api/status`);
      const status = await statusResponse.json();
      console.log("📊 API Status:", JSON.stringify(status.websocket, null, 2));
    } catch (error) {
      console.error("❌ Failed to get API status:", error);
    }

    // Assertions
    expect(connectionError).toBeNull();
    expect(messageReceived).toBe(true);
    expect(messageContent).not.toBeNull();
  });

  it("should work with minimal WebSocket server", async () => {
    console.log("\n🔍 Testing with minimal WebSocket server...");

    // Create a minimal server to verify WebSocket infrastructure works
    const simpleServer = Bun.serve({
      port: 3012,
      fetch(req, server) {
        if (req.headers.get("upgrade") === "websocket") {
          return server.upgrade(req);
        }
        return new Response("WebSocket test server", { status: 200 });
      },
      websocket: {
        open(ws) {
          console.log("✅ Simple server: connection opened");
          // Send immediate message
          ws.send(JSON.stringify({
            type: "connection",
            message: "Welcome to simple server",
            timestamp: new Date().toISOString()
          }));
        },
        message(ws, message) {
          console.log("📨 Simple server: got message:", message);
        },
        close(ws) {
          console.log("🔌 Simple server: connection closed");
        },
      },
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Test connection to simple server
    const ws = new WebSocket(`ws://localhost:3012/`);
    let received = false;
    let content: any = null;

    ws.on('message', (data) => {
      console.log("📨 Simple server message received:", data.toString());
      received = true;
      try {
        content = JSON.parse(data.toString());
      } catch {
        content = data.toString();
      }
    });

    ws.on('error', (error) => {
      console.error("❌ Simple server error:", error);
    });

    await new Promise((resolve) => {
      ws.on('open', () => {
        setTimeout(resolve, 2000); // Wait 2 seconds for messages
      });
      ws.on('error', () => resolve(null));
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }

    simpleServer.stop();

    console.log("🔍 Simple server results:");
    console.log("✅ Message received:", received);
    console.log("✅ Content:", content);

    expect(received).toBe(true);
    expect(content).not.toBeNull();
  });
});
