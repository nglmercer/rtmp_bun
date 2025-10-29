import { writeFileSync, appendFileSync } from "node:fs";

interface StreamStats {
  bytesReceived: number;
  startTime: number;
  lastUpdate: number;
  bitrate: number;
  streamKey: string;
  clientId: string;
}

interface ReconnectionInfo {
  originalClientId: string;
  streamKey: string;
  disconnectTime: number;
  lastBytesReceived: number;
  totalDuration: number;
}

interface PendingStream {
  streamKey: string;
  clientId: string;
  startTime: number;
  disconnectTime: number;
  bytesReceived: number;
}

const streams = new Map<string, StreamStats>();
const connections = new Map<string, RTMPConnection>(); // ✅ Map global para conexiones
const pendingStreams = new Map<string, PendingStream>(); // Streams waiting for reconnection
const reconnectionHistory = new Map<string, ReconnectionInfo>(); // Track reconnections
const LOG_FILE = `./logs/rtmp.log`;

// Reconnection settings
const RECONNECTION_TIMEOUT = 30000; // 30 seconds to reconnect
const CLEANUP_INTERVAL = 60000; // Check for expired streams every minute

function writeLog(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);

  try {
    appendFileSync(LOG_FILE, logMessage, "utf-8");
  } catch (error) {
    console.error(`Failed to write to log file: ${error}`);
  }
}

function writeHexDump(label: string, buffer: Buffer, maxBytes: number = 64) {
  const hex =
    buffer
      .slice(0, maxBytes)
      .toString("hex")
      .match(/.{1,2}/g)
      ?.join(" ") || "";
  writeLog(
    `${label}: [${buffer.length} bytes] ${hex}${buffer.length > maxBytes ? "..." : ""}`,
  );
}

// Reconnection management functions
function cleanupExpiredStreams() {
  const now = Date.now();
  const expiredStreams: string[] = [];

  for (const [clientId, stream] of pendingStreams.entries()) {
    if (now - stream.disconnectTime > RECONNECTION_TIMEOUT) {
      expiredStreams.push(clientId);
    }
  }

  for (const clientId of expiredStreams) {
    const stream = pendingStreams.get(clientId)!;
    const duration = (stream.disconnectTime - stream.startTime) / 1000;
    const totalMB = stream.bytesReceived / 1024 / 1024;

    writeLog(`🧹 STREAM EXPIRADO (sin reconexión): ${clientId}`);
    writeLog(`   🔑 Stream Key: ${stream.streamKey}`);
    writeLog(`   📊 Total: ${totalMB.toFixed(2)} MB`);
    writeLog(`   ⏱️  Duración: ${duration.toFixed(2)}s`);

    pendingStreams.delete(clientId);
    reconnectionHistory.delete(clientId);
  }

  if (expiredStreams.length > 0) {
    writeLog(
      `🧹 Limpieza completada: ${expiredStreams.length} streams expirados`,
    );
  }
}

function addPendingStream(
  clientId: string,
  streamKey: string,
  stats: StreamStats,
) {
  const pendingStream: PendingStream = {
    streamKey,
    clientId,
    startTime: stats.startTime,
    disconnectTime: Date.now(),
    bytesReceived: stats.bytesReceived,
  };

  pendingStreams.set(clientId, pendingStream);
  writeLog(`🔄 Stream pendiente de reconexión: ${streamKey} (${clientId})`);
  writeLog(`   ⏰ Tiempo límite: ${RECONNECTION_TIMEOUT / 1000}s`);
}

function checkForReconnection(
  streamKey: string,
  newClientId: string,
): string | null {
  const now = Date.now();

  for (const [clientId, stream] of pendingStreams.entries()) {
    if (
      stream.streamKey === streamKey &&
      now - stream.disconnectTime <= RECONNECTION_TIMEOUT
    ) {
      // Found matching stream waiting for reconnection
      const reconnectionInfo: ReconnectionInfo = {
        originalClientId: clientId,
        streamKey,
        disconnectTime: stream.disconnectTime,
        lastBytesReceived: stream.bytesReceived,
        totalDuration: stream.disconnectTime - stream.startTime,
      };

      reconnectionHistory.set(newClientId, reconnectionInfo);
      pendingStreams.delete(clientId);

      writeLog(`🔄¡RECONEXIÓN DETECTADA!`);
      writeLog(`   🔑 Stream Key: ${streamKey}`);
      writeLog(`   📍 Cliente anterior: ${clientId}`);
      writeLog(`   📍 Nuevo cliente: ${newClientId}`);
      writeLog(
        `   ⏰ Tiempo desconectado: ${(now - stream.disconnectTime) / 1000}s`,
      );

      return clientId;
    }
  }

  return null;
}

