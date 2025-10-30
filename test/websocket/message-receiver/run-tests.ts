#!/usr/bin/env bun

import { spawn } from "bun";

async function runMessageReceiverTests() {
  console.log("🧪 Running WebSocket Message Receiver Tests...\n");

  try {
    // Run message receiver tests
    const testProcess = spawn({
      cmd: ["bun", "test", "test/websocket/message-receiver"],
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await testProcess.exited;

    if (exitCode === 0) {
      console.log("\n✅ All message receiver tests passed!");
    } else {
      console.log(`\n❌ Message receiver tests failed with exit code: ${exitCode}`);
      process.exit(exitCode);
    }
  } catch (error) {
    console.error("❌ Error running message receiver tests:", error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.main) {
  runMessageReceiverTests();
}

export { runMessageReceiverTests };
```

Ahora también voy a crear un test de diagnóstico para identificar exactamente dónde está el problema:

```typescript
#!/usr/bin/env bun

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { RestApi } from "../../../src/api";
import { AppConfig } from "../../../src/config";
import { StreamForwarder } from "../../../src/forwarder";
import WebSocket from "ws";

describe("WebSocket Diagnosis Test", () => {
  let api: RestApi;
  let forwarder: StreamForwarder;
  const testConfig: AppConfig = {
    server: {
      port: 1935,
      host: "0.0.0.0",
      chunkSize: 4096,
      windowAckSize: 2500000,
      peerBandwidth: 2500000,
      logLevel: "debug", // Enable debug logging
      logFile: "./logs/test-diagnosis.log",
      enableRestApi: true,
      restApiPort: 3009, // Use different port for testing
    },
    targets: [],
  };

  beforeAll(async () => {
    console.log("🚀 Setting up WebSocket diagnosis environment...");

    forwarder = new StreamForwarder(testConfig);
    api = new RestApi(testConfig, forwarder);

    await api.start();

    // Wait for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 300));

    console.log("✅ WebSocket diagnosis environment ready");
  });

  afterAll(async () => {
    console.log("🧹 Cleaning up WebSocket diagnosis environment...");
    await api.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("✅ Cleanup complete");
  });

  it("should diagnose WebSocket connection step by step", async () => {
    console.log("🔍 Starting detailed WebSocket diagnosis...");

    const streamKey = "diagnosis-test";
    const wsUrl = `ws://localhost:${testConfig.server.restApiPort}/stream/${streamKey}`;

    console.log(`📡 Attempting to connect to: ${wsUrl}`);

    const diagnosisSteps = {
      connectionAttempted: false,
      connectionOpened: false,
      clientRegistered: false,
      messageSent: false,
      messageReceived: false,
      errorOccurred: false,
      errorMessage: ""
    };

    const ws = new WebSocket(wsUrl);

    // Step 1: Connection attempt
    diagnosisSteps.connectionAttempted = true;
    console.log("✅ Step 1: WebSocket connection initiated");

    // Step 2: Wait for connection to open
    const connectionPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        diagnosisSteps.errorOccurred = true;
        diagnosisSteps.errorMessage = "Connection timeout";
        reject(new Error("Connection timeout"));
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        diagnosisSteps.connectionOpened = true;
        console.log("✅ Step 2: WebSocket connection opened successfully");

        // Give a moment for the server to register the client
        setTimeout(resolve, 100);
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        diagnosisSteps.errorOccurred = true;
        diagnosisSteps.errorMessage = error.message;
        console.error("❌ Step 2: WebSocket connection error:", error);
        reject(error);
      });
    });

    try {
      await connectionPromise;
    } catch (error) {
      console.log("🔍 Diagnosis result so far:", diagnosisSteps);
      throw error;
    }

    // Step 3: Check if client is registered in API
    await new Promise(resolve => setTimeout(resolve, 200)); // Wait for registration

    const statusResponse = await fetch(`http://localhost:${testConfig.server.restApiPort}/api/status`);
    const status = await statusResponse.json();

    console.log("📊 API Status:", JSON.stringify(status.websocket, null, 2));

    if (status.websocket.totalClients > 0) {
      diagnosisSteps.clientRegistered = true;
      console.log("✅ Step 3: Client registered in API status");
    } else {
      console.log("❌ Step 3: Client not found in API status");
    }

    // Step 4: Send test message via broadcastToStream
    console.log("📡 Step 4: Sending test message via broadcastToStream...");

    const testMessage = JSON.stringify({
      type: "diagnosis-test",
      message: "Hello from diagnosis test",
      timestamp: new Date().toISOString(),
      step: 4
    });

    try {
      api.broadcastToStream(streamKey, testMessage);
      diagnosisSteps.messageSent = true;
      console.log("✅ Step 4: Message sent via broadcastToStream");
    } catch (error) {
      diagnosisSteps.errorOccurred = true;
      diagnosisSteps.errorMessage = `broadcastToStream error: ${error.message}`;
      console.error("❌ Step 4: Error sending message via broadcastToStream:", error);
    }

    // Step 5: Wait for message reception
    console.log("📡 Step 5: Waiting for message reception...");

    const messagePromise = new Promise<{ received: boolean; content?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        console.log("⏰ Step 5: Message reception timeout");
        resolve({ received: false });
      }, 3000);

      ws.on('message', (data) => {
        clearTimeout(timeout);
        diagnosisSteps.messageReceived = true;
        const content = data.toString();
        console.log("✅ Step 5: Message received!");
        console.log("📨 Message content:", content);
        resolve({ received: true, content });
      });

      // If the message was already sent before this listener was attached,
      // we might miss it, so send another one after a short delay
      setTimeout(() => {
        if (!diagnosisSteps.messageReceived && diagnosisSteps.messageSent) {
          console.log("📡 Step 5b: Sending second test message...");
          const secondMessage = JSON.stringify({
            type: "diagnosis-test-second",
            message: "Second attempt",
            timestamp: new Date().toISOString(),
            step: "5b"
          });
          api.broadcastToStream(streamKey, secondMessage);
        }
      }, 500);
    });

    const messageResult = await messagePromise;

    // Close the WebSocket
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }

    // Final diagnosis
    console.log("\n🔍 FINAL DIAGNOSIS:");
    console.log("📋 Connection Attempted:", diagnosisSteps.connectionAttempted);
    console.log("📋 Connection Opened:", diagnosisSteps.connectionOpened);
    console.log("📋 Client Registered:", diagnosisSteps.clientRegistered);
    console.log("📋 Message Sent:", diagnosisSteps.messageSent);
    console.log("📋 Message Received:", diagnosisSteps.messageReceived);
    if (diagnosisSteps.errorOccurred) {
      console.log("❌ Error:", diagnosisSteps.errorMessage);
    }

    // Assert the critical steps
    expect(diagnosisSteps.connectionAttempted).toBe(true);
    expect(diagnosisSteps.connectionOpened).toBe(true);
    expect(diagnosisSteps.messageSent).toBe(true);

    if (!diagnosisSteps.messageReceived) {
      console.log("\n🚨 ISSUE IDENTIFIED:");
      console.log("The WebSocket connection is established and messages are being sent,");
      console.log("but the client is not receiving them. This could indicate:");
      console.log("1. A timing issue with message handlers");
      console.log("2. The broadcastToStream method is not actually sending to the WebSocket");
      console.log("3. The client is not properly subscribed to the stream");

      // Log additional debugging info
      console.log("\n🔍 ADDITIONAL DEBUG INFO:");
      console.log("Stream Key:", streamKey);
      console.log("WebSocket URL:", wsUrl);
      console.log("WebSocket readyState at end:", ws.readyState);
    }

    expect(diagnosisSteps.messageReceived).toBe(true);
  });

  it("should test direct WebSocket message sending", async () => {
    console.log("🔍 Testing direct WebSocket server behavior...");

    // Create a simple WebSocket server to compare behavior
    const simpleServer = Bun.serve({
      port: 3010,
      fetch(req, server) {
        if (req.headers.get("upgrade") === "websocket") {
          return server.upgrade(req);
        }
        return new Response("WebSocket server", { status: 200 });
      },
      websocket: {
        open(ws) {
          console.log("✅ Simple server: WebSocket opened");
          ws.send("Direct message from simple server");
        },
        message(ws, message) {
          console.log("📨 Simple server: Received:", message);
          ws.send(`Echo: ${message}`);
        },
        close(ws) {
          console.log("🔌 Simple server: WebSocket closed");
        },
      },
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Test connection to simple server
    const ws = new WebSocket(`ws://localhost:3010/`);

    const messagePromise = new Promise<{ received: boolean; content?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ received: false });
      }, 3000);

      ws.on('message', (data) => {
        clearTimeout(timeout);
        const content = data.toString();
        console.log("📨 Simple server message received:", content);
        resolve({ received: true, content });
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error("❌ Simple server error:", error);
        resolve({ received: false });
      });
    });

    const result = await messagePromise;

    expect(result.received).toBe(true);
    expect(result.content).toContain("Direct message from simple server");

    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }

    simpleServer.stop();

    console.log("✅ Simple WebSocket server test completed successfully");
  });
});
```

## Resumen de los tests creados

He creado tests exhaustivos para diagnosticar y verificar el problema del WebSocket que no emite datos:

### 1. **Test de Recepción de Cualquier Mensaje** (`any-message.test.ts`)
- Prueba conexión básica de WebSocket
- Verifica recepción de mensajes string (JSON)
- Prueba mecanismo ping-pong
- Prueba recepción de mensajes binarios
- Verifica datos FLV (formato de video streaming)
- Prueba chunks de audio y video
- Prueba broadcast a múltiples clientes
- Verifica tracking de conexiones en API status

### 2. **Test de Funcionalidad broadcastToStream** (`broadcast-test.ts`)
- Prueba directa del método `broadcastToStream`
- Verifica envío de mensajes string
- Verifica envío de datos binarios
- Prueba múltiples broadcasts rápidos
- Verifica handling de streams no existentes
- Confirma tracking de clientes en status

### 3. **Test de Diagnóstico Detallado** (`diagnosis.test.ts`)
- Diagnóstico paso a paso del problema
- Verifica cada etapa del proceso de comunicación
- Compara con servidor WebSocket simple
- Identifica exactamente dónde falla el proceso

### 4. **Script para ejecutar tests** (`run-tests.ts`)
- Script para ejecutar todos los tests de message receiver

## Cómo ejecutar los tests:

```bash
# Ejecutar todos los nuevos tests de message receiver
bun test/websocket/message-receiver/run-tests.ts

# O ejecutar un test específico
bun test test/websocket/message-receiver/any-message.test.ts
bun test test/websocket/message-receiver/broadcast-test.ts
bun test test/websocket/message-receiver/diagnosis.test.ts
```

## Posibles problemas identificados:

1. **Timing**: Los mensajes podrían enviarse antes de que el cliente esté completamente suscrito
2. **Método broadcastToStream**: Podría no estar llamando correctamente al método `send()` de WebSocket
3. **Registro de clientes**: Los clientes podrían no estar registrándose correctamente en `streamClients`
4. **WebSocket readyState**: El WebSocket podría no estar en estado `OPEN` cuando se intenta enviar

Estos tests te ayudarán a identificar exactamente dónde está el problema y si el WebSocket está recibiendo cualquier tipo de mensaje.
