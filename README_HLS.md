# RTMP Bun - HLS Streaming Server con HTTP Callback

## 🎯 Estrategia 1: El Enfoque "HTTP Callback" (La solución PRO)

Implementación completa de streaming HLS con almacenamiento 100% en RAM usando el método HTTP Callback de FFmpeg.

## ✅ Características Implementadas

- **100% Multiplataforma**: Funciona en Windows, Linux, Mac
- **Rendimiento Extremo**: Todo ocurre en la RAM del proceso Bun
- **Cero Desgaste de Disco**: Tu SSD te lo agradecerá
- **Sistema de Rutas Modular**: Código mantenible y escalable
- **Interfaz Web Moderna**: Control completo del sistema
- **API REST**: Control programático completo

## 🚀 Arquitectura

### Flujo de Datos

```
RTMP Input → FFmpeg → HTTP PUT → Bun Server (RAM) → HLS Player
     ↓           ↓           ↓              ↓
 OBS/Stream  → Conversión → Segmentos .ts → Video en tiempo real
```

### Componentes

1. **RTMP Server** (`src/server.ts`)
   - Recibe stream RTMP
   - Maneja reconexiones automáticas
   - Logging detallado

2. **HLS Converter** (`src/hls.ts`)
   - FFmpeg con HTTP Callback
   - Configuración optimizada para streaming
   - Gestión de procesos

3. **API REST** (`src/api.ts`)
   - Sistema de rutas modular
   - Control de HLS
   - Estado del sistema
   - CORS habilitado

4. **Memory Store** (`src/store.ts`)
   - Almacenamiento en RAM
   - Map<string, Uint8Array>
   - Sin I/O de disco

5. **Web Interface** (`public/index.html`)
   - Player HLS.js
   - Control en tiempo real
   - Logs del sistema
   - Estado visual

## 🛠️ Instalación y Uso

### 1. Instalar Dependencias

```bash
npm install
```

### 2. Iniciar Servidor

```bash
npm start
```

El servidor iniciará:
- **RTMP**: `rtmp://localhost:1935/live`
- **API**: `http://localhost:3000`
- **Web**: `http://localhost:3000` (sirve el HTML)

### 3. Configurar OBS

1. **Servidor**: `rtmp://localhost:1935/live`
2. **Clave de Stream**: `entrada` (o cualquier otra)
3. **Iniciar Stream**

### 4. Iniciar HLS

Abre `http://localhost:3000` en tu navegador:

1. Haz clic en **"▶️ Start HLS"**
2. El sistema detectará automáticamente el stream
3. El video aparecerá en el player

## 📡 API REST

### Control HLS

```bash
# Iniciar conversión HLS
curl -X POST http://localhost:3000/api/hls/start \
  -H "Content-Type: application/json" \
  -d '{"inputUrl": "rtmp://localhost/live/entrada"}'

# Detener conversión HLS
curl -X POST http://localhost:3000/api/hls/stop

# Estado del sistema
curl http://localhost:3000/api/status

# Estado específico de HLS
curl http://localhost:3000/api/hls/status
```

### Streams HLS

Los archivos HLS están disponibles en:
- **Playlist**: `http://localhost:3000/hls_ingest/stream.m3u8`
- **Segmentos**: `http://localhost:3000/hls_ingest/segmentXXX.ts`

## 🎮 Control Web

La interfaz web proporciona:

### Controles Principales
- **Start/Stop HLS**: Inicia o detiene la conversión
- **Refresh Video**: Recarga el player
- **RTMP Input URL**: Configura la entrada

### Monitoreo en Tiempo Real
- **Estado HLS**: Activo/Detenido con indicador visual
- **Contador de Segmentos**: Número de archivos .ts en RAM
- **Playlists**: Número de playlists .m3u8 generados
- **Estado FFmpeg**: Disponibilidad del conversor

