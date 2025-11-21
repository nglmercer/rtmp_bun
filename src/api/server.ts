import type { AppConfig } from "../config.js";
import { StreamForwarder } from "../forwarder.js";
import type { RequestContext } from "./types.js";
import { createRouter } from "./routes/router.js";
import { cors, corsPreflight } from "./middleware/cors.js";
import { logging, errorLogging } from "./middleware/logging.js";
import { staticFiles } from "./utils/static-server.js";
import { ResponseUtils } from "./utils/response.js";

export class RestApi {
  private config: AppConfig;
  private forwarder: StreamForwarder;
  private server: any;
  private router: any;
  private staticFileHandler: any;

  constructor(config: AppConfig, forwarder: StreamForwarder) {
    this.config = config;
    this.forwarder = forwarder;
  }

  async start(): Promise<void> {
    if (!this.config.server.enableRestApi) {
      console.log("REST API disabled");
      return;
    }

    // Inicializar el router y el servidor de archivos estáticos
    this.router = await createRouter();
    this.staticFileHandler = staticFiles({
      rootDir: "./public",
      maxAge: 3600,
      etag: true,
      lastModified: true,
    });

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
    const method = request.method;

    try {
      // Crear contexto para la solicitud
      const context: RequestContext = {
        config: this.config,
        forwarder: this.forwarder,
        updateConfig: (newConfig) => {
          this.config = newConfig;
          this.forwarder.updateConfig(newConfig);
        }
      };

      // Middleware stack
      const middlewares = [
        corsPreflight(),
        cors(),
        logging({ logLevel: "info" }),
        errorLogging(),
      ];

      // Ejecutar middleware stack y el handler principal
      let response: Response | undefined;
      
      for (const middleware of middlewares) {
        const result = await middleware(request, context, () => this.executeHandler(request, context));
        if (result) {
          response = result;
          break;
        }
      }

      if (!response) {
        response = await this.executeHandler(request, context);
      }

      // Si no se encontró un handler, intentar servir archivos estáticos
      if (response.status === 404) {
        const staticResponse = await this.staticFileHandler(request);
        if (staticResponse) {
          return staticResponse;
        }
      }

      return response;
    } catch (error) {
      console.error("API Error:", error);
      return ResponseUtils.serverError("Internal server error");
    }
  }

  private async executeHandler(request: Request, context: RequestContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const { handler, params } = this.router.handle(method, path);
    
    if (handler) {
      const response = await handler(request, { ...context, params });
      
      // Agregar headers CORS si no los tiene ya
      if (!response.headers.has("Access-Control-Allow-Origin")) {
        response.headers.set("Access-Control-Allow-Origin", "*");
      }
      if (!response.headers.has("Access-Control-Allow-Methods")) {
        response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      }
      if (!response.headers.has("Access-Control-Allow-Headers")) {
        response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      }
      
      return response;
    }

    return ResponseUtils.notFound("Route not found");
  }
}