function startCleanupTimer() {
  setInterval(cleanupExpiredStreams, CLEANUP_INTERVAL);
  setInterval(logReconnectionStats, 30000); // Log stats every 30 seconds
  writeLog(
    `⏰ Temporizador de limpieza iniciado (${CLEANUP_INTERVAL / 1000}s)`,
  );
  writeLog(`📊 Estadísticas de reconexión cada 30s`);
}

function getReconnectionStats() {
  const now = Date.now();
  const activeReconnections = Array.from(reconnectionHistory.entries()).map(
    ([clientId, info]) => ({
      clientId,
      originalClientId: info.originalClientId,
      streamKey: info.streamKey,
      disconnectedFor: (now - info.disconnectTime) / 1000,
      lastBytesReceived: info.lastBytesReceived,
    }),
  );

  const pendingStreamsList = Array.from(pendingStreams.entries()).map(
    ([clientId, stream]) => ({
      clientId,
      streamKey: stream.streamKey,
      timeRemaining: Math.max(
        0,
        (RECONNECTION_TIMEOUT - (now - stream.disconnectTime)) / 1000,
      ),
      bytesReceived: stream.bytesReceived,
    }),
  );

  return {
    activeReconnections,
    pendingStreams: pendingStreamsList,
    totalActive: connections.size,
    totalPending: pendingStreams.size,
  };
}

function logReconnectionStats() {
  const stats = getReconnectionStats();

  if (stats.activeReconnections.length > 0 || stats.pendingStreams.length > 0) {
    writeLog(`\n📊 ESTADO DE RECONEXIONES:`);
    writeLog(`   🟢 Conexiones activas: ${stats.totalActive}`);
    writeLog(`   🟡 Streams pendientes: ${stats.totalPending}`);

    if (stats.pendingStreams.length > 0) {
      writeLog(`   ⏳ Streams esperando reconexión:`);
      stats.pendingStreams.forEach((pending) => {
        writeLog(
          `      🔑 ${pending.streamKey} - ${pending.timeRemaining.toFixed(1)}s restantes`,
        );
      });
    }

    if (stats.activeReconnections.length > 0) {
      writeLog(`   🔄 Reconexiones activas:`);
      stats.activeReconnections.forEach((reconn) => {
        writeLog(
          `      🔑 ${reconn.streamKey} - hace ${reconn.disconnectedFor.toFixed(1)}s`,
        );
      });
    }
    writeLog(`\n`);
  }
}

const RTMP_HANDSHAKE_SIZE = 1536;
const RTMP_VERSION = 3;

// Message Type IDs
const MSG_SET_CHUNK_SIZE = 1;
const MSG_ABORT = 2;
const MSG_ACK = 3;
const MSG_USER_CONTROL = 4;
const MSG_WINDOW_ACK_SIZE = 5;
const MSG_SET_PEER_BW = 6;
const MSG_AUDIO = 8;
const MSG_VIDEO = 9;
const MSG_AMF3_DATA = 15;
const MSG_AMF3_SHARED = 16;
const MSG_AMF3_CMD = 17;
const MSG_AMF0_DATA = 18;
const MSG_AMF0_SHARED = 19;
const MSG_AMF0_CMD = 20;
const MSG_AGGREGATE = 22;

enum HandshakeState {
  UNINITIALIZED,
  VERSION_SENT,
  ACK_SENT,
  HANDSHAKE_DONE,
}

class RTMPConnection {
  private socket: any;
  private buffer: Buffer = Buffer.alloc(0);
  private handshakeState: HandshakeState = HandshakeState.UNINITIALIZED;
  private clientId: string;
  private chunkSize: number = 128;
  private peerChunkSize: number = 128;
  private windowAckSize: number = 2500000;
  private peerBandwidth: number = 2500000;
  private bytesReceived: number = 0;
  private lastAckSent: number = 0;
  private streamKey: string | null = null;
  private isReconnection: boolean = false;

  private incompleteMessages: Map<
    number,
    {
      buffer: Buffer;
      bytesReceived: number;
      totalLength: number;
      messageType: number;
      timestamp: number;
      streamId: number;
    }
  > = new Map();

  private lastMessageLength: Map<number, number> = new Map();
  private lastMessageType: Map<number, number> = new Map();
  private lastMessageStreamId: Map<number, number> = new Map();
  private lastTimestamp: Map<number, number> = new Map();

  constructor(socket: any, clientId: string) {
    this.socket = socket;
    this.clientId = clientId;
  }

