import * as http from "http";
import * as https from "https";
import * as url from "url";

export class ProxyServer {
  private _server: http.Server | null = null;
  private _port: number = 0;

  constructor() {}

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url || "", true);
        
        if (parsedUrl.pathname === "/proxy") {
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

            const requestHeaders: Record<string, string> = {};
            for (const key of Object.keys(req.headers)) {
              if (key !== "host" && key !== "origin" && key !== "referer") {
                const headerVal = req.headers[key];
                if (headerVal !== undefined) {
                  requestHeaders[key] = Array.isArray(headerVal) ? headerVal.join(", ") : headerVal;
                }
              }
            }

            // Set referer and host to target server to prevent access block
            requestHeaders["host"] = targetUrl.host;
            requestHeaders["referer"] = targetUrl.origin;

            const proxyReq = requester.request(
              targetUrl,
              {
                method: req.method,
                headers: requestHeaders,
              },
              (proxyRes) => {
                const responseHeaders: Record<string, string> = {
                  "access-control-allow-origin": "*",
                };

                for (const key of Object.keys(proxyRes.headers)) {
                  const lowerKey = key.toLowerCase();
                  if (
                    lowerKey !== "x-frame-options" &&
                    lowerKey !== "content-security-policy" &&
                    lowerKey !== "content-security-policy-report-only" &&
                    lowerKey !== "frame-options"
                  ) {
                    const headerVal = proxyRes.headers[key];
                    if (headerVal !== undefined) {
                      responseHeaders[key] = Array.isArray(headerVal) ? headerVal.join(", ") : headerVal;
                    }
                  }
                }

                const contentType = proxyRes.headers["content-type"] || "";
                const isHtml = contentType.includes("text/html");

                if (isHtml) {
                  let body = "";
                  proxyRes.on("data", (chunk) => {
                    body += chunk.toString();
                  });

                  proxyRes.on("end", () => {
                    const baseTag = `<base href="${targetUrl.origin}${targetUrl.pathname}">`;
                    let modifiedBody = body;
                    
                    const headMatch = body.match(/<head[^>]*>/i);
                    if (headMatch && headMatch.index !== undefined) {
                      const insertIndex = headMatch.index + headMatch[0].length;
                      modifiedBody = body.substring(0, insertIndex) + baseTag + body.substring(insertIndex);
                    } else {
                      modifiedBody = baseTag + body;
                    }

                    delete responseHeaders["content-length"];
                    responseHeaders["content-type"] = "text/html; charset=utf-8";

                    res.writeHead(proxyRes.statusCode || 200, responseHeaders);
                    res.end(modifiedBody);
                  });
                } else {
                  res.writeHead(proxyRes.statusCode || 200, responseHeaders);
                  proxyRes.pipe(res);
                }
              }
            );

            proxyReq.on("error", (err) => {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end("Proxy request failed: " + err.message);
            });

            req.pipe(proxyReq);
          } catch (e: any) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid target URL: " + e.message);
          }
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      });

      this._server.listen(0, "127.0.0.1", () => {
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

  public getPort(): number {
    return this._port;
  }

  public stop(): void {
    if (this._server) {
      this._server.close();
    }
  }
}
