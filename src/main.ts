import { Server, Socket } from "node:net";
import { ConfigLoader } from "./config/loader";
import { RtmpConnection } from "./rtmp/connection";
import { createDefaultConfig, type RtmpConfig } from "./config/schemas";

interface RTMPServerOptions {
  configPath?: string;
  watchConfig?: boolean;
  autoStart?: boolean;
}

export class RTMPServer {
  private configLoader: ConfigLoader;
  private server: Server | null = null;
  private connections: Map<string, RtmpConnection> = new Map();
  private isRunning: boolean = false;
  private config: RtmpConfig;
  private restApiServer: Server | null = null;

  constructor(options: RTMPServerOptions = {}) {
    const {
      configPath = "./config.toml",
      watchConfig = false,
      autoStart = false,
    } = options;

    this.configLoader = new ConfigLoader({
      configPath,
      format: "auto",
      watch: watchConfig,
    });

    this.config = createDefaultConfig();

    this.configLoader.onUpdate((newConfig) => {
      this.config = newConfig;
      console.log("[RTMPServer] Configuration reloaded");
    });

    if (autoStart) {
      this.start();
    }
  }

  public async loadConfig(): Promise<void> {
    console.log("[RTMPServer] Loading configuration...");
    this.config = await this.configLoader.load();
    console.log("[RTMPServer] Configuration loaded:", {
      port: this.config.server.port,
      host: this.config.server.host,
      targets: this.config.targets.length,
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("[RTMPServer] Server is already running");
      return;
    }

    try {
      if (!this.config.server) {
        await this.loadConfig();
      }

      const { port, host } = this.config.server;

      this.server = new Server();

      this.server.on("connection", (socket) => {
        this.handleConnection(socket);
      });

      this.server.on("error", (error) => {
        console.error("[RTMPServer] Server error:", error);
      });

      await new Promise<void>((resolve, reject) => {
        if (!this.server) return reject(new Error("Server not initialized"));

        this.server.listen(port, host, () => {
          console.log(`[RTMPServer] RTMP server listening on ${host}:${port}`);
          this.isRunning = true;
          resolve();
        });

        this.server?.once("error", reject);
      });

      if (this.config.server.enableRestApi) {
        await this.startRestApi();
      }
    } catch (error) {
      console.error("[RTMPServer] Failed to start server:", error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      console.warn("[RTMPServer] Server is not running");
      return;
    }

    console.log("[RTMPServer] Stopping server...");

    if (this.restApiServer) {
      await this.stopRestApi();
    }

    const connectionPromises = Array.from(this.connections.values()).map(
      (conn) => conn.disconnect("Server stopping"),
    );
    await Promise.allSettled(connectionPromises);
    this.connections.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => {
          this.server = null;
          this.isRunning = false;
          console.log("[RTMPServer] Server stopped");
          resolve();
        });

        setTimeout(() => {
          this.server?.closeAllConnections?.();
          this.server = null;
          this.isRunning = false;
          resolve();
        }, 2000);
      });
    }
  }

  private handleConnection(socket: Socket): void {
    const connectionId = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[RTMPServer] New connection from ${connectionId}`);

    const connection = new RtmpConnection(this.config.server, {
      onConnect: (client) => {
        console.log(`[RTMPServer] Client connected: ${connectionId}`);
      },
      onDisconnect: (client, reason) => {
        console.log(
          `[RTMPServer] Client disconnected: ${connectionId} (${reason})`,
        );
        this.connections.delete(connectionId);
      },
      onMessage: (message, client) => {
        console.log(
          `[RTMPServer] Message from ${connectionId}: ${message.type}`,
        );
      },
      onHandshakeComplete: (result, client) => {
        console.log(
          `[RTMPServer] Handshake completed for ${connectionId}: ${result.success ? "OK" : "FAILED"}`,
        );
      },
      onStreamPublishStart: (streamName, client) => {
        console.log(`[RTMPServer] Stream publish started: ${streamName}`);
        this.config.targets.forEach((target) => {
          if (target.enabled) {
            console.log(
              `[RTMPServer] Forwarding stream ${streamName} to ${target.url}`,
            );
            this.forwardToTarget(streamName, target);
          }
        });
      },
      onStreamPublishStop: (streamName, client) => {
        console.log(`[RTMPServer] Stream publish stopped: ${streamName}`);
      },
      onStreamPlayStart: (streamName, client) => {
        console.log(`[RTMPServer] Stream play started: ${streamName}`);
      },
      onStreamPlayStop: (streamName, client) => {
        console.log(`[RTMPServer] Stream play stopped: ${streamName}`);
      },
      onError: (error, client) => {
        console.error(
          `[RTMPServer] Connection error for ${connectionId}:`,
          error,
        );
      },
    });

    this.connections.set(connectionId, connection);
    connection.setSocket(socket as any);

    socket.on("data", async (data) => {
      try {
        await connection.handleData(Buffer.from(data));
      } catch (error) {
        console.error(
          `[RTMPServer] Error handling data from ${connectionId}:`,
          error,
        );
        socket.destroy();
      }
    });

    socket.on("close", () => {
      console.log(`[RTMPServer] Socket closed for ${connectionId}`);
      this.connections.delete(connectionId);
    });

    socket.on("error", (error) => {
      console.error(`[RTMPServer] Socket error for ${connectionId}:`, error);
      this.connections.delete(connectionId);
    });

    socket.setKeepAlive(true, 60000);
    socket.setTimeout(0);
  }

  private async startRestApi(): Promise<void> {
    const { restApiPort, host } = this.config.server;

    this.restApiServer = new Server(async (socket) => {
      socket.on("data", (data) => {
        const request = data.toString();
        const lines = request.split("\r\n");
        const requestLine = lines[0];
        const [method, path] = requestLine.split(" ");

        let response = "";
        let body = "";
        let statusLine = "HTTP/1.1 200 OK";

        if (method === "GET" && (path === "/api" || path === "/api/")) {
          body = JSON.stringify({
            name: "RTMP Bun Server",
            version: "1.0.0",
            status: this.isRunning ? "running" : "stopped",
            endpoints: ["/api", "/api/config", "/api/targets", "/api/status"],
          });
        } else if (method === "GET" && path === "/api/status") {
          const status = {
            running: this.isRunning,
            connections: this.connections.size,
            config: {
              port: this.config.server.port,
              targets: this.config.targets.length,
            },
            uptime: process.uptime,
            memory: process.memoryUsage,
          };
          body = JSON.stringify(status);
        } else if (method === "GET" && path === "/api/targets") {
          body = JSON.stringify(this.config.targets);
        } else if (method === "GET" && path === "/api/config") {
          body = JSON.stringify(this.config);
        } else {
          statusLine = "HTTP/1.1 404 Not Found";
          body = JSON.stringify({ error: "Not found" });
        }

        response = `${statusLine}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
        socket.write(response);
        socket.end();
      });

      socket.on("error", (error) => {
        console.error("[RTMPServer] REST API socket error:", error);
      });
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.restApiServer)
        return reject(new Error("REST API server not initialized"));

      this.restApiServer.listen(restApiPort, host, () => {
        console.log(
          `[RTMPServer] REST API listening on ${host}:${restApiPort}`,
        );
        resolve();
      });

      this.restApiServer?.once("error", reject);
    });
  }

  private async stopRestApi(): Promise<void> {
    if (this.restApiServer) {
      await new Promise<void>((resolve) => {
        this.restApiServer?.close(() => {
          this.restApiServer = null;
          console.log("[RTMPServer] REST API stopped");
          resolve();
        });
      });
    }
  }

  private forwardToTarget(streamName: string, target: any): void {
    console.log(
      `[RTMPServer] Simulating forwarding ${streamName} to ${target.url}`,
    );
    // In real implementation, this would initiate RTMP or HTTP push
  }

  public getStats(): {
    running: boolean;
    connections: number;
    config: any;
  } {
    return {
      running: this.isRunning,
      connections: this.connections.size,
      config: this.config,
    };
  }

  public async updateTargets(newTargets: any[]): Promise<void> {
    this.config.targets = newTargets;
    await this.configLoader.save(this.config);
    console.log("[RTMPServer] Targets updated");
  }
}

// Main entry point
async function main() {
  console.log("[RTMPServer] Starting RTMP Bun Server...");

  const server = new RTMPServer({
    configPath: "./config.toml",
    watchConfig: true,
    autoStart: false,
  });

  try {
    await server.loadConfig();
    await server.start();

    // Graceful shutdown
    const shutdown = async () => {
      console.log("[RTMPServer] Received shutdown signal");
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep process alive
    await new Promise(() => {}); // Infinite promise to prevent exit
  } catch (error) {
    console.error("[RTMPServer] Failed to start:", error);
    process.exit(1);
  }
}

// Export for external use
export default RTMPServer;

// Only run main if executed directly
if (import.meta.main) {
  main();
}
