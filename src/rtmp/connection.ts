import { type as arktype } from "arktype";
import { type HandshakeResult } from "../handshake/index";

// RTMP Protocol constants
export const RTMP_MAJOR_VERSION = 3;
export const RTMP_VERSION = 0x03;
export const RTMP_HANDSHAKE_SIZE = 1536;
export const RTMP_CONNECTION_ID_LENGTH = 12;

// Chunk type constants
export enum ChunkType {
  FULL = 0,
  RELATIVE = 1,
  LARGE_ABSOLUTE = 2,
  ABSOLUTE = 3,
}

// Message type constants
export enum MessageType {
  SET_CHUNK_SIZE = 1,
  ABORT = 2,
  ACKNOWLEDGEMENT = 3,
  USER_CONTROL = 4,
  WINDOW_ACKNOWLEDGEMENT_SIZE = 5,
  SET_PEER_BANDWIDTH = 6,
  AUDIO = 8,
  VIDEO = 9,
  COMMAND_AMF0 = 20,
  COMMAND_AMF3 = 17,
  DATA_AMF0 = 18,
  DATA_AMF3 = 15,
  SHARED_OBJECT_AMF0 = 19,
  SHARED_OBJECT_AMF3 = 16,
  AGGREGATE = 22,
}

// Connection states
export enum ConnectionState {
  INIT = "init",
  HANDSHAKE = "handshake",
  READING_HEADER = "reading_header",
  READING_BODY = "reading_body",
  READY = "ready",
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  ERROR = "error",
}

// Media types
export enum MediaStreamType {
  AUDIO = "audio",
  VIDEO = "video",
  DATA = "data",
}

// RTMP Header
export interface RtmpHeader {
  timestamp: number;
  messageLength: number;
  messageTypeId: number;
  messageStreamId: number;
  chunkStreamId: number;
  extendedTimestamp: boolean;
}

// RTMP Packet
export interface RtmpPacket {
  header: RtmpHeader;
  payload: Buffer;
  timestamp: number;
}

// Connection Configuration
export interface ConnectionConfig {
  chunkSize: number;
  windowAckSize: number;
  peerBandwidth: number;
  logLevel: string;
}

// Event Handlers
export interface RtmpEventHandlers {
  onConnect: (client: any) => void;
  onDisconnect: (client: any, reason: string) => void;
  onMessage: (message: RtmpPacket, client: any) => void;
  onHandshakeComplete: (result: HandshakeResult, client: any) => void;
  onStreamPublishStart: (streamName: string, client: any) => void;
  onStreamPublishStop: (streamName: string, client: any) => void;
  onStreamPlayStart: (streamName: string, client: any) => void;
  onStreamPlayStop: (streamName: string, client: any) => void;
  onError: (error: Error, client: any) => void;
}

export class RtmpConnection {
  private socket: any = null;
  private state: ConnectionState = ConnectionState.INIT;
  private config: ConnectionConfig;
  private handlers: RtmpEventHandlers;
  private buffer: Buffer = Buffer.alloc(0);
  private transactionId = 1;
  private currentStreamId = 0;
  private streamId: number | null = null;
  private handshakeBuffer: Buffer = Buffer.alloc(0);

  constructor(config?: ConnectionConfig, handlers?: RtmpEventHandlers) {
    this.config = config || {
      chunkSize: 4096,
      windowAckSize: 2500000,
      peerBandwidth: 2500000,
      logLevel: "info",
    };
    this.handlers = handlers || {
      onConnect: () => {},
      onDisconnect: () => {},
      onMessage: () => {},
      onHandshakeComplete: () => {},
      onStreamPublishStart: () => {},
      onStreamPublishStop: () => {},
      onStreamPlayStart: () => {},
      onStreamPlayStop: () => {},
      onError: () => {},
    };
  }

  public setSocket(socket: any): void {
    this.socket = socket;
  }

  public async handleData(data: Buffer): Promise<void> {
    this.buffer = Buffer.concat([this.buffer, data]);

    try {
      switch (this.state) {
        case ConnectionState.INIT:
        case ConnectionState.HANDSHAKE:
          await this.processHandshake();
          break;
        case ConnectionState.READING_HEADER:
        case ConnectionState.READING_BODY:
        case ConnectionState.READY:
        case ConnectionState.CONNECTED:
          await this.processRTMPPackets();
          break;
        default:
          this.socket?.destroy();
          break;
      }
    } catch (error) {
      this.handlers.onError(error as Error, this);
      this.socket?.destroy();
    }
  }

