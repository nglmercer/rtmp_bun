import { type as arktype } from "arktype";

// RTMP Handshake constants and types
export const RTMP_VERSION = 0x03;
export const RTMP_CLIENT_DIGEST_OFFSET = 1536;
export const RTMP_SERVER_DIGEST_OFFSET = 1792;
export const RTMP_HANDSHAKE_SIZE = 1536;

export type HandshakeState =
  | "idle"
  | "c0_received"
  | "c1_received"
  | "c2_received"
  | "completed";

export interface HandshakePacket {
  version: number;
  timestamp: number;
  payload: Buffer;
  digest?: Buffer;
  randomBytes: Buffer;
}

export interface HandshakeContext {
  state: HandshakeState;
  clientTimestamp: number;
  serverTimestamp: number;
  challenge: Buffer;
  response: Buffer;
  publicKey?: Buffer;
  privateKey?: Buffer;
}

export interface HandshakeResult {
  success: boolean;
  error?: string;
  context?: HandshakeContext;
  handshakeBytes?: number;
}

// Key generation for simplified RTMP handshake
export function generateSharedSecret(): {
  privateKey: Buffer;
  publicKey: Buffer;
} {
  // Simplified shared secret generation for testing
  // In production, this should use proper Diffie-Hellman or the specific RTMP key exchange
  const privateKey = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    privateKey[i] = Math.floor(Math.random() * 256);
  }

  const publicKey = Buffer.alloc(32);
  // Simple XOR-based "encryption" for testing purposes
  for (let i = 0; i < 32; i++) {
    publicKey[i] = privateKey[i] ^ 0x55;
  }

  return { privateKey, publicKey };
}

// Create a digest from a buffer
export function createDigest(data: Buffer): Buffer {
  // Simple hash for testing - in production, use SHA-256
  // For RTMP, the digest is typically partial SHA-256 at a specific offset
  const hash = new Uint32Array([0x73616261]); // "saba" in hex for simple testing

  // XOR each byte into the hash
  for (let i = 0; i < data.length; i++) {
    hash[0] = (hash[0] ^ data[i]) >>> 0;
    hash[0] = (hash[0] * 0x1000193) >>> 0; // FNV-like multiplication
  }

  return Buffer.from([(hash[0] >>> 0) % 256]);
}

// RTMP handshake packet builder
export class RtmpHandshake {
  private state: HandshakeState = "idle";
  private context: HandshakeContext;
  private sequence: Buffer[] = [];

  constructor(useSharedSecret: boolean = false) {
    const { privateKey, publicKey } = useSharedSecret
      ? generateSharedSecret()
      : { privateKey: Buffer.alloc(32), publicKey: Buffer.alloc(32) };

    this.context = {
      state: "idle",
      clientTimestamp: 0,
      serverTimestamp: Date.now(),
      challenge: Buffer.alloc(0),
      response: Buffer.alloc(0),
      privateKey,
      publicKey,
    };
  }

  // Generate C0 (version)
  generateC0(): Buffer {
    const buffer = Buffer.alloc(1);
    buffer[0] = RTMP_VERSION;
    this.state = "c0_received";
    this.context.state = "c0_received";
    console.log("[RTMP Handshake] Generated C0: version", RTMP_VERSION);
    return buffer;
  }

  // Generate C1 (timestamp + random bytes)
  generateC1(): Buffer {
    const buffer = Buffer.alloc(RTMP_HANDSHAKE_SIZE);

    // Timestamp (4 bytes) - convert to unsigned 32-bit correctly
    const timestamp = Date.now() % 0x100000000;
    buffer.writeUInt32BE(Math.floor(timestamp), 0);

    // Reserved (4 bytes) - should be 0
    buffer.writeUInt32BE(0, 4);

    // Random data (1528 bytes)
    const randomData = Buffer.alloc(1528);
    for (let i = 0; i < randomData.length; i++) {
      randomData[i] = Math.floor(Math.random() * 256);
    }

    randomData.copy(buffer, 8);

    // Create digest at last byte (position 1535 for 1536-byte buffer)
    const digest = createDigest(buffer.subarray(0, 1535));
    digest.copy(buffer, 1535);

    this.context.clientTimestamp = timestamp;
    this.sequence.push(buffer);
    this.context.state = "c1_received";
    this.state = "c1_received";

    console.log("[RTMP Handshake] Generated C1 with timestamp:", timestamp);
    return buffer;
  }

