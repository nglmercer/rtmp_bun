import type { AppConfig, StreamTarget } from "./config.js";

export class StreamForwarder {
  private activeTargets: Map<string, any> = new Map();
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async startForwarding(streamKey: string): Promise<void> {
    console.log(`Starting forwarding for stream: ${streamKey}`);

    for (const target of this.config.targets) {
      if (target.enabled && target.key) {
        try {
          await this.connectToTarget(streamKey, target);
        } catch (error) {
          console.error(`Failed to connect to target ${target.id}:`, error);
        }
      }
    }
  }

  private async connectToTarget(
    streamKey: string,
    target: StreamTarget,
  ): Promise<void> {
    console.log(`Connecting to target: ${target.id} at ${target.url}`);

    try {
      // Create TCP connection to target RTMP server
      const socket = Bun.connect({
        hostname: new URL(target.url).hostname,
        port: parseInt(new URL(target.url).port) || 1935,
        socket: {
          data: (socket: any, data: Buffer) => {
            // Handle response from target server if needed
          },
          open: (socket: any) => {
            console.log(`Connected to target ${target.id}`);

            // Send RTMP handshake and publish command
            this.sendRTMPHandshake(socket);
            setTimeout(() => {
              this.sendPublishCommand(socket, streamKey, target.key!);
            }, 500);
          },
          close: (socket: any) => {
            console.log(`Disconnected from target ${target.id}`);
            this.activeTargets.delete(target.id);
          },
          error: (socket: any, error: any) => {
            console.error(`Error on target ${target.id}:`, error);
            this.activeTargets.delete(target.id);
          },
        },
      });

      this.activeTargets.set(target.id, socket);
    } catch (error) {
      console.error(`Failed to create connection to ${target.id}:`, error);
      throw error;
    }
  }

  private sendRTMPHandshake(socket: any): void {
    // Send RTMP handshake (simplified version)
    const handshake = new Uint8Array(1537);
    handshake[0] = 0x03; // RTMP version

    // Fill handshake data
    for (let i = 1; i < 1537; i++) {
      handshake[i] = Math.floor(Math.random() * 256);
    }

    socket.write(handshake);
  }

  private sendPublishCommand(
    socket: any,
    streamKey: string,
    targetKey: string,
  ): void {
    // Send publish command (simplified AMF0 encoding)
    const publishCommand = this.encodeAMF0Command("publish", null, targetKey);
    socket.write(publishCommand);
  }

  private encodeAMF0Command(
    command: string,
    transactionId: number | null,
    ...args: any[]
  ): Uint8Array {
    const buffer: number[] = [];

    // Encode command name
    buffer.push(0x02); // AMF0 string marker
    buffer.push(command.length);
    for (let i = 0; i < command.length; i++) {
      buffer.push(command.charCodeAt(i));
    }

    // Encode transaction ID
    if (transactionId !== null) {
      buffer.push(0x00); // AMF0 number marker
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, transactionId);
      for (let i = 0; i < 8; i++) {
        buffer.push(view.getUint8(i));
      }
    }

    // Encode arguments
    for (const arg of args) {
      if (typeof arg === "string") {
        buffer.push(0x02); // AMF0 string marker
        buffer.push(arg.length);
        for (let i = 0; i < arg.length; i++) {
          buffer.push(arg.charCodeAt(i));
        }
      } else if (typeof arg === "number") {
        buffer.push(0x00); // AMF0 number marker
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, arg);
        for (let i = 0; i < 8; i++) {
          buffer.push(view.getUint8(i));
        }
      } else if (arg === null || arg === undefined) {
        buffer.push(0x05); // AMF0 null marker
      }
    }

    return new Uint8Array(buffer);
  }

  async stopForwarding(streamKey: string): Promise<void> {
    console.log(`Stopping forwarding for stream: ${streamKey}`);

    for (const [targetId, socket] of this.activeTargets) {
      try {
        if (socket && typeof socket.end === "function") {
          socket.end();
        }
      } catch (error) {
        console.error(`Error closing connection to ${targetId}:`, error);
      }
    }

    this.activeTargets.clear();
  }

  async forwardData(data: Buffer): Promise<void> {
    for (const [targetId, socket] of this.activeTargets) {
      try {
        if (socket && typeof socket.write === "function") {
          socket.write(data);
        }
      } catch (error) {
        console.error(`Error forwarding data to ${targetId}:`, error);
        this.activeTargets.delete(targetId);
      }
    }
  }

  getActiveTargets(): string[] {
    return Array.from(this.activeTargets.keys());
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
  }
}
