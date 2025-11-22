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
    console.log(`[Transcoder] 🎬 Iniciando FFmpeg (Fixed Filters) para: ${this.streamKey}`);

    const hlsBaseUrl = `http://127.0.0.1:${this.httpPort}/internal/publish/${this.streamKey}/`;

    this.process = spawn([
      "ffmpeg",
      "-re",
      "-i", "pipe:0",
      
      // --- CORRECCIÓN AQUÍ: FILTRO INTEGRADO ---
      // Explicación: 
      // 1. [0:v]split=2[v_hls][v_temp] -> Duplica el video original.
      // 2. ;[v_temp]fps=1/5[v_img]     -> Toma la copia temporal, baja los FPS y la llama [v_img].
      "-filter_complex", "[0:v]split=2[v_hls][v_temp];[v_temp]fps=1/5[v_img]",

      // ============================
      // SALIDA 1: HLS (Video + Audio)
      // ============================
      "-map", "[v_hls]",  // Usamos la copia limpia para el video fluido
      "-map", "0:a",      // Usamos el audio original
      
      "-c:v", "libx264",
      "-preset", "superfast",
      "-tune", "zerolatency",
      "-r", "30",
      "-g", "30",
      "-keyint_min", "30",
      "-sc_threshold", "0",
      
      "-c:a", "aac",
      "-ar", "44100",
      "-b:a", "128k",

      "-f", "hls",
      "-hls_time", "1",
      "-hls_list_size", "5",
      "-hls_flags", "delete_segments",
      "-method", "PUT",
      "-http_persistent", "0",
      `${hlsBaseUrl}index.m3u8`,

      // ============================
      // SALIDA 2: PREVIEW JPG
      // ============================
      "-map", "[v_img]", // Usamos la copia que YA TIENE los fps bajados en el filter_complex
      
      // NOTA: Eliminamos "-vf fps=1/5" de aquí porque ya lo hicimos arriba
      
      "-update", "1",
      "-f", "image2",
      "-method", "PUT",
      "-http_persistent", "0",
      "-ignore_io_errors", "1",
      `${hlsBaseUrl}preview.jpg`

    ], {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "inherit"
    });

    this.process.exited.then((code) => {
        if (code !== 0 && code !== null) {
            console.error(`[Transcoder] ⚠️ FFmpeg salió con código ${code}`);
        } else {
            console.log(`[Transcoder] 🛑 FFmpeg finalizó correctamente.`);
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
    if (!this.process || !this.process.stdin) return;
    try {
      const stdin = this.process.stdin as unknown as FileSink;
      stdin.write(data);
      stdin.flush();
    } catch (error) {
       // Ignorar
    }
  }
}