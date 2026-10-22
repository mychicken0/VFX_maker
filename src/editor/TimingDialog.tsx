import { useState } from "react";
import { retimeProject, staggerLayers } from "../core/editing.js";
import type { Project } from "../core/model.js";
import { readableError } from "../core/errors.js";
import { Modal } from "./Modal.js";
import { NumberField } from "./controls.js";

export function TimingDialog({
  project,
  ids,
  apply,
  onClose,
}: {
  project: Project;
  ids: string[];
  apply: (p: Project) => void;
  onClose: () => void;
}) {
  const [duration, setDuration] = useState(project.duration),
    [stagger, setStagger] = useState(0.05),
    [error, setError] = useState("");
  const run = (action: () => Project) => {
    try {
      apply(action());
      onClose();
    } catch (e) {
      setError(readableError(e));
    }
  };
  return (
    <Modal title="Timing tools" onClose={onClose}>
      <p>
        Change the whole effect's speed, or delay selected layers one after
        another.
      </p>
      <NumberField
        label="New effect length"
        value={duration}
        min={0.1}
        max={10}
        step={0.1}
        unit="s"
        onChange={setDuration}
      />
      <button
        className="primary wide"
        onClick={() => run(() => retimeProject(project, duration))}
      >
        Stretch effect
      </button>
      <p className="hint">
        Retimes layers, particle motion and animated modifiers together. Locked
        layers also follow a whole-effect time change.
      </p>
      <details>
        <summary>Stagger selected layers</summary>
        <NumberField
          label="Stagger seconds"
          value={stagger}
          min={-10}
          max={10}
          step={0.01}
          unit="s"
          onChange={setStagger}
        />
        <button
          disabled={ids.length < 2}
          onClick={() => run(() => staggerLayers(project, ids, stagger))}
        >
          Stagger selection ({ids.length})
        </button>
        <p className="hint">
          Uses selection order and skips locked layers. Negative values move
          later selections earlier.
        </p>
      </details>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
