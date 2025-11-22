import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { ramStore } from './hls-store';
import { GStreamerFix } from './gstreamer-fix';

export class GstTranscoder {
  private process: ChildProcess | null = null;
  private streamKey: string;
  private tempDir: string;
  private watcher: fs.FSWatcher | null = null;
  private gstPath: string;
  private isUsingFallback: boolean = false;
  private retryCount: number = 0;
  private maxRetries: number = 1;

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
    
    try {
      // Check GStreamer installation first
      await GStreamerFix.installPlugins();
    } catch (error) {
      console.error(`[Transcoder] ❌ GStreamer check failed:`, error);
      throw error;
    }
    
    this.ensureDirectory();
    
    // Try the fixed pipeline first, fallback if needed
    let args = this.isUsingFallback
      ? GStreamerFix.getFallbackPipeline(this.streamKey, this.tempDir)
      : GStreamerFix.getFixedPipeline(this.streamKey, this.tempDir);
    let pipelineType = this.isUsingFallback ? "FALLBACK" : "PRIMARY";

    console.log(`\n[GST DEBUG] ${pipelineType} Pipeline Command:`);
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
        GST_DEBUG: '2', // Reducir verbosidad para ver solo errores importantes
        GST_DEBUG_NO_COLOR: '1' // Para mejor legibilidad en logs
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
           console.error(`[Transcoder] ⚠️ ${pipelineType} GStreamer terminó con código: ${code}`);
           
           // Try fallback pipeline if primary failed and we haven't tried it yet
           if (!this.isUsingFallback && this.retryCount < this.maxRetries) {
             console.log(`[Transcoder] 🔄 Attempting fallback pipeline...`);
             this.isUsingFallback = true;
             this.retryCount++;
             
             // Restart with fallback after a short delay
             setTimeout(() => {
               this.start();
             }, 1000);
             return;
           }
        }
        this.stop();
      });

      if (this.process.stderr) {
        this.process.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          // Filtrar para mostrar solo errores críticos y warnings importantes
          if (msg) {
            // Ignorar algunos warnings comunes que no son críticos
            const ignorePatterns = [
              /couldn't find fd/,
              /GST_POLL/,
              /Delayed linking failed/  // Ya manejamos esto con caps explícitos
            ];
            
            const shouldIgnore = ignorePatterns.some(pattern => pattern.test(msg));
            
            if (!shouldIgnore && (msg.includes('WARN') || msg.includes('ERROR') || msg.includes('refused caps') || msg.includes('not-negotiated'))) {
               console.error(`[GST LOG] ${msg}`);
               
               // Detectar errores críticos que requieran fallback
               if (msg.includes('refused caps') || msg.includes('not-negotiated') || msg.includes('not-linked')) {
                 console.log(`[Transcoder] 🚨 Critical error detected, will trigger fallback if needed`);
               }
            }
          }
        });
      }

      // Add stdout monitoring for additional debugging
      if (this.process.stdout) {
        this.process.stdout.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) {
            console.log(`[GST STDOUT] ${msg}`);
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
        // Validate FLV data before writing
        if (data.length > 0) {
          // Log first few bytes for debugging
          if (data.length >= 13) {
            const header = data.subarray(0, 13);
            const flvSignature = header.toString('utf8', 0, 3);
            
            if (flvSignature === 'FLV') {
              console.log(`[Transcoder] 📄 FLV header detected: ${header.toString('hex')}`);
            } else {
              // Check if it's an FLV tag
              const tagType = data[0];
              if (tagType === 8 || tagType === 9 || tagType === 18) {
                const dataSize = data.readUIntBE(1, 3);
                const timestamp = data.readUIntBE(4, 3) | (data[7] << 24);
                //console.log(`[Transcoder] 🏷️  FLV tag: type=${tagType} (${this.getTagTypeName(tagType)}), size=${dataSize}, ts=${timestamp}`);
              } else {
                console.warn(`[Transcoder] ⚠️  Unknown data type: 0x${tagType.toString(16)}`);
              }
            }
          }
        }
        
        this.process.stdin.write(data);
      } catch (err) {
        // Ignore EPIPE (pipe closed) errors as they happen during shutdown
        if ((err as any).code !== 'EPIPE') {
          console.error('[Transcoder] Error escribiendo:', err);
        }
      }
    }
  }

  private getTagTypeName(tagType: number): string {
    switch (tagType) {
      case 8: return 'Audio';
      case 9: return 'Video';
      case 18: return 'Script';
      default: return `Unknown(${tagType})`;
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

    // Cleanup temp files after a longer delay to ensure handles are released
    setTimeout(() => {
        try {
            if (fs.existsSync(this.tempDir)) {
                // Try multiple times with increasing delays
                const cleanupWithRetry = (attempt: number) => {
                    try {
                        fs.rmSync(this.tempDir, { recursive: true, force: true });
                        console.log(`[Transcoder] ✅ Cleanup successful on attempt ${attempt}`);
                    } catch (e) {
                        if (attempt < 3) {
                            console.log(`[Transcoder] ⏳ Cleanup retry ${attempt}/3...`);
                            setTimeout(() => cleanupWithRetry(attempt + 1), 2000 * attempt);
                        } else {
                            console.error('[Transcoder] ❌ Cleanup failed after 3 attempts:', e);
                        }
                    }
                };
                cleanupWithRetry(1);
            }
        } catch (e) {
            console.error('[Transcoder] Cleanup error:', e);
        }
    }, 3000);
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