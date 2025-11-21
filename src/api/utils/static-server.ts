import type { StaticFileOptions } from "../types.js";
import type { file } from "bun";

export class StaticServer {
  private options: Required<StaticFileOptions>;

  constructor(options: StaticFileOptions) {
    this.options = {
      rootDir: options.rootDir,
      maxAge: options.maxAge || 3600,
      etag: options.etag !== false,
      lastModified: options.lastModified !== false,
    };
  }

  async serve(req: Request, path: string = new URL(req.url).pathname): Promise<Response | null> {
    try {
      // Normalize path to prevent directory traversal
      const normalizedPath = this.normalizePath(path);
      
      // Construct full file path
      const fullPath = `${this.options.rootDir}${normalizedPath}`;
      
      // Try to get the file
      const file = Bun.file(fullPath);
      
      if (!(await file.exists())) {
        // Try to serve index.html for directories
        if (normalizedPath.endsWith('/')) {
          const indexPath = `${fullPath}index.html`;
          const indexFile = Bun.file(indexPath);
          
          if (await indexFile.exists()) {
            return this.createFileResponse(indexFile, indexPath, req);
          }
        }
        return null;
      }

      // If it's a directory, try to serve index.html
      const stats = await this.getFileStats(fullPath);
      if (stats?.isDirectory) {
        const indexPath = `${fullPath}/index.html`;
        const indexFile = Bun.file(indexPath);
        
        if (await indexFile.exists()) {
          return this.createFileResponse(indexFile, indexPath, req);
        }
        return null;
      }

      return this.createFileResponse(file, fullPath, req);
    } catch (error) {
      console.error("Static file server error:", error);
      return null;
    }
  }

  private normalizePath(path: string): string {
    // Remove query parameters and hash
    path = path.split('?')[0].split('#')[0];
    
    // Ensure path starts with /
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    
    // Decode URI components
    path = decodeURIComponent(path);
    
    // Prevent directory traversal
    path = path.replace(/\.\./g, '').replace(/\/+/g, '/');
    
    return path;
  }

  private async createFileResponse(file: any, filePath: string, req: Request): Promise<Response> {
    const headers = new Headers();
    
    // Set content type based on file extension
    const contentType = this.getContentType(filePath);
    if (contentType) {
      headers.set("Content-Type", contentType);
    }
    
    // Set cache control
    if (this.options.maxAge > 0) {
      headers.set("Cache-Control", `public, max-age=${this.options.maxAge}`);
    }
    
    // Set ETag
    if (this.options.etag) {
      const stats = await this.getFileStats(filePath);
      if (stats) {
        const etag = this.generateETag(stats);
        headers.set("ETag", etag);
        
        // Check if-none-match header
        const ifNoneMatch = req.headers.get("if-none-match");
        if (ifNoneMatch === etag) {
          return new Response(null, { status: 304, headers });
        }
      }
    }
    
    // Set Last-Modified
    if (this.options.lastModified) {
      const stats = await this.getFileStats(filePath);
      if (stats) {
        headers.set("Last-Modified", stats.lastModified.toUTCString());
        
        // Check if-modified-since header
        const ifModifiedSince = req.headers.get("if-modified-since");
        if (ifModifiedSince) {
          const modifiedSince = new Date(ifModifiedSince);
          if (stats.lastModified <= modifiedSince) {
            return new Response(null, { status: 304, headers });
          }
        }
      }
    }
    
    // Set content security headers for HTML files
    if (filePath.endsWith('.html')) {
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "SAMEORIGIN");
      headers.set("X-XSS-Protection", "1; mode=block");
    }
    
    return new Response(file, { headers });
  }

  private getContentType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    
    const contentTypes: Record<string, string> = {
      'html': 'text/html; charset=utf-8',
      'css': 'text/css; charset=utf-8',
      'js': 'application/javascript; charset=utf-8',
      'json': 'application/json',
      'xml': 'application/xml',
      'txt': 'text/plain; charset=utf-8',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
      'webp': 'image/webp',
      'pdf': 'application/pdf',
      'zip': 'application/zip',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'woff': 'font/woff',
      'woff2': 'font/woff2',
      'ttf': 'font/ttf',
      'eot': 'application/vnd.ms-fontobject',
    };
    
    return contentTypes[ext || ''] || 'application/octet-stream';
  }

  private async getFileStats(filePath: string): Promise<{
    size: number;
    lastModified: Date;
    isDirectory: boolean;
  } | null> {
    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();
      
      if (!exists) {
        return null;
      }
      
      // Bun doesn't provide detailed stats, so we'll create a simple version
      const fileSize = file.size;
      const lastModified = new Date();
      
      // Try to determine if it's a directory by checking if it ends with /
      // This is a limitation of Bun's file API
      const isDirectory = filePath.endsWith('/');
      
      return {
        size: fileSize,
        lastModified,
        isDirectory,
      };
    } catch (error) {
      return null;
    }
  }

  private generateETag(stats: { size: number; lastModified: Date }): string {
    const hash = `${stats.size}-${stats.lastModified.getTime()}`;
    return `"${hash}"`;
  }
}

// Middleware factory for static file serving
export const staticFiles = (options: StaticFileOptions) => {
  const server = new StaticServer(options);
  
  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    return server.serve(req, url.pathname);
  };
};
