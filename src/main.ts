import { loadConfig } from "./config.js";
import { RestApi } from "./api.js";
import { StreamForwarder } from "./forwarder.js";
import { RTMPServer } from "./server.js";
import { MSEStreaming } from "./mse-streaming.js";

async function main() {
  console.log("🚀 Starting RTMP Bun Server...");

  // Load configuration
  const config = await loadConfig();
  console.log(
    `📋 Configuration loaded. RTMP Port: ${config.server.port}, API Port: ${config.server.restApiPort}`,
  );

  // Initialize stream forwarder
  const forwarder = new StreamForwarder(config);

  // Initialize REST API
  const api = new RestApi(config, forwarder);

  // Initialize MSE Streaming
  const mseStreaming = new MSEStreaming(api);

  // Start the API server
  await api.start();

  // MSE streaming will start automatically when streams are published
  console.log("🎥 MSE Streaming initialized and ready");

  // Initialize RTMP Server (constructor starts the server automatically)
  new RTMPServer(config.server.port, mseStreaming);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n🛑 Shutting down gracefully...");
    await forwarder.stopForwarding("all");
    // Note: MSEStreaming cleanup is handled automatically when streams disconnect
    // No need to call stopStreaming here as it requires a specific streamKey
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
    console.log(
      `🎥 MSE Stream Viewer available at http://localhost:${config.server.restApiPort}/`,
    );
    console.log(
      `🔗 WebSocket streaming endpoint: ws://localhost:${config.server.restApiPort}/stream/live`,
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
