import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { ramStore } from './hls-store';

export class GstTranscoder {
  private process: ChildProcess | null = null;
  private streamKey: string;
  private tempDir: string;
  private watcher: fs.FSWatcher | null = null;
  private gstPath: string;

  constructor(streamKey: string, customGstPath?: string) {
    this.streamKey = streamKey;
    this.tempDir = path.join(process.cwd(), 'temp_hls', streamKey);
    
    const defaultWinPath = "C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-launch-1.0.exe";
    
    if (customGstPath) {
        this.gstPath = customGstPath;
    } else if (process.platform === 'win32' && fs.existsSync(defaultWinPath)) {
        this.gstPath = defaultWinPath;
    } else {
        this.gstPath = 'gst-launch-1.0';
    }
  }

  async start() {
    console.log(`[Transcoder] 🎬 Iniciando Pipeline para: ${this.streamKey}`);
    this.ensureDirectory();
    
    // GStreamer on Windows requires forward slashes for paths in arguments
    const tempDirPosix = this.tempDir.split(path.sep).join('/').replace(/\\/g, '/');

    const args = [
      // 1. SOURCE & DEMUX
      'fdsrc', 'fd=0', 
      '!', 'flvdemux', 'name=demux',

      // 2. VIDEO BRANCH -> MUXER
      'demux.video', 
      '!', 'queue', 'silent=true', 'leaky=1',
      '!', 'h264parse',
      '!', 'decodebin',
      '!', 'videoconvert',
      '!', 'video/x-raw,format=I420',
      '!', 'x264enc',
          'tune=zerolatency',
          'speed-preset=ultrafast',
          'bitrate=2500',
          'key-int-max=60',
          'threads=4',
      '!', 'h264parse',
      '!', 'mux.', // Connect to Muxer named 'mux'

      // 3. AUDIO BRANCH -> MUXER
      'demux.audio',
      '!', 'queue', 'silent=true', 'leaky=1',
      '!', 'aacparse',
      '!', 'decodebin',
      '!', 'audioconvert',
      '!', 'audioresample',
      '!', 'avenc_aac', 'bitrate=128000',
      '!', 'aacparse',
      '!', 'mux.', // Connect to Muxer named 'mux'
      
      // 4. MUXER DEFINITION & SINK
      'mpegtsmux', 'name=mux',
      '!', 'queue', 'silent=true',
      '!', 'hlssink2',
          `location=${tempDirPosix}/segment_%05d.ts`,
          `playlist-location=${tempDirPosix}/playlist.m3u8`,
          'target-duration=2',
          'max-files=10',
          'playlist-length=6'
    ];

    console.log(`\n[GST DEBUG] Pipeline Command:`);
    console.log(`"${this.gstPath}" ${args.join(' ')}\n`);

    try {
      if (path.isAbsolute(this.gstPath) && !fs.existsSync(this.gstPath)) {
         throw new Error(`GStreamer no encontrado en: ${this.gstPath}`);
      }

      const gstDir = path.dirname(this.gstPath);
      // Adjust library path based on OS logic if necessary
      const gstPluginPath = process.platform === 'win32' 
        ? path.join(gstDir, '..', 'lib', 'gstreamer-1.0')
        : undefined;
      
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        GST_DEBUG: '3'
      };

      if (gstPluginPath) {
        env.GST_PLUGIN_PATH = process.env.GST_PLUGIN_PATH || gstPluginPath;
        env.GST_PLUGIN_SYSTEM_PATH = process.env.GST_PLUGIN_SYSTEM_PATH || gstPluginPath;
      }

      this.process = spawn(this.gstPath, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        env: env
      });

      this.process.on('error', (err) => {
        console.error(`[Transcoder] ❌ Error al iniciar:`, err.message);
      });

      this.process.on('exit', (code) => {
        if (code !== null && code !== 0 && code !== 15) {
           console.error(`[Transcoder] ⚠️ GStreamer terminó con código: ${code}`);
        }
        this.stop();
      });

      if (this.process.stderr) {
        this.process.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          // Filter out common info noise, keep warnings/errors
          if (msg && (msg.includes('WARN') || msg.includes('ERROR') || msg.includes('erroneous'))) {
             console.error(`[GST LOG] ${msg}`);
          }
        });
      }

      this.startWatcher();

    } catch (e) {
      console.error(`[Transcoder] ❌ Excepción fatal:`, e);
    }
  }

  write(data: Buffer) {
    if (this.process?.stdin?.writable && !this.process.killed) {
      try {
        this.process.stdin.write(data);
      } catch (err) {
        // Ignore EPIPE (pipe closed) errors as they happen during shutdown
        if ((err as any).code !== 'EPIPE') {
          console.error('[Transcoder] Error escribiendo:', err);
        }
      }
    }
  }

  async stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      // Force kill if it doesn't exit gracefully
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 2000);
      this.process = null;
    }

    // Cleanup temp files after a short delay to ensure handles are released
    setTimeout(() => {
        try {
            if (fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
        } catch (e) { 
            console.error('[Transcoder] Cleanup warning:', e);
        }
    }, 1500);
  }

  private ensureDirectory() {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(this.tempDir, { recursive: true });
    } catch (e) {
      console.error('[Transcoder] Error creando directorio:', e);
    }
  }

  private startWatcher() {
    try {
      // Watch the directory for new .ts or .m3u8 files
      this.watcher = fs.watch(this.tempDir, (eventType, filename) => {
        if (!filename || filename.endsWith('.tmp')) return;
        
        const filePath = path.join(this.tempDir, filename);
        
        // Small delay to ensure file write is complete
        setTimeout(() => {
          try {
            if (!fs.existsSync(filePath)) return;
            
            // Basic debouncing/checking size could be added here
            const stat = fs.statSync(filePath);
            if (stat.size === 0) return;

            const data = fs.readFileSync(filePath);
            
            const ext = path.extname(filename);
            const contentType = 
              ext === '.m3u8' ? 'application/vnd.apple.mpegurl' :
              ext === '.ts' ? 'video/MP2T' :
              ext === '.jpg' ? 'image/jpeg' :
              'application/octet-stream';

            // Store in RAM for the HTTP server to serve
            ramStore.saveFile(this.streamKey, filename, data, contentType);
          } catch (e) {
            // File might have been deleted by rotation logic before we read it
            // This is normal in HLS rotation, so we log gently
            // console.warn(`[Watcher] Could not read ${filename}`);
          }
        }, 50); 
      });
    } catch (err) {
      console.error("[Transcoder] Error iniciando watcher:", err);
    }
  }
}