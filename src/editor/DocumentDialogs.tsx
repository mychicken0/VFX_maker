import { useState } from "react";
import { Modal } from "./Modal.js";
import { readableError } from "../core/errors.js";
import type { BackupItem } from "./useDocument.js";
export function SaveAsDialog({
  name,
  busy,
  onSave,
  onClose,
}: {
  name: string;
  busy: boolean;
  onSave: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  const [path, setPath] = useState(name.replace(/\.json$/i, "") + "-copy.json"),
    [error, setError] = useState("");
  return (
    <Modal title="Save project as" busy={busy} onClose={onClose}>
      <p>
        Choose a new project filename inside the folder where Studio was
        started. Existing files are protected.
      </p>
      <label className="field">
        <span>Project filename</span>
        <input
          aria-label="Project filename"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          disabled={busy}
        />
      </label>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !path}
        onClick={() => {
          void onSave(path).catch((e) => setError(readableError(e)));
        }}
      >
        Save new file
      </button>
    </Modal>
  );
}
export function BackupsDialog({
  entries,
  busy,
  onRestore,
  onClose,
}: {
  entries: BackupItem[];
  busy: boolean;
  onRestore: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <Modal title="File backups" busy={busy} onClose={onClose}>
      <p>
        The last five distinct file versions are kept before saving. Restoring
        also backs up the current file.
      </p>
      {!entries.length && (
        <p>
          No file backups yet. A backup is created when Save replaces existing
          content.
        </p>
      )}
      <div className="recent-list">
        {entries.map((e) => (
          <div key={e.id}>
            <button
              disabled={busy}
              onClick={() => {
                void onRestore(e.id).catch((e) => setError(readableError(e)));
              }}
            >
              <b>{new Date(e.updated).toLocaleString()}</b>
              <small>
                {Math.round((e.bytes / 1024) * 10) / 10} KiB · Restore this
                version
              </small>
            </button>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
export function RecoveryDialog({
  name,
  onKeep,
  onFile,
}: {
  name: string;
  onKeep: () => void;
  onFile: () => void;
}) {
  return (
    <Modal title="Recover unsaved work" onClose={onKeep}>
      <p>
        Unsaved browser work was found for {name}. The disk file is available
        too. Choose which version to continue editing.
      </p>
      <div className="pixel-actions">
        <button className="primary" onClick={onKeep}>
          Recover unsaved changes
        </button>
        <button onClick={onFile}>Open disk version</button>
      </div>
    </Modal>
  );
}