  async handleData(data: Buffer | Uint8Array) {
    // CRÍTICO: Convertir Uint8Array a Buffer si es necesario
    const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data);

    this.buffer = Buffer.concat([this.buffer, bufferData]);
    this.bytesReceived += bufferData.length;

    if (this.handshakeState !== HandshakeState.HANDSHAKE_DONE) {
      this.processHandshake();
    } else {
      this.processRTMPMessages();
    }
  }

  private async processHandshake() {
    writeLog(
      `🤝 Procesando handshake - Estado: ${HandshakeState[this.handshakeState]}, Buffer: ${this.buffer.length} bytes`,
    );

    switch (this.handshakeState) {
      case HandshakeState.UNINITIALIZED:
        const needed = 1 + RTMP_HANDSHAKE_SIZE;
        writeLog(
          `   Esperando C0+C1: ${needed} bytes, tenemos: ${this.buffer.length}`,
        );

        if (this.buffer.length >= needed) {
          const version = this.buffer[0];
          writeLog(`   C0 versión: ${version}`);

          if (version !== RTMP_VERSION) {
            writeLog(`❌ Versión incorrecta: ${version}`);
            this.socket.end();
            return;
          }

          const c1 = this.buffer.subarray(1, 1 + RTMP_HANDSHAKE_SIZE);
          this.buffer = this.buffer.subarray(1 + RTMP_HANDSHAKE_SIZE);

          writeLog(`   ✅ C0+C1 recibido`);

          // S0 + S1 + S2
          const s0 = Buffer.from([RTMP_VERSION]);

          const s1 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
          s1.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
          s1.writeUInt32BE(0, 4);
          // Llenar con datos aleatorios
          for (let i = 8; i < RTMP_HANDSHAKE_SIZE; i++) {
            s1[i] = Math.floor(Math.random() * 256);
          }

          const s2 = Buffer.from(c1); // Echo C1

          const response = Buffer.concat([s0, s1, s2]);

          writeLog(`   📤 Enviando S0+S1+S2 (${response.length} bytes)`);
          this.socket.write(response);

          this.handshakeState = HandshakeState.ACK_SENT;
        }
        break;

      case HandshakeState.ACK_SENT:
        writeLog(
          `   Esperando C2: ${RTMP_HANDSHAKE_SIZE} bytes, tenemos: ${this.buffer.length}`,
        );

        if (this.buffer.length >= RTMP_HANDSHAKE_SIZE) {
          const c2 = this.buffer.subarray(0, RTMP_HANDSHAKE_SIZE);
          this.buffer = this.buffer.subarray(RTMP_HANDSHAKE_SIZE);

          writeLog(`   ✅ C2 recibido`);
          writeHexDump("   C2", c2, 32);

          this.handshakeState = HandshakeState.HANDSHAKE_DONE;
          writeLog(`\n🎉 HANDSHAKE COMPLETADO\n`);

          this.sendServerConfig();

          if (this.buffer.length > 0) {
            writeLog(`   Procesando ${this.buffer.length} bytes pendientes...`);
            this.processRTMPMessages();
          }
        }
        break;
    }
  }

  private async sendServerConfig() {
    writeLog(`⚙️  Enviando configuración del servidor...`);

    // Set Chunk Size
    writeLog(`   📦 Set Chunk Size: 4096`);
    this.sendSetChunkSize(4096);

    // Window Acknowledgement Size
    writeLog(`   🪟 Window ACK Size: ${this.windowAckSize}`);
    this.sendWindowAckSize(this.windowAckSize);

    // Set Peer Bandwidth
    writeLog(`   📊 Set Peer Bandwidth: ${this.peerBandwidth}`);
    this.sendSetPeerBandwidth(this.peerBandwidth, 2);

    writeLog(`   ✅ Configuración enviada\n`);
  }

  private sendSetChunkSize(size: number) {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(size, 0);
    this.sendControlMessage(2, MSG_SET_CHUNK_SIZE, payload);
    this.chunkSize = size;
  }

  private sendWindowAckSize(size: number) {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(size, 0);
    this.sendControlMessage(2, MSG_WINDOW_ACK_SIZE, payload);
  }

  private sendSetPeerBandwidth(size: number, limitType: number) {
    const payload = Buffer.alloc(5);
    payload.writeUInt32BE(size, 0);
    payload.writeUInt8(limitType, 4);
    this.sendControlMessage(2, MSG_SET_PEER_BW, payload);
  }

  private sendControlMessage(
    csid: number,
    messageType: number,
    payload: Buffer,
  ) {
    const header = Buffer.alloc(12);
    header[0] = (0 << 6) | (csid & 0x3f); // fmt=0, csid
    header.writeUIntBE(0, 1, 3); // timestamp
    header.writeUIntBE(payload.length, 4, 3); // message length
    header[7] = messageType;
    header.writeUInt32LE(0, 8); // stream id

    const message = Buffer.concat([header, payload]);
    this.socket.write(message);
  }

  private async processRTMPMessages() {
    let processed = 0;

    while (this.buffer.length > 0) {
      const startLen = this.buffer.length;

      if (this.buffer.length < 1) {
        writeLog(`   ⏸️  Buffer vacío`);
        break;
      }

      // Basic Header
      const basicHeader = this.buffer[0];
      if (!basicHeader) break;

      const fmt = (basicHeader >> 6) & 0x03;
      let csid = basicHeader & 0x3f;
      let offset = 1;

      // CSID extendido
      if (csid === 0) {
        if (this.buffer.length < 2) break;
        const nextByte = this.buffer[1];
        if (nextByte === undefined) break;
        csid = nextByte + 64;
        offset = 2;
      } else if (csid === 1) {
        if (this.buffer.length < 3) break;
        const byte1 = this.buffer[1];
        const byte2 = this.buffer[2];
        if (byte1 === undefined || byte2 === undefined) break;
        csid = (byte2 << 8) + byte1 + 64;
        offset = 3;
      }

      // Message Header según FMT
      let headerSize = offset;
      let timestamp = this.lastTimestamp.get(csid) || 0;
      let messageLength = this.lastMessageLength.get(csid) || 0;
      let messageType = this.lastMessageType.get(csid) || 0;
      let streamId = this.lastMessageStreamId.get(csid) || 0;

      if (fmt === 0) {
        // Type 0: Full header (11 bytes)
        headerSize += 11;
        if (this.buffer.length < headerSize) {
          writeLog(
            `      ⏸️  Necesita ${headerSize} bytes, tiene ${this.buffer.length}`,
          );
          break;
        }

        timestamp = this.buffer.readUIntBE(offset, 3);
        messageLength = this.buffer.readUIntBE(offset + 3, 3);
        const msgType = this.buffer[offset + 6];
        if (msgType !== undefined) {
          messageType = msgType;
        }
        streamId = this.buffer.readUInt32LE(offset + 7);

        // Guardar para siguientes chunks
        this.lastTimestamp.set(csid, timestamp);
        this.lastMessageLength.set(csid, messageLength);
        this.lastMessageType.set(csid, messageType);
        this.lastMessageStreamId.set(csid, streamId);

        writeLog(
          `      📋 Mensaje: type=${messageType} (${this.getMessageTypeName(messageType)}), len=${messageLength}, ts=${timestamp}`,
        );
      } else if (fmt === 1) {
        // Type 1: No stream ID (7 bytes)
        headerSize += 7;
        if (this.buffer.length < headerSize) break;

        const timestampDelta = this.buffer.readUIntBE(offset, 3);
        timestamp += timestampDelta;
        messageLength = this.buffer.readUIntBE(offset + 3, 3);
        const msgType = this.buffer[offset + 6];
        if (msgType !== undefined) {
          messageType = msgType;
        }

        this.lastTimestamp.set(csid, timestamp);
        this.lastMessageLength.set(csid, messageLength);
        this.lastMessageType.set(csid, messageType);
      } else if (fmt === 2) {
        // Type 2: Timestamp delta only (3 bytes)
        headerSize += 3;
        if (this.buffer.length < headerSize) break;

        const timestampDelta = this.buffer.readUIntBE(offset, 3);
        timestamp += timestampDelta;
        this.lastTimestamp.set(csid, timestamp);

        writeLog(
          `      📋 FMT=2: usando len=${messageLength}, type=${messageType}`,
        );
      } else {
        // Type 3: No header, usar valores previos
        writeLog(
          `      📋 FMT=3: usando len=${messageLength}, type=${messageType}`,
        );
      }

      // Calcular bytes a leer
      const incomplete = this.incompleteMessages.get(csid);
      const remainingBytes = incomplete
        ? incomplete.totalLength - incomplete.bytesReceived
        : messageLength;

      const bytesToRead = Math.min(remainingBytes, this.peerChunkSize);

      if (this.buffer.length < headerSize + bytesToRead) {
        writeLog(
          `      ⏸️  Necesita ${headerSize + bytesToRead} bytes, tiene ${this.buffer.length}`,
        );
        break;
      }

      // Leer chunk data
      const chunkData = Buffer.from(
        this.buffer.subarray(headerSize, headerSize + bytesToRead),
      );
      this.buffer = this.buffer.subarray(headerSize + bytesToRead);
      // Reconstruir mensaje completo
      if (!incomplete) {
        // Primer chunk
        if (messageLength <= bytesToRead) {
          // Mensaje completo
          this.handleCompleteMessage(messageType, chunkData, csid, streamId);
        } else {
          // Mensaje fragmentado - guardar
          this.incompleteMessages.set(csid, {
            buffer: chunkData,
            bytesReceived: bytesToRead,
            totalLength: messageLength,
            messageType,
            timestamp,
            streamId,
          });
        }
      } else {
        // Chunk subsecuente
        incomplete.buffer = Buffer.concat([incomplete.buffer, chunkData]);
        incomplete.bytesReceived += bytesToRead;

        writeLog(
          `      📦 Acumulado: ${incomplete.bytesReceived}/${incomplete.totalLength} bytes`,
        );

        if (incomplete.bytesReceived >= incomplete.totalLength) {
          // Mensaje completo
          this.handleCompleteMessage(
            incomplete.messageType,
            incomplete.buffer,
            csid,
            incomplete.streamId,
          );
          this.incompleteMessages.delete(csid);
        }
      }

      processed++;

      // Enviar ACK
      if (this.bytesReceived - this.lastAckSent >= this.windowAckSize) {
        writeLog(`   📨 Enviando ACK: ${this.bytesReceived} bytes`);
        this.sendAck(this.bytesReceived);
        this.lastAckSent = this.bytesReceived;
      }

      // Safety check
      if (this.buffer.length === startLen) {
        writeLog(`   ⚠️  Buffer no cambió, saliendo del loop`);
        break;
      }
    }

    writeLog(`   ✅ Procesados ${processed} chunks\n`);
  }

  private async handleCompleteMessage(
    messageType: number,
    payload: Buffer,
    csid: number,
    streamId: number,
  ) {
    switch (messageType) {
      case MSG_SET_CHUNK_SIZE:
        if (payload.length >= 4) {
          this.peerChunkSize = payload.readUInt32BE(0) & 0x7fffffff;
          writeLog(`      ✅ Peer chunk size: ${this.peerChunkSize}`);
        }
        break;

      case MSG_WINDOW_ACK_SIZE:
        if (payload.length >= 4) {
          const size = payload.readUInt32BE(0);
          writeLog(`      ✅ Window ACK size: ${size}`);
        }
        break;

      case MSG_SET_PEER_BW:
        if (payload.length >= 5) {
          const size = payload.readUInt32BE(0);
          const limit = payload[4];
          writeLog(`      ✅ Peer bandwidth: ${size}, limit: ${limit}`);
        }
        break;

      case MSG_AMF0_CMD:
      case MSG_AMF3_CMD:
        this.handleCommand(
          payload,
          csid,
          streamId,
          messageType === MSG_AMF3_CMD,
        );
        break;

      case MSG_AUDIO:
        writeLog(`      🎵 Audio data: ${payload.length} bytes`);
        break;

      case MSG_VIDEO:
        writeLog(`      🎥 Video data: ${payload.length} bytes`);
        break;

      default:
        writeLog(`      ⚠️  Tipo no manejado: ${messageType}`);
        writeHexDump("      Payload", payload, 64);
    }
  }

  private getMessageTypeName(type: number): string {
    const names: Record<number, string> = {
      1: "SetChunkSize",
      2: "Abort",
      3: "Ack",
      4: "UserControl",
      5: "WindowAckSize",
      6: "SetPeerBW",
      8: "Audio",
      9: "Video",
      15: "AMF3Data",
      17: "AMF3Cmd",
      18: "AMF0Data",
      20: "AMF0Cmd",
      22: "Aggregate",
    };
    return names[type] || `Unknown(${type})`;
  }

  private sendAck(bytes: number) {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(bytes, 0);
    this.sendControlMessage(2, MSG_ACK, payload);
  }

  private async handleCommand(
    payload: Buffer,
    csid: number,
    streamId: number,
    isAMF3: boolean,
  ) {
    try {
      writeLog(`      🎯 Parseando comando AMF0...`);

      let offset = 0;
      // AMF3 tiene un byte 0x00 al inicio que hay que saltar
      if (isAMF3 && payload[0] === 0) {
        offset = 1;
        writeLog(`      ℹ️  Saltando marker AMF3`);
      }

      const { command, transactionId, args } = this.parseAMF0(
        payload.subarray(offset),
      );
      writeLog(
        `      ✅ Comando: "${command}", TxID: ${transactionId}, Args: ${args.length}`,
      );

      switch (command) {
        case "connect":
          this.handleConnect(csid, transactionId, args);
          break;

        case "releaseStream":
          writeLog(`      📤 releaseStream`);
          this.sendCommandResponse(csid, "_result", transactionId, null, null);
          break;

        case "FCPublish":
          writeLog(`      📤 FCPublish`);
          this.sendCommandResponse(csid, "_result", transactionId, null, null);
          break;

        case "createStream":
          writeLog(`      🆕 createStream`);
          this.sendCommandResponse(csid, "_result", transactionId, null, 1);
          writeLog(`         ✅ Stream ID 1 asignado`);
          break;

        case "publish":
          this.handlePublish(csid, args);
          break;

        default:
          writeLog(`      ⚠️  Comando desconocido: ${command}`);
      }
    } catch (error: any) {
      writeLog(`      ❌ ERROR parseando comando: ${error.message}`);
      writeLog(`      Stack: ${error.stack}`);
    }
  }

  private parseAMF0(buffer: Buffer): {
    command: string;
    transactionId: number;
    args: any[];
  } {
    let offset = 0;
    const args: any[] = [];

    // Command name (string - marker 0x02)
    if (buffer[offset] !== 0x02) {
      throw new Error(
        `Expected string marker (0x02), got 0x${(buffer[offset] || 0).toString(16)}`,
      );
    }
    const cmdLen = buffer.readUInt16BE(offset + 1);
    const command = buffer.toString("utf8", offset + 3, offset + 3 + cmdLen);
    offset += 3 + cmdLen;

    // Transaction ID (number - marker 0x00)
    if (buffer[offset] !== 0x00) {
      throw new Error(
        `Expected number marker (0x00), got 0x${(buffer[offset] || 0).toString(16)}`,
      );
    }
    const transactionId = buffer.readDoubleBE(offset + 1);
    offset += 9;

    // Parse arguments
    while (offset < buffer.length - 1) {
      const type = buffer[offset];

      if (type === 0x02) {
        // String
        const len = buffer.readUInt16BE(offset + 1);
        const value = buffer.toString("utf8", offset + 3, offset + 3 + len);
        args.push(value);
        offset += 3 + len;
      } else if (type === 0x05) {
        // Null
        args.push(null);
        offset += 1;
      } else if (type === 0x03) {
        // Object
        const obj: any = {};
        offset += 1;

        // Parse object properties
        while (offset < buffer.length - 2) {
          // Check for object end marker (0x00 0x00 0x09)
          if (
            buffer[offset] === 0x00 &&
            buffer[offset + 1] === 0x00 &&
            buffer[offset + 2] === 0x09
          ) {
            offset += 3;
            break;
          }

          // Read property name
          const propLen = buffer.readUInt16BE(offset);
          const propName = buffer.toString(
            "utf8",
            offset + 2,
            offset + 2 + propLen,
          );
          offset += 2 + propLen;

          // Read property value
          const propType = buffer[offset];
          if (propType === 0x02) {
            // String value
            const valLen = buffer.readUInt16BE(offset + 1);
            obj[propName] = buffer.toString(
              "utf8",
              offset + 3,
              offset + 3 + valLen,
            );
            offset += 3 + valLen;
          } else if (propType === 0x00) {
            // Number value
            obj[propName] = buffer.readDoubleBE(offset + 1);
            offset += 9;
          } else if (propType === 0x01) {
            // Boolean
            obj[propName] = buffer[offset + 1] !== 0;
            offset += 2;
          } else {
            // Unknown type, skip
            offset++;
          }
        }
        args.push(obj);
      } else if (type === 0x00) {
        // Number
        const value = buffer.readDoubleBE(offset + 1);
        args.push(value);
        offset += 9;
      } else {
        // Unknown type
        break;
      }
    }

    return { command, transactionId, args };
  }

  private async handleConnect(
    csid: number,
    transactionId: number,
    args: any[],
  ) {
    writeLog(`\n      🔌 COMANDO CONNECT`);

    // User Control: Stream Begin (event type 0)
    const streamBegin = Buffer.alloc(6);
    streamBegin.writeUInt16BE(0, 0); // Event type: StreamBegin
    streamBegin.writeUInt32BE(0, 2); // Stream ID
    this.sendControlMessage(2, MSG_USER_CONTROL, streamBegin);
    writeLog(`         📤 Stream Begin enviado`);

    // Send _result with connection info
    this.sendCommandResponse(
      csid,
      "_result",
      transactionId,
      {
        fmsVer: "FMS/3,5,7,7009",
        capabilities: 31,
        mode: 1,
      },
      {
        level: "status",
        code: "NetConnection.Connect.Success",
        description: "Connection succeeded",
        objectEncoding: 0,
      },
    );

    writeLog(`         ✅ _result(Connect.Success) enviado`);
    writeLog(`\n      🎉🎉🎉 CONEXIÓN EXITOSA 🎉🎉🎉\n`);
  }

  private async handlePublish(csid: number, args: any[]) {
    const streamKey = args[0] || "unknown";
    this.streamKey = streamKey;

    // Check for reconnection
    const previousClientId = checkForReconnection(streamKey, this.clientId);
    if (previousClientId) {
      this.isReconnection = true;
      const reconnectionInfo = reconnectionHistory.get(this.clientId);

      if (reconnectionInfo) {
        // Restore stream statistics from previous session
        const stats: StreamStats = {
          bytesReceived: reconnectionInfo.lastBytesReceived,
          startTime: Date.now() - reconnectionInfo.totalDuration,
          lastUpdate: Date.now(),
          bitrate: 0,
          streamKey,
          clientId: this.clientId,
        };

        streams.set(this.clientId, stats);

        writeLog(`🔄 ESTADO RESTAURADO`);
        writeLog(
          `   📊 Bytes previos: ${(reconnectionInfo.lastBytesReceived / 1024 / 1024).toFixed(2)} MB`,
        );
        writeLog(
          `   ⏱️  Duración previa: ${(reconnectionInfo.totalDuration / 1000).toFixed(2)}s`,
        );
      }
    }

    // Send onStatus
    this.sendCommandResponse(csid, "onStatus", 0, null, {
      level: "status",
      code: "NetStream.Publish.Start",
      description: this.isReconnection
        ? "Stream reconnected successfully"
        : "Stream is now published",
      details: streamKey,
    });

    const status = this.isReconnection
      ? "🔄🔄🔄 STREAM RECONECTADO 🔄🔄🔄"
      : "🎬🎬🎬 STREAM PUBLICADO 🎬🎬🎬";
    writeLog(`\n      ${status}`);
    writeLog(`         Stream Key: ${streamKey}`);
    if (this.isReconnection) {
      writeLog(`         Cliente anterior: ${previousClientId}`);
      writeLog(`         Nuevo cliente: ${this.clientId}`);
    }
    writeLog(`\n`);
  }

  private sendCommandResponse(
    csid: number,
    command: string,
    transactionId: number,
    ...args: any[]
  ) {
    const payload = this.encodeAMF0(command, transactionId, ...args);

    const header = Buffer.alloc(12);
    header[0] = (0 << 6) | (csid & 0x3f); // fmt=0
    header.writeUIntBE(0, 1, 3); // timestamp
    header.writeUIntBE(payload.length, 4, 3); // message length
    header[7] = MSG_AMF0_CMD;
    header.writeUInt32LE(0, 8); // stream id

    this.socket.write(Buffer.concat([header, payload]));
  }

  private encodeAMF0(
    command: string,
    transactionId: number,
    ...args: any[]
  ): Buffer {
    const buffers: Buffer[] = [];

    // Encode command name (string)
    buffers.push(Buffer.from([0x02])); // String marker
    const cmdBuf = Buffer.from(command, "utf8");
    const cmdLen = Buffer.allocUnsafe(2);
    cmdLen.writeUInt16BE(cmdBuf.length);
    buffers.push(cmdLen, cmdBuf);

    // Encode transaction ID (number)
    buffers.push(Buffer.from([0x00])); // Number marker
    const tidBuf = Buffer.allocUnsafe(8);
    tidBuf.writeDoubleBE(transactionId);
    buffers.push(tidBuf);

    // Encode arguments
    for (const arg of args) {
      if (arg === null || arg === undefined) {
        buffers.push(Buffer.from([0x05])); // Null marker
      } else if (typeof arg === "number") {
        buffers.push(Buffer.from([0x00])); // Number marker
        const numBuf = Buffer.allocUnsafe(8);
        numBuf.writeDoubleBE(arg);
        buffers.push(numBuf);
      } else if (typeof arg === "boolean") {
        buffers.push(Buffer.from([0x01])); // Boolean marker
        buffers.push(Buffer.from([arg ? 1 : 0]));
      } else if (typeof arg === "object") {
        buffers.push(Buffer.from([0x03])); // Object marker

        for (const [key, value] of Object.entries(arg)) {
          // Property name (no type marker for object keys)
          const keyBuf = Buffer.from(key, "utf8");
          const keyLen = Buffer.allocUnsafe(2);
          keyLen.writeUInt16BE(keyBuf.length);
          buffers.push(keyLen, keyBuf);

          // Property value
          if (typeof value === "string") {
            buffers.push(Buffer.from([0x02])); // String marker
            const valBuf = Buffer.from(value, "utf8");
            const valLen = Buffer.allocUnsafe(2);
            valLen.writeUInt16BE(valBuf.length);
            buffers.push(valLen, valBuf);
          } else if (typeof value === "number") {
            buffers.push(Buffer.from([0x00])); // Number marker
            const valBuf = Buffer.allocUnsafe(8);
            valBuf.writeDoubleBE(value);
            buffers.push(valBuf);
          } else if (typeof value === "boolean") {
            buffers.push(Buffer.from([0x01])); // Boolean marker
            buffers.push(Buffer.from([value ? 1 : 0]));
          }
        }

        // Object end marker
        buffers.push(Buffer.from([0x00, 0x00, 0x09]));
      }
    }

    return Buffer.concat(buffers);
  }
}

