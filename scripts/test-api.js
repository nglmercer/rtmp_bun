import { loadConfig } from "../src/config.js";
import { RestApi } from "../src/api.js";
import { StreamForwarder } from "../src/forwarder.js";

async function startApiOnly() {
  console.log("🚀 Starting API-only server for WebSocket testing...");

  // Load configuration
  const config = await loadConfig();

  // Force port 3008 for testing
  config.server.restApiPort = 3008;

  console.log(`📋 API will start on port ${config.server.restApiPort}`);

  // Initialize stream forwarder (needed by API)
  const forwarder = new StreamForwarder(config);

  // Initialize and start REST API
  const api = new RestApi(config, forwarder);
  await api.start();

  console.log("✅ API server started successfully!");
  console.log(`🌐 REST API available at http://localhost:${config.server.restApiPort}`);
  console.log(`🔗 WebSocket streaming endpoint: ws://localhost:${config.server.restApiPort}/stream/{streamKey}`);
  console.log("💡 Use Ctrl+C to stop the server");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n🛑 Shutting down gracefully...");
    await api.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the process alive
  process.stdin.resume();
}

startApiOnly().catch((error) => {
  console.error("❌ Failed to start API server:", error);
  process.exit(1);
});