  private async processHandshake(): Promise<void> {
    if (this.buffer.length < RTMP_HANDSHAKE_SIZE) {
      return;
    }

    // Check if this is RTMP handshake (version byte)
    if (this.buffer[0] !== RTMP_VERSION) {
      this.handlers.onError(new Error("Invalid RTMP version"), this);
      this.socket?.destroy();
      return;
    }

    const { RtmpHandshake, RtmpServerHandshake } =
      await import("../handshake/index");

    if (this.state === ConnectionState.INIT) {
      const serverHandshake = new RtmpServerHandshake();
      const handshakeResult = serverHandshake.generateServerResponse(
        this.buffer,
      );
      this.socket?.write(handshakeResult);

      // Consume handshake bytes
      this.buffer = this.buffer.subarray(
        1 + RTMP_HANDSHAKE_SIZE * 2 + RTMP_HANDSHAKE_SIZE,
      );

      this.state = ConnectionState.READY;
      this.handlers.onHandshakeComplete(
        { success: true, handshakeBytes: handshakeResult.length },
        this,
      );
    }
  }

  private async processRTMPPackets(): Promise<void> {
    while (this.buffer.length > 0) {
      // Try to read chunk header
      if (this.buffer.length < 1) break;

      const basicHeader = this.buffer[0];
      const chunkStreamId = basicHeader & 0x3f;
      const chunkType = (basicHeader >> 6) & 0x03;

      let bytesConsumed = 1;
      let timestampDelta = 0;
      let messageLength = 0;
      let messageTypeId = 0;
      let messageStreamId = 0;
      let timestamp = 0;

      // Parse based on chunk type
      if (chunkType === 0) {
        // Full header
        if (this.buffer.length < 12) break;
        timestamp = this.buffer.readUIntBE(1, 3);
        messageLength = this.buffer.readUIntBE(4, 3);
        messageTypeId = this.buffer.readUInt8(7);
        messageStreamId = this.buffer.readUInt32LE(8);
        bytesConsumed = 12;

        // Extended timestamp
        if (timestamp === 0xffffff) {
          if (this.buffer.length < 16) break;
          timestamp = this.buffer.readUInt32BE(12);
          timestampDelta = 0;
          bytesConsumed = 16;
        }
      } else {
        // Type 1, 2, 3 - relative timestamp
        // For simplicity, assume type 3 for subsequent chunks
        if (chunkType === 1) {
          if (this.buffer.length < 4) break;
          timestampDelta = this.buffer.readUIntBE(1, 3);
          bytesConsumed = 4;
        } else if (chunkType === 2) {
          if (this.buffer.length < 3) break;
          timestampDelta = this.buffer.readUIntBE(1, 2);
          bytesConsumed = 3;
        } else {
          // Type 3 - no header
          bytesConsumed = 1;
        }
      }

      if (this.buffer.length < bytesConsumed) break;

      const header: RtmpHeader = {
        timestamp: timestamp || timestampDelta,
        messageLength,
        messageTypeId,
        messageStreamId,
        chunkStreamId,
        extendedTimestamp: timestamp >= 0xffffff,
      };

      const packet: RtmpPacket = {
        header,
        payload: Buffer.alloc(0),
        timestamp: timestamp || timestampDelta,
      };

      this.buffer = this.buffer.subarray(bytesConsumed);
      await this.processMessage(packet);
    }
  }

  private async processMessage(packet: RtmpPacket): Promise<void> {
    const { messageTypeId } = packet.header;

    switch (messageTypeId) {
      case MessageType.SET_CHUNK_SIZE:
        await this.handleSetChunkSize(packet);
        break;
      case MessageType.ABORT:
        await this.handleAbort(packet);
        break;
      case MessageType.ACKNOWLEDGEMENT:
        await this.handleAcknowledgement(packet);
        break;
      case MessageType.WINDOW_ACKNOWLEDGEMENT_SIZE:
        await this.handleWindowAckSize(packet);
        break;
      case MessageType.SET_PEER_BANDWIDTH:
        await this.handleSetPeerBandwidth(packet);
        break;
      case MessageType.USER_CONTROL:
        await this.handleUserControl(packet);
        break;
      case MessageType.COMMAND_AMF0:
      case MessageType.COMMAND_AMF3:
        await this.handleCommand(packet);
        break;
      case MessageType.AUDIO:
      case MessageType.VIDEO:
        await this.handleMediaData(packet);
        break;
      case MessageType.DATA_AMF0:
      case MessageType.DATA_AMF3:
        await this.handleDataMessage(packet);
        break;
      default:
        this.handlers.onError(
          new Error(`Unknown message type: ${messageTypeId}`),
          this,
        );
        break;
    }
  }

