import { test, describe, expect, beforeEach } from 'bun:test';
import { HLSConverter, HLSSegment } from '../src/hls';

describe('HLS Generation from Memory', () => {
  let converter: HLSConverter;

  beforeEach(() => {
    converter = new HLSConverter();
  });

  test('debería crear un conversor HLS con configuración inicial', () => {
    expect(converter).toBeDefined();
    expect(converter.isActive()).toBe(false);
    
    const stats = converter.getStats();
    expect(stats.segments).toBe(0);
    expect(stats.isRunning).toBe(false);
    expect(stats.mediaSequence).toBe(0);
  });

  test('debería generar playlist HLS vacía inicialmente', () => {
    const playlist = converter.getPlaylist();
    
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('#EXT-X-VERSION:3');
    expect(playlist).toContain('#EXT-X-TARGETDURATION:4');
    expect(playlist).toContain('#EXT-X-MEDIA-SEQUENCE:0');
    expect(playlist).toContain('#EXT-X-ALLOW-CACHE:NO');
    // No debe contener segmentos todavía
    expect(playlist).not.toContain('#EXTINF:');
  });

  test('debería añadir segmentos HLS manualmente', () => {
    // Simular datos de segmento de video (datos dummy de 1KB)
    const segmentData = Buffer.alloc(1024, 0x00);
    
    // Añadir primer segmento
    converter.addSegment(0, 4.0, segmentData);
    
    let stats = converter.getStats();
    expect(stats.segments).toBe(1);
    expect(stats.mediaSequence).toBe(0);
    
    let playlist = converter.getPlaylist();
    expect(playlist).toContain('#EXTINF:4.00,');
    expect(playlist).toContain('segment-000.ts');
    
    // Añadir segundo segmento
    const segmentData2 = Buffer.alloc(1024, 0x01);
    converter.addSegment(1, 4.0, segmentData2);
    
    stats = converter.getStats();
    expect(stats.segments).toBe(2);
    
    playlist = converter.getPlaylist();
    expect(playlist).toContain('segment-000.ts');
    expect(playlist).toContain('segment-001.ts');
  });

  test('debería mantener solo los últimos segmentos configurados', () => {
    // Añadir más segmentos del máximo permitido (10 por defecto)
    for (let i = 0; i < 15; i++) {
      const segmentData = Buffer.alloc(1024, i);
      converter.addSegment(i, 4.0, segmentData);
    }
    
    const stats = converter.getStats();
    expect(stats.segments).toBe(10); // Solo debe mantener los últimos 10
    
    const sequences = converter.getAvailableSequences();
    expect(sequences.length).toBe(10);
    expect(sequences[0]).toBe(5); // Debe empezar desde el segmento 5
    expect(sequences[9]).toBe(14); // hasta el 14
  });

  test('debería recuperar segmentos individuales', () => {
    const segmentData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    converter.addSegment(5, 3.5, segmentData);
    
    const retrievedSegment = converter.getSegment(5);
    expect(retrievedSegment).not.toBeNull();
    expect(retrievedSegment!.equals(segmentData)).toBe(true);
    
    const nonExistentSegment = converter.getSegment(999);
    expect(nonExistentSegment).toBeNull();
  });

  test('debería emitir eventos cuando se añaden segmentos', async () => {
    let segmentEventFired = false;
    let playlistUpdatedEventFired = false;
    
    converter.on('segment', (segment: HLSSegment) => {
      segmentEventFired = true;
      expect(segment.sequence).toBe(0);
      expect(segment.duration).toBe(4.0);
      expect(segment.url).toBe('segment-000.ts');
    });
    
    converter.on('playlist-updated', () => {
      playlistUpdatedEventFired = true;
    });
    
    const segmentData = Buffer.alloc(512);
    converter.addSegment(0, 4.0, segmentData);
    
    // Los eventos deberían haberse disparado sincrónicamente
    expect(segmentEventFired).toBe(true);
    expect(playlistUpdatedEventFired).toBe(true);
  });

  test('debería generar playlist HLS válida para reproductores', () => {
    // Añadir algunos segmentos
    for (let i = 0; i < 3; i++) {
      const segmentData = Buffer.alloc(1024, i);
      converter.addSegment(i, 4.0, segmentData);
    }
    
    const playlist = converter.getPlaylist();
    
    // Verificar estructura básica
    expect(playlist).toMatch(/^#EXTM3U\n#EXT-X-VERSION:3\n/);
    expect(playlist).toContain('#EXT-X-TARGETDURATION:4');
    expect(playlist).toContain('#EXT-X-MEDIA-SEQUENCE:0');
    expect(playlist).toContain('#EXT-X-ALLOW-CACHE:NO');
    
    // Verificar segmentos
    expect(playlist).toContain('#EXTINF:4.00,\nsegment-000.ts');
    expect(playlist).toContain('#EXTINF:4.00,\nsegment-001.ts');
    expect(playlist).toContain('#EXTINF:4.00,\nsegment-002.ts');
    
    // No debe terminar con #EXT-X-ENDLIST en modo live
    expect(playlist).not.toContain('#EXT-X-ENDLIST');
  });

  test('debería ajustar targetDuration según duración de segmentos', () => {
    // Añadir segmentos con diferentes duraciones
    converter.addSegment(0, 2.5, Buffer.alloc(1024));
    converter.addSegment(1, 6.2, Buffer.alloc(1024)); // Más largo que el default
    converter.addSegment(2, 3.8, Buffer.alloc(1024));
    
    const playlist = converter.getPlaylist();
    
    // El targetDuration debe ser el máximo, redondeado hacia arriba
    expect(playlist).toContain('#EXT-X-TARGETDURATION:7'); // 6.2 redondeado a 7
  });
});

describe('Integración con datos RTMP simulados', () => {
  test('debería procesar datos RTMP y generar HLS', async () => {
    const converter = new HLSConverter();
    let segmentCount = 0;
    
    // Escuchar eventos de segmentos
    converter.on('segment', (segment: HLSSegment) => {
      segmentCount++;
      console.log(`Segmento ${segment.sequence} generado: ${segment.url}`);
    });
    
    // Simular recepción de datos RTMP en chunks
    // En un caso real, estos datos vendrían del servidor RTMP
    const rtmpChunks = [
      Buffer.from([0x00, 0x01, 0x02, 0x03]), // Header dummy
      Buffer.from([0x04, 0x05, 0x06, 0x07]), // Datos de video dummy
      Buffer.from([0x08, 0x09, 0x0A, 0x0B]), // Más datos
    ];
    
    // Simular acumulación de datos hasta completar un segmento
    let accumulatedData = Buffer.alloc(0);
    for (const chunk of rtmpChunks) {
      accumulatedData = Buffer.concat([accumulatedData, chunk]);
      
      // Cuando tenemos suficientes datos, crear un segmento
      if (accumulatedData.length >= 12) {
        converter.addSegment(segmentCount, 4.0, accumulatedData);
        accumulatedData = Buffer.alloc(0); // Resetear para siguiente segmento
      }
    }
    
    expect(segmentCount).toBe(1);
    expect(converter.getStats().segments).toBe(1);
    
    const playlist = converter.getPlaylist();
    expect(playlist).toContain('segment-000.ts');
  });

  test('debería simular flujo completo de streaming', () => {
    const converter = new HLSConverter();
    const generatedSegments: HLSSegment[] = [];
    
    converter.on('segment', (segment: HLSSegment) => {
      generatedSegments.push(segment);
    });
    
    // Simular 30 segundos de streaming con segmentos de 4 segundos
    const totalDuration = 30;
    const segmentDuration = 4;
    const segmentCount = Math.ceil(totalDuration / segmentDuration);
    
    for (let i = 0; i < segmentCount; i++) {
      // Simular datos de video/audio para este segmento
      const segmentData = Buffer.alloc(4096, i % 256); // Datos dummy
      converter.addSegment(i, segmentDuration, segmentData);
    }
    
    expect(generatedSegments.length).toBe(segmentCount);
    expect(converter.getStats().segments).toBe(Math.min(segmentCount, 10)); // Máximo 10 segmentos
    
    // Verificar que la playlist se actualizó correctamente
    const playlist = converter.getPlaylist();
    expect(playlist).toContain('#EXT-X-MEDIA-SEQUENCE:' + Math.max(0, segmentCount - 10));
    
    // Verificar que los últimos segmentos están en la playlist
    const startSequence = Math.max(0, segmentCount - 10);
    for (let i = startSequence; i < segmentCount; i++) {
      expect(playlist).toContain(`segment-${String(i).padStart(3, '0')}.ts`);
    }
  });
});