  // Generate C2 (echo of server's S1)
  generateC2(serverS1: Buffer): Buffer {
    if (!serverS1 || serverS1.length < RTMP_HANDSHAKE_SIZE) {
      throw new Error("Invalid server S1 packet");
    }

    const buffer = Buffer.alloc(RTMP_HANDSHAKE_SIZE);

    // Copy server's timestamp to echo position (4-7)
    const serverTimestamp = serverS1.readUInt32BE(0);
    buffer.writeUInt32BE(serverTimestamp, 4);

    // Copy echoed data from server S1 starting at position 4
    const echoData = serverS1.subarray(4, RTMP_HANDSHAKE_SIZE);
    echoData.copy(buffer, 8);

    // Generate response digest from buffer (positions 0-1534)
    const dataToDigest = buffer.subarray(0, 1535);
    const Digest = createDigest(dataToDigest);
    Digest.copy(buffer, 1535);

    this.context.state = "completed";
    this.state = "completed";
    this.sequence.push(buffer);

    console.log("[RTMP Handshake] Generated C2 (response to server S1)");
    return buffer;
  }

  // Process server response (S0 + S1 + S2)
  processServerResponse(data: Buffer): HandshakeResult {
    if (!data || data.length < RTMP_HANDSHAKE_SIZE) {
      return {
        success: false,
        error: "Invalid server response length",
      };
    }

    const s0 = data[0];
    if (s0 !== RTMP_VERSION) {
      return {
        success: false,
        error: `Invalid server version: ${s0}, expected ${RTMP_VERSION}`,
      };
    }

    // Extract S1 and S2
    const s1 = data.subarray(1, RTMP_HANDSHAKE_SIZE + 1);
    const s2 = data.subarray(
      RTMP_HANDSHAKE_SIZE + 1,
      RTMP_HANDSHAKE_SIZE * 2 + 1,
    );

    console.log("[RTMP Handshake] Received S0, S1, and S2 from server");

    // Validate digests
    if (!this.validateDigest(s1)) {
      return {
        success: false,
        error: "S1 digest validation failed",
      };
    }

    if (!this.validateDigest(s2)) {
      return {
        success: false,
        error: "S2 digest validation failed",
      };
    }

    this.context.state = "completed";
    this.state = "completed";

    return {
      success: true,
      context: this.context,
      handshakeBytes: data.length,
    };
  }

  // Generate complete client handshake (C0+C1+C2 if server provides S1)
  generateClientHandshake(serverS1?: Buffer): Buffer {
    if (this.state === "idle") {
      const c0 = this.generateC0();
      const c1 = this.generateC1();

      // Combine C0 + C1
      const combined = Buffer.concat([c0, c1]);

      if (serverS1 && this.state !== "completed") {
        // We have server's S1, so generate C2
        // generateC2 sets state to "completed"
        const c2 = this.generateC2(serverS1);
        return Buffer.concat([combined, c2]);
      }

      return combined;
    }

    if (this.state === "c0_received" && !serverS1) {
      return this.generateC1();
    }

    if (this.state === "c0_received" && serverS1) {
      return this.generateC2(serverS1);
    }

    throw new Error(`Cannot generate handshake in state: ${this.state}`);
  }

  // Validate digest from RTMP packet
  private validateDigest(packet: Buffer): boolean {
    if (packet.length < RTMP_HANDSHAKE_SIZE) {
      return false;
    }

    // This is a simplified validation for testing
    // In production, RTMP uses specific key exchange and SHA-256 HMAC
    const digest = packet.slice(-1);
    const dataWithoutDigest = packet.subarray(0, packet.length - 1);
    const computedDigest = createDigest(dataWithoutDigest);

    return Buffer.compare(digest, computedDigest) === 0;
  }

  public getContext(): HandshakeContext {
    return { ...this.context };
  }

  public getState(): HandshakeState {
    return this.state;
  }

  public reset(): void {
    this.state = "idle";
    this.sequence = [];
    this.context.state = "idle";
    this.context.challenge = Buffer.alloc(0);
    this.context.response = Buffer.alloc(0);
  }
}

// Handshake response builder for servers
export class RtmpServerHandshake {
  private context: HandshakeContext;

  constructor() {
    this.context = {
      state: "idle",
      clientTimestamp: 0,
      serverTimestamp: Date.now(),
      challenge: Buffer.alloc(0),
      response: Buffer.alloc(0),
      privateKey: Buffer.alloc(32),
      publicKey: Buffer.alloc(32),
    };
  }

