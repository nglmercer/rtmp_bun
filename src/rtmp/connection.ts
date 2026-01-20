import { RtmpSocket, GenericSocketAdapter } from './socket.interface';
import {
  ConnectionConfig,
  ConnectionState,
  RtmpEventHandlers,
  RtmpPacket,
  RtmpHeader,
  MessageType,
  MediaStreamType,
  RTMP_VERSION,
  RTMP_HANDSHAKE_SIZE,
  isRtmpPacket,
  UserControlEventType,
  BandwidthLimitType,
  ConnectionStats,
  AmfDataType,
  AmfObject,
  RtmpConnectionInterface,
  PartialConnectionConfig,
  RtmpCommandName,
  RtmpStatusCode,
  isStandardMessageType,
  getMessageTypeName
} from './types';
import { type HandshakeResult } from "../handshake/index";
import { AmfUtility, amf } from './amf';
import { parseChunkHeader, hasCompleteChunk, extractChunkPayload } from './parsers';

/**
 * RTMP Connection Class with improved type safety and modular design
 */
export class RtmpConnection implements RtmpConnectionInterface {
  private socket: RtmpSocket | null = null;
  private state: ConnectionState = ConnectionState.INIT;
  private config: ConnectionConfig;
  private handlers: RtmpEventHandlers<RtmpConnection>;
  private buffer: Buffer = Buffer.alloc(0);
  private transactionId = 1;
  private currentStreamId = 0;
  private stats: ConnectionStats;

  constructor(config?: Partial<ConnectionConfig>, handlers?: Partial<RtmpEventHandlers<RtmpConnection>>) {
    this.config = this.validateConfig(config);
    this.handlers = this.validateHandlers(handlers);
    this.stats = this.initializeStats();
  }

  private validateConfig(config?: Partial<ConnectionConfig>): ConnectionConfig {
    const defaultConfig: ConnectionConfig = {
      chunkSize: 4096,
      windowAckSize: 2500000,
      peerBandwidth: 2500000,
      logLevel: "info",
      timeout: 30000
    };

    if (!config) return defaultConfig;

    return {
      chunkSize: config.chunkSize ?? defaultConfig.chunkSize,
      windowAckSize: config.windowAckSize ?? defaultConfig.windowAckSize,
      peerBandwidth: config.peerBandwidth ?? defaultConfig.peerBandwidth,
      logLevel: config.logLevel ?? defaultConfig.logLevel,
      timeout: config.timeout ?? defaultConfig.timeout
    };
  }

