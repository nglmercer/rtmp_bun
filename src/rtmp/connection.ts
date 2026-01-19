import { type } from "arktype";
import { type HandshakeResult } from "../handshake/index";

// RTMP Protocol constants
export const RTMP_CHUNK_SIZE = 128;
export const RTMP_MAX_CHUNK_SIZE = 65536;
export const RTMP_CSID_PROTOCOL = 0x02;
export const RTMP_CSID_CONTROL = 0x04;
export const RTMP_CSID_CONNECTION = 0x03;

// RTMP Message Types
export const RTMP_MSG_SET_CHUNK_SIZE = 0x01;
export const RTMP_MSG_ABORT = 0x02;
export const RTMP_MSG_ACK = 0x03;
export const RTMP_MSG_USER = 0x04;
export const RTMP_MSG_ACK_SIZE = 0x05;
export const RTMP_MSG_BANDWIDTH = 0x06;
export const RTMP_MSG_EDGE = 0x07;
export const RTMP_MSG_AUDIO = 0x08;
export const RTMP_MSG_VIDEO = 0x09;
export const RTMP_MSG_AMF3_META = 0x0f;
export const RTMP_MSG_AMF3_SHARED = 0x10;
export const RTMP_MSG_AMF3_COMMAND = 0x12;
export const RTMP_MSG_AMF0_META = 0x12;
export const RTMP_MSG_AMF0_SHARED = 0x13;
export const RTMP_MSG_AMF0_COMMAND = 0x14;
export const RTMP_MSG_AGGREGATE = 0x16;

// RTMP User Control Messages
export const RTMP_UCM_STREAM_BEGIN = 0x00;
export const RTMP_UCM_STREAM_EOF = 0x01;
export const RTMP_UCM_STREAM_EMPTY = 0x02;
export const RTMP_UCM_SET_BUFFER = 0x03;

// RTMP Acknowledgement
export const RTMP_ACK_WINDOW_SIZE = 2500000;

// RTMP Connection States
export type ConnectionState =
  | "idle"
  | "handshaking"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "error";

// RTMP Packet types
export interface RtmpHeader {
  timestamp: number;
  messageLength: number;
  messageTypeId: number;
  messageStreamId: number;
  chunkStreamId: number;
  extendedTimestamp: boolean;
}

export interface RtmpPacket {
  header: RtmpHeader;
  payload: Buffer;
  timestamp: number;
}

export interface RtmpMessage {
  type: string;
  timestamp: number;
  streamId: number;
  data: unknown[] | Record<string, unknown>;
}

// RTMP Connection Configuration
export interface ConnectionConfig {
  chunkSize?: number;
  windowAckSize?: number;
  peerBandwidth?: number;
  timeoutMs?: number;
  maxConnections?: number;
  enableRequests?: boolean;
}

// Interfaces for RTMP events
export interface RtmpEventHandlers {
  onConnect?: (client: RtmpConnection) => void;
  onDisconnect?: (client: RtmpConnection, reason: string) => void;
  onMessage?: (message: RtmpMessage, client: RtmpConnection) => void;
  onHandshakeComplete?: (
    result: HandshakeResult,
    client: RtmpConnection,
  ) => void;
  onStreamPublishStart?: (streamName: string, client: RtmpConnection) => void;
  onStreamPublishStop?: (streamName: string, client: RtmpConnection) => void;
  onStreamPlayStart?: (streamName: string, client: RtmpConnection) => void;
  onStreamPlayStop?: (streamName: string, client: RtmpConnection) => void;
  onError?: (error: Error, client: RtmpConnection) => void;
}

// RTMP Connection Class
export class RtmpConnection {
  private state: ConnectionState = "idle";
  private socket: Bun.Socket | null = null;
  private config: ConnectionConfig;
  private handlers: RtmpEventHandlers;
  private packetBuffer: Map<number, RtmpPacket> = new Map();

  // Window acknowledgement tracking
  private bytesReceived: number = 0;
  private lastAck: number = 0;
  private windowSize: number = RTMP_ACK_WINDOW_SIZE;

  // Connection metadata
  private streamName: string | null = null;
  private streamType: "publish" | "play" | null = null;
  private streamId: number = 0;
  private transactionId: number = 1;

  // RTMP Handshaking state
  private handshakeComplete: boolean = false;
  private handshakeResult: HandshakeResult | null = null;
  private rawBuffer: Buffer = Buffer.alloc(0);

