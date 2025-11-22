import { spawn, type Subprocess } from "bun";

export class FFmpegTranscoder {
  private process: Subprocess | null = null;
  private streamKey: string;
  private httpPort: number;

  constructor(streamKey: string, httpPort: number = 3000) {
    this.streamKey = streamKey;
    this.httpPort = httpPort;
    // Ya no creamos directorios en disco
  }

  start() {
    console.log(`[Transcoder] 🎬 Iniciando FFmpeg (In-Memory) para: ${this.streamKey}`);

    // URL interna donde FFmpeg "subirá" los segmentos a Hono
    const hlsBaseUrl = `http://127.0.0.1:${this.httpPort}/internal/publish/${this.streamKey}/`;

    this.process = spawn([
      "ffmpeg",
      "-re", 
      "-i", "pipe:0",
      
      // --- VIDEO (Optimizado para estabilidad) ---
      "-c:v", "libx264",
      "-preset", "superfast", // veryfast es bueno, superfast reduce lag en CPU bajo
      "-tune", "zerolatency",
      
      // 🔥 CRÍTICO: Alineación de Keyframes
      // Para segmentos de 1s a 30fps, necesitamos un Keyframe cada 30 frames EXACTOS.
      // Si esto no cuadra, el reproductor se salta segmentos y se congela.
      "-r", "30",             // Forzar 30 fps de salida
      "-g", "30",             // Group of Pictures = 30 (1 segundo)
      "-keyint_min", "30",    // No permitir keyframes intermedios aleatorios
      "-sc_threshold", "0",   // Desactivar detección de escena (evita cortes raros)

      // --- AUDIO ---
      "-c:a", "aac", 
      "-ar", "44100", 
      "-b:a", "128k",

      // --- HLS OUTPUT (HTTP PUT) ---
      "-f", "hls",
      "-hls_time", "1",             // Segmentos de 1 segundo (mejor latencia)
      "-hls_list_size", "5",        // Lista pequeña (5s buffer) para low latency
      "-hls_flags", "delete_segments", // FFmpeg mandará DELETE al servidor
      "-method", "PUT",             // <--- EL TRUCO: Enviar a Hono en vez de disco
      `${hlsBaseUrl}index.m3u8`,    // Salida HLS principal

      // --- PREVIEW IMAGE (HTTP PUT) ---
      "-vf", "fps=1/5",             // 1 frame cada 5s
      "-update", "1",               // Sobreescribir
      "-method", "PUT",             // También enviar por HTTP
      `${hlsBaseUrl}preview.jpg`
    ], {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "inherit"
    });

    this.process.exited.then((code) => {
        if (code !== 0 && code !== null) {
            console.error(`[Transcoder] ⚠️ FFmpeg salió con código ${code}`);
        }
    });
  }

  stop() {
    if (this.process) {
      console.log(`[Transcoder] 🛑 Deteniendo: ${this.streamKey}`);
      this.process.kill();
      this.process = null;
    }
  }

  write(data: Buffer) {
    if (this.process?.stdin) {
      try {
        this.process.stdin.write(data);
        this.process.stdin.flush();
      } catch (e) {}
    }
  }
}