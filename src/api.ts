import type { AppConfig, StreamTarget } from "./config.js";
import { loadConfig, saveConfig } from "./config.js";
import { StreamForwarder } from "./forwarder.js";

export class RestApi {
  private config: AppConfig;
  private forwarder: StreamForwarder;
  private server: any;

  constructor(config: AppConfig, forwarder: StreamForwarder) {
    this.config = config;
    this.forwarder = forwarder;
  }

  async start(): Promise<void> {
    if (!this.config.server.enableRestApi) {
      console.log("REST API disabled");
      return;
    }

    this.server = Bun.serve({
      port: this.config.server.restApiPort,
      hostname: "0.0.0.0",
      fetch: this.handleRequest.bind(this),
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

  private async handleRequest(request: Request): Promise<Response> {
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

    try {
      switch (path) {
        case "/":
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
            };
            return this.jsonResponse(status, headers);
          }
          break;

        default:
          if (path.startsWith("/api/targets/") && request.method === "DELETE") {
            const targetId = path.split("/").pop();
            if (targetId) {
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
          }

          if (path.startsWith("/api/targets/") && request.method === "PUT") {
            const targetId = path.split("/").pop();
            if (targetId) {
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