  constructor(config: ConnectionConfig = {}, handlers: RtmpEventHandlers = {}) {
    this.config = {
      chunkSize: RTMP_CHUNK_SIZE,
      windowAckSize: RTMP_ACK_WINDOW_SIZE,
      peerBandwidth: RTMP_ACK_WINDOW_SIZE,
      timeoutMs: 10000,
      maxConnections: 100,
      enableRequests: config.enableRequests ?? true,
      ...config,
    };

    this.handlers = handlers;
    this.state = "idle";
  }

  // Public getters
  public getState(): ConnectionState {
    return this.state;
  }

  public getStreamName(): string | null {
    return this.streamName;
  }

  public getStreamType(): string | null {
    return this.streamType;
  }

  public getStreamId(): number {
    return this.streamId;
  }

  public isHandshakeComplete(): boolean {
    return this.handshakeComplete;
  }

  // Set the socket for the connection
  public setSocket(socket: Bun.Socket): void {
    this.socket = socket;
    this.state = "handshaking";
  }

  // Handle incoming data
  public async handleData(data: Buffer): Promise<void> {
    this.bytesReceived += data.length;

    // Check if we need to send an acknowledgement
    if (
      this.lastAck > 0 &&
      this.bytesReceived - this.lastAck >= this.windowSize
    ) {
      this.sendAck(this.bytesReceived - this.lastAck);
      this.lastAck = this.bytesReceived;
    }

    if (!this.handshakeComplete) {
      await this.processHandshake(data);
      return;
    }

    // Process RTMP chunks
    await this.processChunks(data);
  }

  // Process RTMP handshake
  private async processHandshake(data: Buffer): Promise<void> {
    // In a real implementation, this would use the handshake module
    // For now, we'll simulate the handshake completion
    console.log("[RTMP Connection] Processing handshake bytes:", data.length);

    // Simulate handshake success
    this.handshakeComplete = true;
    this.state = "connected";

    const result: HandshakeResult = {
      success: true,
      handshakeBytes: 1536,
    };

    this.handshakeResult = result;

    if (this.handlers.onHandshakeComplete) {
      this.handlers.onHandshakeComplete(result, this);
    }

    if (this.handlers.onConnect) {
      this.handlers.onConnect(this);
    }

    // Send initial RTMP control messages
    this.sendAckWindowSize(this.config.windowAckSize || RTMP_ACK_WINDOW_SIZE);
    this.sendSetChunkSize(this.config.chunkSize || RTMP_CHUNK_SIZE);
    this.sendSetPeerBandwidth(
      this.config.peerBandwidth || RTMP_ACK_WINDOW_SIZE,
      2,
    ); // Hard limit at 250% of window size
  }

  // Process RTMP chunks
  private async processChunks(data: Buffer): Promise<void> {
    let offset = 0;
    const buffer = Buffer.concat([this.rawBuffer, data]);

    while (offset < buffer.length) {
      if (offset >= buffer.length) {
        break;
      }

      // Parse basic RTMP header
      const basicHeader = buffer[offset];
      const chunkStreamId = basicHeader & 0x3f;
      const chunkType = (basicHeader >> 6) & 0x03;

      // Calculate header size based on chunk type
      let headerSize = 1;
      if (chunkStreamId === 0) {
        headerSize += 1;
      } else if (chunkStreamId === 1) {
        headerSize += 2;
      }

      if (chunkType === 0) {
        headerSize += 11;
      } else if (chunkType === 1) {
        headerSize += 7;
      } else if (chunkType === 2) {
        headerSize += 3;
      }
      // chunkType 3 has no timestamp delta

      // Check if we have enough data for a full header
      if (offset + headerSize > buffer.length) {
        this.rawBuffer = buffer.subarray(offset);
        return;
      }

      const headerData = buffer.subarray(offset, offset + headerSize);
      const header = this.parseRtmpHeader(headerData, chunkType, chunkStreamId);

      // Calculate chunk body size
      const chunkSize = this.config.chunkSize || RTMP_CHUNK_SIZE;
      const bodySize = header.messageLength;
      const chunksNeeded = Math.ceil(bodySize / chunkSize);
      const chunkOffset = 0;

      // Check if we have enough data for the message
      let neededData = headerSize + bodySize - chunkOffset;

      if (offset + neededData > buffer.length) {
        this.rawBuffer = buffer.subarray(offset);
        return;
      }

      // Get the payload
      const payload = Buffer.alloc(header.messageLength);
      let decodedOffset = headerSize;
      let payloadOffset = 0;

      for (let i = 0; i < chunksNeeded; i++) {
        const chunkPayload = chunkSize;
        const chunkData = buffer.subarray(
          offset + decodedOffset,
          offset + decodedOffset + chunkPayload,
        );
        chunkData.copy(payload, payloadOffset);
        payloadOffset += chunkOffset;
        decodedOffset += chunkPayload + (i > 0 ? 0 : headerSize);

        // Next chunks have type 3 header (just timestamp delta)
        if (i < chunksNeeded - 1) {
          decodedOffset++;
          if (offset + decodedOffset >= buffer.length) {
            this.rawBuffer = buffer.subarray(offset);
            return;
          }
        }
      }

      // Create full packet
      const packet: RtmpPacket = {
        header,
        payload: Buffer.from(payload),
        timestamp: header.timestamp,
      };

      // Process the RTMP message
      await this.processMessage(packet);

      // Move offset forward
      offset += headerSize + Math.ceil(bodySize / chunkSize) * chunkSize;
    }

    this.rawBuffer = buffer.subarray(offset);
  }

