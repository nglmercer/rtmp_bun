import type { AppConfig, StreamTarget } from "./config.js";
import { loadConfig, saveConfig } from "./config.js";
import { StreamForwarder } from "./forwarder.js";
import { file } from "bun";
import { join } from "path";

export class RestApi {
  private config: AppConfig;
  private forwarder: StreamForwarder;
  private server: any;
  private streamClients: Map<string, Set<WebSocket>> = new Map();

  constructor(config: AppConfig, forwarder: StreamForwarder) {
    this.config = config;
    this.forwarder = forwarder;
  }

  async start(): Promise<void> {
    if (!this.config.server.enableRestApi) {
      console.log("REST API disabled");
      return;
    }

    const self = this;
    this.server = Bun.serve({
      port: this.config.server.restApiPort,
      hostname: "0.0.0.0",
      fetch(req, server) {
        return self.handleRequest(req, server);
      },
      websocket: {
        open: (ws) => this.handleWebSocketOpen(ws),
        message: (ws, message) => this.handleWebSocketMessage(ws, message),
        close: (ws) => this.handleWebSocketClose(ws),
        error: (ws, error) => this.handleWebSocketError(ws, error),
        drain: (ws) => {
          // Handle backpressure if needed
          console.log("WebSocket buffer drained");
        },
      },
    });

    console.log(
      `REST API server started on port ${this.config.server.restApiPort}`,
    );
    console.log(
      `🌐 WebSocket streaming endpoint: ws://localhost:${this.config.server.restApiPort}/stream/{streamKey}`,
    );
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      console.log("REST API server stopped");
    }
  }

  private handleWebSocketOpen(ws: WebSocket): void {
    // Extract stream key from request URL stored in ws.data
    const url = new URL(ws.data.url);
    const path = url.pathname;
    const streamKey = path.split("/").pop() || "";

    console.log(
      `🔍 WebSocket connection attempt - Path: ${path}, StreamKey: ${streamKey}`,
    );

    if (path.startsWith("/stream/") && streamKey) {
      console.log(`✅ WebSocket client connected to stream: ${streamKey}`);

      // Add client to stream subscribers
      if (!this.streamClients.has(streamKey)) {
        this.streamClients.set(streamKey, new Set());
        console.log(`📋 Created new stream group for: ${streamKey}`);
      }
      this.streamClients.get(streamKey)!.add(ws);
      console.log(
        `➕ Added client to stream: ${streamKey} (total: ${this.streamClients.get(streamKey)!.size})`,
      );

      // Store stream key in WebSocket data for later use
      ws.data = { ...ws.data, streamKey };

      // Don't send immediate test data - wait for actual stream data
      // The connection should stay open waiting for real stream data
      console.log(
        `✅ WebSocket connection established for stream: ${streamKey}`,
      );
      console.log(`🔄 Waiting for stream data to be published...`);
    } else {
      console.log(`❌ WebSocket connected to invalid path: ${path}`);
      ws.close();
    }
  }

  private handleWebSocketMessage(
    ws: WebSocket,
    message: string | Buffer,
  ): void {
    const streamKey = ws.data?.streamKey;
    if (!streamKey) return;

    try {
      if (typeof message === "string") {
        const data = JSON.parse(message);
        console.log(`📨 WebSocket message from ${streamKey}:`, data);

        if (data.type === "ping") {
          ws.send(
            JSON.stringify({
              type: "pong",
              timestamp: new Date().toISOString(),
            }),
          );
        }
      } else {
        console.log(
          `📨 Binary message from ${streamKey}: ${message.length} bytes`,
        );
      }
    } catch (error) {
      console.error(`❌ Error processing WebSocket message:`, error);
    }
  }

  private handleWebSocketClose(ws: WebSocket): void {
    const streamKey = ws.data?.streamKey;
    if (streamKey) {
      console.log(`🔌 WebSocket client disconnected from stream: ${streamKey}`);
      const clients = this.streamClients.get(streamKey);
      if (clients) {
        clients.delete(ws);
        console.log(
          `➖ Removed client from stream: ${streamKey} (remaining: ${clients.size})`,
        );
        if (clients.size === 0) {
          this.streamClients.delete(streamKey);
          console.log(`🗑️ Removed empty stream group: ${streamKey}`);
        }
      }
    } else {
      console.log(`🔌 WebSocket client disconnected (no stream key)`);
    }
  }

  private handleWebSocketError(ws: WebSocket, error: Error): void {
    const streamKey = ws.data?.streamKey;
    console.error(
      `❌ WebSocket error for stream ${streamKey || "unknown"}:`,
      error,
    );
    console.error(`🔍 WebSocket error details:`, {
      readyState: ws.readyState,
      streamKey: streamKey,
      errorType: error.name,
      errorMessage: error.message,
    });
  }

  public broadcastToStream(
    streamKey: string,
    data: ArrayBuffer | Uint8Array | string,
  ): void {
    const clients = this.streamClients.get(streamKey);
    if (clients && clients.size > 0) {
      let messageCount = 0;
      clients.forEach((client) => {
        try {
          if (client.readyState === 1) {
            // WebSocket.OPEN
            client.send(data);
            messageCount++;
          }
        } catch (error) {
          console.error(`Error sending to client:`, error);
        }
      });

      if (messageCount > 0) {
        console.log(
          `📡 Broadcasted to ${messageCount} clients for stream ${streamKey}`,
        );
      }
    }
  }

  private async handleRequest(
    request: Request,
    server: any,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Enable CORS
    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // Serve static files
    if (path === "/" || path.endsWith(".html")) {
      const requestPath = path === "/" ? "/index.html" : path;
      const indexPath = join(process.cwd(), "public", requestPath);
      const indexFile = file(indexPath);

      try {
        if (await indexFile.exists()) {
          return new Response(await indexFile.arrayBuffer(), {
            headers: { "Content-Type": "text/html", ...headers },
          });
        }
        return new Response("File not found", { status: 404 });
      } catch (error) {
        return new Response("File not found", { status: 404 });
      }
    }

    // Serve JavaScript files
    if (path.endsWith(".js")) {
      const jsPath = join(process.cwd(), "public", path);
      const jsFile = file(jsPath);

      try {
        if (await jsFile.exists()) {
          return new Response(await jsFile.arrayBuffer(), {
            headers: { "Content-Type": "application/javascript", ...headers },
          });
        }
        return new Response("File not found", { status: 404 });
      } catch (error) {
        return new Response("File not found", { status: 404 });
      }
    }

    // Handle WebSocket upgrade requests for /stream/* paths
    const upgrade = request.headers.get("upgrade");
    const connection = request.headers.get("connection");

    if (
      path.startsWith("/stream/") &&
      upgrade === "websocket" &&
      connection?.includes("Upgrade")
    ) {
      const streamKey = path.split("/").pop();
      if (streamKey) {
        console.log(
          `🔍 Upgrading WebSocket connection for stream: ${streamKey}`,
        );

        // Use server upgrade function passed from fetch handler
        if (typeof server.upgrade === "function") {
          const success = server.upgrade(request, {
            data: {
              streamKey,
              url: request.url,
              path: path,
            },
          });

          if (success) {
            console.log(
              `✅ WebSocket upgrade successful for stream: ${streamKey}`,
            );
            return undefined; // Connection handled by upgrade
          } else {
            console.log(`❌ WebSocket upgrade failed for stream: ${streamKey}`);
            return new Response("WebSocket upgrade failed", { status: 500 });
          }
        } else {
          // Fallback - let global handler handle this
          console.log(
            `🔄 Using fallback WebSocket handling for stream: ${streamKey}`,
          );
          return new Response(null, { status: 101 });
        }
      }
    }

    try {
      switch (path) {
        case "/health":
          return this.jsonResponse(
            { status: "ok", timestamp: new Date().toISOString() },
            headers,
          );

        case "/api/config":
          if (request.method === "GET") {
            return this.jsonResponse(this.config, headers);
          } else if (request.method === "PUT") {
            const newConfig = (await request.json()) as AppConfig;
            this.config = { ...this.config, ...newConfig };
            saveConfig(this.config);
            this.forwarder.updateConfig(this.config);
            return this.jsonResponse(
              { message: "Configuration updated" },
              headers,
            );
          }
          break;

        case "/api/targets":
          if (request.method === "GET") {
            return this.jsonResponse(this.config.targets, headers);
          } else if (request.method === "POST") {
            const newTarget = (await request.json()) as StreamTarget;
            this.config.targets.push(newTarget);
            saveConfig(this.config);
            return this.jsonResponse(
              { message: "Target added", target: newTarget },
              headers,
            );
          }
          break;

        case "/api/targets/enable":
          if (request.method === "POST") {
            const requestData = (await request.json()) as {
              targetId: string;
              enabled: boolean;
              key?: string;
            };
            const { targetId, enabled, key } = requestData;
            const target = this.config.targets.find((t) => t.id === targetId);
            if (target) {
              target.enabled = enabled;
              if (key) target.key = key;
              saveConfig(this.config);
              return this.jsonResponse(
                {
                  message: `Target ${targetId} ${enabled ? "enabled" : "disabled"}`,
                },
                headers,
              );
            }
            return this.jsonResponse(
              { error: "Target not found" },
              headers,
              404,
            );
          }
          break;

        case "/api/targets/disable":
          if (request.method === "POST") {
            const requestData = (await request.json()) as { targetId: string };
            const { targetId } = requestData;
            const target = this.config.targets.find((t) => t.id === targetId);
            if (target) {
              target.enabled = false;
              saveConfig(this.config);
              return this.jsonResponse(
                { message: `Target ${targetId} disabled` },
                headers,
              );
            }
            return this.jsonResponse(
              { error: "Target not found" },
              headers,
              404,
            );
          }
          break;

        case "/api/status":
          if (request.method === "GET") {
            const status = {
              server: {
                port: this.config.server.port,
                host: this.config.server.host,
                uptime: process.uptime(),
              },
              targets: this.config.targets.map((target) => ({
                id: target.id,
                url: target.url,
                enabled: target.enabled,
                hasKey: !!target.key,
                active: this.forwarder.getActiveTargets().includes(target.id),
              })),
              activeTargets: this.forwarder.getActiveTargets(),
              websocket: {
                activeStreams: Array.from(this.streamClients.keys()),
                totalClients: Array.from(this.streamClients.values()).reduce(
                  (sum, clients) => sum + clients.size,
                  0,
                ),
              },
            };
            return this.jsonResponse(status, headers);
          }
          break;

        case "/api/test-stream":
          if (request.method === "POST") {
            // Create and send test FLV header
            const flvHeader = new Uint8Array([
              0x46,
              0x4c,
              0x56, // "FLV" signature
              0x01, // version 1
              0x05, // audio and video present
              0x00,
              0x00,
              0x00,
              0x09, // header length (9 bytes)
              0x00,
              0x00,
              0x00,
              0x00, // previous tag size 0
            ]);

            // Get stream key from request body
            let streamKey = "test"; // default
            try {
              const requestData = await request.json();
              if (requestData.streamKey) {
                streamKey = requestData.streamKey;
              }
            } catch (error) {
              // If no body or invalid JSON, use default
            }

            // Send test stream data
            this.broadcastToStream(streamKey, flvHeader);

            // Don't send JSON metadata - only FLV binary data

            return this.jsonResponse(
              {
                message: `Test stream sent to /stream/${streamKey}`,
                url: `ws://localhost:${this.config.server.restApiPort}/stream/${streamKey}`,
              },
              headers,
            );
          }
          break;

        default:
          // Dynamic target management
          if (path.startsWith("/api/targets/")) {
            const targetId = path.split("/").pop();
            if (!targetId) break;

            if (request.method === "DELETE") {
              const index = this.config.targets.findIndex(
                (t) => t.id === targetId,
              );
              if (index !== -1) {
                const removed = this.config.targets.splice(index, 1);
                saveConfig(this.config);
                return this.jsonResponse(
                  { message: "Target deleted", target: removed[0] },
                  headers,
                );
              }
              return this.jsonResponse(
                { error: "Target not found" },
                headers,
                404,
              );
            }

            if (request.method === "PUT") {
              const updatedTarget =
                (await request.json()) as Partial<StreamTarget>;
              const index = this.config.targets.findIndex(
                (t) => t.id === targetId,
              );
              if (index !== -1) {
                this.config.targets[index] = {
                  ...this.config.targets[index],
                  ...updatedTarget,
                };
                saveConfig(this.config);
                return this.jsonResponse(
                  {
                    message: "Target updated",
                    target: this.config.targets[index],
                  },
                  headers,
                );
              }
              return this.jsonResponse(
                { error: "Target not found" },
                headers,
                404,
              );
            }
          }
      }
    } catch (error) {
      console.error("API Error:", error);
      return this.jsonResponse(
        { error: "Internal server error" },
        headers,
        500,
      );
    }

    return this.jsonResponse({ error: "Not found" }, headers, 404);
  }

  private jsonResponse(
    data: any,
    headers: Record<string, string>,
    status: number = 200,
  ): Response {
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      status,
    });
  }
}
