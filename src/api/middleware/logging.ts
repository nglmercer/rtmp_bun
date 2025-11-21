import type { Middleware } from "../types.js";

export interface LoggingOptions {
  logLevel?: "debug" | "info" | "warn" | "error";
  includeHeaders?: boolean;
  includeBody?: boolean;
  maxBodySize?: number;
}

export const logging = (options: LoggingOptions = {}): Middleware => {
  const {
    logLevel = "info",
    includeHeaders = false,
    includeBody = false,
    maxBodySize = 1000,
  } = options;

  const log = (level: string, message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...(data && { data })
    };

    if (level === "error") {
      console.error(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || "");
    } else if (level === "warn") {
      console.warn(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || "");
    } else if (level === "debug") {
      console.debug(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || "");
    } else {
      console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || "");
    }
  };

  return async (req, ctx, next) => {
    const startTime = Date.now();
    const url = new URL(req.url);
    
    const requestData: any = {
      method: req.method,
      path: url.pathname,
      query: url.search,
      userAgent: req.headers.get("user-agent"),
      ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
    };

    if (includeHeaders) {
      requestData.headers = Object.fromEntries(req.headers.entries());
    }

    if (includeBody && req.method !== "GET") {
      try {
        const body = await req.clone().text();
        if (body.length > 0) {
          requestData.body = body.length > maxBodySize 
            ? body.substring(0, maxBodySize) + "..." 
            : body;
        }
      } catch (error) {
        requestData.body = "[Error reading body]";
      }
    }

    log(logLevel, "Incoming request", requestData);

    try {
      const response = await next();
      const duration = Date.now() - startTime;

      const responseData: any = {
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        contentType: response.headers.get("content-type"),
      };

      log(logLevel, "Request completed", responseData);

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorData: any = {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        duration: `${duration}ms`,
      };

      log("error", "Request failed", errorData);
      throw error;
    }
  };
};

// Simple error logging middleware
export const errorLogging = (): Middleware => {
  return async (req, ctx, next) => {
    try {
      return await next();
    } catch (error) {
      const timestamp = new Date().toISOString();
      const url = new URL(req.url);
      
      console.error(`[${timestamp}] ERROR: ${req.method} ${url.pathname}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        method: req.method,
        path: url.pathname,
        query: url.search,
      });

      throw error;
    }
  };
};