  private async handleSetChunkSize(packet: RtmpPacket): Promise<void> {
    const chunkSize = packet.payload.readUInt32BE(0);
    this.config.chunkSize = chunkSize;
    this.log(`[RTMP Connection] Set chunk size: ${chunkSize}`);
  }

  private async handleAbort(packet: RtmpPacket): Promise<void> {
    const chunkStreamId = packet.payload.readUInt32BE(0);
    this.log(`[RTMP Connection] Abort chunk stream: ${chunkStreamId}`);
    this.buffer = Buffer.alloc(0); // Clear buffer
  }

  private async handleAcknowledgement(packet: RtmpPacket): Promise<void> {
    const sequenceNumber = packet.payload.readUInt32BE(0);
    this.log(`[RTMP Connection] Acknowledgement: ${sequenceNumber}`);
  }

  private async handleWindowAckSize(packet: RtmpPacket): Promise<void> {
    const ackSize = packet.payload.readUInt32BE(0);
    this.config.windowAckSize = ackSize;
    this.log(`[RTMP Connection] Window ack size: ${ackSize}`);
  }

  private async handleSetPeerBandwidth(packet: RtmpPacket): Promise<void> {
    const bandwidth = packet.payload.readUInt32BE(0);
    const limitType = packet.payload.readUInt8(4);
    this.config.peerBandwidth = bandwidth;
    this.log(
      `[RTMP Connection] Set peer bandwidth: ${bandwidth}, limit type: ${limitType}`,
    );
  }

  private async handleUserControl(packet: RtmpPacket): Promise<void> {
    const eventType = packet.payload.readUInt16BE(0);
    const eventData = packet.payload.subarray(2);

    this.log(`[RTMP Connection] User control event: ${eventType}`);

    // Handle specific user control events
    switch (eventType) {
      case 2: // SetBuffer
        const streamId = eventData.readUInt32BE(0);
        const bufferMs = eventData.readUInt32BE(4);
        this.log(
          `[RTMP Connection] Set buffer for stream ${streamId}: ${bufferMs}ms`,
        );
        break;
      case 3: // Ping
        // Send Pong back
        await this.sendUserControl(2, Buffer.alloc(0));
        break;
      case 4: // ServerBW
        const serverBW = eventData.readUInt32BE(0);
        this.log(`[RTMP Connection] Server bandwidth: ${serverBW}`);
        break;
      case 5: // Client BW
        const clientBW = eventData.readUInt32BE(0);
        const clientBWType = eventData.readUInt8(4);
        this.log(
          `[RTMP Connection] Client bandwidth: ${clientBW}, type: ${clientBWType}`,
        );
        break;
    }
  }

  private async handleCommand(packet: RtmpPacket): Promise<void> {
    const commandName = this.extractAmfType(packet.payload, 0);
    const transactionId = this.extractAmfType(packet.payload, 1);
    const commandObject = this.extractAmfType(packet.payload, 2);
    const extraData = packet.payload.subarray(
      this.getAmfLength(packet.payload, 0) +
        this.getAmfLength(packet.payload, 1) +
        this.getAmfLength(packet.payload, 2),
    );

    this.log(
      `[RTMP Connection] Command: ${commandName}, transaction: ${transactionId}`,
    );

    switch (commandName) {
      case "connect":
        await this.handleConnect(transactionId, commandObject, extraData);
        break;
      case "createStream":
        await this.handleCreateStream(transactionId, commandObject, extraData);
        break;
      case "publish":
        await this.handlePublish(transactionId, commandObject, extraData);
        break;
      case "play":
        await this.handlePlay(transactionId, commandObject, extraData);
        break;
      case "close":
        await this.handleClose(transactionId, commandObject, extraData);
        break;
      case "pause":
        await this.handlePause(transactionId, commandObject, extraData);
        break;
      case "seek":
        await this.handleSeek(transactionId, commandObject, extraData);
        break;
      case "receiveVideo":
        await this.handleReceiveVideo(transactionId, commandObject, extraData);
        break;
      case "receiveAudio":
        await this.handleReceiveAudio(transactionId, commandObject, extraData);
        break;
      case "onStatus":
        this.log(
          `[RTMP Connection] onStatus for ${commandName}: ${JSON.stringify(
            commandObject,
          )}`,
        );
        break;
      default:
        this.log(
          `[RTMP Connection] Unknown command: ${commandName}`,
          commandObject,
          extraData,
        );
        break;
    }
  }

