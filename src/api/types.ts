import type { AppConfig, StreamTarget } from "../config.js";
import { StreamForwarder } from "../forwarder.js";

export interface RouteHandler {
  (req: Request, context: RequestContext): Promise<Response> | Response;
}

export interface RequestContext {
  config: AppConfig;
  forwarder: StreamForwarder;
  updateConfig: (config: AppConfig) => void;
  params?: Record<string, string>;
}

export interface Middleware {
  (req: Request, context: RequestContext, next: () => Promise<Response> | Response): Promise<Response> | Response;
}

export interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
  middlewares?: Middleware[];
}

export interface StaticFileOptions {
  rootDir: string;
  maxAge?: number;
  etag?: boolean;
  lastModified?: boolean;
}
