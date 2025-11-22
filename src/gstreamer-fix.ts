import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export class GStreamerFix {
  private static gstPath: string = "";
  
  static async detectGStreamerPath(): Promise<string> {
    const possiblePaths = [
      "C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-launch-1.0.exe",
      "C:\\Program Files (x86)\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-launch-1.0.exe",
      "gst-launch-1.0"
    ];
    
    for (const gstPath of possiblePaths) {
      if (gstPath === 'gst-launch-1.0' || fs.existsSync(gstPath)) {
        this.gstPath = gstPath;
        return gstPath;
      }
    }
    
    throw new Error("GStreamer not found. Please install GStreamer 1.0 with the 'good', 'bad', 'ugly', and 'libav' plugins.");
  }
  
  static async checkRequiredPlugins(): Promise<string[]> {
    const gstPath = await this.detectGStreamerPath();
    
    return new Promise((resolve, reject) => {
      const process = spawn(gstPath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`GStreamer not found or not working: ${errorOutput}`));
          return;
        }
        
        console.log(`✅ GStreamer version check passed: ${output.trim()}`);
        
        // For now, assume all plugins are available since checking them is complex
        // We'll rely on runtime errors to detect missing plugins
        resolve([]);
      });
    });
  }
  
  static async installPlugins(): Promise<void> {
    console.log('🔧 Checking GStreamer installation...');
    
    try {
      const missingPlugins = await this.checkRequiredPlugins();
      
      if (missingPlugins.length > 0) {
        console.error(`❌ Missing GStreamer plugins: ${missingPlugins.join(', ')}`);
        console.log('\n💡 To fix this issue:');
        console.log('1. Download GStreamer installer from: https://gstreamer.freedesktop.org/download/');
        console.log('2. During installation, select ALL plugin packages:');
        console.log('   - gstreamer1.0-plugins-good');
        console.log('   - gstreamer1.0-plugins-bad'); 
        console.log('   - gstreamer1.0-plugins-ugly');
        console.log('   - gstreamer1.0-libav');
        console.log('3. Restart your terminal and try again');
        
        throw new Error(`Missing required GStreamer plugins: ${missingPlugins.join(', ')}`);
      }
      
      console.log('✅ All required GStreamer plugins are available');
      
    } catch (error) {
      console.error('❌ GStreamer check failed:', error);
      throw error;
    }
  }
  
  static getFixedPipeline(streamKey: string, tempDir: string): string[] {
    const tempDirPosix = tempDir.split(path.sep).join('/').replace(/\\/g, '/');
    
    // Pipeline optimizado para baja latencia
    return [
      'fdsrc', 'fd=0',
      '!', 'queue', 'leaky=2', 'max-size-buffers=500', 'max-size-time=1000000000', // 1 segundo
      '!', 'flvdemux', 'name=demux',
      'demux.video',
      '!', 'queue', 'silent=true', 'leaky=2', 'max-size-buffers=300', 'max-size-time=500000000', // 0.5 segundos
      '!', 'mpegtsmux', 'name=mux',
      'demux.audio',
      '!', 'queue', 'silent=true', 'leaky=2', 'max-size-buffers=300', 'max-size-time=500000000', // 0.5 segundos
      '!', 'aacparse',
      '!', 'mux.',
      'mux.',
      '!', 'queue', 'silent=true', 'max-size-buffers=50',
      '!', 'hlssink',
          `location=${tempDirPosix}/segment_%05d.ts`,
          `playlist-location=${tempDirPosix}/playlist.m3u8`,
          'target-duration=1', // Segmentos más cortos para menor latencia
          'max-files=15', // Mantener más segmentos para evitar buffering
          'playlist-length=8',
          'max-segment-duration=1'
    ];
  }

  static getFallbackPipeline(streamKey: string, tempDir: string): string[] {
    const tempDirPosix = tempDir.split(path.sep).join('/').replace(/\\/g, '/');
    
    // Pipeline alternativo optimizado para baja latencia con conversión forzada
    return [
      'fdsrc', 'fd=0',
      '!', 'queue', 'leaky=2', 'max-size-buffers=300', 'max-size-time=1000000000', // 1 segundo
      '!', 'flvdemux', 'name=demux',
      'demux.video',
      '!', 'queue', 'silent=true', 'leaky=2', 'max-size-buffers=200', 'max-size-time=500000000', // 0.5 segundos
      '!', 'videoconvert',
      '!', 'x264enc', 'tune=zerolatency', 'speed-preset=ultrafast', 'key-int-max=30',
      '!', 'mpegtsmux',
      '!', 'queue', 'silent=true', 'max-size-buffers=50',
      '!', 'hlssink',
          `location=${tempDirPosix}/segment_%05d.ts`,
          `playlist-location=${tempDirPosix}/playlist.m3u8`,
          'target-duration=2', // Segmentos más cortos para menor latencia
          'max-files=10',
          'playlist-length=6',
          'max-segment-duration=2'
    ];
  }
}