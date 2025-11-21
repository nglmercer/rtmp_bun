// Re-exportar la clase RestApi refactorizada
export { RestApi } from "./api/server.js";

// También exportar tipos y utilidades si se necesitan externamente
export type { 
  RouteHandler, 
  RequestContext, 
  Middleware, 
  Route, 
  StaticFileOptions 
} from "./api/types.js";

export { ResponseUtils } from "./api/utils/response.js";
export { StaticServer, staticFiles } from "./api/utils/static-server.js";
export { cors, corsPreflight } from "./api/middleware/cors.js";
export { logging, errorLogging } from "./api/middleware/logging.js";
export { Router, createRouter } from "./api/routes/router.js";
