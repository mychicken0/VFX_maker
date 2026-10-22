import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/** UPNG 2.1.0 probes `typeof require`, which survives CommonJS conversion and
 * selects window.pako in a browser worker. Resolve its declared dependency
 * directly at build time. The published package and its license stay intact. */
function upngCompatibility(): Plugin {
  return {
    name: "upng-commonjs-worker",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").split("?")[0].endsWith("/upng-js/UPNG.js"))
        return;
      const header =
        /var pako;\s*if \(typeof module == "object"\) \{module.exports = UPNG;\}  else \{window.UPNG = UPNG;\}\s*if \(typeof require == "function"\) \{pako = require\("pako"\);\}  else \{pako = window.pako;\}/;
      if (!header.test(code))
        throw new Error(
          "UPNG compatibility header changed; review the pinned dependency.",
        );
      return {
        code: `import pako from 'pako'; const pngCodec = {};\n${code.replace("var UPNG = {};", "var UPNG = pngCodec;").replace(header, "")}\nexport default pngCodec;`,
        map: null,
      };
    },
  };
}
export default defineConfig({
  plugins: [upngCompatibility(), react()],
  worker: { plugins: () => [upngCompatibility()] },
  optimizeDeps: { exclude: ["upng-js"] },
  base: "./",
  build: {
    outDir: "dist/web",
    rollupOptions: {
      input: { editor: resolve("index.html"), render: resolve("render.html") },
    },
  },
  server: { host: "127.0.0.1" },
});