  // Parse RTMP header
  private parseRtmpHeader(
    headerData: Buffer,
    chunkType: number,
    chunkStreamId: number,
  ): RtmpHeader {
    const previousPacket = this.packetBuffer.get(chunkStreamId);

    let timestamp = 0;
    let messageLength = 0;
    let messageTypeId = 0;
    let messageStreamId = chunkStreamId; // Default to chunk stream ID

    // Parse based on chunk type
    let offset = 1;
    if (chunkStreamId === 0) {
      offset += 1;
    } else if (chunkStreamId === 1) {
      offset += 2;
    }

    if (chunkType === 0) {
      // Full header (11 bytes)
      timestamp = headerData.readUIntBE(offset, 3);
      offset += 3;
      messageLength = headerData.readUIntBE(offset, 3);
      offset += 3;
      messageTypeId = headerData.readUInt8(offset);
      offset += 1;
      messageStreamId = headerData.readUInt32LE(offset);

      return {
        timestamp,
        messageLength,
        messageTypeId,
        messageStreamId,
        chunkStreamId,
        extendedTimestamp: timestamp >= 0xffffff,
      };
    }

    if (chunkType === 1) {
      // Header without stream ID (7 bytes)
      timestamp = headerData.readUIntBE(offset, 3);
      offset += 3;
      messageLength = headerData.readUIntBE(offset, 3);
      offset += 3;
      messageTypeId = headerData.readUInt8(offset);

      messageStreamId = previousPacket?.header.messageStreamId || chunkStreamId;
    }

    if (chunkType === 2) {
      // Header with timestamp delta only (3 bytes)
      timestamp = headerData.readUIntBE(offset, 3);
      messageTypeId = previousPacket?.header.messageTypeId || 0;
      messageLength = previousPacket?.header.messageLength || 0;
      messageStreamId = previousPacket?.header.messageStreamId || chunkStreamId;
    }

    if (chunkType === 3) {
      // Timestamp delta only - use previous packet's values
      timestamp = headerData.readUIntLE(offset, 3) || 0;
      const prevHeader = previousPacket?.header;
      if (prevHeader) {
        timestamp = prevHeader.timestamp;
      }
      messageTypeId = prevHeader?.messageTypeId || 0;
      messageLength = prevHeader?.messageLength || 0;
      messageStreamId = prevHeader?.messageStreamId || chunkStreamId;
    }

    return {
      timestamp,
      messageLength,
      messageTypeId,
      messageStreamId,
      chunkStreamId,
      extendedTimestamp: chunkType === 3 || timestamp >= 0xffffff,
    };
  }

  // Process RTMP message
  private async processMessage(packet: RtmpPacket): Promise<void> {
    const { messageTypeId, messageStreamId, messageLength } = packet.header;

    console.log(
      `[RTMP Connection] Processing message: type=${messageTypeId}, stream=${messageStreamId}, length=${messageLength}`,
    );

    // Store chunk in buffer for reassembly
    this.packetBuffer.set(packet.header.chunkStreamId, packet);

    // Process based on message type
    switch (messageTypeId) {
      case RTMP_MSG_SET_CHUNK_SIZE:
        await this.handleSetChunkSize(packet);
        break;

      case RTMP_MSG_ACK:
        await this.handleAck(packet);
        break;

      case RTMP_MSG_ACK_SIZE:
        await this.handleAckSize(packet);
        break;

      case RTMP_MSG_BANDWIDTH:
        await this.handleBandwidth(packet);
        break;

      case RTMP_MSG_AMF0_COMMAND:
      case RTMP_MSG_AMF3_COMMAND:
        await this.handleAmfCommand(packet);
        break;

      case RTMP_MSG_AMF0_META:
      case RTMP_MSG_AMF3_META:
        await this.handleAmfMetadata(packet);
        break;

      case RTMP_MSG_USER:
        await this.handleUserControl(packet);
        break;

      case RTMP_MSG_AUDIO:
      case RTMP_MSG_VIDEO:
        await this.handleMedia(packet);
        break;

      default:
        console.log(`[RTMP Connection] Unknown message type: ${messageTypeId}`);
        break;
    }
  }

