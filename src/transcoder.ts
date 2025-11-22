import { spawn, type Subprocess, type FileSink } from "bun";

export class FFmpegTranscoder {
  private process: Subprocess | null = null;
  private streamKey: string;
  private httpPort: number;

  constructor(streamKey: string, httpPort: number = 3000) {
    this.streamKey = streamKey;
    this.httpPort = httpPort;
  }

  start() {
    console.log(`[Transcoder] 🎬 Iniciando Transmisión RAM para: ${this.streamKey}`);

    // Rutas locales
    const baseUrl = `http://127.0.0.1:${this.httpPort}/internal/publish/${this.streamKey}`;
    const hlsUrl = `${baseUrl}/index.m3u8`;
    const previewUrl = `${baseUrl}/preview.jpg`;

    this.process = spawn([
      "ffmpeg",
      "-y", // Sobrescribir sin preguntar
      "-hide_banner",
      "-loglevel", "error", // Reducir ruido, ver solo errores reales
      "-re",
      "-i", "pipe:0", 

      // --- PROCESAMIENTO ---
      "-filter_complex", "[0:v]split=2[v_hls][v_temp];[v_temp]fps=1/5[v_img]",

      // ============================
      // SALIDA 1: HLS (Video + Audio) -> RAM
      // ============================
      "-map", "[v_hls]",
      "-map", "0:a",
      
      "-c:v", "libx264",
      "-preset", "superfast", 
      "-tune", "zerolatency",
      "-r", "30",
      "-g", "60",
      "-keyint_min", "60",
      "-sc_threshold", "0",
      
      "-c:a", "aac",
      "-ar", "44100",
      "-b:a", "128k",

      // -- HLS FLAGS ROBUSTOS PARA WINDOWS --
      "-f", "hls",
      "-hls_time", "2",
      "-hls_list_size", "5",
      "-hls_flags", "delete_segments",
      "-method", "PUT",
      // En Windows, a veces desactivar persistent ayuda si Hono cierra rápido, 
      // pero intentaremos mantenerlo con manejo de errores.
      "-send_expect_100", "0",   // <--- IMPORTANTE: No esperar confirmación de cabecera
      "-http_persistent", "1",   // Intentamos mantener persistencia en segmentos para velocidad
      "-headers", "Connection: keep-alive\r\n", 
      hlsUrl,

      // ============================
      // SALIDA 2: PREVIEW JPG -> RAM
      // ============================
      "-map", "[v_img]",
      "-update", "1",
      "-f", "image2",
      "-q:v", "5", // Calidad media para que pese menos la transferencia
      "-method", "PUT",
      // Para imágenes en Windows, desactivar persistencia suele ser más estable
      // porque son requests puntuales espaciados por 5 segundos.
      "-send_expect_100", "0",   // <--- IMPORTANTE
      "-http_persistent", "0",   // <--- APAGAR persistencia para imágenes en Windows
      "-headers", "Connection: close\r\n", // <--- Forzar cierre limpio tras cada JPG
      "-ignore_io_errors", "1",
      previewUrl

    ], {
      stdin: "pipe",
      stdout: "ignore", 
      stderr: "inherit"
    });

    this.process.exited.then((code) => {
      // Ignoramos el código 255 (interrupción manual) o null
        if (code !== 0 && code !== null && code !== 255) {
            console.error(`[Transcoder] ⚠️ FFmpeg cerrado con código ${code}`);
        } else {
            console.log(`[Transcoder] 🛑 Stream finalizado limpiamente.`);
        }
    });
  }

  stop() {
    if (this.process) {
      console.log(`[Transcoder] 🛑 Deteniendo stream: ${this.streamKey}`);
      this.process.kill(); // SIGTERM
      this.process = null;
    }
  }

  write(data: Buffer) {
    if (!this.process || !this.process.stdin) return;
    if (this.process.exitCode !== null) return;

    try {
        const stdin = this.process.stdin as unknown as FileSink;
        // En Bun, write devuelve bytes escritos, no booleano de drenaje
        stdin.write(data);
        // Flush suele ser automático en pipes, pero forzamos si es necesario
        stdin.flush(); 
    } catch (e) {
       // Silencio en pipes rotos
    }
  }
}