  // Process client C0 + C1, generate S0 + S1 + S2
  generateServerResponse(clientC0C1: Buffer): Buffer {
    if (clientC0C1.length < RTMP_HANDSHAKE_SIZE + 1) {
      throw new Error("Invalid client handshake packet");
    }

    const c0 = clientC0C1[0];
    if (c0 !== RTMP_VERSION) {
      throw new Error(`Invalid client version: ${c0}`);
    }

    const c1 = clientC0C1.subarray(1, RTMP_HANDSHAKE_SIZE + 1);

    // Validate client digest
    if (!this.validateDigest(c1)) {
      console.log(
        "[RTMP Handshake] Warning: Client C1 digest validation failed",
      );
      // Continue anyway for testing
    }

    // Extract client timestamp
    this.context.clientTimestamp = c1.readUInt32BE(0);

    // Generate S0 (version)
    const s0 = Buffer.from([RTMP_VERSION]);

    // Generate S1 (timestamp + random bytes + digest)
    const s1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
    const serverTimestamp = Date.now() % 0x100000000;
    s1.writeUInt32BE(Math.floor(serverTimestamp), 0);
    s1.writeUInt32BE(0, 4); // Reserved

    const randomData = Buffer.alloc(1528);
    for (let i = 0; i < randomData.length; i++) {
      randomData[i] = Math.floor(Math.random() * 256);
    }
    randomData.copy(s1, 8);

    const digest = createDigest(s1.subarray(0, 1535));
    digest.copy(s1, 1535);

    // Generate S2 (echo of C1 with server's timestamp)
    const s2 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
    // Copy C2 timestamp + data (positions 4-1535 of c1)
    const echoData = c1.subarray(4, RTMP_HANDSHAKE_SIZE);
    echoData.copy(s2, 4);

    // Generate response digest from echoed data (positions 4-1534)
    const dataToDigest = s2.subarray(0, 1535);
    const digest2 = createDigest(dataToDigest);
    digest2.copy(s2, 1535);

    console.log("[RTMP Handshake] Generated S0, S1, S2 for server response");

    this.context.state = "completed";
    this.context.serverTimestamp = serverTimestamp;

    // Combine S0 + S1 + S2
    return Buffer.concat([s0, s1, s2]);
  }

  private validateDigest(packet: Buffer): boolean {
    if (packet.length < RTMP_HANDSHAKE_SIZE) {
      return false;
    }

    const digest = packet.slice(-1);
    const dataWithoutDigest = packet.subarray(0, packet.length - 1);
    const computedDigest = createDigest(dataWithoutDigest);

    return Buffer.compare(digest, computedDigest) === 0;
  }

  public getContext(): HandshakeContext {
    return { ...this.context };
  }
}

// Helper function to detect if data contains RTMP handshake
export function isRtmpHandshake(data: Buffer): boolean {
  if (data.length === 0) return false;

  // Check if first byte is RTMP version
  return data[0] === RTMP_VERSION;
}

// Async handshake simulation for testing
export async function performHandshakeSimulation(
  client: RtmpHandshake,
  server: RtmpServerHandshake,
  timeoutMs: number = 5000,
): Promise<HandshakeResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Handshake timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      // Client sends C0+C1
      const c0c1 = client.generateClientHandshake();

      // Server generates response (S0+S1+S2)
      const s0s1s2 = server.generateServerResponse(c0c1);

      // Client processes server's response and generates C2
      const c2 = client.generateC2(s0s1s2.subarray(1, RTMP_HANDSHAKE_SIZE + 1));

      // Final client handshake (optional, for verification)
      const final = Buffer.concat([c0c1, c2]);

      clearTimeout(timeout);

      resolve({
        success: true,
        context: client.getContext(),
        handshakeBytes: final.length,
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

// Type guards for validation
export const isHandshakeResult = (obj: unknown): obj is HandshakeResult => {
  if (typeof obj !== "object" || obj === null) return false;

  const result = obj as any;

  return (
    typeof result.success === "boolean" &&
    (result.error === undefined || typeof result.error === "string") &&
    (result.handshakeBytes === undefined ||
      typeof result.handshakeBytes === "number")
  );
};

export const isHandshakeContext = (obj: unknown): obj is HandshakeContext => {
  if (typeof obj !== "object" || obj === null) return false;

  const ctx = obj as any;
  const validStates: HandshakeState[] = [
    "idle",
    "c0_received",
    "c1_received",
    "c2_received",
    "completed",
  ];

  return (
    typeof ctx.state === "string" &&
    validStates.includes(ctx.state as HandshakeState) &&
    typeof ctx.clientTimestamp === "number" &&
    typeof ctx.serverTimestamp === "number" &&
    Buffer.isBuffer(ctx.challenge) &&
    Buffer.isBuffer(ctx.response) &&
    (ctx.privateKey === undefined || Buffer.isBuffer(ctx.privateKey)) &&
    (ctx.publicKey === undefined || Buffer.isBuffer(ctx.publicKey))
  );
};

// Default export for convenience
export default {
  RtmpHandshake,
  RtmpServerHandshake,
  generateSharedSecret,
  createDigest,
  isRtmpHandshake,
  performHandshakeSimulation,
  RTMP_VERSION,
  RTMP_HANDSHAKE_SIZE,
};
