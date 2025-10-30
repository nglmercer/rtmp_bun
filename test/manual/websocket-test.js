// Manual WebSocket test script
// Usage: bun run test/manual/websocket-test.js

const WebSocket = require("ws");

async function testWebSocketConnection() {
  console.log(
    "🔍 Testing WebSocket connection to ws://localhost:3008/stream/unknown",
  );

  const ws = new WebSocket("ws://localhost:3008/stream/unknown");

  ws.on("open", () => {
    console.log("✅ WebSocket connection established");
    console.log("🔄 Waiting for stream data...");
  });

  ws.on("message", (data) => {
    console.log("📨 Received data:", {
      type: data.constructor.name,
      size: data.length || data.byteLength,
      isBinary:
        data instanceof Buffer ||
        data instanceof ArrayBuffer ||
        data instanceof Uint8Array,
    });

    if (data instanceof Buffer) {
      console.log("📦 Binary data preview:", Array.from(data.slice(0, 20)));
    } else {
      console.log("📝 Text data:", data.toString());
    }
  });

  ws.on("error", (error) => {
    console.error("❌ WebSocket error:", error.message);
  });

  ws.on("close", (code, reason) => {
    console.log("🔌 WebSocket closed:", { code, reason: reason.toString() });
  });

  // Send test data to server to trigger broadcast
  console.log("📡 Sending test stream data to server...");
  try {
    const response = await fetch("http://localhost:3008/api/test-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ streamKey: "unknown" }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log("✅ Test stream sent:", result.message);
    } else {
      console.error("❌ Failed to send test stream:", response.status);
    }
  } catch (error) {
    console.error("❌ Error sending test stream:", error.message);
  }

  // Keep connection open for 10 seconds
  setTimeout(() => {
    console.log("⏱️ Test timeout - closing connection");
    ws.close();
    process.exit(0);
  }, 10000);
}

// Handle process exit
process.on("SIGINT", () => {
  console.log("\n🛑 Test interrupted");
  process.exit(0);
});

testWebSocketConnection().catch(console.error);