  private async handleConnect(
    transactionId: any,
    commandObject: any,
    extraData: Buffer,
  ): Promise<void> {
    this.log(
      `[RTMP Connection] Connect request: ${JSON.stringify(commandObject)}`,
    );

    // Send Window Acknowledgement Size
    await this.sendWindowAckSize(this.config.windowAckSize);

    // Send Set Peer Bandwidth
    await this.setPeerBandwidth(this.config.peerBandwidth, 2);

    // Send Set Chunk Size
    await this.setChunkSize(this.config.chunkSize);

    // Send onStatus event
    await this.sendOnStatus("NetConnection.Connect.Success", {
      code: "NetConnection.Connect.Success",
      level: "status",
      description: "Connection accepted",
    });

    this.state = ConnectionState.CONNECTED;
    this.handlers.onConnect(this);
  }

  private async handleCreateStream(
    transactionId: any,
    commandObject: any,
    extraData: Buffer,
  ): Promise<void> {
    this.currentStreamId = this.currentStreamId + 1;
    await this.sendCreateStreamResult(this.currentStreamId, transactionId);
    this.streamId = this.currentStreamId;
  }

  private async handlePublish(
    transactionId: any,
    commandObject: any,
    extraData: Buffer,
  ): Promise<void> {
    const streamName = this.extractAmfType(extraData, 0);
    const publishingType = this.extractAmfType(extraData, 1);

    this.log(
      `[RTMP Connection] Publish request: ${streamName}, type: ${publishingType}`,
    );

    await this.sendOnStatus("NetStream.Publish.Start", {
      code: "NetStream.Publish.Start",
      level: "status",
      description: `Started publishing stream: ${streamName}`,
      details: streamName,
    });

    this.handlers.onStreamPublishStart(streamName, this);
  }

  private async handlePlay(
    transactionId: any,
    commandObject: any,
    extraData: Buffer,
  ): Promise<void> {
    const streamName = this.extractAmfType(extraData, 0);

    this.log(`[RTMP Connection] Play request: ${streamName}`);

    await this.sendOnStatus("NetStream.Play.Start", {
      code: "NetStream.Play.Start",
      level: "status",
      description: `Started playing stream: ${streamName}`,
    });

    this.handlers.onStreamPlayStart(streamName, this);
  }

  private async handleClose(
    transactionId: any,
    commandObject: any,
    extraData: Buffer,
  ): Promise<void> {
    this.log("[RTMP Connection] Close request");
    await this.disconnect("Client requested close");
  }

  private async handlePause(
    transactionId: any,
    commandObject: any,
    extraData: Buffer,
  ): Promise<void> {
    const pause = this.extractAmfType(extraData, 0);
    this.log(`[RTMP Connection] Pause request: ${pause}`);
  }

  private async handleSeek(
    transactionId: any,
    commandObject: any,
    extraData: Buffer,
  ): Promise<void> {
    const offset = this.extractAmfType(extraData, 0);
    this.log(`[RTMP Connection] Seek request: ${offset}`);
  }

  private async handleReceiveVideo(
    transactionId: any,
    commandObject: any,
    extraData: Buffer,
  ): Promise<void> {
    const receive = this.extractAmfType(extraData, 0);
    this.log(`[RTMP Connection] Receive video request: ${receive}`);
  }

  private async handleReceiveAudio(
    transactionId: any,
    commandObject: any,
    extraData: Buffer,
  ): Promise<void> {
    const receive = this.extractAmfType(extraData, 0);
    this.log(`[RTMP Connection] Receive audio request: ${receive}`);
  }

  private async handleMediaData(packet: RtmpPacket): Promise<void> {
    const isAudio = packet.header.messageTypeId === MessageType.AUDIO;
    const mediaType = isAudio ? MediaStreamType.AUDIO : MediaStreamType.VIDEO;

    this.log(
      `[RTMP Connection] Media data: ${mediaType}, size: ${packet.payload.length}`,
    );

    // Forward to handlers
    this.handlers.onMessage(packet, this);
  }

