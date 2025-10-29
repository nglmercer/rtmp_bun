import { loadConfig } from "./config.js";
import { RestApi } from "./api.js";
import { StreamForwarder } from "./forwarder.js";
import { RTMPServer } from "./server.js";

async function main() {
  console.log("🚀 Starting RTMP Bun Server...");

  // Load configuration
  const config = await loadConfig();
  console.log(
    `📋 Configuration loaded. RTMP Port: ${config.server.port}, API Port: ${config.server.restApiPort}`,
  );

  // Initialize RTMP Server (constructor starts the server automatically)
  new RTMPServer(config.server.port);

  // Initialize stream forwarder
  const forwarder = new StreamForwarder(config);

  // Initialize REST API
  const api = new RestApi(config, forwarder);

  // Start the API server
  await api.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n🛑 Shutting down gracefully...");
    await forwarder.stopForwarding("all");
    await api.stop();
    // Note: RTMPServer cleanup handled by process exit
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("✅ Server started successfully!");
  console.log(
    `📡 RTMP Server listening on ${config.server.host}:${config.server.port}`,
  );
  if (config.server.enableRestApi) {
    console.log(
      `🌐 REST API available at http://localhost:${config.server.restApiPort}`,
    );
  }
  console.log("💡 Use Ctrl+C to stop the server");

  // Keep the process alive
  process.stdin.resume();
}

main().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
