import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { serveMemorySegment } from "../src/api/handlers/hls-memory.js";
import { hlsMemoryManager } from "../src/api/hls-memory-manager.js";
import { StreamForwarder } from "../src/forwarder.js";
import type { RequestContext } from "../src/api/types.js";

describe("HLS Memory Handler Integration", () => {
  let mockContext: RequestContext;

  beforeEach(async () => {
    // Iniciar HLS antes de cada test
    await hlsMemoryManager.startHls("test-stream");
    
    // Crear context con instancias reales
    const config = {
      server: {
        port: 1935,
        host: "0.0.0.0",
        chunkSize: 4096,
        windowAckSize: 2500000,
        peerBandwidth: 2500000,
        logLevel: "info",
        logFile: "./logs/rtmp.log",
        enableRestApi: true,
        restApiPort: 3000,
      },
      targets: []
    };
    
    const forwarder = new StreamForwarder(config);
    
    mockContext = {
      config,
      forwarder,
      updateConfig: () => {},
      params: undefined
    };
  });

  afterEach(async () => {
    // Detener HLS después de cada test
    await hlsMemoryManager.stopHls();
  });

  test("debe servir un segmento HLS existente", async () => {
    // Obtener las secuencias disponibles
    const availableSequences = hlsMemoryManager.getAvailableSequences();
    expect(availableSequences.length).toBeGreaterThan(0);
    
    const firstSequence = availableSequences[0];
    const sequenceWithExtension = `${String(firstSequence).padStart(3, '0')}.ts`;
    
    // Crear un mock request y context
    const mockRequest = new Request(`http://localhost:3000/hls-memory/segment-${sequenceWithExtension}`);
    mockContext.params = { sequence: sequenceWithExtension };
    
    // Llamar al handler
    const response = await serveMemorySegment(mockRequest, mockContext);
    
    // Verificar la respuesta
    expect(response).toBeDefined();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp2t');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');
    
    // Verificar el cuerpo de la respuesta
    const responseData = await response.arrayBuffer();
    expect(responseData.byteLength).toBeGreaterThan(0);
  });

  test("debe devolver 404 para un segmento que no existe", async () => {
    // Usar una secuencia que probablemente no exista
    const nonExistentSequence = "999.ts";
    
    const mockRequest = new Request(`http://localhost:3000/hls-memory/segment-${nonExistentSequence}`);
    mockContext.params = { sequence: nonExistentSequence };
    
    const response = await serveMemorySegment(mockRequest, mockContext);
    
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    
    const responseData = await response.json() as any;
    expect(responseData.error).toContain("not found");
  });

  test("debe manejar correctamente parámetros sin extensión", async () => {
    // Obtener las secuencias disponibles
    const availableSequences = hlsMemoryManager.getAvailableSequences();
    expect(availableSequences.length).toBeGreaterThan(0);
    
    const firstSequence = availableSequences[0];
    const sequenceWithoutExtension = String(firstSequence);
    
    const mockRequest = new Request(`http://localhost:3000/hls-memory/segment-${sequenceWithoutExtension}`);
    mockContext.params = { sequence: sequenceWithoutExtension };
    
    const response = await serveMemorySegment(mockRequest, mockContext);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp2t');
  });

  test("debe devolver 404 si no se proporciona parámetro sequence", async () => {
    const mockRequest = new Request("http://localhost:3000/hls-memory/segment-");
    mockContext.params = {};
    
    const response = await serveMemorySegment(mockRequest, mockContext);
    
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    
    const responseData = await response.json() as any;
    expect(responseData.error).toContain("Missing sequence parameter");
  });
});