  private async handleDataMessage(packet: RtmpPacket): Promise<void> {
    const data = this.extractAmfType(packet.payload, 0);
    this.log(`[RTMP Connection] Data message: ${JSON.stringify(data)}`);
    this.handlers.onMessage(packet, this);
  }

  // Send methods
  private async sendWindowAckSize(size: number): Promise<void> {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(size, 0);

    await this.sendMessage(
      MessageType.WINDOW_ACKNOWLEDGEMENT_SIZE,
      0,
      0,
      0,
      payload,
    );
  }

  private async setPeerBandwidth(
    size: number,
    limitType: number,
  ): Promise<void> {
    const payload = Buffer.alloc(5);
    payload.writeUInt32BE(size, 0);
    payload.writeUInt8(limitType, 4);

    await this.sendMessage(MessageType.SET_PEER_BANDWIDTH, 0, 0, 0, payload);
  }

  private async setChunkSize(size: number): Promise<void> {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(size, 0);

    await this.sendMessage(MessageType.SET_CHUNK_SIZE, 0, 0, 0, payload);
  }

  private async sendOnStatus(code: string, properties: any): Promise<void> {
    const buffer = Buffer.alloc(1024);
    let offset = 0;

    // AMF0 encoded onStatus command
    buffer.writeUInt8(0x02, offset); // String
    offset += 1;
    buffer.writeUInt16BE(8, offset); // "onStatus".length
    offset += 2;
    buffer.write("onStatus", 8, offset);
    offset += 8;

    // Transaction ID (number 1)
    buffer.writeUInt8(0x00, offset); // Number
    offset += 1;
    buffer.writeDoubleBE(1, offset);
    offset += 8;

    // Command object (null)
    buffer.writeUInt8(0x05, offset); // Null
    offset += 1;

    // Info object (AMF object)
    buffer.writeUInt8(0x03, offset); // Object
    offset += 1;

    // Add properties
    for (const [key, value] of Object.entries(properties)) {
      // Key
      const keyBuffer = Buffer.from(key, "utf8");
      buffer.writeUInt16BE(keyBuffer.length, offset);
      offset += 2;
      keyBuffer.copy(buffer, offset);
      offset += keyBuffer.length;

      // Value
      const valueBuffer = this.serializeItem(value);
      valueBuffer.copy(buffer, offset);
      offset += valueBuffer.length;
    }

    // End of object
    buffer.writeUInt16BE(0, offset);
    offset += 3;

    const payload = buffer.subarray(0, offset);
    await this.sendMessage(
      MessageType.COMMAND_AMF0,
      this.currentStreamId,
      0,
      0,
      payload,
    );
  }

  private async sendCreateStreamResult(
    streamId: number,
    transactionId: any,
  ): Promise<void> {
    const buffer = Buffer.alloc(128);
    let offset = 0;

    // AMF0 encoded result
    buffer.writeUInt8(0x02, offset); // String
    offset += 1;
    buffer.writeUInt16BE(6, offset); // "result".length
    offset += 2;
    buffer.write("result", 6, offset);
    offset += 6;

    // Transaction ID (number)
    const transactionIdBuffer = this.serializeItem(transactionId);
    transactionIdBuffer.copy(buffer, offset);
    offset += transactionIdBuffer.length;

    // Command object (null)
    buffer.writeUInt8(0x05, offset); // Null
    offset += 1;

    // Stream ID (number)
    const streamIdBuffer = this.serializeItem(streamId);
    streamIdBuffer.copy(buffer, offset);
    offset += streamIdBuffer.length;

    const payload = buffer.subarray(0, offset);
    await this.sendMessage(MessageType.COMMAND_AMF0, 0, 0, 0, payload);
  }

  private async sendUserControl(
    eventType: number,
    data: Buffer,
  ): Promise<void> {
    const payload = Buffer.alloc(2 + data.length);
    payload.writeUInt16BE(eventType, 0);
    data.copy(payload, 2);

    await this.sendMessage(MessageType.USER_CONTROL, 0, 0, 0, payload);
  }

