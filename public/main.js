class UniversalStreamPlayer {
  constructor() {
    this.video = document.getElementById("videoPlayer");
    this.player = null;
    this.currentMethod = null;
    this.streamKey = "test";
    this.isConnected = false;
    this.supportedCodecs = [];
    this.availableLibraries = [];
    this.stats = {
      chunksReceived: 0,
      chunksProcessed: 0,
      bitrate: 0,
      droppedFrames: 0,
      bufferLength: 0,
      totalBytesReceived: 0,
      connectionTime: 0,
    };

    this.methods = [
      {
        name: "mpegts",
        priority: 1,
        loader: () => this.loadMpegts(),
        available: false,
      },
      {
        name: "flvjs",
        priority: 2,
        loader: () => this.loadFLVJS(),
        available: false,
      },
      {
        name: "hls",
        priority: 3,
        loader: () => this.loadHLS(),
        available: false,
      },
      {
        name: "mse",
        priority: 4,
        loader: () => this.loadDirectMSE(),
        available: false,
      },
    ];

    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;

    this.init();
  }

  async init() {
    await this.detectAvailableLibraries();
    await this.detectCodecs();
    this.filterAvailableMethods();
    this.setupEventListeners();
    this.startStatsMonitor();
    this.updateCodecBadges();
    this.updateMethodIndicator();
    this.log("🚀 Universal Stream Player inicializado", "success");
    this.log(
      `🎯 Codecs soportados: ${this.supportedCodecs.join(", ")}`,
      "info",
    );
    this.log(
      `📚 Librerías disponibles: ${this.availableLibraries.join(", ")}`,
      "info",
    );
  }

  async detectAvailableLibraries() {
    this.availableLibraries = [];

    if (typeof mpegts !== "undefined") {
      this.availableLibraries.push("mpegts.js");
    }

    if (typeof flvjs !== "undefined") {
      this.availableLibraries.push("flv.js");
    }

    if (typeof Hls !== "undefined") {
      this.availableLibraries.push("hls.js");
    }

    if (typeof shaka !== "undefined") {
      this.availableLibraries.push("shaka-player");
    }

    if (window.MediaSource) {
      this.availableLibraries.push("MSE nativo");
    }
  }

  filterAvailableMethods() {
    this.methods.forEach((method) => {
      switch (method.name) {
        case "mpegts":
          method.available =
            typeof mpegts !== "undefined" && mpegts.isSupported();
          break;
        case "flvjs":
          method.available =
            typeof flvjs !== "undefined" && flvjs.isSupported();
          break;
        case "hls":
          method.available = typeof Hls !== "undefined" && Hls.isSupported();
          break;
        case "mse":
          method.available =
            window.MediaSource &&
            MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"');
          break;
      }
    });

    // Filtrar métodos no disponibles
    this.methods = this.methods.filter((method) => method.available);

    // Ordenar por prioridad
    this.methods.sort((a, b) => a.priority - b.priority);
  }

  updateCodecBadges() {
    const container = document.getElementById("codecBadges");
    if (!container) return;

    const badges = this.supportedCodecs
      .map((codec) => `<div class="codec-badge">${codec}</div>`)
      .join("");

    container.innerHTML =
      badges || '<div class="codec-badge">❌ No detectados</div>';
  }

  updateMethodIndicator() {
    const indicator = document.getElementById("methodIndicator");
    if (!indicator) return;

    if (this.currentMethod) {
      indicator.textContent = `🎯 ${this.currentMethod.name.toUpperCase()}`;
      indicator.style.background = "rgba(102, 126, 234, 0.9)";
    } else {
      indicator.textContent = "🔄 Esperando...";
      indicator.style.background = "rgba(0, 0, 0, 0.7)";
    }
  }

  async detectCodecs() {
    const video = document.createElement("video");
    const testCodecs = {
      h264: 'video/mp4; codecs="avc1.42E01E"',
      h265: 'video/mp4; codecs="hev1.1.6.L93.B0"',
      vp9: 'video/webm; codecs="vp9"',
      av1: 'video/mp4; codecs="av01.0.05M.08"',
      aac: 'audio/mp4; codecs="mp4a.40.2"',
      opus: 'audio/webm; codecs="opus"',
      mp3: "audio/mpeg",
    };

    this.supportedCodecs = Object.entries(testCodecs)
      .filter(([codec, mimeType]) => {
        const support = video.canPlayType(mimeType);
        return support !== "" && support !== "no";
      })
      .map(([codec]) => codec);
  }

  setupEventListeners() {
    // Video events
    this.video.addEventListener("loadstart", () =>
      this.log("🎬 Video iniciando carga", "info"),
    );
    this.video.addEventListener("loadedmetadata", () => {
      this.log(
        `📐 Video: ${this.video.videoWidth}x${this.video.videoHeight}`,
        "success",
      );
    });
    this.video.addEventListener("canplay", () =>
      this.log("✅ Video listo para reproducir", "success"),
    );
    this.video.addEventListener("error", (e) => {
      this.log(`❌ Error video: ${e.message}`, "error");
      this.tryFallback();
    });

    // Network events
    window.addEventListener("online", () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.log("🌐 Conexión restaurada, reintentando...", "info");
        this.connect();
      }
    });

    window.addEventListener("offline", () => {
      this.log("📡 Conexión perdida", "warning");
    });
  }

  startStatsMonitor() {
    setInterval(() => {
      this.updateStats();
    }, 500);
  }

  updateStats() {
    try {
      document.getElementById("chunksReceived").textContent =
        this.stats.chunksReceived;
      document.getElementById("chunksProcessed").textContent =
        this.stats.chunksProcessed;

      if (this.player && typeof this.player.statistics === "object") {
        const playerStats = this.player.statistics;
        this.stats.bitrate = playerStats.bitrate || 0;
        this.stats.bufferLength = playerStats.bufferLength || 0;
        this.stats.droppedFrames = playerStats.droppedFrames || 0;
      }

      const queueSize = Math.max(
        0,
        this.stats.chunksReceived - this.stats.chunksProcessed,
      );
      document.getElementById("queueSize").textContent = queueSize;

      const connectionTime = this.isConnected
        ? Math.floor((Date.now() - this.stats.connectionTime) / 1000)
        : 0;

      document.getElementById("bufferInfo").textContent =
        `📊 ${(this.stats.bitrate / 1024).toFixed(0)}KB/s | ` +
        `⏱️ ${this.stats.bufferLength.toFixed(1)}s | ` +
        `🎯 ${this.currentMethod?.name || "none"} | ` +
        `🕐 ${connectionTime}s`;
    } catch (error) {
      // Ignorar errores en stats
    }
  }

  startNetworkMonitoring() {
    // Monitor de rendimiento cada 5 segundos
    setInterval(() => {
      if (this.isConnected && this.player) {
        try {
          if (this.player.statistics) {
            const stats = this.player.statistics;
            this.log(
              `📊 Performance - BW: ${(stats.bitrate / 1024).toFixed(0)}KB/s | ` +
                `Buffer: ${stats.bufferLength.toFixed(1)}s | ` +
                `Dropped: ${stats.droppedFrames}`,
              "info",
            );
          }
        } catch (error) {
          // Ignorar errores en monitoring
        }
      }
    }, 5000);
  }

  async connect() {
    if (this.isConnected) {
      this.log("⚠️ Ya está conectado", "warning");
      return;
    }

    this.log("🔗 Iniciando conexión con fallback automático...", "info");
    this.updateStatus("Conectando...", "connecting");
    document.getElementById("fallbackIndicator").classList.add("active");

    this.stats.connectionTime = Date.now();

    for (const method of this.methods) {
      try {
        this.log(`🔄 Intentando método: ${method.name}`, "info");
        this.currentMethod = method;
        this.updateMethodIndicator();
        await method.loader();
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.updateStatus("Conectado", "connected");
        this.updateButtons();
        document.getElementById("fallbackIndicator").classList.remove("active");
        this.log(`✅ Conectado exitosamente con ${method.name}`, "success");
        this.startNetworkMonitoring();
        return;
      } catch (error) {
        this.log(`❌ ${method.name} falló: ${error.message}`, "warning");
        this.cleanup();
      }
    }

    this.log("❌ Todos los métodos fallaron", "error");
    this.updateStatus("Error", "error");
    document.getElementById("fallbackIndicator").classList.remove("active");
  }

  async loadMpegts() {
    if (typeof mpegts === "undefined") {
      throw new Error("mpegts.js no cargado");
    }

    if (!mpegts.isSupported()) {
      throw new Error("mpegts.js no soportado");
    }

    this.player = mpegts.createPlayer({
      type: "flv",
      isLive: true,
      url: `ws://${window.location.hostname}:${parseInt(window.location.port) + 1}/stream/${this.streamKey}`,
      hasAudio:
        this.supportedCodecs.includes("aac") ||
        this.supportedCodecs.includes("mp3"),
      hasVideo: this.supportedCodecs.includes("h264"),
      stashInitialSize: 1024 * 1024,
      enableWorker: true,
      lazyLoadMaxDuration: 3 * 60,
      lazyLoadRecoverDuration: 30,
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 3,
      autoCleanupMinBackwardDuration: 2,
      accurateSeek: true,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 3.0,
      liveBufferLatencyMinRemain: 0.5,
      debug: false,
    });

    this.setupMpegtsEvents();
    this.attachToVideo();

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout esperando datos mpegts"));
      }, 10000);

      this.player.on(mpegts.Events.MEDIA_INFO, () => {
        clearTimeout(timeout);
        resolve();
      });

      this.player.on(mpegts.Events.ERROR, (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.player.on(mpegts.Events.LOADING_COMPLETE, () => {
        this.stats.totalBytesReceived = this.player.bytesReceived || 0;
      });

      this.player.on(mpegts.Events.FRAG_PARSING_INIT_SEGMENT, () => {
        this.stats.chunksReceived++;
      });

      this.player.on(mpegts.Events.FRAG_PARSING_DATA, () => {
        this.stats.chunksProcessed++;
      });

      this.player.load();
      this.player.play().catch(reject);
    });
  }

  setupMpegtsEvents() {
    this.player.on(mpegts.Events.MEDIA_INFO, (mediaInfo) => {
      this.log("📺 MediaInfo recibido", "success");
      this.log(
        `🎬 Codecs: ${mediaInfo.videoCodec || "N/A"}/${mediaInfo.audioCodec || "N/A"}`,
        "info",
      );
      this.log(`📐 Resolución: ${mediaInfo.width}x${mediaInfo.height}`, "info");
    });

    this.player.on(mpegts.Events.METADATA_ARRIVED, (metadata) => {
      this.log("📋 Metadata recibido", "info");
      if (metadata.onMetaData) {
        this.log(
          `🎵 Audio: ${metadata.onMetaData.audiodatarate || "N/A"}kbps`,
          "info",
        );
        this.log(
          `🎬 Video: ${metadata.onMetaData.videodatarate || "N/A"}kbps`,
          "info",
        );
        this.log(`🖼️ FPS: ${metadata.onMetaData.framerate || "N/A"}`, "info");
      }
    });

    this.player.on(mpegts.Events.LOADING_COMPLETE, () => {
      this.log("🏁 Carga completa", "info");
    });

    this.player.on(mpegts.Events.ERROR, (error) => {
      this.log(`❌ Error mpegts: ${error.details} (${error.code})`, "error");
      throw error;
    });

    this.player.on(mpegts.Events.WARNING, (warning) => {
      this.log(
        `⚠️ Advertencia: ${warning.details} (${warning.code})`,
        "warning",
      );
    });

    this.player.on(mpegts.Events.STATISTICS_INFO, (stats) => {
      this.stats.chunksProcessed++;
    });
  }

  async loadFLVJS() {
    if (typeof flvjs === "undefined") {
      throw new Error("flv.js no cargado");
    }

    if (!flvjs.isSupported()) {
      throw new Error("flv.js no soportado");
    }

    this.player = flvjs.createPlayer({
      type: "flv",
      url: `ws://${window.location.hostname}:${parseInt(window.location.port) + 1}/stream/${this.streamKey}`,
      isLive: true,
      hasAudio: true,
      hasVideo: true,
      enableStashBuffer: true,
      stashInitialSize: 128,
      autoCleanupSourceBuffer: true,
      lazyLoad: false,
      autoCleanupMaxBackwardDuration: 3,
      autoCleanupMinBackwardDuration: 1,
      seekType: "range",
    });

    this.player.on(flvjs.Events.MEDIA_INFO, (mediaInfo) => {
      this.log(`📺 FLV MediaInfo: ${mediaInfo.codec}`, "info");
    });

    this.player.on(flvjs.Events.ERROR, (errorType, errorDetail) => {
      this.log(`❌ FLV Error: ${errorType} - ${errorDetail}`, "error");
      throw new Error(`FLV: ${errorType}`);
    });

    this.player.on(flvjs.Events.STATISTICS_INFO, (statisticsInfo) => {
      this.stats.chunksProcessed++;
      Object.assign(this.stats, statisticsInfo);
    });

    this.player.on(flvjs.Events.LOADING_COMPLETE, () => {
      this.log("📦 FLV loading completado", "success");
    });

    this.attachToVideo();
    this.player.load();
    await this.player.play();
  }

  async loadHLS() {
    if (typeof Hls === "undefined") {
      throw new Error("hls.js no cargado");
    }

    if (!Hls.isSupported()) {
      throw new Error("HLS no soportado");
    }

    this.player = new Hls({
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      maxBufferLength: 30,
      maxMaxBufferLength: 600,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 3,
      maxFragLookUpTolerance: 0.25,
      liveDurationInfinity: true,
      preferManagedMediaSource: true,
    });

    this.player.on(Hls.Events.MEDIA_ATTACHED, () => {
      this.log("📺 HLS Media Source attached", "info");
    });

    this.player.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      this.log(`📋 HLS Manifest parsed: ${data.levels.length} levels`, "info");
    });

    this.player.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        this.log(`❌ HLS Error fatal: ${data.details}`, "error");
        throw new Error(`HLS: ${data.details}`);
      }
    });

    this.player.on(Hls.Events.FRAG_BUFFERED, () => {
      this.stats.chunksProcessed++;
    });

    this.player.loadSource(
      `http://${window.location.hostname}:${window.location.port}/live/${this.streamKey}.m3u8`,
    );
    this.player.attachMedia(this.video);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout HLS"));
      }, 10000);

      this.player.once(Hls.Events.MANIFEST_PARSED, () => {
        clearTimeout(timeout);
        resolve();
      });

      this.player.once(Hls.Events.ERROR, () => {
        clearTimeout(timeout);
        reject(new Error("HLS manifest error"));
      });
    });
  }

  async loadDirectMSE() {
    if (
      !window.MediaSource ||
      !MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')
    ) {
      throw new Error("MSE no soportado");
    }

    const mediaSource = new MediaSource();
    this.video.src = URL.createObjectURL(mediaSource);

    await new Promise((resolve) => {
      mediaSource.addEventListener("sourceopen", resolve, { once: true });
    });

    // Crear buffers de audio y video
    const videoCodec = this.supportedCodecs.includes("h264")
      ? 'video/mp4; codecs="avc1.42E01E"'
      : null;
    const audioCodec = this.supportedCodecs.includes("aac")
      ? 'audio/mp4; codecs="mp4a.40.2"'
      : null;

    if (videoCodec) {
      const videoBuffer = mediaSource.addSourceBuffer(videoCodec);
      this.setupMSEBuffer(videoBuffer, "video");
    }

    if (audioCodec) {
      const audioBuffer = mediaSource.addSourceBuffer(audioCodec);
      this.setupMSEBuffer(audioBuffer, "audio");
    }

    // Conectar WebSocket directo
    const ws = new WebSocket(
      `ws://${window.location.hostname}:${parseInt(window.location.port) + 1}/stream/${this.streamKey}`,
    );

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      this.log("🔌 WebSocket MSE conectado", "success");
    };

    ws.onmessage = (event) => {
      this.stats.chunksReceived++;
      this.stats.totalBytesReceived += event.data.byteLength;

      // Aquí procesar los datos FLV y convertir a MP4 fragments
      // Esta es una implementación simplificada
      if (event.data instanceof ArrayBuffer) {
        this.processFLVData(event.data);
      }
    };

    ws.onerror = (error) => {
      this.log(`❌ MSE WebSocket error: ${error}`, "error");
      throw new Error("MSE WebSocket failed");
    };

    this.player = { ws, mediaSource };

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout MSE"));
      }, 10000);

      ws.onmessage = (event) => {
        clearTimeout(timeout);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("MSE connection failed"));
      };
    });
  }

  setupMSEBuffer(buffer, type) {
    buffer.addEventListener("updateend", () => {
      this.stats.chunksProcessed++;
    });

    buffer.addEventListener("error", (e) => {
      this.log(`❌ MSE Buffer error (${type}): ${e.message}`, "error");
    });
  }

  processFLVData(data) {
    // Procesamiento básico de FLV data para MSE
    try {
      const buffer = new Uint8Array(data);

      // Parsear FLV tag header (primeros 11 bytes)
      if (buffer.length < 11) return;

      const tagType = buffer[0];
      const dataSize = (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
      const timestamp =
        (buffer[4] << 16) | (buffer[5] << 8) | buffer[6] | (buffer[7] << 24);

      if (tagType === 8) {
        // Audio
        this.log(`🎵 Audio FLV tag: ${dataSize} bytes`, "info");
      } else if (tagType === 9) {
        // Video
        this.log(`🎥 Video FLV tag: ${dataSize} bytes`, "info");
      }

      // Aquí iría la conversión real de FLV a MP4 fragments
      // Por ahora solo contamos los chunks
      this.stats.chunksProcessed++;
    } catch (error) {
      this.log(`⚠️ Error procesando FLV: ${error.message}`, "warning");
    }
  }

  attachToVideo() {
    if (this.player && this.player.attachMediaElement) {
      this.player.attachMediaElement(this.video);
    }
  }

  async tryFallback() {
    if (
      !this.currentMethod ||
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      this.log("❌ Máximo de reconexiones alcanzado", "error");
      return;
    }

    this.reconnectAttempts++;
    const currentIndex = this.methods.indexOf(this.currentMethod);

    // Intentar el siguiente método
    for (let i = currentIndex + 1; i < this.methods.length; i++) {
      const method = this.methods[i];
      try {
        this.log(
          `🔄 Fallback a ${method.name} (intento ${this.reconnectAttempts})`,
          "info",
        );
        await this.cleanup();
        this.currentMethod = method;
        await method.loader();
        this.log(`✅ Fallback exitoso a ${method.name}`, "success");
        return;
      } catch (error) {
        this.log(
          `❌ Fallback ${method.name} falló: ${error.message}`,
          "warning",
        );
      }
    }

    this.log("❌ Todos los fallbacks fallaron", "error");
  }

  async cleanup() {
    this.stats.chunksReceived = 0;
    this.stats.chunksProcessed = 0;
    this.stats.totalBytesReceived = 0;
    this.stats.connectionTime = 0;

    if (this.player) {
      try {
        // Limpiar diferentes tipos de players
        if (this.player.pause) this.player.pause();
        if (this.player.unload) this.player.unload();
        if (this.player.detachMediaElement) this.player.detachMediaElement();
        if (this.player.destroy) this.player.destroy();
        if (this.player.ws) {
          this.player.ws.onmessage = null;
          this.player.ws.onerror = null;
          this.player.ws.close();
        }
        if (this.player.mediaSource) {
          if (this.player.mediaSource.readyState === "open") {
            this.player.mediaSource.endOfStream();
          }
        }
        if (this.player.destroy) this.player.destroy();
      } catch (error) {
        this.log(`⚠️ Error limpiando player: ${error.message}`, "warning");
      }
      this.player = null;
    }

    // Reset video element completamente
    try {
      this.video.pause();
      this.video.currentTime = 0;
      this.video.removeAttribute("src");
      this.video.load();

      // Limpiar todos los event listeners
      const clone = this.video.cloneNode(true);
      this.video.parentNode.replaceChild(clone, this.video);
      this.video = clone;
    } catch (error) {
      this.log(`⚠️ Error limpiando video: ${error.message}`, "warning");
    }
  }

  disconnect() {
    this.log("🔌 Desconectando...", "info");
    this.cleanup();
    this.isConnected = false;
    this.currentMethod = null;
    this.updateStatus("Desconectado", "error");
    this.updateButtons();
    this.log("✅ Desconectado correctamente", "success");
  }

  updateStatus(text, className) {
    const statusEl = document.getElementById("status");
    const statusText = document.getElementById("statusText");
    statusEl.className = `status ${className}`;
    statusText.textContent = text;
  }

  updateButtons() {
    document.getElementById("connectBtn").disabled = this.isConnected;
    document.getElementById("disconnectBtn").disabled = !this.isConnected;
    document.getElementById("testBtn").disabled = !this.isConnected;
  }

  log(message, type = "info") {
    const logs = document.getElementById("logs");
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement("div");

    const emoji =
      {
        success: "✅",
        error: "❌",
        info: "ℹ️",
        warning: "⚠️",
      }[type] || "ℹ️";

    logEntry.innerHTML = `[${timestamp}] ${emoji} ${message}`;
    logs.appendChild(logEntry);
    logs.scrollTop = logs.scrollHeight;
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

// Global instance
let player;

// Initialize when page loads
window.addEventListener("load", () => {
  player = new UniversalStreamPlayer();

  // Setup stream key input
  const streamKeyInput = document.getElementById("streamKeyInput");
  if (streamKeyInput) {
    streamKeyInput.value = player.streamKey;
    streamKeyInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        setStreamKey();
      }
    });
  }
});

