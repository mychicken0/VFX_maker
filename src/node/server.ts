import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { parseProject } from "../core/model.js";
import { Store, revision } from "./store.js";
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
  options: {
    port?: number;
    project?: Project;
    webRoot?: string;
    document?: { store: Store; file: string };
  } = {},
) {
  const root = resolve(
      options.webRoot ?? fileURLToPath(new URL("./web", import.meta.url)),
    ),
    token = randomBytes(24).toString("hex");
  let document = options.document;
  const documentInfo = async () => {
    if (!document) return null;
    return {
      ...(await document.store.read(document.file)),
      file: document.file,
      id: revision(document.store.root + "/" + document.file),
    };
  };
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "";
      if (!/^127\.0\.0\.1:\d+$/.test(host)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://127.0.0.1").pathname,
      );
      if (pathname.startsWith("/api/")) {
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(403);
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
          if (req.method === "GET" && pathname === "/api/document") {
            res.end(JSON.stringify(await documentInfo()));
            return;
          }
          if (req.method === "GET" && pathname === "/api/backups") {
            res.end(
              JSON.stringify(
                document ? await document.store.backups(document.file) : [],
              ),
            );
            return;
          }
          if (
            req.method === "POST" &&
            ["/api/save", "/api/save-as", "/api/restore"].includes(pathname)
          ) {
            if (!document)
              throw Error("Open Studio with a project file to save to disk");
            if (req.headers.origin && req.headers.origin !== `http://${host}`)
              throw Error("Invalid request origin");
            if (!req.headers["content-type"]?.startsWith("application/json"))
              throw Error("Use application/json");
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 5242880) throw Error("Request exceeds project budget");
              chunks.push(Buffer.from(chunk));
            }
            const value = JSON.parse(Buffer.concat(chunks).toString());
            if (
              value.documentId !==
              revision(document.store.root + "/" + document.file)
            )
              throw Error(
                "Document changed in another Studio tab. Reload before saving.",
              );
            if (pathname === "/api/save-as") {
              if (
                typeof value.file !== "string" ||
                !value.file.endsWith(".json")
              )
                throw Error(
                  "Choose a new .json filename inside the project folder",
                );
              const result = await document.store.create(
                value.file,
                parseProject(value.project),
              );
              document = { store: document.store, file: value.file };
              res.end(
                JSON.stringify({
                  ...result,
                  file: document.file,
                  id: revision(document.store.root + "/" + document.file),
                }),
              );
              return;
            }
            if (typeof value.revision !== "string")
              throw Error("Revision required");
            const result =
              pathname === "/api/save"
                ? await document.store.edit(document.file, value.revision, () =>
                    parseProject(value.project),
                  )
                : await document.store.restore(
                    document.file,
                    value.revision,
                    String(value.id),
                  );
            res.end(
              JSON.stringify({
                ...result,
                file: document.file,
                id: revision(document.store.root + "/" + document.file),
              }),
            );
            return;
          }
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          res.statusCode = /[Rr]evision conflict/.test(error) ? 409 : 400;
          res.end(JSON.stringify({ error }));
          return;
        }
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end();
        return;
      }
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
