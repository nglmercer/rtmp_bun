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
  private memoryStore: Map<string, Uint8Array> = new Map();

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
      }
    });

    console.log(
      `REST API server started on port ${this.config.server.restApiPort}`,
    );
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      console.log("REST API server stopped");
    }
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

    // --- HLS Ingest Handlers (FFmpeg HTTP PUT/DELETE/GET) ---
    if (path.startsWith("/hls_ingest/")) {
      // CASE 1: FFmpeg sending data (PUT)
      if (request.method === "PUT") {
        const data = await request.arrayBuffer();
        this.memoryStore.set(path, new Uint8Array(data));
        console.log(`📦 Recibido en RAM: ${path} (${data.byteLength} bytes)`);
        return new Response("OK");
      }

      // CASE 2: FFmpeg deleting old segments (DELETE)
      if (request.method === "DELETE") {
        this.memoryStore.delete(path);
        console.log(`🗑️ Eliminado de RAM: ${path}`);
        return new Response("OK");
      }

      // CASE 3: Player requesting video (GET)
      if (request.method === "GET") {
        const fileData = this.memoryStore.get(path);
        
        if (!fileData) {
          return new Response("Not Found", { status: 404 });
        }

        return new Response(fileData, {
          headers: {
            "Content-Type": path.endsWith(".m3u8") 
              ? "application/vnd.apple.mpegurl" 
              : "video/mp2t",
            "Access-Control-Allow-Origin": "*",
          }
        });
      }
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
              const requestData: any = await request.json();
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
