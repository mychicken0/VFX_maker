import { useRef } from "react";
import type { Project, Asset } from "../core/model.js";
import { inspectPng } from "../core/pixels.js";
import { readableError } from "../core/errors.js";
import { toBase64 } from "../render/export.js";
import { NumberField, Select, Check } from "./controls.js";
export function ReferencePanel({
  project,
  onApply,
  onError,
}: {
  project: Project;
  onApply: (p: Project) => void;
  onError: (s: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    ref = project.editor.reference;
  const update = (
    patch: Partial<NonNullable<Project["editor"]["reference"]>>,
  ) => {
    if (ref)
      onApply({
        ...project,
        editor: { ...project.editor, reference: { ...ref, ...patch } },
      });
  };
  return (
    <>
      <div className="panel-heading">
        <span>REFERENCE IMAGE</span>
      </div>
      <button className="import-asset" onClick={() => input.current?.click()}>
        Import reference PNG
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png"
        hidden
        aria-label="Reference PNG"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            if (file.size > 1048576)
              throw Error("Reference PNG must be at most 1 MiB");
            const bytes = new Uint8Array(await file.arrayBuffer()),
              { width, height } = inspectPng(bytes);
            const image: Asset = {
              id: "reference-image",
              name: file.name.slice(0, 100),
              data: "data:image/png;base64," + toBase64(bytes),
              width,
              height,
              columns: 1,
              rows: 1,
              frames: 1,
            };
            onApply({
              ...project,
              editor: {
                ...project.editor,
                reference: {
                  image,
                  position: {
                    x: project.canvas.width / 2,
                    y: project.canvas.height / 2,
                  },
                  opacity: 0.7,
                  scale: 1,
                  visible: true,
                  plane: "behind",
                },
              },
            });
          } catch (e) {
            onError(readableError(e));
          }
        }}
      />
      {ref ? (
        <div className="reference-controls">
          <div className="asset-preview checker">
            <img src={ref.image.data} alt="Reference image" />
          </div>
          <b>{ref.image.name}</b>
          <Check
            label="Show reference"
            value={ref.visible}
            onChange={(visible) => update({ visible })}
          />
          <Select
            label="Reference plane"
            value={ref.plane}
            options={["behind", "above"]}
            onChange={(plane) => update({ plane: plane as typeof ref.plane })}
          />
          <div className="two-fields">
            <NumberField
              label="Reference X"
              value={ref.position.x}
              onChange={(x) => update({ position: { ...ref.position, x } })}
            />
            <NumberField
              label="Reference Y"
              value={ref.position.y}
              onChange={(y) => update({ position: { ...ref.position, y } })}
            />
          </div>
          <NumberField
            label="Reference scale"
            value={ref.scale}
            min={0.125}
            max={8}
            step={0.125}
            onChange={(scale) => update({ scale })}
          />
          <NumberField
            label="Reference opacity"
            value={ref.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(opacity) => update({ opacity })}
          />
          <button
            onClick={() =>
              onApply({
                ...project,
                editor: { ...project.editor, reference: undefined },
              })
            }
          >
            Remove reference
          </button>
          <p className="hint">Use Reference move in the preview to drag it.</p>
        </div>
      ) : (
        <div className="empty-state">
          Add a character or scene to judge the effect's size and timing.
        </div>
      )}
      <div className="library-tip">
        <p>
          Preview only. The image travels in your saved project and is excluded
          from rendered/exported files.
        </p>
      </div>
    </>
  );
}
