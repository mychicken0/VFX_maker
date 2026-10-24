import { useEffect, useRef, useState } from "react";
import type { CatalogEntry } from "../core/catalog.js";
export function AddNodeMenu({
  items,
  onChoose,
  onClose,
  position,
}: {
  items: CatalogEntry[];
  onChoose: (id: string) => void;
  onClose: () => void;
  position?: { x: number; y: number };
}) {
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("input")?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const found = items.filter((i) =>
    `${i.name} ${i.category} ${i.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div
      ref={ref}
      className="add-node-menu"
      role="dialog"
      aria-label="Add node"
      style={
        position
          ? {
              left: Math.max(8, Math.min(position.x, window.innerWidth - 350)),
              top: Math.max(8, Math.min(position.y, window.innerHeight - 430)),
              position: "fixed",
            }
          : undefined
      }
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const list = [
              ...ref.current!.querySelectorAll<HTMLButtonElement>(
                "button[data-node]:not(:disabled)",
              ),
            ],
            index = list.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            index < 0
              ? e.key === "ArrowDown"
                ? 0
                : list.length - 1
              : (index + (e.key === "ArrowDown" ? 1 : -1) + list.length) %
                list.length;
          list[next]?.focus();
        }
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          const first = found.find((i) => !i.disabled);
          if (first) onChoose(first.id);
        }
      }}
    >
      <div className="add-node-heading">
        <strong>Add node</strong>
        <button aria-label="Close Add menu" onClick={onClose}>
          ×
        </button>
      </div>
      <input
        aria-label="Search nodes"
        placeholder="Search layers, modifiers, controls…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="add-node-list">
        {(["Layers", "Modifiers", "Controls"] as const).map((group) => {
          const entries = found.filter((i) => i.category === group);
          return (
            !!entries.length && (
              <section key={group}>
                <h4>{group}</h4>
                {entries.map((item) => (
                  <button
                    key={item.id}
                    data-node={item.id}
                    disabled={!!item.disabled}
                    title={item.disabled}
                    onClick={() => onChoose(item.id)}
                  >
                    <span>{item.name}</span>
                    <small>{item.disabled ?? item.description}</small>
                  </button>
                ))}
              </section>
            )
          );
        })}
        {!found.length && <p>No matching nodes.</p>}
      </div>
      <p className="hint">↑ ↓ select · Enter add · Escape close</p>
    </div>
  );
}
