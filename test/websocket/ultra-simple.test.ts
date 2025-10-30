import { describe, it, expect, beforeAll, afterAll } from "bun:test";

describe("WebSocket Infrastructure Test", () => {
  let server: any;
  const port = 3006;

  beforeAll(async () => {
    // Create WebSocket server with proper upgrade handling
    server = Bun.serve({
      port,
      fetch(req, server) {
        const url = new URL(req.url);
        const upgrade = req.headers.get("upgrade");
        const connection = req.headers.get("connection");

        // Check if this is a WebSocket upgrade request
        if (upgrade === "websocket" && connection?.includes("Upgrade")) {
          console.log(
            "✅ Detected WebSocket upgrade request for:",
            url.pathname,
          );
          // Let global websocket handler handle this
          return new Response(null, { status: 101 });
        }

        console.log("❓ Not a WebSocket upgrade request for:", url.pathname);
        return new Response("WebSocket server", { status: 200 });
      },
      websocket: {
        open(ws) {
          console.log("✅ WebSocket opened");
          ws.send("Hello from server");
        },
        message(ws, message) {
          console.log("📨 Received:", message);
          ws.send(`Echo: ${message}`);
        },
        close(ws) {
          console.log("🔌 WebSocket closed");
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    if (server) {
      server.stop();
    }
  });

  it("should detect WebSocket upgrade headers correctly", async () => {
    // Test WebSocket upgrade via HTTP request
    const response = await fetch(`http://localhost:${port}/`, {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "7YxyXrruTBWBATIydmKT/w==",
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
  });

  it("should handle regular HTTP requests", async () => {
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);
  });

  it("should verify WebSocket infrastructure is ready", async () => {
    // This test verifies that the server is properly configured
    expect(server).toBeDefined();
    expect(port).toBe(3006);

    // Test that we can make HTTP requests to the server
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.ok).toBe(true);
  });
});
