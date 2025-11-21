import { FFmpegCommand, FFmpegManager, FFmpegOptions } from "ffmpeg-lib";
import { EventEmitter } from "node:events";

interface FFmpegStatus {
    isInstalled: boolean;
    manager: FFmpegManager;
    [key: string]: unknown;
}

// Interfaz para segmentos HLS en memoria
export interface HLSSegment {
    sequence: number;
    duration: number;
    data: Buffer;
    url: string;
    timestamp: number;
}

// Interfaz para playlist HLS
export interface HLSPlaylist {
    version: number;
    targetDuration: number;
    mediaSequence: number;
    segments: HLSSegment[];
    isLive: boolean;
    endList: boolean;
}

// Cache del manager de FFmpeg para evitar reinstalaciones
let cachedManager: FFmpegManager | null = null;
let ffmpegPaths: { ffmpegPath: string; ffprobePath: string } | null = null;

async function setupFFmpeg(): Promise<FFmpegStatus> {
    // Reutilizar manager si ya está configurado
    if (cachedManager && ffmpegPaths) {
        return { isInstalled: true, manager: cachedManager };
    }

    const manager = new FFmpegManager();
    
    // Verificar si FFmpeg está disponible
    const isInstalled = await manager.isFFmpegAvailable();
    
    if (!isInstalled) {
        console.log("📦 FFmpeg no encontrado, descargando binarios...");
        const install = await manager.downloadFFmpegBinaries();
        console.log("✅ FFmpeg instalado exitosamente");
        return { install, isInstalled: true, manager };
    }
    
    console.log("✅ FFmpeg encontrado en el sistema");
    return { isInstalled: true, manager };
}

async function getFFmpegPaths(): Promise<{ ffmpegPath: string; ffprobePath: string }> {
    if (ffmpegPaths) {
        return ffmpegPaths;
    }

    const { manager } = await setupFFmpeg();
    const paths = await manager.verifyBinaries();
    ffmpegPaths = paths;
    return paths;
}

export class HLSConverter extends EventEmitter {
    private ffmpegProcess: any = null;
    private segments: Map<number, HLSSegment> = new Map();
    private playlist: HLSPlaylist;
    private mediaSequence = 0;
    private isRunning = false;
    private maxSegments = 10; // Mantener solo los últimos 10 segmentos
    private segmentDuration = 4; // 4 segundos por segmento

    constructor() {
        super();
        this.playlist = {
            version: 3,
            targetDuration: this.segmentDuration,
            mediaSequence: this.mediaSequence,
            segments: [],
            isLive: true,
            endList: false
        };
    }

    async startConversion(streamKey: string, rtmpUrl?: string): Promise<void> {
        if (this.isRunning) {
            throw new Error("HLS conversion is already running");
        }

        try {
            const { ffmpegPath, ffprobePath } = await getFFmpegPaths();
            
            // Input será una URL RTMP o un stream local
            const inputUrl = rtmpUrl || `rtmp://localhost:1935/live/${streamKey}`;
            
            const ffmpegOptions: FFmpegOptions = {
                ffmpegPath,
                ffprobePath,
                timeout: 0, // Sin timeout para streaming continuo
            };

            const cmd = new FFmpegCommand(ffmpegOptions);

            console.log(`🎬 Iniciando conversión HLS para stream: ${streamKey}`);
            console.log(`📡 Input URL: ${inputUrl}`);

            // Configurar FFmpeg para leer desde RTMP y generar HLS
            const command = cmd
                .input(inputUrl)
                .inputOptions([
                    '-rw_timeout', '5000000', // 5 segundos de timeout para lectura
                    '-rtmp_live', 'live',     // Modo live
                    '-rtmp_buffer', '1000'    // Buffer de 1 segundo
                ])
                .output('stream.m3u8') // Especificar el archivo de salida principal
                .outputOptions([
                    '-f hls',
                    `-hls_time ${this.segmentDuration}`,
                    `-hls_list_size ${this.maxSegments}`,
                    '-hls_flags delete_segments+program_date_time+round_durations',
                    '-hls_segment_filename segment-%03d.ts',
                    '-hls_base_url ./',
                    // Opciones de video para baja latencia
                    '-c:v libx264',
                    '-preset veryfast',
                    '-tune zerolatency',
                    '-g 30', // Keyframe cada 1 segundo a 30fps
                    '-sc_threshold 0', // Forzar keyframes en intervalos fijos
                    '-b:v 2500k', // Bitrate video
                    '-maxrate 2500k',
                    '-bufsize 5000k',
                    '-pix_fmt yuv420p',
                    '-vf "scale=1280:720"',
                    // Opciones de audio
                    '-c:a aac',
                    '-b:a 128k',
                    '-ar 48000',
                    // Opciones de HLS específicas
                    '-hls_segment_type mpegts',
                    '-hls_flags append_list+delete_segments+program_date_time+round_durations',
                    '-hls_playlist_type event'
                ]);

            // Iniciar el proceso
            this.ffmpegProcess = await command.run();
            this.isRunning = true;

            // Manejar eventos del proceso
            this.setupProcessHandlers();

            console.log("✅ Conversión HLS iniciada correctamente");
            this.emit('started', { streamKey, inputUrl });

        } catch (error) {
            console.error("❌ Error al iniciar conversión HLS:", error);
            throw new Error(`Failed to start HLS conversion: ${error}`);
        }
    }