  private validateHandlers(handlers?: Partial<RtmpEventHandlers<RtmpConnection>>): RtmpEventHandlers<RtmpConnection> {
    const defaultHandlers: RtmpEventHandlers<RtmpConnection> = {
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

    if (!handlers) return defaultHandlers;

    return {
      onConnect: handlers.onConnect ?? defaultHandlers.onConnect,
      onDisconnect: handlers.onDisconnect ?? defaultHandlers.onDisconnect,
      onMessage: handlers.onMessage ?? defaultHandlers.onMessage,
      onHandshakeComplete: handlers.onHandshakeComplete ?? defaultHandlers.onHandshakeComplete,
      onStreamPublishStart: handlers.onStreamPublishStart ?? defaultHandlers.onStreamPublishStart,
      onStreamPublishStop: handlers.onStreamPublishStop ?? defaultHandlers.onStreamPublishStop,
      onStreamPlayStart: handlers.onStreamPlayStart ?? defaultHandlers.onStreamPlayStart,
      onStreamPlayStop: handlers.onStreamPlayStop ?? defaultHandlers.onStreamPlayStop,
      onError: handlers.onError ?? defaultHandlers.onError,
    };
  }

  private initializeStats(): ConnectionStats {
    return {
      bytesReceived: 0,
      bytesSent: 0,
      packetsReceived: 0,
      packetsSent: 0,
      connectedAt: new Date(),
      lastActivity: new Date(),
      unknownMessagesReceived: 0
    };
  }

  /**
   * Set the socket for this connection
   * @param socket Raw socket to be wrapped in adapter
   */
  public setSocket(socket: unknown): void {
    this.socket = new GenericSocketAdapter(socket);
    this.updateLastActivity();
  }

  /**
   * Set a specific socket adapter
   * @param socket Already adapted socket
   */
  public setSocketAdapter(socket: RtmpSocket): void {
    this.socket = socket;
    this.updateLastActivity();
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public getSocket(): RtmpSocket | null {
    return this.socket;
  }

  public getConfig(): ConnectionConfig {
    return this.config;
  }

  public getStats(): ConnectionStats {
    return this.stats;
  }

  public isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED && !!this.socket?.isConnected();
  }

  private updateLastActivity(): void {
    this.stats.lastActivity = new Date();
  }

  private updateBytesReceived(bytes: number): void {
    this.stats.bytesReceived += bytes;
    this.updateLastActivity();
  }

  private updateBytesSent(bytes: number): void {
    this.stats.bytesSent += bytes;
    this.updateLastActivity();
  }

  private incrementPacketsReceived(): void {
    this.stats.packetsReceived++;
    this.updateLastActivity();
  }

  private incrementPacketsSent(): void {
    this.stats.packetsSent++;
    this.updateLastActivity();
  }

  public async handleData(data: Buffer): Promise<void> {
    if (!data || data.length === 0) return;

    this.updateBytesReceived(data.length);
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
        case ConnectionState.DISCONNECTED:
        case ConnectionState.ERROR:
          this.log(`[RTMP Connection] Ignoring data in state: ${this.state}`);
          break;
        default:
          this.socket?.destroy();
          break;
      }
    } catch (error) {
      this.handleError(error as Error, 'handleData');
      this.socket?.destroy();
    }
  }

  private async processHandshake(): Promise<void> {
    if (this.buffer.length < RTMP_HANDSHAKE_SIZE) {
      return;
    }

    // Check if this is RTMP handshake (version byte)
    if (this.buffer[0] !== RTMP_VERSION) {
      const error = new Error(`Invalid RTMP version. Expected: ${RTMP_VERSION}, Got: ${this.buffer[0]}`);
      this.handleError(error, 'processHandshake');
      this.socket?.destroy();
      return;
    }

    try {
      const { RtmpHandshake, RtmpServerHandshake } = await import("../handshake/index");

      if (this.state === ConnectionState.INIT) {
        const serverHandshake = new RtmpServerHandshake();
        const handshakeResult = serverHandshake.generateServerResponse(this.buffer);

        if (!handshakeResult || handshakeResult.length === 0) {
          throw new Error("Handshake failed - no response generated");
        }

        this.socket?.write(handshakeResult);
        this.updateBytesSent(handshakeResult.length);

        // Consume handshake bytes (C0 + C1)
        this.buffer = this.buffer.subarray(
          1 + RTMP_HANDSHAKE_SIZE,
        );

        this.state = ConnectionState.READY;
        this.handlers.onHandshakeComplete(
          { success: true, handshakeBytes: handshakeResult.length },
          this,
        );
      }
    } catch (error) {
      this.handleError(error as Error, 'processHandshake');
      this.socket?.destroy();
    }
  }

  /**
   * Parses RTMP chunk headers and extracts packet information
   * @param buffer Buffer containing RTMP data
   * @returns Object with header info and bytes consumed, or null if insufficient data
   */
  private parseChunkHeader(buffer: Buffer): { header: RtmpHeader; bytesConsumed: number } | null {
    return parseChunkHeader(buffer);
  }

  /**
   * Processes RTMP packets from the buffer
   * Handles chunked messages and reassembles complete packets
   */
  private async processRTMPPackets(): Promise<void> {
    while (this.buffer.length > 0) {
      // Parse chunk header
      const headerResult = this.parseChunkHeader(this.buffer);
      if (!headerResult) {
        break;
      }

      const { header, bytesConsumed } = headerResult;

      // Check if we have the complete message payload
      if (this.buffer.length < bytesConsumed + header.messageLength) {
        break;
      }

      // Extract payload
      const payload = this.buffer.subarray(
        bytesConsumed,
        bytesConsumed + header.messageLength,
      );

      // Create packet
      const packet: RtmpPacket = {
        header,
        payload,
        timestamp: header.timestamp,
      };

      // Remove processed data from buffer
      this.buffer = this.buffer.subarray(bytesConsumed + header.messageLength);
      this.incrementPacketsReceived();

      // Process the complete packet
      await this.processMessage(packet);
    }
  }

  private async processMessage(packet: RtmpPacket): Promise<void> {
    if (!isRtmpPacket(packet)) {
      this.handleError(new Error("Invalid RTMP packet structure"), 'processMessage');
      return;
    }

    const { messageTypeId } = packet.header;

    try {
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
          // Handle unknown/extended message types
          // Some RTMP clients may send proprietary or extended message types
          // Common examples: 98, 186 (OBS proprietary messages)
          this.stats.unknownMessagesReceived++;
          
          const messageTypeName = getMessageTypeName(messageTypeId);
          const isStandard = isStandardMessageType(messageTypeId);
          
          if (isStandard) {
            this.log(`[RTMP Connection] Standard message type not implemented: ${messageTypeId} (${messageTypeName}), ignoring`);
          } else {
            this.log(`[RTMP Connection] Extended/Proprietary message type: ${messageTypeId} (${messageTypeName}), ignoring`);
          }
          
          // Update activity to prevent timeout
          this.updateLastActivity();
          // Also update bytes received to ensure proper tracking
          this.updateBytesReceived(packet.payload.length);
          // Increment packets received to maintain proper statistics
          this.incrementPacketsReceived();
          
          // Call the optional onUnknownMessageType handler if provided
          if (this.handlers.onUnknownMessageType) {
            try {
              this.handlers.onUnknownMessageType(messageTypeId, packet, this);
            } catch (handlerError) {
              this.log(`[RTMP Connection] Error in onUnknownMessageType handler: ${handlerError}`);
            }
          }
          break;
      }
    } catch (error) {
      this.handleError(error as Error, `processMessage (type: ${messageTypeId})`);
    }
  }

  private async handleSetChunkSize(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 4) {
      // If payload is empty or too short, it might be a protocol issue
      // For now, just log and continue instead of erroring
      // This allows the connection to proceed even with malformed SET_CHUNK_SIZE
      if (packet.payload.length === 0) {
        this.log(`[RTMP Connection] SET_CHUNK_SIZE with empty payload, using default chunk size`);
        return;
      }
      
      this.handleError(new Error("Invalid SET_CHUNK_SIZE payload length"), 'handleSetChunkSize');
      return;
    }

    const chunkSize = packet.payload.readUInt32BE(0);
    this.config.chunkSize = chunkSize;
    this.log(`[RTMP Connection] Set chunk size: ${chunkSize}`);
  }

  private async handleAbort(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 4) {
      this.handleError(new Error("Invalid ABORT payload length"), 'handleAbort');
      return;
    }

    const chunkStreamId = packet.payload.readUInt32BE(0);
    this.log(`[RTMP Connection] Abort chunk stream: ${chunkStreamId}`);
    this.buffer = Buffer.alloc(0); // Clear buffer
  }

  private async handleAcknowledgement(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 4) {
      this.handleError(new Error("Invalid ACKNOWLEDGEMENT payload length"), 'handleAcknowledgement');
      return;
    }

    const sequenceNumber = packet.payload.readUInt32BE(0);
    this.log(`[RTMP Connection] Acknowledgement: ${sequenceNumber}`);
  }

  private async handleWindowAckSize(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 4) {
      this.handleError(new Error("Invalid WINDOW_ACKNOWLEDGEMENT_SIZE payload length"), 'handleWindowAckSize');
      return;
    }

    const ackSize = packet.payload.readUInt32BE(0);
    this.config.windowAckSize = ackSize;
    this.log(`[RTMP Connection] Window ack size: ${ackSize}`);
  }

  private async handleSetPeerBandwidth(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 5) {
      this.handleError(new Error("Invalid SET_PEER_BANDWIDTH payload length"), 'handleSetPeerBandwidth');
      return;
    }

    const bandwidth = packet.payload.readUInt32BE(0);
    const limitType = packet.payload.readUInt8(4);
    this.config.peerBandwidth = bandwidth;
    this.log(
      `[RTMP Connection] Set peer bandwidth: ${bandwidth}, limit type: ${BandwidthLimitType[limitType] || limitType}`,
    );
  }

  private async handleUserControl(packet: RtmpPacket): Promise<void> {
    if (packet.payload.length < 2) {
      this.handleError(new Error("Invalid USER_CONTROL payload length"), 'handleUserControl');
      return;
    }

    const eventType = packet.payload.readUInt16BE(0);
    const eventData = packet.payload.subarray(2);

    this.log(`[RTMP Connection] User control event: ${UserControlEventType[eventType] || eventType}`);

    // Handle specific user control events
    switch (eventType) {
      case UserControlEventType.SET_BUFFER_LENGTH:
        if (eventData.length < 8) {
          this.handleError(new Error("Invalid SET_BUFFER_LENGTH event data length"), 'handleUserControl');
          return;
        }
        const streamId = eventData.readUInt32BE(0);
        const bufferMs = eventData.readUInt32BE(4);
        this.log(
          `[RTMP Connection] Set buffer for stream ${streamId}: ${bufferMs}ms`,
        );
        break;
      case UserControlEventType.PING_REQUEST:
        // Send Pong back
        await this.sendUserControl(UserControlEventType.PING_RESPONSE, Buffer.alloc(0));
        break;
      case UserControlEventType.STREAM_BEGIN:
      case UserControlEventType.STREAM_EOF:
      case UserControlEventType.STREAM_DRY:
      case UserControlEventType.STREAM_IS_RECORDED:
        this.log(`[RTMP Connection] Stream event: ${UserControlEventType[eventType]}`);
        break;
      default:
        this.log(`[RTMP Connection] Unhandled user control event: ${eventType}`);
        break;
    }
  }

  private async handleCommand(packet: RtmpPacket): Promise<void> {
    try {
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

      if (typeof commandName !== 'string') {
        throw new Error(`Invalid command name type: ${typeof commandName}`);
      }

      switch (commandName) {
        case RtmpCommandName.CONNECT:
          await this.handleConnect(transactionId, commandObject, extraData);
          break;
        case RtmpCommandName.CREATE_STREAM:
          await this.handleCreateStream(transactionId, commandObject, extraData);
          break;
        case RtmpCommandName.PUBLISH:
          await this.handlePublish(transactionId, commandObject, extraData);
          break;
        case RtmpCommandName.PLAY:
          await this.handlePlay(transactionId, commandObject, extraData);
          break;
        case RtmpCommandName.CLOSE:
          await this.handleClose(transactionId, commandObject, extraData);
          break;
        case RtmpCommandName.PAUSE:
          await this.handlePause(transactionId, commandObject, extraData);
          break;
        case RtmpCommandName.SEEK:
          await this.handleSeek(transactionId, commandObject, extraData);
          break;
        case RtmpCommandName.RECEIVE_VIDEO:
          await this.handleReceiveVideo(transactionId, commandObject, extraData);
          break;
        case RtmpCommandName.RECEIVE_AUDIO:
          await this.handleReceiveAudio(transactionId, commandObject, extraData);
          break;
        case RtmpCommandName.ON_STATUS:
          this.log(
            `[RTMP Connection] onStatus: ${JSON.stringify(commandObject)}`,
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
    } catch (error) {
      this.handleError(error as Error, 'handleCommand');
    }
  }

  private async handleConnect(
    transactionId: AmfDataType,
    commandObject: AmfDataType,
    extraData: Buffer,
  ): Promise<void> {
    this.log(
      `[RTMP Connection] Connect request: ${JSON.stringify(commandObject)}`,
    );

    try {
      // Send Window Acknowledgement Size
      await this.sendWindowAckSize(this.config.windowAckSize);

      // Send Set Peer Bandwidth
      await this.setPeerBandwidth(this.config.peerBandwidth, BandwidthLimitType.DYNAMIC);

      // Send Set Chunk Size
      await this.setChunkSize(this.config.chunkSize);

      // Send onStatus event
      await this.sendOnStatus(RtmpStatusCode.NET_CONNECTION_CONNECT_SUCCESS, {
        code: RtmpStatusCode.NET_CONNECTION_CONNECT_SUCCESS,
        level: "status",
        description: "Connection accepted",
      });

      this.state = ConnectionState.CONNECTED;
      this.handlers.onConnect(this);
    } catch (error) {
      this.handleError(error as Error, 'handleConnect');
      await this.disconnect("Connection setup failed");
    }
  }

  private async handleCreateStream(
    transactionId: AmfDataType,
    commandObject: AmfDataType,
    extraData: Buffer,
  ): Promise<void> {
    this.currentStreamId = this.currentStreamId + 1;
    await this.sendCreateStreamResult(this.currentStreamId, transactionId);
  }

  private async handlePublish(
    transactionId: AmfDataType,
    commandObject: AmfDataType,
    extraData: Buffer,
  ): Promise<void> {
    try {
      const streamName = this.extractAmfType(extraData, 0);
      const publishingType = this.extractAmfType(extraData, 1);

      if (typeof streamName !== 'string') {
        throw new Error(`Invalid stream name type: ${typeof streamName}`);
      }

      this.log(
        `[RTMP Connection] Publish request: ${streamName}, type: ${publishingType}`,
      );

      await this.sendOnStatus(RtmpStatusCode.NET_STREAM_PUBLISH_START, {
        code: RtmpStatusCode.NET_STREAM_PUBLISH_START,
        level: "status",
        description: `Started publishing stream: ${streamName}`,
        details: streamName,
      });

      this.handlers.onStreamPublishStart(streamName, this);
    } catch (error) {
      this.handleError(error as Error, 'handlePublish');
    }
  }

  private async handlePlay(
    transactionId: AmfDataType,
    commandObject: AmfDataType,
    extraData: Buffer,
  ): Promise<void> {
    try {
      const streamName = this.extractAmfType(extraData, 0);

      if (typeof streamName !== 'string') {
        throw new Error(`Invalid stream name type: ${typeof streamName}`);
      }

      this.log(`[RTMP Connection] Play request: ${streamName}`);

      await this.sendOnStatus(RtmpStatusCode.NET_STREAM_PLAY_START, {
        code: RtmpStatusCode.NET_STREAM_PLAY_START,
        level: "status",
        description: `Started playing stream: ${streamName}`,
      });

      this.handlers.onStreamPlayStart(streamName, this);
    } catch (error) {
      this.handleError(error as Error, 'handlePlay');
    }
  }

  private async handleClose(
    transactionId: AmfDataType,
    commandObject: AmfDataType,
    extraData: Buffer,
  ): Promise<void> {
    this.log("[RTMP Connection] Close request");
    await this.disconnect("Client requested close");
  }

  private async handlePause(
    transactionId: AmfDataType,
    commandObject: AmfDataType,
    extraData: Buffer,
  ): Promise<void> {
    try {
      const pause = this.extractAmfType(extraData, 0);
      this.log(`[RTMP Connection] Pause request: ${pause}`);
    } catch (error) {
      this.handleError(error as Error, 'handlePause');
    }
  }

  private async handleSeek(
    transactionId: AmfDataType,
    commandObject: AmfDataType,
    extraData: Buffer,
  ): Promise<void> {
    try {
      const offset = this.extractAmfType(extraData, 0);
      this.log(`[RTMP Connection] Seek request: ${offset}`);
    } catch (error) {
      this.handleError(error as Error, 'handleSeek');
    }
  }

  private async handleReceiveVideo(
    transactionId: AmfDataType,
    commandObject: AmfDataType,
    extraData: Buffer,
  ): Promise<void> {
    try {
      const receive = this.extractAmfType(extraData, 0);
      this.log(`[RTMP Connection] Receive video request: ${receive}`);
    } catch (error) {
      this.handleError(error as Error, 'handleReceiveVideo');
    }
  }

  private async handleReceiveAudio(
    transactionId: AmfDataType,
    commandObject: AmfDataType,
    extraData: Buffer,
  ): Promise<void> {
    try {
      const receive = this.extractAmfType(extraData, 0);
      this.log(`[RTMP Connection] Receive audio request: ${receive}`);
    } catch (error) {
      this.handleError(error as Error, 'handleReceiveAudio');
    }
  }

  private async handleMediaData(packet: RtmpPacket): Promise<void> {
    try {
      const isAudio = packet.header.messageTypeId === MessageType.AUDIO;
      const mediaType = isAudio ? MediaStreamType.AUDIO : MediaStreamType.VIDEO;

      this.log(
        `[RTMP Connection] Media data: ${mediaType}, size: ${packet.payload.length}`,
      );

      // Forward to handlers
      this.handlers.onMessage(packet, this);
    } catch (error) {
      this.handleError(error as Error, 'handleMediaData');
    }
  }

  private async handleDataMessage(packet: RtmpPacket): Promise<void> {
    try {
      const data = this.extractAmfType(packet.payload, 0);
      this.log(`[RTMP Connection] Data message: ${JSON.stringify(data)}`);
      this.handlers.onMessage(packet, this);
    } catch (error) {
      this.handleError(error as Error, 'handleDataMessage');
    }
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
    limitType: BandwidthLimitType,
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

  private async sendOnStatus(code: string, properties: AmfObject): Promise<void> {
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

  /**
   * Sends a createStream result response using AMF serialization
   * @param streamId The created stream ID
   * @param transactionId The transaction ID from the client request
   */
  private async sendCreateStreamResult(
    streamId: number,
    transactionId: AmfDataType,
  ): Promise<void> {
    // Use AMF serialization for cleaner, more maintainable code
    const result = amf.serialize([
      "result",           // Command name
      transactionId,      // Transaction ID
      null,               // Command object
      streamId,           // Stream ID
    ]);

    await this.sendMessage(MessageType.COMMAND_AMF0, 0, 0, 0, result);
  }

  private async sendUserControl(
    eventType: UserControlEventType,
    data: Buffer,
  ): Promise<void> {
    const payload = Buffer.alloc(2 + data.length);
    payload.writeUInt16BE(eventType, 0);
    data.copy(payload, 2);

    await this.sendMessage(MessageType.USER_CONTROL, 0, 0, 0, payload);
  }

  /**
   * Sends an RTMP message with proper chunking support
   * @param messageTypeId Type of RTMP message
   * @param messageStreamId Stream ID for the message
   * @param timestamp Timestamp for the message
   * @param extendedTimestamp Extended timestamp flag
   * @param payload Message payload
   */
  public async sendMessage(
    messageTypeId: MessageType,
    messageStreamId: number,
    timestamp: number,
    extendedTimestamp: number,
    payload: Buffer,
  ): Promise<void> {
    if (!this.socket || this.state === ConnectionState.DISCONNECTED) {
      this.log(`[RTMP Connection] Cannot send message - not connected`);
      return;
    }

    if (!this.socket.isConnected()) {
      this.log(`[RTMP Connection] Cannot send message - socket not connected`);
      return;
    }

    try {
      // Check if message needs chunking
      if (payload.length > this.config.chunkSize) {
        await this.sendChunkedMessage(messageTypeId, messageStreamId, timestamp, extendedTimestamp, payload);
      } else {
        await this.sendSingleChunk(messageTypeId, messageStreamId, timestamp, extendedTimestamp, payload);
      }
    } catch (error) {
      this.handleError(error as Error, 'sendMessage');
    }
  }

  /**
   * Sends a single RTMP chunk (no chunking needed)
   */
  private async sendSingleChunk(
    messageTypeId: MessageType,
    messageStreamId: number,
    timestamp: number,
    extendedTimestamp: number,
    payload: Buffer,
  ): Promise<void> {
    if (!this.socket) {
      throw new Error("Socket is not available");
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
    this.updateBytesSent(message.length);
    this.incrementPacketsSent();
  }

  /**
   * Sends a message that needs to be chunked into multiple RTMP chunks
   */
  private async sendChunkedMessage(
    messageTypeId: MessageType,
    messageStreamId: number,
    timestamp: number,
    extendedTimestamp: number,
    payload: Buffer,
  ): Promise<void> {
    if (!this.socket) {
      throw new Error("Socket is not available");
    }

    const chunkStreamId = 3;
    let offset = 0;

    // Send first chunk with full header (Type 0)
    const firstChunkHeader = Buffer.alloc(12);
    firstChunkHeader[0] = ((0 << 6) & 0xc0) | (chunkStreamId & 0x3f);
    
    const actualTimestamp = timestamp || 0;
    firstChunkHeader[1] = (actualTimestamp >> 16) & 0xff;
    firstChunkHeader[2] = (actualTimestamp >> 8) & 0xff;
    firstChunkHeader[3] = actualTimestamp & 0xff;
    
    firstChunkHeader[4] = (payload.length >> 16) & 0xff;
    firstChunkHeader[5] = (payload.length >> 8) & 0xff;
    firstChunkHeader[6] = payload.length & 0xff;
    firstChunkHeader[7] = messageTypeId;
    firstChunkHeader[8] = messageStreamId & 0xff;
    firstChunkHeader[9] = (messageStreamId >> 8) & 0xff;
    firstChunkHeader[10] = (messageStreamId >> 16) & 0xff;
    firstChunkHeader[11] = (messageStreamId >> 24) & 0xff;

    const firstChunkSize = Math.min(this.config.chunkSize, payload.length);
    const firstChunk = Buffer.concat([firstChunkHeader, payload.subarray(0, firstChunkSize)]);
    
    this.socket.write(firstChunk);
    this.updateBytesSent(firstChunk.length);
    this.incrementPacketsSent();
    
    offset = firstChunkSize;

    // Send remaining chunks with Type 3 header (no timestamp, no message length, no message type)
    while (offset < payload.length) {
      const chunkSize = Math.min(this.config.chunkSize, payload.length - offset);
      const chunkHeader = Buffer.alloc(1);
      chunkHeader[0] = ((3 << 6) & 0xc0) | (chunkStreamId & 0x3f);

      const chunk = Buffer.concat([chunkHeader, payload.subarray(offset, offset + chunkSize)]);
      
      this.socket.write(chunk);
      this.updateBytesSent(chunk.length);
      this.incrementPacketsSent();
      
      offset += chunkSize;
    }

    this.log(`[RTMP Connection] Sent chunked message: ${payload.length} bytes in ${Math.ceil(payload.length / this.config.chunkSize)} chunks`);
  }

  private extractAmfType(buffer: Buffer, index: number): AmfDataType {
    return amf.parse(buffer, index);
  }

  private getAmfLength(buffer: Buffer, start: number): number {
    return amf.getLength(buffer, start);
  }

  private serializeItem(item: unknown): Buffer {
    return amf.serialize(item);
  }

  public async disconnect(reason: string): Promise<void> {
    if (this.state === ConnectionState.DISCONNECTED) return;

    this.state = ConnectionState.DISCONNECTED;
    this.handlers.onDisconnect(this, reason);

    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (error) {
        this.log(`[RTMP Connection] Error destroying socket: ${error}`);
      }
      this.socket = null;
    }

    this.buffer = Buffer.alloc(0);
  }

  private handleError(error: Error, context: string): void {
    this.log(`[RTMP Connection] Error in ${context}: ${error.message}`);
    this.handlers.onError(error, this);

    // For critical errors, disconnect
    if (error.message.includes('Invalid RTMP') ||
        error.message.includes('handshake failed') ||
        error.message.includes('socket')) {
      this.disconnect(`Error: ${error.message}`);
    }
  }

  private log(...messages: any[]): void {
    if (this.config.logLevel === "debug") {
      console.log(...messages);
    }
  }
}

// Connection factory
export function createRtmpConnection(
  config?: Partial<ConnectionConfig>,
  handlers?: Partial<RtmpEventHandlers<RtmpConnection>>,
): RtmpConnection {
  return new RtmpConnection(config, handlers);
}

// Export types for external use
export * from './types';
export * from './socket.interface';
