import { useEffect, useRef, useState } from "react";
import {
  pixelOptionsSchema,
  type PixelOptions,
} from "../core/pixel-options.js";
import type { optimizePng } from "../core/pixels.js";
import { readableError } from "../core/errors.js";
import { Modal } from "./Modal.js";
import { NumberField, Select, Check } from "./controls.js";
import { downloadFile, safeFilename } from "./files.js";
export type PixelSource = { name: string; bytes: Uint8Array; assetId?: string };
type Stats = ReturnType<typeof optimizePng>["stats"];
function useImage(bytes?: Uint8Array) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!bytes) {
      setUrl("");
      return;
    }
    const value = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [bytes]);
  return url;
}
const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
export function PixelLab({
  source,
  onSource,
  onClose,
  onOutput,
  onAsset,
  initial,
}: {
  source: PixelSource | null;
  onSource: (s: PixelSource) => void;
  onClose: () => void;
  onOutput: (p: PixelOptions) => void;
  onAsset?: (source: PixelSource, png: Uint8Array, stats: Stats) => void;
  initial: PixelOptions;
}) {
  const [options, setOptions] = useState(() =>
      pixelOptionsSchema.parse(initial),
    ),
    [result, setResult] = useState<{ png: Uint8Array; stats: Stats } | null>(
      null,
    ),
    [validatedSource, setValidatedSource] = useState<PixelSource | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [wipe, setWipe] = useState(50);
  const input = useRef<HTMLInputElement>(null),
    generation = useRef(0);
  const original = useImage(
      validatedSource === source ? source?.bytes : undefined,
    ),
    processed = useImage(result?.png);
  useEffect(() => {
    setError("");
    setResult(null);
    if (!source) return;
    setBusy(true);
    const id = ++generation.current,
      worker = new Worker(new URL("./pixels.worker.ts", import.meta.url), {
        type: "module",
      });
    worker.onmessage = (e) => {
      if (e.data.id !== generation.current) return;
      setBusy(false);
      if (e.data.error) setError(e.data.error);
      else {
        setResult(e.data);
        setValidatedSource(source);
      }
      worker.terminate();
    };
    worker.onerror = (e) => {
      if (id === generation.current) {
        setBusy(false);
        setError(e.message || "Image processing failed");
      }
      worker.terminate();
    };
    const bytes = new Uint8Array(source.bytes);
    worker.postMessage({ id, bytes: bytes.buffer, options }, [bytes.buffer]);
    return () => {
      generation.current++;
      worker.terminate();
    };
  }, [source, options]);
  const update = (patch: Partial<PixelOptions>) =>
    setOptions((p) => ({ ...p, ...patch }));
  return (
    <Modal title="Pixel optimizer" wide onClose={onClose}>
      <p>
        Reduce resolution, palette and PNG file size. Everything runs locally;
        your source stays intact.
      </p>
      <div className="pixel-lab-layout">
        <div className="pixel-controls">
          <button
            className="import-asset"
            onClick={() => input.current?.click()}
          >
            Open PNG
          </button>
          <input
            ref={input}
            hidden
            type="file"
            accept="image/png"
            aria-label="Open optimizer PNG"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                if (f.size > 4194304) throw Error("PNG must be at most 4 MiB");
                onSource({
                  name: f.name,
                  bytes: new Uint8Array(await f.arrayBuffer()),
                });
              } catch (error) {
                setError(readableError(error));
              }
            }}
          />
          <Select
            label="Output scale"
            value={String(options.scale)}
            options={[
              ...new Set([
                "0.125",
                "0.25",
                "0.5",
                "1",
                "2",
                "3",
                "4",
                "8",
                String(options.scale),
              ]),
            ]}
            onChange={(scale) => update({ scale: Number(scale) })}
          />
          <Select
            label="Color limit"
            value={String(options.colors)}
            options={[
              ...new Set([
                "0",
                "2",
                "4",
                "8",
                "16",
                "32",
                "64",
                "128",
                "256",
                String(options.colors),
              ]),
            ]}
            onChange={(colors) => update({ colors: Number(colors) })}
          />
          <p className="hint">
            0 keeps every color. Smaller palettes change the image.
          </p>
          <Check
            label="Ordered dithering"
            value={options.dither}
            onChange={(dither) => update({ dither })}
          />
          <NumberField
            label="Pixel block size"
            value={options.pixelSize}
            min={1}
            max={16}
            onChange={(pixelSize) =>
              update({ pixelSize: Math.round(pixelSize) })
            }
          />
          <Select
            label="Alpha levels"
            value={String(options.alphaLevels)}
            options={["0", "2", "4", "8", "16", "32", "64", "256"]}
            onChange={(alphaLevels) =>
              update({ alphaLevels: Number(alphaLevels) })
            }
          />
          <p className="hint">
            Alpha 0 preserves transparency exactly. Resize uses nearest-neighbor
            sampling.
          </p>
          <button onClick={() => setOptions(pixelOptionsSchema.parse({}))}>
            Reset to lossless
          </button>
        </div>
        <div className="pixel-results">
          <div className="comparison-labels">
            <b>Original</b>
            <span>{source?.name ?? "Rendering current frame…"}</span>
            <b>Optimized</b>
          </div>
          <div className="pixel-comparison checker">
            {original && <img src={original} alt="Original PNG" />}
            {processed && (
              <img
                src={processed}
                alt="Optimized PNG"
                style={{ clipPath: `inset(0 0 0 ${wipe}%)` }}
              />
            )}
            <div className="comparison-line" style={{ left: `${wipe}%` }} />
          </div>
          <input
            type="range"
            aria-label="Before after comparison"
            min={0}
            max={100}
            value={wipe}
            onChange={(e) => setWipe(Number(e.target.value))}
          />
          {busy && (
            <p role="status">Processing… You can keep adjusting settings.</p>
          )}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {result && (
            <>
              <div className="optimizer-stats">
                <div>
                  <small>FILE SIZE</small>
                  <strong>
                    {size(result.stats.inputBytes)} →{" "}
                    {size(result.stats.outputBytes)}
                  </strong>
                  <span>
                    {result.stats.savedBytes >= 0
                      ? `${result.stats.savingsPercent.toFixed(1)}% smaller`
                      : `${(-result.stats.savingsPercent).toFixed(1)}% larger`}
                  </span>
                </div>
                <div>
                  <small>DIMENSIONS</small>
                  <strong>
                    {result.stats.inputWidth} × {result.stats.inputHeight} →{" "}
                    {result.stats.width} × {result.stats.height}
                  </strong>
                  <span>
                    {result.stats.colorsBefore} → {result.stats.colorsAfter}{" "}
                    visible RGB colors
                  </span>
                </div>
              </div>
              <p className="hint">
                {result.stats.lossless
                  ? "Lossless: decoded RGBA pixels are preserved."
                  : "Palette, alpha, pixel block or scale changes are lossy."}
                {result.stats.keptOriginal
                  ? " Original encoding was already smaller and was kept."
                  : ""}
              </p>
            </>
          )}
          <div className="pixel-actions">
            <button
              className="primary"
              disabled={!result || busy || !!error}
              onClick={() =>
                result &&
                downloadFile(
                  result.png,
                  safeFilename(source?.name.replace(/\.png$/i, "") ?? "frame") +
                    "-optimized.png",
                  "image/png",
                )
              }
            >
              Download PNG
            </button>
            {source?.assetId && onAsset && (
              <button
                disabled={!result || busy || !!error}
                onClick={() =>
                  result && onAsset(source, result.png, result.stats)
                }
              >
                Replace texture
              </button>
            )}
            <button
              disabled={!result || busy || !!error}
              onClick={() => onOutput(options)}
            >
              Use settings for exports
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
