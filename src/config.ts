export interface StreamTarget {
  id: string;
  url: string;
  key?: string;
  enabled: boolean;
}

export interface ServerConfig {
  port: number;
  host: string;
  chunkSize: number;
  windowAckSize: number;
  peerBandwidth: number;
  logLevel: "debug" | "info" | "warn" | "error"| string;
  logFile: string;
  enableRestApi: boolean;
  restApiPort: number;
}

export interface AppConfig {
  server: ServerConfig;
  targets: StreamTarget[];
}

export const defaultConfig: AppConfig = {
  server: {
    port: 1935,
    host: "0.0.0.0",
    chunkSize: 4096,
    windowAckSize: 2500000,
    peerBandwidth: 2500000,
    logLevel: "info",
    logFile: "./logs/rtmp.log",
    enableRestApi: true,
    restApiPort: 3000,
  },
  targets: [
    {
      id: "youtube",
      url: "rtmp://a.rtmp.youtube.com/live2",
      key: "",
      enabled: false,
    },
    {
      id: "twitch",
      url: "rtmp://live.twitch.tv/app",
      key: "",
      enabled: false,
    },
    {
      id: "facebook",
      url: "rtmps://live-api-s.facebook.com:443/rtmp",
      key: "",
      enabled: false,
    },
  ],
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const configFile = Bun.file("./config.json");
    if (await configFile.exists()) {
      const config = await configFile.json();
      return { ...defaultConfig, ...config };
    }
  } catch (error) {
    console.warn("Could not load config.json, using defaults");
  }

  return defaultConfig;
}

export function saveConfig(config: AppConfig): void {
  Bun.write("./config.json", JSON.stringify(config, null, 2));
}