// Global functions
function connect() {
  player.connect();
}

function disconnect() {
  player.disconnect();
}

async function sendTestChunk() {
  try {
    player.log("🧪 Solicitando test stream...", "info");
    const response = await fetch("/api/test-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      const result = await response.json();
      player.log(`✅ ${result.message}`, "success");
    } else {
      player.log("❌ Error solicitando test stream", "error");
    }
  } catch (error) {
    player.log(`❌ Error: ${error.message}`, "error");
  }
}

function clearLogs() {
  document.getElementById("logs").innerHTML = "";
  player.log("🚀 Logs limpiados", "success");
}

function useTestStream() {
  player.streamKey = "test";
  const streamKeyInput = document.getElementById("streamKeyInput");
  if (streamKeyInput) {
    streamKeyInput.value = "test";
  }
  player.log("🔑 Stream key: test", "info");

  if (player.isConnected) {
    player.disconnect();
    setTimeout(() => player.connect(), 1000);
  }
}

function setStreamKey() {
  const streamKeyInput = document.getElementById("streamKeyInput");
  const newStreamKey = streamKeyInput.value.trim();

  if (newStreamKey) {
    player.streamKey = newStreamKey;
    player.log(`🔑 Stream key: ${player.streamKey}`, "info");

    if (player.isConnected) {
      player.disconnect();
      setTimeout(() => player.connect(), 1000);
    }
  }
}
