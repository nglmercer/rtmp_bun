import { Server, Socket } from "node:net";
import { ConfigLoader } from "./config/loader";
import { RtmpConnection } from "./rtmp/connection";
import { createDefaultConfig, type RtmpConfig, type TargetConfig } from "./config/schemas";

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
  private readonly LOG_PREFIX = "[RTMPServer]";
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
      this.log("Configuration reloaded");
    });

    if (autoStart) {
      // Start the server asynchronously without blocking constructor
      this.start().catch((error) => {
        this.logError("Failed to auto-start:", error);
      });
    }
  }

  private log(message: string, ...args: unknown[]): void {
    console.log(`${this.LOG_PREFIX} ${message}`, ...args);
  }

  private logError(message: string, ...args: unknown[]): void {
    console.error(`${this.LOG_PREFIX} ${message}`, ...args);
  }

  private logWarn(message: string, ...args: unknown[]): void {
    console.warn(`${this.LOG_PREFIX} ${message}`, ...args);
  }

  public async loadConfig(): Promise<void> {
    this.log("Loading configuration...");
    this.config = await this.configLoader.load();
    this.log("Configuration loaded:", {
      port: this.config.server.port,
      host: this.config.server.host,
      targets: this.config.targets.length,
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logWarn("Server is already running");
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
        this.logError("Server error:", error);
      });

      await new Promise<void>((resolve, reject) => {
        if (!this.server) return reject(new Error("Server not initialized"));

        this.server.listen(port, host, () => {
          this.log(`RTMP server listening on ${host}:${port}`);
          this.isRunning = true;
          resolve();
        });

        this.server?.once("error", reject);
      });

      if (this.config.server.enableRestApi) {
        await this.startRestApi();
      }
    } catch (error) {
      this.logError("Failed to start server:", error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logWarn("Server is not running");
      return;
    }

    this.log("Stopping server...");

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
          this.log("Server stopped");
          resolve();
        });

        setTimeout(() => {
          this.server = null;
          this.isRunning = false;
          resolve();
        }, 2000);
      });
    }
  }

  private handleConnection(socket: Socket): void {
    const connectionId = `${socket.remoteAddress}:${socket.remotePort}`;
    this.log(`New connection from ${connectionId}`);

    // Map server config to connection config
    const connectionConfig = {
      chunkSize: this.config.server.chunkSize,
      windowAckSize: this.config.server.windowAckSize,
      peerBandwidth: this.config.server.peerBandwidth,
      logLevel: this.config.server.logLevel as 'debug' | 'info' | 'warn' | 'error',
      timeout: 30000
    };

    const connection = new RtmpConnection(connectionConfig, {
      onConnect: (client) => {
        this.log(`Client connected: ${connectionId}`);
      },
      onDisconnect: (client, reason) => {
        this.log(`Client disconnected: ${connectionId} (${reason})`);
        this.connections.delete(connectionId);
      },
      onMessage: (message, client) => {
        this.log(`Message from ${connectionId}`);
      },
      onHandshakeComplete: (result, client) => {
        this.log(`Handshake completed for ${connectionId}: ${result.success ? "OK" : "FAILED"}`);
      },
      onStreamPublishStart: (streamName, client) => {
        this.log(`Stream publish started: ${streamName}`);
        this.config.targets.forEach((target) => {
          if (target.enabled) {
            this.log(`Forwarding stream ${streamName} to ${target.url}`);
            this.forwardToTarget(streamName, target);
          }
        });
      },
      onStreamPublishStop: (streamName, client) => {
        this.log(`Stream publish stopped: ${streamName}`);
      },
      onStreamPlayStart: (streamName, client) => {
        this.log(`Stream play started: ${streamName}`);
      },
      onStreamPlayStop: (streamName, client) => {
        this.log(`Stream play stopped: ${streamName}`);
      },
      onError: (error, client) => {
        this.logError(`Connection error for ${connectionId}:`, error);
      },
    });

    this.connections.set(connectionId, connection);
    connection.setSocket(socket);

    socket.on("data", async (data) => {
      try {
        await connection.handleData(Buffer.from(data));
      } catch (error) {
        this.logError(`Error handling data from ${connectionId}:`, error);
        socket.destroy();
      }
    });

    socket.on("close", () => {
      this.log(`Socket closed for ${connectionId}`);
      this.connections.delete(connectionId);
    });

    socket.on("error", (error) => {
      this.logError(`Socket error for ${connectionId}:`, error);
      this.connections.delete(connectionId);
    });

    socket.setKeepAlive(true, 60000);
    socket.setTimeout(0);
  }

  private async startRestApi(): Promise<void> {
    const { restApiPort, host } = this.config.server;

    this.restApiServer = new Server((socket) => {
      let requestData = "";

      socket.on("data", async (data) => {
        requestData += data.toString();

        // Check if we have received the complete HTTP request
        const headerEndIndex = requestData.indexOf("\r\n\r\n");
        if (headerEndIndex === -1) {
          return; // Wait for more data
        }

        const headers = requestData.substring(0, headerEndIndex);
        const body = requestData.substring(headerEndIndex + 4);

        const lines = headers.split("\r\n");
        const requestLine = lines[0];
        const [method, path] = requestLine.split(" ");

        let responseBody = "";
        let statusLine = "HTTP/1.1 200 OK";

        try {
          if (method === "GET" && (path === "/api" || path === "/api/")) {
            responseBody = JSON.stringify({
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
              uptime: process.uptime(),
              memory: process.memoryUsage(),
            };
            responseBody = JSON.stringify(status);
          } else if (method === "GET" && path === "/api/targets") {
            responseBody = JSON.stringify(this.config.targets);
          } else if (method === "GET" && path === "/api/config") {
            responseBody = JSON.stringify(this.config);
          } else if (method === "POST" && path === "/api/targets") {
            // Handle POST request to update targets
            try {
              const parsedBody = JSON.parse(body);
              if (Array.isArray(parsedBody)) {
                this.config.targets = parsedBody;
                await this.configLoader.save(this.config);
                responseBody = JSON.stringify({ success: true, message: "Targets updated" });
              } else {
                statusLine = "HTTP/1.1 400 Bad Request";
                responseBody = JSON.stringify({ error: "Invalid request body" });
              }
            } catch (parseError) {
              statusLine = "HTTP/1.1 400 Bad Request";
              responseBody = JSON.stringify({ error: "Invalid JSON" });
            }
          } else {
            statusLine = "HTTP/1.1 404 Not Found";
            responseBody = JSON.stringify({ error: "Not found" });
          }
        } catch (error) {
          statusLine = "HTTP/1.1 500 Internal Server Error";
          responseBody = JSON.stringify({ error: "Internal server error" });
          this.logError("REST API error:", error);
        }

        const response = `${statusLine}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(responseBody)}\r\n\r\n${responseBody}`;
        socket.write(response);
        socket.end();
      });

      socket.on("error", (error) => {
        this.logError("REST API socket error:", error);
      });
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.restApiServer)
        return reject(new Error("REST API server not initialized"));

      this.restApiServer.listen(restApiPort, host, () => {
        this.log(`REST API listening on ${host}:${restApiPort}`);
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
          this.log("REST API stopped");
          resolve();
        });
      });
    }
  }

  private forwardToTarget(streamName: string, target: TargetConfig): void {
    this.log(`Simulating forwarding ${streamName} to ${target.url}`);
    // In real implementation, this would initiate RTMP or HTTP push
    // For now, this is a stub that logs the forwarding attempt
    // Actual implementation would require:
    // 1. Creating an RTMP client connection to the target
    // 2. Re-streaming the media data
    // 3. Handling connection errors and retries
  }

  public getStats(): {
    running: boolean;
    connections: number;
    config: RtmpConfig;
  } {
    return {
      running: this.isRunning,
      connections: this.connections.size,
      config: this.config,
    };
  }

  public async updateTargets(newTargets: TargetConfig[]): Promise<void> {
    this.config.targets = newTargets;
    await this.configLoader.save(this.config);
    this.log("Targets updated");
  }
}

// Main entry point
async function main() {
  const LOG_PREFIX = "[RTMPServer]";
  const log = (message: string, ...args: unknown[]): void => {
    console.log(`${LOG_PREFIX} ${message}`, ...args);
  };
  const logError = (message: string, ...args: unknown[]): void => {
    console.error(`${LOG_PREFIX} ${message}`, ...args);
  };

  log("Starting RTMP Bun Server...");

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
      log("Received shutdown signal");
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep process alive
    await new Promise(() => {}); // Infinite promise to prevent exit
  } catch (error) {
    logError("Failed to start:", error);
    process.exit(1);
  }
}

// Export for external use
export default RTMPServer;

// Only run main if executed directly
if (import.meta.main) {
  main();
}
