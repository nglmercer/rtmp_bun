import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  RtmpHandshake,
  RtmpServerHandshake,
  generateSharedSecret,
  createDigest,
  isRtmpHandshake,
  performHandshakeSimulation,
  RTMP_VERSION,
  RTMP_HANDSHAKE_SIZE,
  type HandshakeResult,
  type HandshakeContext,
} from "../src/handshake/index";
import { Buffer } from "buffer";

describe("RTMP Handshake Module", () => {
  describe("generateSharedSecret", () => {
    it("should generate valid private and public keys", () => {
      const result = generateSharedSecret();

      expect(result).toHaveProperty("privateKey");
      expect(result).toHaveProperty("publicKey");
      expect(Buffer.isBuffer(result.privateKey)).toBe(true);
      expect(Buffer.isBuffer(result.publicKey)).toBe(true);
      expect(result.privateKey.length).toBe(32);
      expect(result.publicKey.length).toBe(32);
    });

    it("should generate different keys each time", () => {
      const result1 = generateSharedSecret();
      const result2 = generateSharedSecret();

      expect(result1.privateKey.equals(result2.privateKey)).toBe(false);
      expect(result1.publicKey.equals(result2.publicKey)).toBe(false);
    });

    it("should create correct public key from private key", () => {
      const { privateKey, publicKey } = generateSharedSecret();

      // Verify public key is derived from private key (XOR with 0x55)
      for (let i = 0; i < 32; i++) {
        expect(publicKey[i]).toBe(privateKey[i] ^ 0x55);
      }
    });
  });

  describe("createDigest", () => {
    it("should create a digest from empty buffer", () => {
      const digest = createDigest(Buffer.alloc(0));

      expect(digest).toBeDefined();
      expect(Buffer.isBuffer(digest)).toBe(true);
      expect(digest.length).toBeGreaterThan(0);
    });

    it("should create consistent digest from same data", () => {
      const data = Buffer.from([1, 2, 3, 4, 5]);
      const digest1 = createDigest(data);
      const digest2 = createDigest(data);

      expect(digest1.equals(digest2)).toBe(true);
    });

    it("should create different digests from different data", () => {
      const data1 = Buffer.from([1, 2, 3, 4, 5]);
      const data2 = Buffer.from([1, 2, 3, 4, 6]);
      const digest1 = createDigest(data1);
      const digest2 = createDigest(data2);

      expect(digest1.equals(digest2)).toBe(false);
    });

    it("should handle large data buffers", () => {
      const largeData = Buffer.alloc(1528);
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256;
      }

      const digest = createDigest(largeData);
      expect(digest).toBeDefined();
      expect(Buffer.isBuffer(digest)).toBe(true);
    });
  });

  describe("RtmpHandshake Class", () => {
    let clientHandshake: RtmpHandshake;

    beforeEach(() => {
      clientHandshake = new RtmpHandshake();
    });

    afterEach(() => {
      clientHandshake.reset();
    });

    describe("generateC0", () => {
      it("should generate C0 packet with correct version", () => {
        const c0 = clientHandshake.generateC0();

        expect(c0.length).toBe(1);
        expect(c0[0]).toBe(RTMP_VERSION);
      });

      it("should update handshake state after generating C0", () => {
        clientHandshake.generateC0();

        expect(clientHandshake.getState()).toBe("c0_received");
      });

      it("should generate the same C0 packet for same instance", () => {
        const c0_1 = clientHandshake.generateC0();
        clientHandshake.reset();
        clientHandshake = new RtmpHandshake();
        const c0_2 = clientHandshake.generateC0();

        expect(c0_1.equals(c0_2)).toBe(true);
      });
    });

    describe("generateC1", () => {
      beforeEach(() => {
        clientHandshake.generateC0();
      });

      it("should generate C1 packet of correct size", () => {
        const c1 = clientHandshake.generateC1();

        expect(c1.length).toBe(RTMP_HANDSHAKE_SIZE);
      });

      it("should include timestamp in first 4 bytes", () => {
        const beforeTime = Date.now();
        const c1 = clientHandshake.generateC1();
        const afterTime = Date.now();

        const timestamp = c1.readUInt32BE(0);
        expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(timestamp).toBeLessThanOrEqual(afterTime);
      });

      it("should have reserved bytes at offset 4-7", () => {
        const c1 = clientHandshake.generateC1();

        const reserved = c1.readUInt32BE(4);
        expect(reserved).toBe(0);
      });

      it("should have random data in payload", () => {
        const c1_1 = clientHandshake.generateC1();
        clientHandshake.reset();
        clientHandshake.generateC0();

        const c1_2 = clientHandshake.generateC1();

        // Random data should be different between two instances
        expect(c1_1.equals(c1_2)).toBe(false);
      });

      it("should update state to after generating C1", () => {
        clientHandshake.generateC1();

        expect(clientHandshake.getState()).toBe("c1_received");
      });
    });

    describe("generateC2", () => {
      it("should throw error with invalid S1", () => {
        const invalidS1 = Buffer.alloc(10);
        expect(() => clientHandshake.generateC2(invalidS1)).toThrow(
          "Invalid server S1 packet",
        );
      });

      it("should generate C2 using server S1", () => {
        // First generate C1
        clientHandshake.generateC0();
        const c1 = clientHandshake.generateC1();

        // Create mock server S1 (same structure as C1)
        const serverS1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
        const timestamp = 1234567890;
        serverS1.writeUInt32BE(timestamp, 0);
        serverS1.writeUInt32BE(0, 4);
        for (let i = 8; i < RTMP_HANDSHAKE_SIZE; i++) {
          serverS1[i] = Math.floor(Math.random() * 256);
        }
        const digest = createDigest(serverS1.subarray(0, 1528));
        digest.copy(serverS1, 1528);

        const c2 = clientHandshake.generateC2(serverS1);

        expect(c2.length).toBe(RTMP_HANDSHAKE_SIZE);
        expect(clientHandshake.getState()).toBe("c2_received");
      });

      it("should echo server timestamp in C2", () => {
        clientHandshake.generateC0();
        clientHandshake.generateC1();

        const serverS1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
        const serverTimestamp = 987654321;
        serverS1.writeUInt32BE(serverTimestamp, 0);
        serverS1.writeUInt32BE(0, 4);
        const digest = createDigest(serverS1.subarray(0, 1528));
        digest.copy(serverS1, 1528);

        const c2 = clientHandshake.generateC2(serverS1);

        const echoedTimestamp = c2.readUInt32BE(4);
        // Should echo server's timestamp
        expect(echoedTimestamp).toBe(serverTimestamp);
      });
    });

    describe("generateClientHandshake", () => {
      it("should generate C0 + C1 when called initially", () => {
        const handshake = clientHandshake.generateClientHandshake();

        expect(handshake.length).toBe(1 + RTMP_HANDSHAKE_SIZE);
        expect(handshake[0]).toBe(RTMP_VERSION);
      });

      it("should generate only C1 when called after C0", () => {
        clientHandshake.generateC0();
        const handshake = clientHandshake.generateClientHandshake();

        expect(handshake.length).toBe(RTMP_HANDSHAKE_SIZE);
      });

      it("should generate complete handshake when serverS1 is provided", () => {
        const serverS1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
        const timestamp = 1234567890;
        serverS1.writeUInt32BE(timestamp, 0);
        serverS1.writeUInt32BE(0, 4);
        const digest = createDigest(serverS1.subarray(0, 1528));
        digest.copy(serverS1, 1528);

        const handshake = clientHandshake.generateClientHandshake(serverS1);

        // Should have C0 + C1 + C2
        expect(handshake.length).toBe(
          1 + RTMP_HANDSHAKE_SIZE + RTMP_HANDSHAKE_SIZE,
        );
      });

      it("should throw error when client already completed", () => {
        const serverS1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
        serverS1.writeUInt32BE(1234567890, 0);
        serverS1.writeUInt32BE(0, 4);
        const digest = createDigest(serverS1.subarray(0, 1528));
        digest.copy(serverS1, 1528);

        clientHandshake.generateClientHandshake(serverS1);

        expect(() => clientHandshake.generateClientHandshake(serverS1)).toThrow(
          "Cannot generate handshake in state: completed",
        );
      });
    });

    describe("validateDigest", () => {
      it("should validate correctly formatted packet", () => {
        const serverS1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
        serverS1.writeUInt32BE(1234567890, 0);
        serverS1.writeUInt32BE(0, 4);
        const digest = createDigest(serverS1.subarray(0, 1528));
        digest.copy(serverS1, 1528);

        // This is simplified validation for testing
        const result = (clientHandshake as any)["validateDigest"](serverS1);
        expect(result).toBe(true);
      });

      it("should reject packet without proper digest", () => {
        const invalidPacket = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
        for (let i = 0; i < invalidPacket.length; i++) {
          invalidPacket[i] = Math.floor(Math.random() * 256);
        }

        const result = (clientHandshake as any)["validateDigest"](
          invalidPacket,
        );
        expect(result).toBe(false);
      });

      it("should reject packets shorter than handshake size", () => {
        const shortPacket = Buffer.alloc(100);
        const result = (clientHandshake as any)["validateDigest"](shortPacket);
        expect(result).toBe(false);
      });
    });

    describe("processServerResponse", () => {
      it("should reject insufficient data", () => {
        clientHandshake.generateC0();
        clientHandshake.generateC1();
        const result = clientHandshake.processServerResponse(Buffer.alloc(10));

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid server response length");
      });

      it("should reject incorrect server version", () => {
        clientHandshake.generateC0();
        clientHandshake.generateC1();
        clientHandshake.generateC0();
        clientHandshake.generateC1();
        const serverResponse = Buffer.alloc(RTMP_HANDSHAKE_SIZE * 2 + 1);
        serverResponse[0] = 0x02; // Wrong version
        const result = clientHandshake.processServerResponse(serverResponse);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid server version");
      });

      it("should accept valid server response", () => {
        clientHandshake.generateC0();
        clientHandshake.generateC1();

        // Build server response: S0 + S1 + S2
        const s0 = Buffer.from([RTMP_VERSION]);
        const s1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
        s1.writeUInt32BE(1234567890, 0);
        s1.writeUInt32BE(0, 4);
        const digest = createDigest(s1.subarray(0, 1528));
        digest.copy(s1, 1528);

        const s2 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
        s2.writeUInt32BE(0, 4); // Random timestamp
        const s2Data = s1.subarray(4, RTMP_HANDSHAKE_SIZE);
        s2Data.copy(s2, 8);
        const s2Digest = createDigest(s2Data);
        s2Digest.copy(s2, RTMP_HANDSHAKE_SIZE - 1);

        const serverResponse = Buffer.concat([s0, s1, s2]);
        clientHandshake.generateC0();
        clientHandshake.generateC1();
        const result = clientHandshake.processServerResponse(serverResponse);

        expect(result.success).toBe(true);
        expect(result.context).toBeDefined();
      });
    });

    describe("getContext", () => {
      it("should return deep copy of context", () => {
        const context1 = clientHandshake.getContext();
        const context2 = clientHandshake.getContext();

        // Deep copy check - different instances
        expect(context1).not.toBe(context2);
        expect(context1.state).toBe(context2.state);
      });

      it("should return current context state", () => {
        clientHandshake.generateC0();
        const context = clientHandshake.getContext();

        expect(context.state).toBe("c0_received");
      });
    });

    describe("reset", () => {
      it("should reset handshake to idle state", () => {
        clientHandshake.generateC0();
        clientHandshake.generateC1();

        clientHandshake.reset();

        expect(clientHandshake.getState()).toBe("idle");
      });

      it("should clear handshake sequence", () => {
        clientHandshake.generateC0();
        clientHandshake.generateC1();

        clientHandshake.reset();

        // Should be able to start a new handshake
        expect(() => clientHandshake.generateC0()).not.toThrow();
      });
    });
  });

  describe("RtmpServerHandshake Class", () => {
    let serverHandshake: RtmpServerHandshake;
    let clientHandshake: RtmpHandshake;

    beforeEach(() => {
      serverHandshake = new RtmpServerHandshake();
      clientHandshake = new RtmpHandshake(true); // Use shared secret
    });

    describe("generateServerResponse", () => {
      it("should throw error with insufficient client data", () => {
        const clientData = Buffer.alloc(5);
        expect(() =>
          serverHandshake.generateServerResponse(clientData),
        ).toThrow("Invalid client handshake packet");
      });

      it("should throw error with incorrect client version", () => {
        const clientC0C1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE + 1);
        clientC0C1[0] = 0x02; // Wrong version

        expect(() =>
          serverHandshake.generateServerResponse(clientC0C1),
        ).toThrow(/Invalid client version/);
      });

      it("should generate valid S0 + S1 + S2 response", () => {
        // Create valid client C0 + C1
        clientHandshake.generateC0();
        const c1 = clientHandshake.generateC1();
        const clientC0C1 = Buffer.concat([Buffer.from([RTMP_VERSION]), c1]);

        const serverResponse =
          serverHandshake.generateServerResponse(clientC0C1);

        // Should be S0 + S1 + S2
        expect(serverResponse.length).toBe(
          1 + RTMP_HANDSHAKE_SIZE + RTMP_HANDSHAKE_SIZE,
        );
        expect(serverResponse[0]).toBe(RTMP_VERSION);
      });

      it("should extract client timestamp from client C1", () => {
        const clientTimestamp = 987654321;
        const c1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
        c1.writeUInt32BE(clientTimestamp, 0);
        c1.writeUInt32BE(0, 4);
        const digest = createDigest(c1.subarray(0, 1528));
        digest.copy(c1, 1528);

        const clientC0C1 = Buffer.concat([Buffer.from([RTMP_VERSION]), c1]);
        serverHandshake.generateServerResponse(clientC0C1);

        const context = serverHandshake.getContext();
        expect(context.clientTimestamp).toBe(clientTimestamp);
      });
    });

    describe("context management", () => {
      it("should return updated context after handshake", () => {
        clientHandshake.generateC0();
        const c1 = clientHandshake.generateC1();
        const clientC0C1 = Buffer.concat([Buffer.from([RTMP_VERSION]), c1]);

        serverHandshake.generateServerResponse(clientC0C1);

        const context = serverHandshake.getContext();
        expect(context.state).toBe("completed");
        expect(context.serverTimestamp).toBeGreaterThan(0);
      });
    });
  });

  describe("performHandshakeSimulation", () => {
    it("should complete handshake simulation successfully", async () => {
      const clientHandshake = new RtmpHandshake(true);
      const serverHandshake = new RtmpServerHandshake();

      const result = await performHandshakeSimulation(
        clientHandshake,
        serverHandshake,
      );

      expect(result.success).toBe(true);
      expect(result.handshakeBytes).toBeDefined();
    });

    it("should set context in result", async () => {
      const clientHandshake = new RtmpHandshake(true);
      const serverHandshake = new RtmpServerHandshake();

      const result = await performHandshakeSimulation(
        clientHandshake,
        serverHandshake,
      );

      expect(result.context).toBeDefined();
      expect(result.context?.state).toBe("completed");
    });

    it("should complete within reasonable time", async () => {
      const startTime = performance.now();
      const clientHandshake = new RtmpHandshake(true);
      const serverHandshake = new RtmpServerHandshake();

      await performHandshakeSimulation(clientHandshake, serverHandshake);

      const duration = performance.now() - startTime;
      expect(duration).toBeLessThan(100); // Should complete in under 100ms
    });

    it("should timeout with hanging client handshake", async () => {
      const clientHandshake = new RtmpHandshake(true);
      const serverHandshake = new RtmpServerHandshake();

      // Mock the client to never complete
      const originalC1 = clientHandshake.generateC1.bind(clientHandshake);
      clientHandshake.generateC1 = () => {
        throw new Error("Simulated hang");
      };

      const startTime = performance.now();
      try {
        await performHandshakeSimulation(clientHandshake, serverHandshake, 50);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain("timed out");
      }

      const duration = performance.now() - startTime;
      expect(duration).toBeGreaterThanOrEqual(49); // Should timeout around 50ms
    }, 1000);
  });

  describe("isRtmpHandshake", () => {
    it("should return true for RTMP version byte", () => {
      const data = Buffer.from([0x03]);
      expect(isRtmpHandshake(data)).toBe(true);
    });

    it("should return false for non-RTMP version byte", () => {
      const data = Buffer.from([0x02]);
      expect(isRtmpHandshake(data)).toBe(false);
    });

    it("should return false for empty buffer", () => {
      const data = Buffer.alloc(0);
      expect(isRtmpHandshake(data)).toBe(false);
    });

    it("should work with larger buffers starting with RTMP version", () => {
      const data = Buffer.alloc(100);
      data[0] = RTMP_VERSION;
      for (let i = 1; i < data.length; i++) {
        data[i] = i % 256;
      }
      expect(isRtmpHandshake(data)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle rapid state transitions", () => {
      const handshake = new RtmpHandshake();

      // Rapid C0, C1, C2 generation
      handshake.generateC0();
      expect(handshake.getState()).toBe("c0_received");

      handshake.generateC1();
      expect(handshake.getState()).toBe("c1_received");

      const serverS1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
      serverS1.writeUInt32BE(1234567890, 0);
      serverS1.writeUInt32BE(0, 4);
      const digest = createDigest(serverS1.subarray(0, 1528));
      digest.copy(serverS1, 1528);

      handshake.generateC2(serverS1);
      expect(handshake.getState()).toBe("c2_received");
    });

    it("should handle multiple resets", () => {
      const handshake = new RtmpHandshake();

      for (let i = 0; i < 5; i++) {
        handshake.generateC0();
        handshake.generateC1();
        handshake.reset();
        expect(handshake.getState()).toBe("idle");
      }
    });

    it("should handle network buffer fragments", () => {
      const handshake = new RtmpHandshake();

      // Simulate fragmented reception
      const serverS1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
      serverS1.writeUInt32BE(1234567890, 0);
      serverS1.writeUInt32BE(0, 4);
      const digest = createDigest(serverS1.subarray(0, 1528));
      digest.copy(serverS1, 1528);

      // Process in fragments
      handshake.generateC0();
      const c1 = handshake.generateC1();

      // Simulate receiving server response in fragments
      const s0 = Buffer.from([RTMP_VERSION]);
      const s2 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);

      const combined = Buffer.concat([s0, serverS1, s2]);

      // Whole packet works
      const result = handshake.processServerResponse(combined);
      expect(result.success).toBe(true);
    });
  });
});