    private setupProcessHandlers(): void {
        if (!this.ffmpegProcess) return;

        const proc = this.ffmpegProcess as any;
        
        if (typeof proc.on === 'function') {
            proc.on('error', (error: any) => {
                console.error("❌ Error en proceso FFmpeg:", error);
                this.emit('error', error);
                this.stop();
            });
            
            proc.on('exit', (code: number, signal: string) => {
                console.log(`📋 Proceso FFmpeg terminado - Code: ${code}, Signal: ${signal}`);
                this.emit('stopped', { code, signal });
                this.isRunning = false;
            });

            // Capturar stdout para detectar creación de segmentos
            proc.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                console.log("FFmpeg stdout:", output);
                
                // Detectar cuando se crea un nuevo segmento
                const segmentMatch = output.match(/segment-(\d+)\.ts/);
                if (segmentMatch) {
                    const sequence = parseInt(segmentMatch[1]);
                    this.handleSegmentCreated(sequence);
                }
            });

            // Capturar stderr para información de progreso
            proc.stderr?.on('data', (data: Buffer) => {
                const output = data.toString();
                console.log("FFmpeg stderr:", output);
                
                // Extraer información de progreso si está disponible
                const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
                if (timeMatch) {
                    const hours = parseInt(timeMatch[1]);
                    const minutes = parseInt(timeMatch[2]);
                    const seconds = parseFloat(timeMatch[3]);
                    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
                    
                    this.emit('progress', {
                        time: totalSeconds,
                        type: 'conversion'
                    });
                }
            });
        }
        
        // Emitir evento ready cuando el proceso está iniciado
        this.emit('ready');
    }

    private async handleSegmentCreated(sequence: number): Promise<void> {
        try {
            // Simular la creación de un segmento (en una implementación real,
            // aquí leeríamos el archivo .ts creado por FFmpeg)
            const segmentData = Buffer.alloc(0); // Placeholder
            
            const segment: HLSSegment = {
                sequence,
                duration: this.segmentDuration,
                data: segmentData,
                url: `segment-${String(sequence).padStart(3, '0')}.ts`,
                timestamp: Date.now()
            };

            this.segments.set(sequence, segment);
            this.updatePlaylist();
            this.emit('segment', segment);

            console.log(`📦 Segmento HLS creado: ${segment.url}`);
            
            // Limpiar segmentos viejos
            this.cleanupOldSegments();
        } catch (error) {
            console.error("❌ Error manejando segmento creado:", error);
        }
    }

    // Método obsoleto - ya no escribimos datos directamente a FFmpeg
    // FFmpeg ahora lee directamente desde la URL RTMP
    writeRTMPData(data: Buffer): void {
        console.warn("⚠️ writeRTMPData() está obsoleto. FFmpeg ahora lee directamente desde RTMP URL");
        // Este método se mantiene por compatibilidad pero no hace nada
    }

    // Método para simular recepción de segmentos HLS (para testing)
    addSegment(sequence: number, duration: number, data: Buffer): void {
        const segment: HLSSegment = {
            sequence,
            duration,
            data,
            url: `segment-${String(sequence).padStart(3, '0')}.ts`,
            timestamp: Date.now()
        };

        this.segments.set(sequence, segment);
        this.updatePlaylist();
        this.emit('segment', segment);

        // Limpiar segmentos viejos
        this.cleanupOldSegments();
    }

    private updatePlaylist(): void {
        const sortedSegments = Array.from(this.segments.values())
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-this.maxSegments);

        this.playlist.segments = sortedSegments;
        this.playlist.mediaSequence = sortedSegments[0]?.sequence || this.mediaSequence;
        this.playlist.targetDuration = Math.max(
            ...sortedSegments.map(s => s.duration),
            this.segmentDuration
        );

        this.emit('playlist-updated', this.playlist);
    }

    private cleanupOldSegments(): void {
        const sortedSequences = Array.from(this.segments.keys()).sort((a, b) => a - b);
        const toKeep = sortedSequences.slice(-this.maxSegments);
        const toDelete = sortedSequences.filter(seq => !toKeep.includes(seq));

        toDelete.forEach(seq => {
            this.segments.delete(seq);
            this.emit('segment-deleted', { sequence: seq });
        });
    }

    getPlaylist(): string {
        let playlist = `#EXTM3U\n#EXT-X-VERSION:${this.playlist.version}\n`;
        playlist += `#EXT-X-TARGETDURATION:${Math.ceil(this.playlist.targetDuration)}\n`;
        playlist += `#EXT-X-MEDIA-SEQUENCE:${this.playlist.mediaSequence}\n`;
        playlist += `#EXT-X-ALLOW-CACHE:NO\n`;

        for (const segment of this.playlist.segments) {
            playlist += `#EXTINF:${segment.duration.toFixed(2)},\n`;
            playlist += `${segment.url}\n`;
        }

        if (this.playlist.endList) {
            playlist += `#EXT-X-ENDLIST\n`;
        }

        return playlist;
    }

    getSegment(sequence: number): Buffer | null {
        const segment = this.segments.get(sequence);
        return segment ? segment.data : null;
    }

    getAvailableSequences(): number[] {
        return Array.from(this.segments.keys()).sort((a, b) => a - b);
    }

    async stop(): Promise<void> {
        if (!this.isRunning || !this.ffmpegProcess) {
            return;
        }

        console.log("⏹️ Deteniendo conversión HLS");

        try {
            const proc = this.ffmpegProcess as any;
            
            // Cerrar stdin para señalar fin de stream
            if (proc.stdin && typeof proc.stdin.end === 'function') {
                proc.stdin.end();
            }

            // Esperar un poco y luego kill si no termina
            setTimeout(() => {
                if (typeof proc.kill === 'function') {
                    proc.kill('SIGTERM');
                }
            }, 5000);

        } catch (error) {
            console.error("Error deteniendo proceso FFmpeg:", error);
        }

        this.isRunning = false;
        this.ffmpegProcess = null;
        this.emit('stopped');
    }

    isActive(): boolean {
        return this.isRunning;
    }

    getStats(): { segments: number; isRunning: boolean; mediaSequence: number } {
        return {
            segments: this.segments.size,
            isRunning: this.isRunning,
            mediaSequence: this.playlist.mediaSequence
        };
    }
}

// Funciones utilitarias
export async function checkFFmpegAvailability(): Promise<boolean> {
    try {
        const { isInstalled } = await setupFFmpeg();
        return isInstalled;
    } catch (error) {
        console.error("Error checking FFmpeg availability:", error);
        return false;
    }
}

export async function getFFmpegInfo(): Promise<{ version?: string; available: boolean; ffmpegPath?: string; ffprobePath?: string; error?: string }> {
    try {
        const { manager } = await setupFFmpeg();
        const { ffmpegPath, ffprobePath } = await getFFmpegPaths();
        
        return {
            available: true,
            ffmpegPath,
            ffprobePath,
        };
    } catch (error) {
        return {
            available: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

// Función de compatibilidad con código antiguo
export async function convertHls(options: any): Promise<any> {
    console.warn("⚠️ convertHls() está deprecated. Usa HLSConverter class en su lugar.");
    
    const converter = new HLSConverter();
    const inputUrl = typeof options === 'string' ? options : options.inputUrl;
    const streamKey = inputUrl.split('/').pop() || 'stream';
    
    await converter.startConversion(streamKey);
    return converter;
}
