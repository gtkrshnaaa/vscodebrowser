import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";

/**
 * Fetches a URL using Node.js HTTP/HTTPS with automatic redirect following.
 * Returns the final HTML with frame-blocking headers stripped and a base tag injected.
 */
export class PageFetcher {

  /**
   * Fetches a URL, follows redirects (up to 10), decompresses content,
   * strips frame-blocking headers, and injects a base tag into HTML responses.
   *
   * @param targetUrl The URL to fetch.
   * @returns Promise resolving with the processed HTML string.
   */
  public static async fetch(targetUrl: string): Promise<{ html: string; finalUrl: string }> {
    return PageFetcher._fetchWithRedirects(targetUrl, 10);
  }

  private static _fetchWithRedirects(
    targetUrl: string,
    maxRedirects: number
  ): Promise<{ html: string; finalUrl: string }> {
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) {
        reject(new Error("Too many redirects"));
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(targetUrl);
      } catch {
        reject(new Error("Invalid URL: " + targetUrl));
        return;
      }

      const isHttps = parsedUrl.protocol === "https:";
      const requester = isHttps ? https : http;

      const requestHeaders: Record<string, string> = {
        "host": parsedUrl.host,
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.5",
        "accept-encoding": "gzip, deflate, br",
        "connection": "keep-alive",
        "upgrade-insecure-requests": "1"
      };

      const req = requester.request(
        parsedUrl,
        { method: "GET", headers: requestHeaders },
        (res) => {
          // Handle redirects
          const statusCode = res.statusCode || 200;
          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            let redirectUrl = res.headers.location;
            if (redirectUrl.startsWith("/")) {
              redirectUrl = parsedUrl.origin + redirectUrl;
            }
            res.resume();
            PageFetcher._fetchWithRedirects(redirectUrl, maxRedirects - 1)
              .then(resolve)
              .catch(reject);
            return;
          }

          // Decompress if needed
          const encoding = (res.headers["content-encoding"] || "").toLowerCase();
          let stream: NodeJS.ReadableStream = res;
          if (encoding === "gzip") {
            stream = res.pipe(zlib.createGunzip());
          } else if (encoding === "deflate") {
            stream = res.pipe(zlib.createInflate());
          } else if (encoding === "br") {
            stream = res.pipe(zlib.createBrotliDecompress());
          }

          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          stream.on("end", () => {
            let body = Buffer.concat(chunks).toString("utf-8");

            // Inject base tag for relative URL resolution
            const baseTag = `<base href="${parsedUrl.origin}${parsedUrl.pathname}">`;
            const headMatch = body.match(/<head[^>]*>/i);
            if (headMatch && headMatch.index !== undefined) {
              const insertIndex = headMatch.index + headMatch[0].length;
              body = body.substring(0, insertIndex) + baseTag + body.substring(insertIndex);
            } else {
              body = baseTag + body;
            }

            resolve({ html: body, finalUrl: targetUrl });
          });

          stream.on("error", (err) => {
            reject(new Error("Decompression failed: " + err.message));
          });
        }
      );

      req.on("error", (err) => {
        reject(new Error("Request failed: " + err.message));
      });

      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });

      req.end();
    });
  }
}
