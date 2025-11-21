import type { Middleware } from "../types.js";

export interface CorsOptions {
  origin?: string | string[];
  methods?: string[];
  allowedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export const cors = (options: CorsOptions = {}): Middleware => {
  const {
    origin = "*",
    methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders = ["Content-Type", "Authorization"],
    credentials = false,
    maxAge = 86400,
  } = options;

  return async (req, ctx, next) => {
    const response = await next();

    // Set CORS headers
    if (typeof origin === "string") {
      response.headers.set("Access-Control-Allow-Origin", origin);
    } else if (Array.isArray(origin)) {
      const requestOrigin = req.headers.get("Origin");
      if (requestOrigin && origin.includes(requestOrigin)) {
        response.headers.set("Access-Control-Allow-Origin", requestOrigin);
      }
    }

    response.headers.set("Access-Control-Allow-Methods", methods.join(", "));
    response.headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));
    
    if (credentials) {
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }

    if (maxAge > 0) {
      response.headers.set("Access-Control-Max-Age", maxAge.toString());
    }

    return response;
  };
};

// Handle preflight requests
export const corsPreflight = (options: CorsOptions = {}): Middleware => {
  return async (req, ctx, next) => {
    if (req.method === "OPTIONS") {
      const {
        origin = "*",
        methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders = ["Content-Type", "Authorization"],
        credentials = false,
        maxAge = 86400,
      } = options;

      const headers = new Headers();
      
      if (typeof origin === "string") {
        headers.set("Access-Control-Allow-Origin", origin);
      } else if (Array.isArray(origin)) {
        const requestOrigin = req.headers.get("Origin");
        if (requestOrigin && origin.includes(requestOrigin)) {
          headers.set("Access-Control-Allow-Origin", requestOrigin);
        }
      }

      headers.set("Access-Control-Allow-Methods", methods.join(", "));
      headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));
      
      if (credentials) {
        headers.set("Access-Control-Allow-Credentials", "true");
      }

      if (maxAge > 0) {
        headers.set("Access-Control-Max-Age", maxAge.toString());
      }

      return new Response(null, { status: 200, headers });
    }

    return next();
  };
};
