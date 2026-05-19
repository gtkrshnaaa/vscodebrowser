import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as zlib from "zlib";

/**
 * Lightweight HTTP reverse proxy that strips frame-blocking headers
 * (X-Frame-Options, Content-Security-Policy) from upstream responses,
 * enabling external webpages to load inside VS Code webview iframes.
 *
 * Binds to localhost on a random available port.
 */
export class ProxyServer {
  private _server: http.Server | null = null;
  private _port: number = 0;

  constructor() {}

  /**
   * Starts the proxy server on a random available port.
   *
   * @returns Promise that resolves with the assigned port number.
   */
  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => {
        // Handle CORS preflight requests
        if (req.method === "OPTIONS") {
          res.writeHead(200, {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
            "access-control-allow-headers": "*",
            "access-control-max-age": "86400"
          });
          res.end();
          return;
        }

        const parsedUrl = url.parse(req.url || "", true);
        
        if (parsedUrl.pathname === "/proxy") {
          this._handleProxyRequest(req, res, parsedUrl);
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      });

      // Bind to localhost so VS Code portMapping can tunnel it
      this._server.listen(0, "localhost", () => {
        const address = this._server?.address();
        if (address && typeof address === "object") {
          this._port = address.port;
          resolve(this._port);
        } else {
          reject(new Error("Failed to get port"));
        }
      });
    });
  }

  /**
   * Handles the proxy request by fetching the target URL and stripping
   * frame-blocking response headers before forwarding to the client.
   */
  private _handleProxyRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parsedUrl: url.UrlWithParsedQuery
  ): void {
    const targetUrlStr = parsedUrl.query.url as string;
    if (!targetUrlStr) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing url parameter.");
      return;
    }

    try {
      const targetUrl = new URL(targetUrlStr);
      const isHttps = targetUrl.protocol === "https:";
      const requester = isHttps ? https : http;

      // Build upstream request headers, masquerading as normal browser traffic
      const requestHeaders: Record<string, string> = {
        "host": targetUrl.host,
        "referer": targetUrl.origin,
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept": req.headers["accept"] as string || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": req.headers["accept-language"] as string || "en-US,en;q=0.5",
        "accept-encoding": "gzip, deflate",
        "connection": "keep-alive",
        "upgrade-insecure-requests": "1"
      };

      const proxyReq = requester.request(
        targetUrl,
        {
          method: req.method,
          headers: requestHeaders,
        },
        (proxyRes) => {
          this._handleProxyResponse(res, proxyRes, targetUrl);
        }
      );

      proxyReq.on("error", (err) => {
        res.writeHead(502, {
          "Content-Type": "text/html; charset=utf-8",
          "access-control-allow-origin": "*"
        });
        res.end(this._buildErrorPage(targetUrlStr, err.message));
      });

      // Handle redirects within the proxy (3xx responses are handled by proxyRes)
      req.pipe(proxyReq);
    } catch (e: any) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid target URL: " + e.message);
    }
  }

  /**
   * Processes the upstream response: strips frame-blocking headers,
   * decompresses if needed, and injects a <base> tag into HTML responses.
   */
  private _handleProxyResponse(
    res: http.ServerResponse,
    proxyRes: http.IncomingMessage,
    targetUrl: URL
  ): void {
    // Build clean response headers, stripping all frame-blocking directives
    const responseHeaders: Record<string, string> = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "*",
      "access-control-expose-headers": "*"
    };

    // Headers to strip from upstream response
    const blockedHeaders = new Set([
      "x-frame-options",
      "content-security-policy",
      "content-security-policy-report-only",
      "frame-options",
      "content-encoding",
      "content-length",
      "transfer-encoding"
    ]);

    for (const key of Object.keys(proxyRes.headers)) {
      if (!blockedHeaders.has(key.toLowerCase())) {
        const headerVal = proxyRes.headers[key];
        if (headerVal !== undefined) {
          responseHeaders[key] = Array.isArray(headerVal) ? headerVal.join(", ") : headerVal;
        }
      }
    }

    const contentType = proxyRes.headers["content-type"] || "";
    const isHtml = contentType.includes("text/html");
    const contentEncoding = (proxyRes.headers["content-encoding"] || "").toLowerCase();

    // Decompress the stream if gzip/deflate
    let dataStream: NodeJS.ReadableStream = proxyRes;
    if (contentEncoding === "gzip") {
      dataStream = proxyRes.pipe(zlib.createGunzip());
    } else if (contentEncoding === "deflate") {
      dataStream = proxyRes.pipe(zlib.createInflate());
    } else if (contentEncoding === "br") {
      dataStream = proxyRes.pipe(zlib.createBrotliDecompress());
    }

    if (isHtml) {
      // Buffer HTML response to inject <base> tag
      const chunks: Buffer[] = [];
      dataStream.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      dataStream.on("end", () => {
        let body = Buffer.concat(chunks).toString("utf-8");

        // Inject <base> tag so relative URLs resolve correctly against the original server
        const baseTag = `<base href="${targetUrl.origin}${targetUrl.pathname}">`;
        const headMatch = body.match(/<head[^>]*>/i);
        if (headMatch && headMatch.index !== undefined) {
          const insertIndex = headMatch.index + headMatch[0].length;
          body = body.substring(0, insertIndex) + baseTag + body.substring(insertIndex);
        } else {
          body = baseTag + body;
        }

        responseHeaders["content-type"] = "text/html; charset=utf-8";

        res.writeHead(proxyRes.statusCode || 200, responseHeaders);
        res.end(body);
      });

      dataStream.on("error", () => {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Failed to decompress response.");
      });
    } else {
      // Non-HTML content: stream directly without modification
      res.writeHead(proxyRes.statusCode || 200, responseHeaders);
      dataStream.pipe(res);

      dataStream.on("error", () => {
        res.end();
      });
    }
  }

  /**
   * Generates a styled error page when the proxy fails to reach the target.
   */
  private _buildErrorPage(targetUrl: string, errorMessage: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connection Failed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1e1e1e; color: #ccc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .container { text-align: center; max-width: 480px; padding: 32px; }
    h1 { color: #fff; font-size: 18px; margin-bottom: 12px; }
    p { font-size: 13px; line-height: 1.6; color: #808080; }
    code { background: #2d2d2d; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Connection Failed</h1>
    <p>Could not connect to <code>${targetUrl}</code></p>
    <p>Error: ${errorMessage}</p>
  </div>
</body>
</html>`;
  }

  public getPort(): number {
    return this._port;
  }

  public stop(): void {
    if (this._server) {
      this._server.close();
    }
  }
}