class RTMPServer {
  private port: number;

  constructor(port: number = 1935) {
    this.port = port;
    this.initLogFile();
    this.startTCPServer();
    startCleanupTimer(); // Start reconnection cleanup timer
  }

  // Public method to get reconnection statistics
  public getReconnectionStatus() {
    return getReconnectionStats();
  }

  // Public method to manually log reconnection status
  public logReconnectionStatus() {
    logReconnectionStats();
  }

  private async initLogFile() {
    writeLog("🚀 RTMP DEBUG SERVER - MODO VERBOSE");
    writeLog(`📁 Archivo de log: ${LOG_FILE}`);
  }

  private startTCPServer() {
    try {
      Bun.listen({
        hostname: "0.0.0.0",
        port: this.port,
        socket: {
          open: (socket: any) => {
            const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
            const conn = new RTMPConnection(socket, clientId);
            socket.data = conn;
            connections.set(clientId, conn);
          },

          // Procesar datos recibidos
          data: (socket: any, receivedData: Buffer) => {
            const clientId = `${socket.remoteAddress}:${socket.remotePort}`;

            // Intentar primero desde socket.data, luego desde Map global
            let conn = socket.data as RTMPConnection | undefined;

            if (conn) {
              socket.data = conn; // Reasignar por si acaso
            }

            if (!conn) {
              writeLog(`❌ ERROR: No se encuentra conexión para ${clientId}`);
              writeLog(
                `   Conexiones activas: ${Array.from(connections.keys()).join(", ")}`,
              );
              return;
            }

            const stats = streams.get(clientId);
            if (stats) {
              stats.bytesReceived += receivedData.length;
            }

            conn.handleData(receivedData);
          },

          close: (socket: any) => {
            const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
            const stats = streams.get(clientId);
            const conn = connections.get(clientId);

            if (stats && conn) {
              const duration = (Date.now() - stats.startTime) / 1000;
              const totalMB = stats.bytesReceived / 1024 / 1024;
              const avgBitrate = (stats.bytesReceived * 8) / duration / 1000;

              writeLog(`👋 CONEXIÓN CERRADA: ${clientId}`);
              writeLog(`   📊 Total: ${totalMB.toFixed(2)} MB`);
              writeLog(`   ⏱️  Duración: ${duration.toFixed(2)}s`);
              writeLog(`   📈 Bitrate: ${avgBitrate.toFixed(0)} kbps`);

              // Add to pending streams for reconnection if we have a stream key
              if (conn["streamKey"]) {
                addPendingStream(clientId, conn["streamKey"], stats);
              }

              streams.delete(clientId);
            }

            connections.delete(clientId); // ✅ Limpiar del Map global
          },

          error: (socket: any, error: any) => {
            writeLog(`❌ ERROR EN SOCKET: ${error}`);
          },
        },
      });

      writeLog(`\n✅ Servidor iniciado en rtmp://localhost:${this.port}`);
      writeLog(`📋 Configuración OBS:`);
      writeLog(`   Servidor: rtmp://localhost:${this.port}/live`);
      writeLog(`   Stream Key: cualquier_clave`);
      writeLog(`🔄 Reconexión automática: ACTIVADA`);
      writeLog(`   ⏰ Tiempo de espera: ${RECONNECTION_TIMEOUT / 1000}s`);
      writeLog(`   🧹 Limpieza: ${CLEANUP_INTERVAL / 1000}s\n`);
    } catch (error: any) {
      writeLog(`❌ ERROR FATAL: ${error.message}`);
      process.exit(1);
    }
  }
}

export { RTMPServer, RTMPConnection };
