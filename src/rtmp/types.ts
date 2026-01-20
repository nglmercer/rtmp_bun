import { RtmpSocket } from './socket.interface';
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

// Message type constants (RTMP specification RFC 7016)
export enum MessageType {
  SET_CHUNK_SIZE = 0,
  ABORT = 1,
  ACKNOWLEDGEMENT = 2,
  USER_CONTROL = 3,
  WINDOW_ACKNOWLEDGEMENT_SIZE = 4,
  SET_PEER_BANDWIDTH = 5,
  AUDIO = 8,
  VIDEO = 9,
  COMMAND_AMF3 = 17,
  DATA_AMF3 = 15,
  SHARED_OBJECT_AMF3 = 16,
  DATA_AMF0 = 18,
  SHARED_OBJECT_AMF0 = 19,
  COMMAND_AMF0 = 20,
  AGGREGATE = 22,
  // Extended/Proprietary message types (common in OBS and other RTMP clients)
  // These are not in the official spec but are commonly used
  PROPRIETARY_186 = 186, // OBS proprietary message type
  PROPRIETARY_98 = 98,    // Another proprietary type seen in logs
}

// Extended message types that may be encountered
export const EXTENDED_MESSAGE_TYPES = [
  98,   // Proprietary (seen in OBS logs)
  186,  // Proprietary (seen in OBS logs)
  255,  // Maximum possible message type
];

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
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  timeout?: number;
}

// Event Handlers with proper typing
export interface RtmpEventHandlers<T = any> {
  onConnect: (client: T) => void;
  onDisconnect: (client: T, reason: string) => void;
  onMessage: (message: RtmpPacket, client: T) => void;
  onHandshakeComplete: (result: HandshakeResult, client: T) => void;
  onStreamPublishStart: (streamName: string, client: T) => void;
  onStreamPublishStop: (streamName: string, client: T) => void;
  onStreamPlayStart: (streamName: string, client: T) => void;
  onStreamPlayStop: (streamName: string, client: T) => void;
  onError: (error: Error, client: T) => void;
  onUnknownMessageType?: (messageTypeId: number, packet: RtmpPacket, client: T) => void;
}

// AMF Data Types
export type AmfDataType = number | string | boolean | null | AmfObject | AmfArray;

export interface AmfObject {
  [key: string]: AmfDataType;
}

export interface AmfArray extends Array<AmfDataType> {}

// Command types
export interface RtmpCommand {
  name: string;
  transactionId: number;
  commandObject: AmfObject;
  extraData: Buffer;
}

// User Control Event Types
export enum UserControlEventType {
  STREAM_BEGIN = 0,
  STREAM_EOF = 1,
  STREAM_DRY = 2,
  SET_BUFFER_LENGTH = 3,
  STREAM_IS_RECORDED = 4,
  PING_REQUEST = 6,
  PING_RESPONSE = 7,
}

// RTMP Command Names (Magic Strings)
export enum RtmpCommandName {
  CONNECT = "connect",
  CREATE_STREAM = "createStream",
  PUBLISH = "publish",
  PLAY = "play",
  CLOSE = "close",
  PAUSE = "pause",
  SEEK = "seek",
  RECEIVE_VIDEO = "receiveVideo",
  RECEIVE_AUDIO = "receiveAudio",
  ON_STATUS = "onStatus",
  RESULT = "result",
}

// RTMP Status Codes
export enum RtmpStatusCode {
  NET_CONNECTION_CONNECT_SUCCESS = "NetConnection.Connect.Success",
  NET_STREAM_PUBLISH_START = "NetStream.Publish.Start",
  NET_STREAM_PLAY_START = "NetStream.Play.Start",
}

// Bandwidth Limit Types
export enum BandwidthLimitType {
  HARD = 0,
  SOFT = 1,
  DYNAMIC = 2,
}

// Connection Statistics
export interface ConnectionStats {
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  connectedAt: Date;
  lastActivity: Date;
  unknownMessagesReceived: number;
}

// Enhanced connection interface
export interface RtmpConnectionInterface {
  getState(): ConnectionState;
  getSocket(): RtmpSocket | null;
  getConfig(): ConnectionConfig;
  getStats(): ConnectionStats;
  isConnected(): boolean;
  disconnect(reason: string): Promise<void>;
  handleData(data: Buffer): Promise<void>;
  sendMessage(
    messageTypeId: MessageType,
    messageStreamId: number,
    timestamp: number,
    extendedTimestamp: number,
    payload: Buffer
  ): Promise<void>;
}

// Connection Configuration with optional fields
export interface PartialConnectionConfig {
  chunkSize?: number;
  windowAckSize?: number;
  peerBandwidth?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | string;
  timeout?: number;
}

// Type guards and validators
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

export const isRtmpHeader = (obj: unknown): obj is RtmpHeader => {
  if (typeof obj !== "object" || obj === null) return false;
  const header = obj as any;

  return (
    typeof header.timestamp === "number" &&
    typeof header.messageLength === "number" &&
    typeof header.messageTypeId === "number" &&
    typeof header.messageStreamId === "number" &&
    typeof header.chunkStreamId === "number" &&
    typeof header.extendedTimestamp === "boolean"
  );
};

export const isConnectionConfig = (obj: unknown): obj is ConnectionConfig => {
  if (typeof obj !== "object" || obj === null) return false;
  const config = obj as any;

  return (
    typeof config.chunkSize === "number" &&
    typeof config.windowAckSize === "number" &&
    typeof config.peerBandwidth === "number" &&
    ['debug', 'info', 'warn', 'error'].includes(config.logLevel)
  );
};

// Utility function to check if a message type is standard RTMP
export function isStandardMessageType(messageTypeId: number): boolean {
  const standardTypes = [
    MessageType.SET_CHUNK_SIZE,
    MessageType.ABORT,
    MessageType.ACKNOWLEDGEMENT,
    MessageType.USER_CONTROL,
    MessageType.WINDOW_ACKNOWLEDGEMENT_SIZE,
    MessageType.SET_PEER_BANDWIDTH,
    MessageType.AUDIO,
    MessageType.VIDEO,
    MessageType.COMMAND_AMF3,
    MessageType.DATA_AMF3,
    MessageType.SHARED_OBJECT_AMF3,
    MessageType.DATA_AMF0,
    MessageType.SHARED_OBJECT_AMF0,
    MessageType.COMMAND_AMF0,
    MessageType.AGGREGATE,
  ];
  return standardTypes.includes(messageTypeId as MessageType);
}

// Utility function to check if a message type is extended/proprietary
export function isExtendedMessageType(messageTypeId: number): boolean {
  return !isStandardMessageType(messageTypeId) && messageTypeId >= 0 && messageTypeId <= 255;
}

// Utility function to get message type name
export function getMessageTypeName(messageTypeId: number): string {
  const name = MessageType[messageTypeId as MessageType];
  if (name) return name;
  
  if (messageTypeId === 98) return "PROPRIETARY_98";
  if (messageTypeId === 186) return "PROPRIETARY_186";
  
  return `UNKNOWN_${messageTypeId}`;
}