  private async sendMessage(
    messageTypeId: number,
    messageStreamId: number,
    timestamp: number,
    extendedTimestamp: number,
    payload: Buffer,
  ): Promise<void> {
    if (!this.socket || this.state === ConnectionState.DISCONNECTED) {
      return;
    }

    const header = Buffer.alloc(12);
    const chunkStreamId = 3;
    const chunkType = 0; // Type 0 - full header

    // Basic header (chunk type 0, chunk stream ID)
    header[0] = ((chunkType << 6) & 0xc0) | (chunkStreamId & 0x3f);

    // Timestamp (3 bytes)
    const actualTimestamp = timestamp || 0;
    header[1] = (actualTimestamp >> 16) & 0xff;
    header[2] = (actualTimestamp >> 8) & 0xff;
    header[3] = actualTimestamp & 0xff;

    // Message length (3 bytes)
    header[4] = (payload.length >> 16) & 0xff;
    header[5] = (payload.length >> 8) & 0xff;
    header[6] = payload.length & 0xff;

    // Message type ID
    header[7] = messageTypeId;

    // Message stream ID (4 bytes, little-endian)
    header[8] = messageStreamId & 0xff;
    header[9] = (messageStreamId >> 8) & 0xff;
    header[10] = (messageStreamId >> 16) & 0xff;
    header[11] = (messageStreamId >> 24) & 0xff;

    // Combine header and payload
    const message = Buffer.concat([header, payload]);

    this.socket.write(message);
  }

  private extractAmfType(buffer: Buffer, index: number): any {
    let offset = 0;
    for (let i = 0; i <= index; i++) {
      if (offset >= buffer.length) return null;

      const type = buffer[offset];
      offset += 1;

      switch (type) {
        case 0x00: // Number
          offset += 8;
          break;
        case 0x01: // Boolean
          offset += 1;
          break;
        case 0x02: // String
          const strLen = buffer.readUInt16BE(offset);
          offset += 2 + strLen;
          break;
        case 0x05: // Null
          break;
        case 0x03: // Object
          // Skip all properties until we hit 0x00 0x00 0x09 (end of object)
          while (offset < buffer.length) {
            if (
              buffer[offset] === 0x00 &&
              buffer[offset + 1] === 0x00 &&
              buffer[offset + 2] === 0x09
            ) {
              offset += 3;
              break;
            }
            // Skip key length
            offset += 2;
            const keyLen = buffer.readUInt16BE(offset - 2);
            offset += keyLen;
            // Skip value
            offset += this.getAmfLength(buffer, offset);
          }
          break;
        case 0x0a: // Array
          const arrayLen = buffer.readUInt32BE(offset);
          offset += 4;
          for (let j = 0; j < arrayLen; j++) {
            offset += this.getAmfLength(buffer, offset);
          }
          break;
        default:
          break;
      }
    }

    // Actually parse the value
    offset = 0;
    for (let i = 0; i <= index; i++) {
      if (offset >= buffer.length) return null;

      const type = buffer[offset];
      offset += 1;

      switch (type) {
        case 0x00: {
          // Number
          const value = buffer.readDoubleBE(offset);
          offset += 8;
          if (i === index) return value;
          break;
        }
        case 0x01: {
          // Boolean
          const value = buffer.readUInt8(offset) === 1;
          offset += 1;
          if (i === index) return value;
          break;
        }
        case 0x02: {
          // String
          const strLen = buffer.readUInt16BE(offset);
          offset += 2;
          const value = buffer.toString("utf8", offset, offset + strLen);
          offset += strLen;
          if (i === index) return value;
          break;
        }
        case 0x05: {
          // Null
          if (i === index) return null;
          break;
        }
        case 0x03: {
          // Object
          if (i === index) {
            const obj: any = {};
            while (offset < buffer.length) {
              if (
                buffer[offset] === 0x00 &&
                buffer[offset + 1] === 0x00 &&
                buffer[offset + 2] === 0x09
              ) {
                offset += 3;
                break;
              }
              const keyLen = buffer.readUInt16BE(offset);
              offset += 2;
              const key = buffer.toString("utf8", offset, offset + keyLen);
              offset += keyLen;
              obj[key] = this.extractAmfType(buffer, offset);
              offset += this.getAmfLength(buffer, offset);
            }
            return obj;
          }
          // Skip object
          while (offset < buffer.length) {
            if (
              buffer[offset] === 0x00 &&
              buffer[offset + 1] === 0x00 &&
              buffer[offset + 2] === 0x09
            ) {
              offset += 3;
              break;
            }
            offset += 2;
            const keyLen = buffer.readUInt16BE(offset - 2);
            offset += keyLen;
            offset += this.getAmfLength(buffer, offset);
          }
          break;
        }
        default:
          break;
      }
    }

    return null;
  }

