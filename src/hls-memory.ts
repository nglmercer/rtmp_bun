import { EventEmitter } from "node:events";

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

// Buffer para acumular datos RTMP y convertirlos a segmentos HLS
class RTMPBuffer {
    private buffer: Buffer = Buffer.alloc(0);
    private segmentDuration: number;
    private bytesPerSecond: number = 0; // Estimación de bitrate
    
    constructor(segmentDuration: number = 4) {
        this.segmentDuration = segmentDuration;
    }
    
    addData(data: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, data]);
    }
    
    // Determinar si tenemos suficientes datos para un segmento
    hasEnoughData(): boolean {
        // Estimación simple: necesitamos aproximadamente segmentDuration * bytesPerSecond
        const targetBytes = this.segmentDuration * this.bytesPerSecond;
        return this.buffer.length >= targetBytes || this.buffer.length >= 1024 * 100; // Mínimo 100KB
    }
    
    // Extraer datos para un segmento
    extractSegment(): Buffer {
        if (!this.hasEnoughData()) {
            return Buffer.alloc(0);
        }
        
        // Calcular tamaño del segmento basado en duración y bitrate
        const targetBytes = Math.min(
            this.buffer.length,
            Math.max(this.segmentDuration * this.bytesPerSecond, 1024 * 200) // Mínimo 200KB
        );
        
        const segmentData = this.buffer.subarray(0, targetBytes);
        this.buffer = this.buffer.subarray(targetBytes);
        
        // Actualizar estimación de bitrate si tenemos datos suficientes
        if (segmentData.length > 0) {
            this.bytesPerSecond = segmentData.length / this.segmentDuration;
        }
        
        return segmentData;
    }
    
    // Establecer bitrate estimado (opcional)
    setBitrate(bitrateKbps: number): void {
        this.bytesPerSecond = (bitrateKbps * 1000) / 8; // Convertir kbps a bytes/second
    }
    
    clear(): void {
        this.buffer = Buffer.alloc(0);
    }
    
    size(): number {
        return this.buffer.length;
    }
}

export class HLSMemoryConverter extends EventEmitter {
    private segments: Map<number, HLSSegment> = new Map();
    private playlist: HLSPlaylist;
    private mediaSequence = 0;
    private isRunning = false;
    private maxSegments = 10; // Mantener solo los últimos 10 segmentos
    private segmentDuration = 4; // 4 segundos por segmento
    private rtmpBuffer: RTMPBuffer;
    private segmentTimer: any = null;
    private nextSequence = 0;

    constructor() {
        super();
        this.rtmpBuffer = new RTMPBuffer(this.segmentDuration);
        this.playlist = {
            version: 3,
            targetDuration: this.segmentDuration,
            mediaSequence: this.mediaSequence,
            segments: [],
            isLive: true,
            endList: false
        };
    }

    async startConversion(streamKey: string): Promise<void> {
        if (this.isRunning) {
            throw new Error("HLS conversion is already running");
        }

        console.log(`🎬 Iniciando conversión HLS desde memoria para stream: ${streamKey}`);
        
        this.isRunning = true;
        this.nextSequence = 0;
        this.rtmpBuffer.clear();
        
        // Iniciar timer para generar segmentos periódicamente
        this.segmentTimer = setInterval(() => {
            this.tryGenerateSegment();
        }, this.segmentDuration * 1000); // Generar segmento cada 4 segundos

        this.emit('started', { streamKey });
        console.log("✅ Conversión HLS desde memoria iniciada correctamente");
    }

    // Método principal para recibir datos RTMP
    writeRTMPData(data: Buffer): void {
        if (!this.isRunning) {
            console.warn("⚠️ HLS conversion not started, ignoring data");
            return;
        }

        this.rtmpBuffer.addData(data);
        
        // Intentar generar un segmento si tenemos suficientes datos
        this.tryGenerateSegment();
    }

    private tryGenerateSegment(): void {
        if (!this.isRunning) return;

        if (this.rtmpBuffer.hasEnoughData()) {
            const segmentData = this.rtmpBuffer.extractSegment();
            
            if (segmentData.length > 0) {
                this.createSegment(this.nextSequence, this.segmentDuration, segmentData);
                this.nextSequence++;
            }
        }
    }

    private createSegment(sequence: number, duration: number, data: Buffer): void {
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

        console.log(`📦 Segmento HLS generado: ${segment.url} (${data.length} bytes)`);
        
        // Limpiar segmentos viejos
        this.cleanupOldSegments();
    }

    // Método para añadir segmentos manualmente (para testing)
    addSegment(sequence: number, duration: number, data: Buffer): void {
        this.createSegment(sequence, duration, data);
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
        if (!this.isRunning) {
            return;
        }

        console.log("⏹️ Deteniendo conversión HLS desde memoria");

        // Detener timer
        if (this.segmentTimer) {
            clearInterval(this.segmentTimer);
            this.segmentTimer = null;
        }

        // Generar último segmento con los datos restantes
        if (this.rtmpBuffer.size() > 0) {
            const remainingData = this.rtmpBuffer.extractSegment();
            if (remainingData.length > 0) {
                this.createSegment(this.nextSequence, this.segmentDuration, remainingData);
            }
        }

        // Marcar fin de lista
        this.playlist.endList = true;
        this.updatePlaylist();

        this.isRunning = false;
        this.emit('stopped');
        console.log("✅ Conversión HLS detenida");
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

    // Configurar bitrate estimado para mejor segmentación
    setEstimatedBitrate(bitrateKbps: number): void {
        this.rtmpBuffer.setBitrate(bitrateKbps);
        console.log(`📊 Bitrate estimado configurado: ${bitrateKbps} kbps`);
    }

    // Obtener información del buffer
    getBufferInfo(): { size: number; hasEnoughData: boolean } {
        return {
            size: this.rtmpBuffer.size(),
            hasEnoughData: this.rtmpBuffer.hasEnoughData()
        };
    }
}

// Función utilitaria para crear datos de segmento HLS simulados
export function createMockSegmentData(sequence: number, size: number = 1024): Buffer {
    const data = Buffer.alloc(size);
    
    // Crear un header TS simple (Transport Stream)
    // TS Sync byte (0x47)
    data[0] = 0x47;
    
    // Llenar con datos pseudo-aleatorios basados en la secuencia
    for (let i = 1; i < size; i++) {
        data[i] = (sequence + i) % 256;
    }
    
    return data;
}

// Función para crear playlist HLS completa para testing
export function createTestPlaylist(segmentCount: number): string {
    let playlist = `#EXTM3U\n#EXT-X-VERSION:3\n`;
    playlist += `#EXT-X-TARGETDURATION:4\n`;
    playlist += `#EXT-X-MEDIA-SEQUENCE:0\n`;
    playlist += `#EXT-X-ALLOW-CACHE:NO\n`;

    for (let i = 0; i < segmentCount; i++) {
        playlist += `#EXTINF:4.00,\n`;
        playlist += `segment-${String(i).padStart(3, '0')}.ts\n`;
    }

    return playlist;
}