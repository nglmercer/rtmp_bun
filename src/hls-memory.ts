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
        return this.buffer.length >= targetBytes || this.buffer.length >= 1024 * 500; // Mínimo 500KB
    }
    
    // Extraer datos para un segmento
    extractSegment(): Buffer {
        if (!this.hasEnoughData()) {
            return Buffer.alloc(0);
        }
        
        // Calcular tamaño del segmento basado en duración y bitrate
        const targetBytes = Math.min(
            this.buffer.length,
            Math.max(this.segmentDuration * this.bytesPerSecond, 1024 * 400) // Mínimo 400KB
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
        
        // Iniciar timer para generar datos RTMP simulados
        const dataTimer = setInterval(() => {
            if (!this.isRunning) {
                clearInterval(dataTimer);
                return;
            }
            this.generateMockRTMPData();
        }, 500); // Generar datos cada 500ms
        
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

    // Generar datos RTMP simulados para testing
    private generateMockRTMPData(): void {
        // Generar un chunk de datos RTMP simulados (aproximadamente 50KB)
        const chunkSize = 50 * 1024;
        const mockData = Buffer.alloc(chunkSize);
        
        // Llenar con patrones que simulen datos de video/audio
        for (let i = 0; i < chunkSize; i++) {
            mockData[i] = (Date.now() + i) % 256;
        }
        
        this.rtmpBuffer.addData(mockData);
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

        console.log(`📦 Segmento HLS creado: ${segment.url} (seq=${sequence}, size=${data.length} bytes)`);
        console.log(`📋 Total segmentos en memoria: ${this.segments.size}`);
        
        // Limpiar segmentos viejos
        this.cleanupOldSegments();
    }

    // Método para añadir segmentos manualmente (para testing)
    addSegment(sequence: number, duration: number, data: Buffer): void {
        console.log(`🎬 Añadiendo segmento manual: sequence=${sequence}, duration=${duration}, size=${data.length} bytes`);
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
        if (segment) {
            console.log(`🔍 Segmento encontrado: sequence=${sequence}, size=${segment.data.length} bytes`);
            return segment.data;
        } else {
            console.log(`❌ Segmento NO encontrado: sequence=${sequence}`);
            console.log(`📋 Secuencias disponibles: [${Array.from(this.segments.keys()).sort((a, b) => a - b).join(', ')}]`);
            return null;
        }
    }

    getAvailableSequences(): number[] {
        return Array.from(this.segments.keys()).sort((a, b) => a - b);
    }

    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        console.log("⏹️ Deteniendo conversión HLS desde memoria");

        // Detener timers
        if (this.segmentTimer) {
            clearInterval(this.segmentTimer);
            this.segmentTimer = null;
        }
        
        // El timer de datos se detiene automáticamente en el callback

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

// Función mejorada para crear datos de segmento HLS válidos
export function createValidMpegTSSegment(sequence: number, duration: number = 4.0): Buffer {
    const packets: Buffer[] = [];
    const packetSize = 188; // Tamaño estándar de paquete TS
    const numPackets = Math.max(100, Math.ceil(duration * 25)); // ~25 paquetes por segundo mínimo
    
    console.log(`🎬 Creando segmento ${sequence} con ${numPackets} paquetes TS`);
    
    for (let i = 0; i < numPackets; i++) {
        const packet = Buffer.alloc(packetSize);
        
        // TS Header (4 bytes)
        packet[0] = 0x47; // Sync byte
        
        // Diferentes PIDs para diferentes streams
        let pid: number;
        let payloadStart: number;
        
        if (i === 0) {
            // PAT - Program Association Table (PID 0)
            pid = 0x0000;
            packet[1] = 0x40; // Payload unit start indicator
            packet[2] = 0x00; // PID low bits
            packet[3] = 0x10; // No adaptation field, continuity counter 0
            
            // PAT payload
            packet[4] = 0x00; // Pointer field
            packet[5] = 0x00; // Table ID
            packet[6] = 0xB0; // Section syntax indicator + 0
            packet[7] = 0x0D; // Section length
            packet[8] = 0x00; // Transport stream ID
            packet[9] = 0x01;
            packet[10] = 0xC1; // Version + current_next_indicator
            packet[11] = 0x00; // Section number
            packet[12] = 0x00; // Last section number
            packet[13] = 0x00; // Program number
            packet[14] = 0x01;
            packet[15] = 0xF0; // PMT PID
            packet[16] = 0x20; // PMT PID
            packet[17] = 0x4E; // CRC32 first byte
            packet[18] = 0x3D;
            packet[19] = 0x6A;
            packet[20] = 0xE1;
            
            payloadStart = 21;
        } else if (i === 1) {
            // PMT - Program Map Table (PID 0x20)
            pid = 0x0020;
            packet[1] = 0x40; // Payload unit start indicator
            packet[2] = 0x20; // PID low bits
            packet[3] = 0x10; // No adaptation field, continuity counter 0
            
            // PMT payload
            packet[4] = 0x00; // Pointer field
            packet[5] = 0x02; // Table ID
            packet[6] = 0xB0; // Section syntax indicator
            packet[7] = 0x17; // Section length
            packet[8] = 0x00; // Program number
            packet[9] = 0x01;
            packet[10] = 0xC1; // Version
            packet[11] = 0x00; // Section number
            packet[12] = 0x00; // Last section number
            packet[13] = 0xE0; // PCR PID
            packet[14] = 0x01;
            packet[15] = 0xF0; // Program info length
            packet[16] = 0x00;
            // Video stream (H.264)
            packet[17] = 0x1B; // Stream type (H.264)
            packet[18] = 0xF1; // Elementary PID
            packet[19] = 0x00;
            packet[20] = 0xF0; // ES info length
            packet[21] = 0x00;
            // Audio stream (AAC)
            packet[22] = 0x0F; // Stream type (AAC)
            packet[23] = 0xF1; // Elementary PID
            packet[24] = 0x01;
            packet[25] = 0xF0; // ES info length
            packet[26] = 0x00;
            packet[27] = 0x53; // CRC32 first byte
            packet[28] = 0x9E;
            packet[29] = 0x9A;
            packet[30] = 0x0B;
            
            payloadStart = 31;
        } else if (i % 3 === 0) {
            // Video stream (PID 0x100)
            pid = 0x0100;
            packet[1] = 0x01; // No payload start, no adaptation field
            packet[2] = 0x00; // PID low bits
            packet[3] = 0x10 | ((i / 3) & 0x0F); // Continuity counter
            payloadStart = 4;
            
            // H.264 NAL unit header (simulado)
            if (i === 3) {
                packet[4] = 0x00;
                packet[5] = 0x00;
                packet[6] = 0x00;
                packet[7] = 0x01; // NAL start
                packet[8] = 0x67; // SPS NAL type
                payloadStart = 9;
            }
        } else {
            // Audio stream (PID 0x101)
            pid = 0x0101;
            packet[1] = 0x01; // No payload start, no adaptation field
            packet[2] = 0x01; // PID low bits
            packet[3] = 0x10 | ((i / 3) & 0x0F); // Continuity counter
            payloadStart = 4;
            
            // ADTS header (simulado)
            if (i === 4) {
                packet[4] = 0xFF;
                packet[5] = 0xF1;
                packet[6] = 0x50;
                packet[7] = 0x80;
                payloadStart = 8;
            }
        }
        
        // Ajustar PID en el header
        packet[1] |= (pid >> 8) & 0x1F;
        packet[2] = pid & 0xFF;
        
        // Payload (datos simulados)
        for (let j = payloadStart; j < packetSize; j++) {
            // Crear datos que parezcan contenido de video/audio real
            packet[j] = (sequence + i * 17 + j * 3) % 256;
        }
        
        packets.push(packet);
    }
    
    const segment = Buffer.concat(packets);
    console.log(`✅ Segmento ${sequence} creado: ${segment.length} bytes, ${packets.length} paquetes`);
    return segment;
}

// Función para crear segmento H.264 simple con datos de prueba
function createH264NALUnit(type: number, data: Buffer): Buffer {
    const header = Buffer.from([0x00, 0x00, 0x00, 0x01, type]);
    return Buffer.concat([header, data]);
}

// Función para crear ADTS header para AAC
function createADTSHeader(sampleRate: number, channelCount: number, frameLength: number): Buffer {
    const header = Buffer.alloc(7);
    
    // Sync word
    header[0] = 0xFF;
    header[1] = 0xF1;
    
    // Audio object type (AAC-LC = 2)
    header[2] = (2 << 6) | (sampleRate << 2) | (channelCount >> 2);
    header[3] = (channelCount & 0x3) << 6 | (frameLength >> 11) & 0x3;
    header[4] = (frameLength >> 3) & 0xFF;
    header[5] = ((frameLength & 0x7) << 5) | 0x1F;
    header[6] = 0xFC;
    
    return header;
}

// Función para crear segmento de prueba con contenido multimedia realista
export function createRealisticSegment(sequence: number, duration: number = 4.0): Buffer {
    const packets: Buffer[] = [];
    const packetSize = 188;
    const numPackets = Math.max(50, Math.ceil(duration * 25));
    
    console.log(`🎬 Creando segmento realista ${sequence} con ${numPackets} paquetes TS`);
    
    // Crear datos de video (SPS, PPS, y algunos frames)
    const spsData = Buffer.from([0x42, 0x00, 0x1E, 0x8D, 0x40, 0x50, 0x17, 0xFC, 0xB0, 0x0F, 0x08, 0x84]);
    const ppsData = Buffer.from([0xCE, 0x38, 0x80]);
    const iframeData = Buffer.alloc(100);
    const pframeData = Buffer.alloc(80);
    
    // Llenar datos de frame con patrones realistas
    for (let i = 0; i < iframeData.length; i++) {
        iframeData[i] = (sequence + i * 7) % 256;
    }
    for (let i = 0; i < pframeData.length; i++) {
        pframeData[i] = (sequence + i * 11 + 50) % 256;
    }
    
    const spsNAL = createH264NALUnit(7, spsData); // SPS
    const ppsNAL = createH264NALUnit(8, ppsData); // PPS
    const iframeNAL = createH264NALUnit(5, iframeData); // I-frame
    const pframeNAL = createH264NALUnit(1, pframeData); // P-frame
    
    // Crear datos de audio AAC
    const audioData = Buffer.alloc(50);
    for (let i = 0; i < audioData.length; i++) {
        audioData[i] = (sequence + i * 13 + 100) % 256;
    }
    const adtsHeader = createADTSHeader(4, 2, audioData.length + 7);
    const audioFrame = Buffer.concat([adtsHeader, audioData]);
    
    let videoPayload = Buffer.concat([spsNAL, ppsNAL, iframeNAL, pframeNAL]);
    let audioPayload = audioFrame;
    
    for (let i = 0; i < numPackets; i++) {
        const packet = Buffer.alloc(packetSize);
        packet[0] = 0x47; // Sync byte
        
        let pid: number;
        let payload: Buffer;
        let continuityCounter: number;
        
        if (i === 0) {
            // PAT packet
            pid = 0x0000;
            packet[1] = 0x40;
            packet[2] = 0x00;
            packet[3] = 0x10;
            
            // PAT payload simplificado
            packet[4] = 0x00;
            packet[5] = 0x00;
            packet[6] = 0xB0;
            packet[7] = 0x0D;
            packet[8] = 0x00;
            packet[9] = 0x01;
            packet[10] = 0xC1;
            packet[11] = 0x00;
            packet[12] = 0x00;
            packet[13] = 0x00;
            packet[14] = 0x01;
            packet[15] = 0xF0;
            packet[16] = 0x20;
            
            // Llenar resto con CRC y padding
            for (let j = 17; j < packetSize; j++) {
                packet[j] = (i + j) % 256;
            }
        } else if (i === 1) {
            // PMT packet
            pid = 0x0020;
            packet[1] = 0x40;
            packet[2] = 0x20;
            packet[3] = 0x10;
            
            // PMT payload simplificado
            packet[4] = 0x00;
            packet[5] = 0x02;
            packet[6] = 0xB0;
            packet[7] = 0x12;
            packet[8] = 0x00;
            packet[9] = 0x01;
            packet[10] = 0xC1;
            packet[11] = 0x00;
            packet[12] = 0x00;
            packet[13] = 0xE0;
            packet[14] = 0x00;
            packet[15] = 0xF0;
            packet[16] = 0x00;
            packet[17] = 0x1B; // H.264
            packet[18] = 0xF1;
            packet[19] = 0x00;
            packet[20] = 0xF0;
            packet[21] = 0x00;
            packet[22] = 0x0F; // AAC
            packet[23] = 0xF1;
            packet[24] = 0x01;
            packet[25] = 0xF0;
            packet[26] = 0x00;
            
            // Llenar resto
            for (let j = 27; j < packetSize; j++) {
                packet[j] = (i + j) % 256;
            }
        } else if (i % 3 === 0) {
            // Video packets
            pid = 0x0100;
            packet[1] = (i === 3) ? 0x41 : 0x01; // Payload start para primer packet de video
            packet[2] = 0x00;
            continuityCounter = Math.floor(i / 3) % 16;
            packet[3] = 0x10 | continuityCounter;
            
            if (i === 3 && videoPayload.length > 0) {
                // Primer packet de video con PES header
                const pesHeaderLength = 14;
                const payloadSize = Math.min(packetSize - 4 - pesHeaderLength, videoPayload.length);
                
                // PES header
                packet[4] = 0x00;
                packet[5] = 0x00;
                packet[6] = 0x01;
                packet[7] = 0xE0; // Video stream ID
                packet[8] = 0x00;
                packet[9] = 0x00;
                packet[10] = 0x80;
                packet[11] = 0x80;
                packet[12] = 0x05;
                packet[13] = 0x21;
                packet[14] = 0x00;
                packet[15] = 0x01;
                packet[16] = 0x00;
                packet[17] = 0x01;
                
                // Copiar payload
                videoPayload.copy(packet, 18, 0, payloadSize);
                videoPayload = videoPayload.subarray(payloadSize);
            } else if (videoPayload.length > 0) {
                // Packets subsiguientes de video
                const payloadSize = Math.min(packetSize - 4, videoPayload.length);
                videoPayload.copy(packet, 4, 0, payloadSize);
                videoPayload = videoPayload.subarray(payloadSize);
            }
            
            // Llenar resto si es necesario
            for (let j = (videoPayload.length === 0 && i > 3) ? 4 : 18; j < packetSize; j++) {
                if (!packet[j]) packet[j] = (sequence + i * 7 + j) % 256;
            }
        } else {
            // Audio packets
            pid = 0x0101;
            packet[1] = (i === 4) ? 0x41 : 0x01; // Payload start para primer packet de audio
            packet[2] = 0x01;
            continuityCounter = Math.floor((i - 1) / 3) % 16;
            packet[3] = 0x10 | continuityCounter;
            
            if (i === 4 && audioPayload.length > 0) {
                // Primer packet de audio con PES header
                const pesHeaderLength = 14;
                const payloadSize = Math.min(packetSize - 4 - pesHeaderLength, audioPayload.length);
                
                // PES header
                packet[4] = 0x00;
                packet[5] = 0x00;
                packet[6] = 0x01;
                packet[7] = 0xC0; // Audio stream ID
                packet[8] = 0x00;
                packet[9] = 0x00;
                packet[10] = 0x80;
                packet[11] = 0x80;
                packet[12] = 0x05;
                packet[13] = 0x21;
                packet[14] = 0x00;
                packet[15] = 0x01;
                packet[16] = 0x00;
                packet[17] = 0x01;
                
                // Copiar payload
                audioPayload.copy(packet, 18, 0, payloadSize);
                audioPayload = audioPayload.subarray(payloadSize);
            } else if (audioPayload.length > 0) {
                // Packets subsiguientes de audio
                const payloadSize = Math.min(packetSize - 4, audioPayload.length);
                audioPayload.copy(packet, 4, 0, payloadSize);
                audioPayload = audioPayload.subarray(payloadSize);
            }
            
            // Llenar resto si es necesario
            for (let j = (audioPayload.length === 0 && i > 4) ? 4 : 18; j < packetSize; j++) {
                if (!packet[j]) packet[j] = (sequence + i * 11 + j) % 256;
            }
        }
        
        packets.push(packet);
    }
    
    const segment = Buffer.concat(packets);
    console.log(`✅ Segmento realista ${sequence} creado: ${segment.length} bytes, ${packets.length} paquetes`);
    return segment;
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