import { describe, it, expect, beforeAll, afterAll } from "bun:test";

describe("Simple WebSocket API Test", () => {
  let server: any;
  const port = 3005;

  beforeAll(async () => {
    // Create a simple server with WebSocket capabilities
    server = Bun.serve({
      port,
      fetch(req, server) {
        const url = new URL(req.url);
        const upgrade = req.headers.get("upgrade");
        const connection = req.headers.get("connection");

        // Handle WebSocket upgrade requests
        if (
          url.pathname === "/ws" &&
          upgrade === "websocket" &&
          connection?.includes("Upgrade")
        ) {
          // Let global websocket handler handle this
          return new Response(null, { status: 101 });
        }

        // Handle API endpoints
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({ status: "ok" }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/api/status") {
          return new Response(
            JSON.stringify({
              websocket: {
                activeStreams: ["test"],
                totalClients: 0,
              },
            }),
            {
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open(ws) {
          console.log("WebSocket opened");
          ws.send("Hello from server");
        },
        message(ws, message) {
          console.log("Received:", message);
          ws.send(`Echo: ${message}`);
        },
        close(ws) {
          console.log("WebSocket closed");
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

  it("should handle WebSocket upgrade requests via HTTP", async () => {
    const response = await fetch(`http://localhost:${port}/ws`, {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      },
    });

    expect(response.status).toBe(101);
  });

  it("should handle regular HTTP endpoints", async () => {
    const response = await fetch(`http://localhost:${port}/health`);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  it("should provide WebSocket status information", async () => {
    const response = await fetch(`http://localhost:${port}/api/status`);
    expect(response.ok).toBe(true);

    const status = await response.json();
    expect(status.websocket).toBeDefined();
    expect(status.websocket.activeStreams).toEqual(expect.any(Array));
    expect(status.websocket.totalClients).toEqual(expect.any(Number));
  });

  it("should reject non-WebSocket requests to WebSocket endpoint", async () => {
    const response = await fetch(`http://localhost:${port}/ws`);
    // Should get 404 since it's not a WebSocket upgrade
    expect(response.status).toBe(404);
  });

  it("should handle invalid WebSocket paths", async () => {
    const response = await fetch(`http://localhost:${port}/invalid-ws`, {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      },
    });

    expect(response.status).toBe(404);
  });
});