  private getAmfLength(buffer: Buffer, start: number): number {
    if (start >= buffer.length) return 0;

    const type = buffer[start];
    let offset = 1;

    switch (type) {
      case 0x00: // Number
        return offset + 8;
      case 0x01: // Boolean
        return offset + 1;
      case 0x02: {
        // String
        const strLen = buffer.readUInt16BE(start + 1);
        return offset + 2 + strLen;
      }
      case 0x05: // Null
        return offset;
      case 0x03: {
        // Object
        while (start + offset < buffer.length) {
          if (
            buffer[start + offset] === 0x00 &&
            buffer[start + offset + 1] === 0x00 &&
            buffer[start + offset + 2] === 0x09
          ) {
            return offset + 3;
          }
          offset += 2;
          const keyLen = buffer.readUInt16BE(start + offset - 2);
          offset += keyLen;
          const valueLen = this.getAmfLength(buffer, start + offset);
          offset += valueLen;
        }
        return buffer.length - start;
      }
      case 0x0a: {
        // Array
        const arrayLen = buffer.readUInt32BE(start + 1);
        offset += 4;
        for (let i = 0; i < arrayLen; i++) {
          offset += this.getAmfLength(buffer, start + offset);
        }
        return offset;
      }
      default:
        return 0;
    }
  }

  private serializeItem(item: unknown): Buffer {
    if (typeof item === "number") {
      const buffer = Buffer.alloc(1 + 8);
      buffer[0] = 0x00; // Number
      buffer.writeDoubleBE(item, 1);
      return buffer;
    } else if (typeof item === "string") {
      const buffer = Buffer.alloc(3 + Buffer.byteLength(item));
      buffer[0] = 0x02; // String
      buffer.writeUInt16BE(Buffer.byteLength(item), 1);
      buffer.write(item, 3);
      return buffer;
    } else if (typeof item === "boolean") {
      const buffer = Buffer.alloc(2);
      buffer[0] = 0x01; // Boolean
      buffer[1] = item ? 0x01 : 0x00;
      return buffer;
    } else if (item === null || item === undefined) {
      const buffer = Buffer.alloc(1);
      buffer[0] = 0x05; // Null (or 0x06 for undefined)
      return buffer;
    } else if (Array.isArray(item)) {
      const buffer = Buffer.alloc(1024);
      buffer[0] = 0x0a; // Array
      buffer.writeUInt32BE(item.length, 1);
      let offset = 5;

      for (const subItem of item) {
        const serialized = this.serializeItem(subItem);
        serialized.copy(buffer, offset);
        offset += serialized.length;
      }

      return buffer.subarray(0, offset);
    } else if (typeof item === "object") {
      const buffer = Buffer.alloc(2048);
      buffer[0] = 0x03; // Object
      let offset = 1;

      for (const [key, value] of Object.entries(item)) {
        // Write key
        const keyBuffer = Buffer.from(key, "utf8");
        buffer.writeUInt16BE(keyBuffer.length, offset);
        offset += 2;
        keyBuffer.copy(buffer, offset);
        offset += keyBuffer.length;

        // Write value
        const valueBuffer = this.serializeItem(value);
        valueBuffer.copy(buffer, offset);
        offset += valueBuffer.length;
      }

      // End of object
      buffer.writeUInt16BE(0, offset);
      offset += 3;

      return buffer.subarray(0, offset);
    }

    return Buffer.alloc(0);
  }

  public async disconnect(reason: string): Promise<void> {
    this.state = ConnectionState.DISCONNECTED;
    this.handlers.onDisconnect(this, reason);

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.buffer = Buffer.alloc(0);
  }

  private log(...messages: any[]): void {
    if (this.config.logLevel === "debug") {
      console.log(...messages);
    }
  }
}

// Type guards for validation
export const isRtmpPacket = (obj: unknown): obj is RtmpPacket => {
  if (typeof obj !== "object" || obj === null) return false;
  const packet = obj as any;

  return (
    typeof packet.timestamp === "number" &&
    Buffer.isBuffer(packet.payload) &&
    typeof packet.header === "object" &&
    typeof packet.header.messageStreamId === "number"
  );
};

// Connection factory
export function createRtmpConnection(
  config?: ConnectionConfig,
  handlers?: RtmpEventHandlers,
): RtmpConnection {
  return new RtmpConnection(config, handlers);
}