  // Message handlers
  private async handleSetChunkSize(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 4) return;
    const newChunkSize = packet.payload.readUInt32BE(0);
    this.config.chunkSize = newChunkSize;
    console.log(`[RTMP Connection] Set chunk size to ${newChunkSize}`);
  }

  private async handleAck(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 4) return;
    const sequence = packet.payload.readUInt32BE(0);
    console.log(`[RTMP Connection] Acknowledgement received: ${sequence}`);
  }

  private async handleAckSize(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 4) return;
    const ackSize = packet.payload.readUInt32BE(0);
    this.windowSize = ackSize;
    this.lastAck = 0;
    console.log(
      `[RTMP Connection] Window acknowledgement size set to ${ackSize}`,
    );
  }

  private async handleBandwidth(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 4) return;
    const bandwidth = packet.payload.readUInt32BE(0);
    console.log(`[RTMP Connection] Peer bandwidth limit: ${bandwidth}`);
  }

  private async handleAmfCommand(packet: RtmpPacket): Promise<void> {
    const amfData = packet.payload;
    const commandName = this.readAmfString(amfData, 0);

    console.log(`[RTMP Connection] AMF command: ${commandName}`);

    switch (commandName.toLowerCase()) {
      case "connect":
        await this.handleConnectCommand(packet);
        break;

      case "createStream":
        await this.handleCreateStream(packet);
        break;

      case "releaseStream":
        await this.handleReleaseStream(packet);
        break;

      case "publish":
        await this.handlePublishCommand(packet);
        break;

      case "play":
        await this.handlePlayCommand(packet);
        break;

      case "closeStream":
        await this.handleCloseStream(packet);
        break;

      case "delete_stream":
        await this.handleDeleteStream(packet);
        break;

      case "seek":
        await this.handleSeekCommand(packet);
        break;

      case "pause":
        await this.handlePauseCommand(packet);
        break;

      default:
        console.log(`[RTMP Connection] Unknown AMF command: ${commandName}`);
        break;
    }
  }

  private async handleAmfMetadata(packet: RtmpPacket): Promise<void> {
    const amfData = packet.payload;

    try {
      const metadata = this.readAmfData(amfData);

      // Try to determine if it's onMetadata, onCuePoint, etc.
      if (Array.isArray(metadata)) {
        const eventType = metadata[0];
        if (eventType === "onMetadata") {
          console.log("[RTMP Connection] Metadata received:", metadata);
        } else {
          console.log("[RTMP Connection] Media event:", eventType);
        }
      }
    } catch (error) {
      console.error("[RTMP Connection] Error parsing metadata:", error);
    }
  }

  private async handleUserControl(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 2) return;

    const eventType = packet.payload.readUInt16BE(0);
    const eventData = packet.payload.subarray(2);

    switch (eventType) {
      case RTMP_UCM_STREAM_BEGIN:
        if (eventData.length >= 2) {
          const streamId = eventData.readUInt32BE(0);
          console.log(`[RTMP Connection] Stream begin: ${streamId}`);
        }
        break;

      case RTMP_UCM_STREAM_EOF:
        if (eventData.length >= 2) {
          const streamId = eventData.readUInt32BE(0);
          console.log(`[RTMP Connection] Stream EOF: ${streamId}`);
        }
        break;

      case RTMP_UCM_SET_BUFFER:
        if (eventData.length >= 4) {
          const streamId = eventData.readUInt32BE(0);
          const bufferTime = eventData.readUInt32BE(4);
          console.log(
            `[RTMP Connection] Set buffer for stream ${streamId} to ${bufferTime}`,
          );
        }
        break;

      default:
        console.log(`[RTMP Connection] User control event: ${eventType}`);
        break;
    }
  }

  private async handleMedia(packet: RtmpPacket): Promise<void> {
    if (!this.streamName || !this.streamType) return;

    // Broadcast media to other listeners in real implementation
    if (this.handlers.onMessage) {
      const message: RtmpMessage = {
        type:
          packet.header.messageTypeId === RTMP_MSG_AUDIO ? "audio" : "video",
        timestamp: packet.header.timestamp,
        streamId: packet.header.messageStreamId,
        data: { payload: packet.payload },
      };
      this.handlers.onMessage(message, this);
    }
  }

  // AMF Command Handlers
  private async handleConnectCommand(packet: RtmpPacket): Promise<void> {
    const amfData = packet.payload;

    // Parse connect command
    try {
      this.readAmfString(amfData, 0); // Skip "connect"
      this.readAmfData(amfData); // Skip transactionId

      const connectParams = this.readAmfData(amfData);
      console.log("[RTMP Connection] Connect parameters:", connectParams);

      // Send "NetConnection Connect Success"
      await this.sendConnectSuccess(packet.header.messageStreamId);

      // Send onBWDone (bandwidth measurement)
      this.sendOnBWDone();

      // Change state to connected
      this.state = "connected";

      if (this.handlers.onConnect) {
        this.handlers.onConnect(this);
      }
    } catch (error) {
      console.error(
        "[RTMP Connection] Failed to handle connect command:",
        error,
      );
      this.sentError("connect_failed");
    }
  }

  private async handleCreateStream(packet: RtmpPacket): Promise<void> {
    const amfData = packet.payload;

    try {
      const transactionId = this.readAmfData(amfData);
      console.log(
        "[RTMP Connection] Create stream request, transaction:",
        transactionId,
      );

      this.streamId = this.transactionId++;

      // Send Result command with new stream ID
      await this.sendCreateStreamResult(
        packet.header.messageStreamId,
        transactionId,
        this.streamId,
      );
    } catch (error) {
      console.error("[RTMP Connection] Failed to create stream:", error);
      this.sentError("create_stream_failed");
    }
  }

  private async handleReleaseStream(packet: RtmpPacket): Promise<void> {
    const amfData = packet.payload;

    try {
      const transactionId = this.readAmfData(amfData);
      const streamName = this.readAmfData(amfData);

      console.log("[RTMP Connection] Release stream:", streamName);
      this.streamName = streamName as string;

      // Send onStatus event
      this.sendStreamStatus(
        streamName as string,
        "NetStream.ReleaseComplete",
        "warning",
        "Stream released",
      );
    } catch (error) {
      console.error("[RTMP Connection] Failed to release stream:", error);
    }
  }

  private async handlePublishCommand(packet: RtmpPacket): Promise<void> {
    const amfData = packet.payload;

    try {
      const transactionId = this.readAmfData(amfData);
      const streamName = this.readAmfData(amfData);

      console.log("[RTMP Connection] Publish command for stream:", streamName);

      this.streamName = streamName as string;
      this.streamType = "publish";

      // Send onStatus event with NetStream.Publish.Start
      await this.sendStreamStatus(
        streamName as string,
        "NetStream.Publish.Start",
        "status",
        "Publish Started",
      );

      if (this.handlers.onStreamPublishStart) {
        this.handlers.onStreamPublishStart(streamName as string, this);
      }
    } catch (error) {
      console.error(
        "[RTMP Connection] Failed to handle publish command:",
        error,
      );
      this.sentError("publish_failed");
    }
  }

  private async handlePlayCommand(packet: RtmpPacket): Promise<void> {
    const amfData = packet.payload;

    try {
      const transactionId = this.readAmfData(amfData);
      const streamName = this.readAmfData(amfData);

      console.log("[RTMP Connection] Play command for stream:", streamName);

      this.streamName = streamName as string;
      this.streamType = "play";

      // Send onStatus event with NetStream.Publish.Start
      await this.sendStreamStatus(
        streamName as string,
        "NetStream.Play.Start",
        "status",
        "Playback Started",
      );

      if (this.handlers.onStreamPlayStart) {
        this.handlers.onStreamPlayStart(streamName as string, this);
      }

      // In real implementation, start streaming data here
      // For now, just send stream reset
      this.sendStreamReset();
    } catch (error) {
      console.error("[RTMP Connection] Failed to handle play command:", error);
      this.sentError("play_failed");
    }
  }

  private async handleCloseStream(packet: RtmpPacket): Promise<void> {
    console.log("[RTMP Connection] Close stream command received");

    if (this.streamType === "publish" && this.handlers.onStreamPublishStop) {
      this.handlers.onStreamPublishStop(this.streamName as string, this);
    } else if (this.streamType === "play" && this.handlers.onStreamPlayStop) {
      this.handlers.onStreamPlayStop(this.streamName as string, this);
    }

    this.streamName = null;
    this.streamType = null;

    this.sendOnStatus("NetStream.Close", this.streamId);
  }

  private async handleDeleteStream(packet: RtmpPacket): Promise<void> {
    const amfData = packet.payload;

    try {
      const transactionId = this.readAmfData(amfData);
      const streamId = this.readAmfData(amfData);

      console.log(
        "[RTMP Connection] Delete stream command for stream ID:",
        streamId,
      );

      this.streamName = null;
      this.streamType = null;
      this.streamId = 0;

      this.sendOnStatus("NetStream.Delete", this.streamId);
    } catch (error) {
      console.error("[RTMP Connection] Failed to delete stream:", error);
    }
  }

  private async handleSeekCommand(packet: RtmpPacket): Promise<void> {
    console.log(
      "[RTMP Connection] Seek command received - available in VOD streams",
    );
    this.sendOnStatus("NetStream.Seek.Notify", this.streamId);
  }

  private async handlePauseCommand(packet: RtmpPacket): Promise<void> {
    console.log(
      "[RTMP Connection] Pause command received - available in VOD streams",
    );
    this.sendOnStatus("NetStream.Pause.Notify", this.streamId);
  }

  // Send RTMP Messages

  // Send chunk size
  public sendSetChunkSize(chunkSize: number): void {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(chunkSize, 0);
    this.sendRtmpMessage(
      RTMP_CSID_PROTOCOL,
      RTMP_MSG_SET_CHUNK_SIZE,
      0,
      0,
      payload,
    );
  }

  // Send acknowledgement
  public sendAck(sequenceNumber: number): void {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(sequenceNumber, 0);
    this.sendRtmpMessage(RTMP_CSID_PROTOCOL, RTMP_MSG_ACK, 0, 0, payload);
  }

  // Send window acknowledgement size
  public sendAckWindowSize(size: number): void {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(size, 0);
    this.sendRtmpMessage(RTMP_CSID_PROTOCOL, RTMP_MSG_ACK_SIZE, 0, 0, payload);
  }

  // Send peer bandwidth
  public sendSetPeerBandwidth(bandwidth: number, limitType: number): void {
    const payload = Buffer.alloc(5);
    payload.writeUInt32BE(bandwidth, 0);
    payload[4] = limitType;
    this.sendRtmpMessage(RTMP_CSID_PROTOCOL, RTMP_MSG_BANDWIDTH, 0, 0, payload);
  }

  // Send AMF Connect Success
  public async sendConnectSuccess(streamId: number): Promise<void> {
    const amfData = this.writeAmfData([
      "_result",
      1, // transactionId
      {
        fmsVer: "FMS/3,0,1,123",
        capabilities: 31,
        mode: 1,
      },
      {
        level: "status",
        code: "NetConnection.Connect.Success",
        description: "Connection succeeded",
        objectEncoding: 0,
      },
    ]);
    this.sendRtmpMessage(
      RTMP_CSID_CONNECTION,
      RTMP_MSG_AMF0_COMMAND,
      0,
      streamId,
      amfData,
    );
  }

  // Send OnBWDone
  public sendOnBWDone(): void {
    const amfData = this.writeAmfData(["onBWDone", 0, null, 4096]);
    this.sendRtmpMessage(
      RTMP_CSID_CONNECTION,
      RTMP_MSG_AMF0_COMMAND,
      0,
      0,
      amfData,
    );
  }

  // Send Create Stream Result
  public async sendCreateStreamResult(
    commandStreamId: number,
    transactionId: number,
    streamId: number,
  ): Promise<void> {
    const amfData = this.writeAmfData([
      "_result",
      transactionId,
      null,
      streamId,
    ]);
    this.sendRtmpMessage(
      RTMP_CSID_CONNECTION,
      RTMP_MSG_AMF0_COMMAND,
      0,
      commandStreamId,
      amfData,
    );
  }

  // Send Stream Status
  public async sendStreamStatus(
    streamName: string,
    code: string,
    level: string,
    description: string,
  ): Promise<void> {
    const amfData = this.writeAmfData([
      "onStatus",
      0,
      null,
      {
        level,
        code,
        description,
        streamName,
        clientid: 1234,
      },
    ]);
    this.sendRtmpMessage(
      RTMP_CSID_CONTROL,
      RTMP_MSG_AMF0_COMMAND,
      0,
      this.streamId,
      amfData,
    );
  }

  // Send On Status
  public sendOnStatus(code: string, streamId: number): void {
    const amfData = this.writeAmfData([
      "onStatus",
      0,
      null,
      {
        level: "status",
        code,
        description: "Received status",
        clientid: 1234,
      },
    ]);
    this.sendRtmpMessage(
      RTMP_CSID_CONTROL,
      RTMP_MSG_AMF0_COMMAND,
      0,
      streamId,
      amfData,
    );
  }

  // Send Stream Reset
  public sendStreamReset(): void {
    const amfData = this.writeAmfData([
      "onStatus",
      0,
      null,
      {
        level: "status",
        code: "NetStream.Reset",
        description: "Stream has been reset",
      },
    ]);
    this.sendRtmpMessage(
      RTMP_CSID_CONTROL,
      RTMP_MSG_AMF0_COMMAND,
      0,
      this.streamId,
      amfData,
    );
  }

  // Send Error
  public sentError(errorCode: string): void {
    const amfData = this.writeAmfData([
      "onError",
      0,
      null,
      {
        level: "error",
        code: errorCode,
      },
    ]);
    this.sendRtmpMessage(
      RTMP_CSID_CONTROL,
      RTMP_MSG_AMF0_COMMAND,
      0,
      0,
      amfData,
    );
  }

  // Send RTMP message utility
  public sendRtmpMessage(
    chunkStreamId: number,
    messageTypeId: number,
    timestamp: number,
    messageStreamId: number,
    payload: Buffer,
  ): void {
    if (!this.socket || this.state !== "connected") {
      console.log("[RTMP Connection] Cannot send message - not connected");
      return;
    }

    const chunkSize = this.config.chunkSize || RTMP_CHUNK_SIZE;

    // Build RTMP header (type 0 - full header)
    const headerLength = 12;
    const header = Buffer.alloc(headerLength);

    // Basic header (1 byte)
    let basicHeader = chunkStreamId & 0x3f;

    // Type 0 chunk
    basicHeader |= 0x00 << 6;
    header[0] = basicHeader;

    // Timestamp (3 bytes)
    header.writeUIntBE(timestamp & 0xffffff, 1, 3);

    // Message length (3 bytes)
    header.writeUIntBE(payload.length, 4, 3);

    // Message type ID (1 byte)
    header[7] = messageTypeId;

    // Message stream ID (4 bytes, little-endian)
    header.writeUInt32LE(messageStreamId, 8);

    // Split payload into chunks
    const chunks: Buffer[] = [];

    // First chunk with header
    const firstChunk = Math.min(chunkSize, payload.length);
    chunks.push(Buffer.concat([header, payload.subarray(0, firstChunk)]));

    // Remaining chunks (type 3 header - timestamp delta only)
    let offset = firstChunk;
    while (offset < payload.length) {
      const chunkHeader = Buffer.from([basicHeader | 0x03]); // Type 3 chunk
      const chunkLen = Math.min(chunkSize, payload.length - offset);
      const chunkData = payload.subarray(offset, offset + chunkLen);
      chunks.push(Buffer.concat([chunkHeader, chunkData]));
      offset += chunkLen;
    }

    const finalBuffer = Buffer.concat(chunks);
    this.socket.write(finalBuffer);
  }

  // AMF0/AMF3 Serialization/Deserialization

  private readAmfString(data: Buffer, offset: number): string {
    const length = data.readUInt16BE(offset);
    return data.subarray(offset + 2, offset + 2 + length).toString();
  }

  private readAmfData(data: Buffer, offset: number = 0): unknown {
    if (offset >= data.length) return null;

    const marker = data[offset];

    if (marker === 0x00) {
      // Number
      const value = data.readDoubleBE(offset + 1);
      offset += 9;
      return value;
    } else if (marker === 0x02) {
      // String
      const length = data.readUInt16BE(offset + 1);
      const value = data.subarray(offset + 3, offset + 3 + length).toString();
      offset += 3 + length;
      return value;
    } else if (marker === 0x03) {
      // Object
      const obj: Record<string, unknown> = {};
      offset += 1;
      while (offset < data.length) {
        const keyLength = data.readUInt16BE(offset);
        const key = data
          .subarray(offset + 2, offset + 2 + keyLength)
          .toString();
        offset += 2 + keyLength;

        if (key === "") break; // End of object
        const value = this.readAmfData(data, offset);
        // Update offset based on value length
        const valueSize = this.calculateAmfSize(value);
        offset += valueSize;
        obj[key] = value;
      }
      offset += 3; // Skip end markers
      return obj;
    } else if (marker === 0x05) {
      // Null
      return null;
    } else if (marker === 0x01) {
      // Boolean
      const value = data[offset + 1] === 1;
      offset += 2;
      return value;
    } else if (marker === 0x06) {
      // Undefined
      return undefined;
    } else if (marker === 0x08) {
      // Associative Array / ECMA
      const length = data.readUInt32BE(offset + 1);
      offset += 5;
      const arr = [];
      for (let i = 0; i < length; i++) {
        arr.push(this.readAmfData(data, offset));
        const valueSize = this.calculateAmfSize(arr[i]);
        offset += valueSize;
      }
      return arr;
    } else if (marker === 0x0a) {
      // Array
      const length = data.readUInt32BE(offset + 1);
      offset += 5;
      const arr = [];
      for (let i = 0; i < length; i++) {
        arr.push(this.readAmfData(data, offset));
        const valueSize = this.calculateAmfSize(arr[i]);
        offset += valueSize;
      }
      return arr;
    } else if (marker === 0x0b) {
      // Date
      const timestamp = data.readDoubleBE(offset + 1);
      offset += 11;
      return new Date(timestamp);
    }

    return null;
  }

  private writeAmfData(data: unknown[]): Buffer {
    const buffer = Buffer.alloc(2048); // Big enough buffer
    let offset = 0;

    for (const item of data) {
      const serialized = this.serializeItem(item);
      serialized.copy(buffer, offset);
      offset += serialized.length;
    }

    return buffer.subarray(0, offset);
  }

  private serializeItem(item: unknown): Buffer {
    if (typeof item === "number") {
      const buffer = Buffer.alloc(1 + 8);
      buffer[0] = 0x00; // Number
      buffer.writeDoubleBE(item, 1, true);
      return buffer;
    } else if (typeof item === "string") {
      const buffer = Buffer.alloc(3 + Buffer.byteLength(item));
      buffer[0] = 0x02; // String
      buffer.writeUInt16BE(Buffer.byteLength(item), 1, true);
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
      buffer.writeUInt32BE(item.length, 1, true);
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
        buffer.writeUInt16BE(keyBuffer.length, offset, true);
        offset += 2;
        keyBuffer.copy(buffer, offset);
        offset += keyBuffer.length;

        // Write value
        const valueBuffer = this.serializeItem(value);
        valueBuffer.copy(buffer, offset);
        offset += valueBuffer.length;
      }

      // End of object
      buffer.writeUInt16BE(0, offset, true);
      offset += 3;

      return buffer.subarray(0, offset);
    }

    return Buffer.from([0x05]); // Null as fallback
  }

  private calculateAmfSize(value: unknown): number {
    if (typeof value === "number") return 9;
    if (typeof value === "string") return 3 + Buffer.byteLength(value);
    if (typeof value === "boolean") return 2;
    if (value === null || value === undefined) return 1;

    if (Array.isArray(value)) {
      let size = 5; // Header (marker + length)
      value.forEach((item) => (size += this.calculateAmfSize(item)));
      return size;
    }

    if (typeof value === "object") {
      let size = 4; // Header + markers
      for (const [key, val] of Object.entries(value)) {
        size += 2 + Buffer.byteLength(key); // Key + length
        size += this.calculateAmfSize(val);
      }
      return size;
    }

    return 0;
  }

  // Connection lifecycle
  public disconnect(reason: string = "Normal close"): Promise<void> {
    return new Promise((resolve) => {
      this.state = "disconnecting";

      if (this.handlers.onDisconnect) {
        this.handlers.onDisconnect(this, reason);
      }

      if (this.socket) {
        try {
          this.socket.end();
          this.socket = null;
        } catch (error) {
          console.error("[RTMP Connection] Error during disconnect:", error);
        }
      }

      this.state = "disconnected";
      this.resetForReconnect();
      resolve();
    });
  }

  public resetForReconnect(): void {
    this.state = "idle";
    this.handshakeComplete = false;
    this.handshakeResult = null;
    this.streamName = null;
    this.streamType = null;
    this.streamId = 0;
    this.bytesReceived = 0;
    this.lastAck = 0;
    this.rawBuffer = Buffer.alloc(0);
    this.packetBuffer.clear();
  }

  // Get connection statistics
  public getStats(): {
    bytesReceived: number;
    packetsBuffered: number;
    currentStream: string | null;
    state: ConnectionState;
  } {
    return {
      bytesReceived: this.bytesReceived,
      packetsBuffered: this.packetBuffer.size,
      currentStream: this.streamName,
      state: this.state,
    };
  }
}

// Type guards for validation
export const isRtmpPacket = (obj: unknown): obj is RtmpPacket => {
  const validation = type({
    header: "unknown",
    payload: "instanceof Uint8Array",
    timestamp: "number",
  });
  return validation(obj).problems === undefined;
};

// Connection factory
export function createRtmpConnection(
  config?: ConnectionConfig,
  handlers?: RtmpEventHandlers,
): RtmpConnection {
  return new RtmpConnection(config, handlers);
}

// Default export
export default {
  RtmpConnection,
  createRtmpConnection,
  RTMP_CHUNK_SIZE,
  RTMP_MAX_CHUNK_SIZE,
  RTMP_CSID_PROTOCOL,
  RTMP_CSID_CONTROL,
  RTMP_CSID_CONNECTION,
  RTMP_MSG_SET_CHUNK_SIZE,
  RTMP_MSG_ACK,
  RTMP_MSG_ACK_SIZE,
  RTMP_MSG_BANDWIDTH,
  RTMP_MSG_USER,
  RTMP_MSG_AMF0_COMMAND,
  RTMP_MSG_AUDIO,
  RTMP_MSG_VIDEO,
};
