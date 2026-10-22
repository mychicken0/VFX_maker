import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { Project } from "../core/model.js";
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
export async function serve(
  options: { port?: number; project?: Project; webRoot?: string } = {},
) {
  const root = resolve(
      options.webRoot ?? fileURLToPath(new URL("./web", import.meta.url)),
    ),
    token = randomBytes(24).toString("hex");
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "";
      if (!/^127\.0\.0\.1:\d+$/.test(host)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end();
        return;
      }
      const pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://127.0.0.1").pathname,
      );
      if (pathname === "/api/project") {
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(403);
          res.end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(options.project ?? null));
        return;
      }
      const path = resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (path !== root && !path.startsWith(root + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const info = await stat(path);
      if (!info.isFile()) throw new Error("Not a file");
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === "HEAD" ? undefined : await readFile(path));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Server did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
