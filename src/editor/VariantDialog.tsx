import { useEffect, useRef, useState } from "react";
import { applyVariant, captureVariant } from "../core/parameters.js";
import { editCreative } from "../core/creative.js";
import type { Project } from "../core/model.js";
import { readableError } from "../core/errors.js";
import { VfxRenderer } from "../render/pixi.js";
import {
  preview,
  toBase64,
  zipExport,
  type ExportOptions,
} from "../render/export.js";
import { exportVariants } from "../render/variants.js";
import { downloadFile, safeFilename } from "./files.js";
import { Modal } from "./Modal.js";
import { Select } from "./controls.js";

export function VariantDialog({
  project,
  time,
  update,
  onClose,
}: {
  project: Project;
  time: number;
  update: (p: Project) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("New look"),
    [error, setError] = useState(""),
    [thumbnails, setThumbnails] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState(
      project.variants.slice(0, 8).map((v) => v.id),
    );
  const [format, setFormat] = useState<ExportOptions["format"]>("gif"),
    [progress, setProgress] = useState<{
      completed: number;
      total: number;
    } | null>(null);
  const controller = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let renderer: VfxRenderer | undefined;
      try {
        renderer = await VfxRenderer.create();
        const result: Record<string, string> = {};
        for (const v of project.variants) {
          if (cancelled) return;
          const p = applyVariant(project, v.id);
          await renderer.setProject(p);
          result[v.id] =
            "data:image/png;base64," +
            toBase64(
              await preview(renderer, p, Math.min(time, p.duration - 0.001)),
            );
          if (!cancelled) setThumbnails({ ...result });
        }
      } catch (e) {
        if (!cancelled) setError(readableError(e));
      } finally {
        renderer?.destroy();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, time]);
  const ids = selected.filter((id) =>
    project.variants.some((v) => v.id === id),
  );
  const runExport = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setProgress({ completed: 0, total: 1 });
    setError("");
    let renderer: VfxRenderer | undefined;
    try {
      renderer = await VfxRenderer.create();
      const files = await exportVariants(
        renderer,
        project,
        ids,
        { format },
        (completed, total) => {
          if (mounted.current) setProgress({ completed, total });
        },
        abort.signal,
      );
      abort.signal.throwIfAborted();
      downloadFile(
        zipExport(files),
        safeFilename(project.name) + "-variants.zip",
        "application/zip",
      );
    } catch (e) {
      if (mounted.current)
        setError(abort.signal.aborted ? "Export cancelled." : readableError(e));
    } finally {
      renderer?.destroy();
      controller.current = null;
      if (mounted.current) setProgress(null);
    }
  };
  return (
    <Modal
      title="Looks & variations"
      onClose={() => {
        if (!progress) onClose();
      }}
      busy={!!progress}
      wide
    >
      <p>
        Adjust your effect controls, then save a look. Every look shares the
        same editable effect and remembers its controls and random seed.
      </p>
      <div className="variant-save">
        <label className="field">
          <span>Look name</span>
          <input
            aria-label="Look name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={!!progress || !name.trim() || project.variants.length >= 12}
          onClick={() => {
            try {
              const id = "look-" + crypto.randomUUID().slice(0, 8);
              update(captureVariant(project, id, name.trim()));
              if (ids.length < 8) setSelected([...ids, id]);
              setName("New look");
              setError("");
            } catch (e) {
              setError(readableError(e));
            }
          }}
        >
          Save current look
        </button>
      </div>
      {!project.variants.length && (
        <div className="empty-state">
          Save your first look, then change a control and save another to
          compare them here.
        </div>
      )}
      <div className="variant-grid">
        {project.variants.map((v) => (
          <article className="variant-card" key={v.id}>
            <div className="variant-preview">
              {thumbnails[v.id] ? (
                <img src={thumbnails[v.id]} alt={`${v.name} preview`} />
              ) : (
                <span>Rendering…</span>
              )}
            </div>
            <strong>{v.name}</strong>
            <small>Seed {v.seed}</small>
            <label className="check">
              <span>Include in export</span>
              <input
                aria-label={`Export ${v.name}`}
                type="checkbox"
                checked={ids.includes(v.id)}
                disabled={
                  !!progress || (!ids.includes(v.id) && ids.length >= 8)
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...ids, v.id]
                      : ids.filter((id) => id !== v.id),
                  )
                }
              />
            </label>
            <div className="compact-actions">
              <button
                disabled={!!progress}
                onClick={() => {
                  try {
                    update(applyVariant(project, v.id));
                    onClose();
                  } catch (e) {
                    setError(readableError(e));
                  }
                }}
              >
                Use look
              </button>
              <button
                disabled={!!progress}
                aria-label={`Remove look ${v.name}`}
                onClick={() =>
                  update(
                    editCreative(project, {
                      action: "remove_variant",
                      id: v.id,
                    }),
                  )
                }
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="variant-export">
        <Select
          label="Variant export format"
          value={format ?? "gif"}
          options={["gif", "spritesheet", "sequence", "godot", "unity"]}
          onChange={(v) => setFormat(v as ExportOptions["format"])}
        />
        {progress ? (
          <>
            <progress value={progress.completed} max={progress.total} />
            <button onClick={() => controller.current?.abort()}>
              Cancel export
            </button>
          </>
        ) : (
          <button
            className="primary"
            disabled={!ids.length}
            onClick={() => void runExport()}
          >
            Export selected ({ids.length})
          </button>
        )}
      </div>
    </Modal>
  );
}
