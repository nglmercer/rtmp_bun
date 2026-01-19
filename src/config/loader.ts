import TOML from "@iarna/toml";
import { FSWatcher } from "node:fs";
import {
  rtmpConfigSchema,
  createDefaultConfig,
  type RtmpConfig,
} from "./schemas";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface ConfigLoaderOptions {
  configPath?: string;
  format?: "json" | "toml" | "auto";
  watch?: boolean;
}

export class ConfigLoader {
  private config: RtmpConfig | null = null;
  private configPath: string;
  private format: "json" | "toml";
  private watcher: FSWatcher | null = null;
  private changeListeners: Array<(config: RtmpConfig) => void> = [];

  constructor(options: ConfigLoaderOptions = {}) {
    const {
      configPath = "./config.toml",
      format = "auto",
      watch = false,
    } = options;

    this.configPath = configPath;
    this.format = this.detectFormat(configPath, format);

    if (watch) {
      this.setupWatcher();
    }
  }

  private detectFormat(
    configPath: string,
    format: "json" | "toml" | "auto",
  ): "json" | "toml" {
    if (format !== "auto") return format;
    const ext = path.extname(configPath).toLowerCase();
    if (ext === ".toml") return "toml";
    if (ext === ".json") return "json";
    return "toml";
  }

  private async setupWatcher(): Promise<void> {
    try {
      this.watcher = fs.watch(this.configPath, async (eventType) => {
        if (eventType === "change") {
          await this.load();
          this.notifyListeners();
        }
      });
    } catch (error) {
      console.warn(
        `Could not set up file watcher for ${this.configPath}:`,
        error,
      );
    }
  }

  private notifyListeners(): void {
    if (this.config) {
      for (const listener of this.changeListeners) {
        listener(this.config);
      }
    }
  }

  private async parseJson(content: string): Promise<unknown> {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Invalid JSON in configuration file: ${error}`);
    }
  }

  private async parseToml(content: string): Promise<unknown> {
    try {
      return TOML.parse(content);
    } catch (error) {
      throw new Error(`Invalid TOML in configuration file: ${error}`);
    }
  }

  private async ensureDirectoryExists(): Promise<void> {
    const dir = path.dirname(this.configPath);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  public async load(): Promise<RtmpConfig> {
    try {
      const content = await fs.readFile(this.configPath, "utf-8");
      let rawData: unknown;

      rawData =
        this.format === "json"
          ? await this.parseJson(content)
          : await this.parseToml(content);

      const result = rtmpConfigSchema(rawData);

      if (result.problems) {
        throw new Error(
          `Configuration validation failed:\n${result.problems.map((p) => `  - ${p}`).join("\n")}`,
        );
      }

      this.config = result.data;
      return this.config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        console.warn(
          `Configuration file not found: ${this.configPath}. Using default configuration.`,
        );
        this.config = createDefaultConfig();
        return this.config;
      }
      throw error;
    }
  }

  public async save(config?: RtmpConfig): Promise<void> {
    const configToSave = config || this.config || createDefaultConfig();

    try {
      await this.ensureDirectoryExists();

      let content: string;
      if (this.format === "json") {
        content = JSON.stringify(configToSave, null, 2);
      } else {
        content = TOML.stringify(configToSave as any);
      }

      await fs.writeFile(this.configPath, content, "utf-8");
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error}`);
    }
  }

  public getConfig(): RtmpConfig {
    if (!this.config) {
      throw new Error("Configuration not loaded. Call load() first.");
    }
    return this.config;
  }

  public getConfigPath(): string {
    return this.configPath;
  }

  public setConfig(config: RtmpConfig): void {
    this.config = config;
    this.notifyListeners();
  }

  public onUpdate(callback: (config: RtmpConfig) => void): void {
    this.changeListeners.push(callback);
  }

  public removeOnUpdate(callback: (config: RtmpConfig) => void): void {
    const index = this.changeListeners.indexOf(callback);
    if (index > -1) {
      this.changeListeners.splice(index, 1);
    }
  }

  public async destroy(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.changeListeners = [];
  }

  public static async createDefault(
    path: string = "./config.toml",
    format: "json" | "toml" = "toml",
  ): Promise<ConfigLoader> {
    const loader = new ConfigLoader({ configPath: path, format });
    const defaultConfig = createDefaultConfig();
    await loader.save(defaultConfig);
    await loader.load();
    return loader;
  }
}

// Convenience function for quick config loading
export async function loadConfig(
  options?: ConfigLoaderOptions,
): Promise<RtmpConfig> {
  const loader = new ConfigLoader(options);
  return await loader.load();
}

// Convenience function for creating and saving default config
export async function createDefaultConfigFile(
  path: string = "./config.toml",
  format: "json" | "toml" = "toml",
): Promise<void> {
  const loader = await ConfigLoader.createDefault(path, format);
  await loader.destroy();
}