### Sistema de Logs
- **Timestamp**: Cada evento con hora exacta
- **Color Coding**: 
  - 🔵 Info (azul)
  - 🟢 Success (verde)
  - 🟡 Warning (naranja)
  - 🔴 Error (rojo)

### Player HLS
- **Auto-detection**: HLS.js con fallback nativo
- **Low Latency**: Modo de baja latencia habilitado
- **Error Handling**: Gestión detallada de errores
- **Auto-reload**: Refresco automático de segmentos

## ⚙️ Configuración

### FFmpeg Options

```typescript
const hlsOptions = {
    inputUrl: 'rtmp://localhost/live/entrada',
    outputUrl: 'http://127.0.0.1:3000/hls_ingest/stream.m3u8',
    hlsTime: 2,           // Segmentos de 2 segundos
    hlsListSize: 5,       // Mantener 5 segmentos en playlist
    additionalOptions: [
        '-c:v libx264',
        '-preset veryfast',
        '-tune zerolatency',
        '-c:a aac',
        '-b:a 128k',
        '-g 30',
        '-sc_threshold 0'
    ]
}
```

### Configuración del Servidor

```json
{
  "server": {
    "port": 1935,
    "host": "0.0.0.0",
    "enableRestApi": true,
    "restApiPort": 3000
  }
}
```

## 🔧 Troubleshooting

### Issues Comunes

1. **FFmpeg no encontrado**
   - El sistema descargará automáticamente los binarios
   - Revisa la consola para ver el progreso

2. **"No se puede cargar el video"**
   - Asegúrate que OBS esté enviando stream
   - Verifica que HLS esté iniciado
   - Revisa los logs en la interfaz web

3. **Error de CORS**
   - La API tiene CORS habilitado por defecto
   - Usa `http://localhost:3000` para la interfaz web

4. **Problemas de reconexión RTMP**
   - El sistema maneja reconexiones automáticas
   - Tiempo de espera: 30 segundos
   - Limpieza automática: 60 segundos

### Logs Detallados

Activar debug mode en `src/server.ts`:

```typescript
const debuglog = true; // Cambiar a false para producción
```

Esto generará logs detallados en `./logs/rtmp.log`.

## 🚀 Rendimiento

### Métricas Típicas

- **Latencia**: 2-6 segundos (configurable)
- **CPU**: ~5-15% (dependiendo de calidad)
- **RAM**: ~50-100MB (solo segmentos activos)
- **Disco**: 0 MB (todo en RAM)

### Optimizaciones

- **Chunk Size**: 4096 bytes (balance óptimo)
- **HLS Time**: 2 segundos (baja latencia)
- **List Size**: 5 segmentos (memoria eficiente)
- **Video Codec**: H.264 with zerolatency tune
- **Audio Codec**: AAC 128kbps

## 🔄 Flujo Completo

1. **OBS** → Envía RTMP a `rtmp://localhost:1935/live/entrada`
2. **RTMP Server** → Recibe y valida el stream
3. **FFmpeg** → Convierte a HLS con HTTP PUT
4. **Bun Server** → Recibe segmentos en RAM (sin disco)
5. **HLS Player** → Reproduce desde el servidor HTTP
6. **Auto-cleanup** → Elimina segmentos viejos automáticamente

## 🎯 Ventajas del Sistema

1. **Multiplataforma**: Mismo código en Windows/Linux/Mac
2. **Ultra rápido**: Todo en memoria, sin I/O de disco
3. **Escalable**: Sistema de rutas modular
4. **Maintenable**: Código limpio y bien estructurado
5. **Monitorizable**: Interface web completa
6. **API First**: Control programático total
7. **Zero Config**: Funciona out-of-the-box

## 📚 Referencias

- [HLS.js Documentation](https://hls-js.com/)
- [FFmpeg HLS Documentation](https://ffmpeg.org/ffmpeg-formats.html#hls-2)
- [RTMP Specification](https://rtmp.veriskope.com/pdf/rtmp_specification_1.0.pdf)

---

**¡Listo para streaming HLS de alto rendimiento! 🚀**
