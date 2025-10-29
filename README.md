# RTMP Bun Server

Un servidor RTMP backend construido con Bun para reenviar streams a múltiples servicios como YouTube, Twitch, Facebook, etc.

## 🎯 Estado del Proyecto: en pruebas

Este proyecto Incluye:
- ✅ Servidor RTMP completo con soporte para publicación de streams
- ✅ Reenvío automático a múltiples plataformas simultáneamente
- ✅ API REST completa para configuración y monitoreo
- ✅ Sistema de logging detallado
- ✅ Documentación completa

## 🚀 Características

- Servidor RTMP completo con soporte para publicación de streams
- Reenvío automático a múltiples plataformas simultáneamente
- API REST para configuración y monitoreo
- Configuración mediante archivo JSON
- Logging detallado de conexiones y streams
- Soporte para streams clave personalizados
- Interface web de administración (via API)

## 📋 Requisitos

- [Bun](https://bun.sh/) runtime instalado
- Node.js 18+ (para tipos TypeScript)

## 🛠️ Instalación

1. Clona el repositorio:
```bash
git clone <repository-url>
cd rtmp_bun
```

2. Instala dependencias:
```bash
bun install
```

## ⚙️ Configuración

El servidor usa un archivo `config.json` para la configuración. Si no existe, se crearán valores por defecto.

### Ejemplo de configuración:

```json
{
  "server": {
    "port": 1935,
    "host": "0.0.0.0",
    "chunkSize": 4096,
    "windowAckSize": 2500000,
    "peerBandwidth": 2500000,
    "logLevel": "info",
    "logFile": "./logs/rtmp.log",
    "enableRestApi": true,
    "restApiPort": 3000
  },
  "targets": [
    {
      "id": "youtube",
      "url": "rtmp://a.rtmp.youtube.com/live2",
      "key": "YOUTUBE_STREAM_KEY",
      "enabled": true
    },
    {
      "id": "twitch",
      "url": "rtmp://live.twitch.tv/app",
      "key": "TWITCH_STREAM_KEY",
      "enabled": true
    }
  ]
}
```

## 🚀 Ejecución

### Desarrollo (con recarga automática):
```bash
bun run dev
```

### Producción:
```bash
bun run start
```

### Logs:
```bash
bun run logs
```

## 📡 Uso

### 1. Publicar un stream

Usa cualquier software de streaming (OBS, Streamlabs, etc.) con la siguiente configuración:
- **URL RTMP**: `rtmp://localhost:1935/live`
- **Clave de Stream**: Tu clave personalizada (ej: `mystream123`) ("not required")

### 2. Configurar destinos via API

#### Ver configuración actual:
```bash
curl http://localhost:3000/api/config
```

#### Habilitar un destino:
```bash
curl -X POST http://localhost:3000/api/targets/enable \
  -H "Content-Type: application/json" \
  -d '{
    "targetId": "youtube",
    "enabled": true,
    "key": "TU_CLAVE_DE_YOUTUBE"
  }'
```

#### Agregar nuevo destino:
```bash
curl -X POST http://localhost:3000/api/targets \
  -H "Content-Type: application/json" \
  -d '{
    "id": "facebook",
    "url": "rtmps://live-api-s.facebook.com:443/rtmp",
    "key": "TU_CLAVE_DE_FACEBOOK",
    "enabled": false
  }'
```

#### Ver estado del servidor:
```bash
curl http://localhost:3000/api/status
```

## 📚 Endpoints de la API

### Configuración
- `GET /api/config` - Obtener configuración completa
- `PUT /api/config` - Actualizar configuración

### Destinos
- `GET /api/targets` - Listar todos los destinos
- `POST /api/targets` - Agregar nuevo destino
- `PUT /api/targets/:id` - Actualizar destino específico
- `DELETE /api/targets/:id` - Eliminar destino
- `POST /api/targets/enable` - Habilitar destino con clave
- `POST /api/targets/disable` - Deshabilitar destino

### Estado
- `GET /api/status` - Estado del servidor y destinos activos
- `GET /health` - Verificar salud del servidor

## 🗂️ Estructura del Proyecto

```
rtmp_bun/
├── src/
│   ├── main.ts          # Punto de entrada principal
│   ├── server.ts        # Implementación del servidor RTMP
│   ├── config.ts        # Gestión de configuración
│   ├── forwarder.ts     # Lógica de reenvío de streams
│   └── api.ts          # API REST
├── logs/               # Archivos de log
├── config.json         # Archivo de configuración
├── package.json        # Dependencias y scripts
└── README.md          # Documentación
```

## 🔧 Scripts Disponibles

- `bun run dev` - Ejecutar en modo desarrollo con --watch
- `bun run start` - Ejecutar en modo producción
- `bun run build` - Construir para distribución
- `bun run test` - Ejecutar tests
- `bun run logs` - Ver logs en tiempo real

## 📝 Notas Importantes

1. **Seguridad**: El servidor acepta conexiones desde cualquier IP. Considera configurar un firewall en producción.
2. **Claves de Stream**: Nunca compartas tus claves de stream públicas. Guárdalas de forma segura.
3. **Recursos**: El reenvío a múltiples destinos consume ancho de banda adicional.
4. **Logs**: Los logs se guardan en `./logs/rtmp.log`

## 🐛 Solución de Problemas

### Stream no se publica:
- Verifica que el puerto 1935 esté abierto
- Revisa los logs para errores
- Confirma la URL y clave de stream

### No se reenvía a destinos:
- Verifica que los destinos estén habilitados (`enabled: true`)
- Confirma que las claves de stream sean correctas
- Revisa conectividad de red

### API no responde:
- Verifica que el puerto 3000 esté disponible
- Confirma que `enableRestApi` sea `true` en la configuración

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature
3. Commit tus cambios
4. Push a la rama
5. Abre un Pull Request

## 📄 Licencia

MIT License

## 📁 Estructura del Proyecto

```
rtmp_bun/
├── src/
│   ├── main.ts          # Punto de entrada principal
│   ├── server.ts        # Implementación completa del servidor RTMP
│   ├── config.ts        # Gestión de configuración JSON
│   ├── forwarder.ts     # Lógica de reenvío de streams
│   └── api.ts          # API REST completa
├── test/
│   └── api-test.ts     # Tests automatizados de la API
├── examples/
│   └── usage.md        # Ejemplos de uso detallados
├── logs/               # Archivos de log (creados automáticamente)
├── dist/               # Build compilado
├── config.json         # Configuración del servidor
├── package.json        # Dependencias y scripts
├── verify.ts          # Script de verificación
├── QUICKSTART.md      # Guía rápida
└── README.md          # Esta documentación
```

## 🚀 Scripts Disponibles

| Comando | Descripción |
|---------|-------------|
| `bun run dev` | Iniciar servidor en modo desarrollo con --watch |
| `bun run start` | Iniciar servidor en modo producción |
| `bun run build` | Compilar para distribución |
| `bun run test` | Ejecutar tests unitarios |
| `bun run test:api` | Probar API REST |
| `bun run verify` | Verificar instalación completa |
| `bun run logs` | Ver logs en tiempo real |

## 🎮 Flujo de Trabajo Recomendado

1. **Iniciar servidor**: `bun run dev`
2. **Configurar plataformas**: Usar API REST o editar `config.json`
3. **Probar API**: `bun run test:api`
4. **Configurar OBS**: `rtmp://localhost:1935/live`
5. **Iniciar transmisión**: Desde OBS o cualquier software RTMP

## 🛠️ Tecnologías Utilizadas

- **Runtime**: Bun (JavaScript/TypeScript)
- **Protocolo**: RTMP (Real-Time Messaging Protocol)
- **API**: REST HTTP con JSON
- **Logging**: Sistema de archivos local
- **Streaming**: Reenvío nativo a plataformas RTMP

## 🔗 Enlaces Útiles

- [Documentación de Bun](https://bun.sh/docs)
- [Protocolo RTMP](https://rtmp.veriskope.com/)
- [OBS Studio](https://obsproject.com/)
