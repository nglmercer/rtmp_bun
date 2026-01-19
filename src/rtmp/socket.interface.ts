/**
 * Socket interface for RTMP connection
 * Provides abstraction for different socket implementations
 */
export interface RtmpSocket {
  /**
   * Write data to the socket
   * @param data The data to write
   */
  write(data: Buffer): void;

  /**
   * Destroy the socket connection
   */
  destroy(): void;

  /**
   * Check if socket is still connected
   */
  isConnected(): boolean;

  /**
   * Get remote address information
   */
  getRemoteAddress(): string;

  /**
   * Set timeout for socket operations
   * @param timeout Timeout in milliseconds
   */
  setTimeout(timeout: number): void;
}

/**
 * Socket factory interface for creating different types of sockets
 */
export interface RtmpSocketFactory {
  /**
   * Create a new socket instance
   * @param options Socket creation options
   */
  createSocket(options?: any): RtmpSocket;
}

/**
 * Bun WebSocket adapter for RTMP socket interface
 */
export class BunWebSocketAdapter implements RtmpSocket {
  private socket: any;

  constructor(socket: any) {
    this.socket = socket;
  }

  write(data: Buffer): void {
    this.socket.write(data);
  }

  destroy(): void {
    this.socket.destroy();
  }

  isConnected(): boolean {
    return this.socket && !this.socket.destroyed;
  }

  getRemoteAddress(): string {
    return this.socket.remoteAddress || 'unknown';
  }

  setTimeout(timeout: number): void {
    this.socket.setTimeout(timeout);
  }
}

/**
 * Node.js net.Socket adapter for RTMP socket interface
 */
export class NodeNetSocketAdapter implements RtmpSocket {
  private socket: any;

  constructor(socket: any) {
    this.socket = socket;
  }

  write(data: Buffer): void {
    this.socket.write(data);
  }

  destroy(): void {
    this.socket.destroy();
  }

  isConnected(): boolean {
    return this.socket && !this.socket.destroyed;
  }

  getRemoteAddress(): string {
    return this.socket.remoteAddress || 'unknown';
  }

  setTimeout(timeout: number): void {
    this.socket.setTimeout(timeout);
  }
}

/**
 * Generic socket adapter that can work with various socket types
 */
export class GenericSocketAdapter implements RtmpSocket {
  private socket: any;

  constructor(socket: any) {
    this.socket = socket;
  }

  write(data: Buffer): void {
    if (this.socket && typeof this.socket.write === 'function') {
      this.socket.write(data);
    }
  }

  destroy(): void {
    if (this.socket && typeof this.socket.destroy === 'function') {
      this.socket.destroy();
    } else if (this.socket && typeof this.socket.end === 'function') {
      this.socket.end();
    }
  }

  isConnected(): boolean {
    return this.socket && !this.socket.destroyed && !this.socket.closed;
  }

  getRemoteAddress(): string {
    return this.socket?.remoteAddress || this.socket?.remoteAddress || 'unknown';
  }

  setTimeout(timeout: number): void {
    if (this.socket && typeof this.socket.setTimeout === 'function') {
      this.socket.setTimeout(timeout);
    }
  }
}
