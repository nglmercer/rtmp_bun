#!/usr/bin/env bun

import { spawn } from "bun";

async function runWebSocketTests() {
  console.log("🧪 Running WebSocket Tests...\n");

  try {
    // Run WebSocket specific tests
    const testProcess = spawn({
      cmd: ["bun", "test", "test/websocket"],
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await testProcess.exited;

    if (exitCode === 0) {
      console.log("\n✅ All WebSocket tests passed!");
    } else {
      console.log(`\n❌ WebSocket tests failed with exit code: ${exitCode}`);
      process.exit(exitCode);
    }
  } catch (error) {
    console.error("❌ Error running WebSocket tests:", error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.main) {
  runWebSocketTests();
}

export { runWebSocketTests };
