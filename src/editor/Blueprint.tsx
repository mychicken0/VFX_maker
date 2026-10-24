import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useReactFlow,
  useNodesInitialized,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Project } from "../core/model.js";
import { type Control, type Binding } from "../core/creative-schema.js";
import {
  connectControl,
  disconnectControl,
  parameterTargets,
  setControl,
} from "../core/parameters.js";
import { editCreative } from "../core/creative.js";
import {
  addCatalogNode,
  nodeCatalog,
  duplicateEditorLayer,
} from "../core/catalog.js";
import { applyEdits, updateLayerData } from "../core/operations.js";
import { uniqueLayerName } from "../core/authoring.js";
import { AddNodeMenu } from "./AddNodeMenu.js";
import { Inspector } from "./Inspector.js";
import { readableError } from "../core/errors.js";
import { NumberField } from "./controls.js";
import { ModifierPanel, MODIFIER_NAMES } from "./ModifierPanel.js";
import { Modal } from "./Modal.js";
import { Viewport } from "./Viewport.js";

type Card = Node<
  {
    title: string;
    subtitle: string;
    ports: string[];
    control?: Control;
    locked?: boolean;
    value?: (v: number) => void;
  },
  "card"
>;
function CardNode({ id, data }: NodeProps<Card>) {
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => updateInternals(id), [id, data.ports.join("|")]);
  return (
    <div className={`blueprint-card ${data.locked ? "is-locked" : ""}`}>
      <header>
        <strong>{data.title}</strong>
        <small>{data.subtitle}</small>
      </header>
      {data.control ? (
        <div className="nodrag nowheel blueprint-value">
          <NumberField
            label={`Node ${data.control.name}`}
            caption="Value"
            value={data.control.value}
            min={data.control.min}
            max={data.control.max}
            step={data.control.step}
            onChange={data.value!}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="value"
            aria-label={`${data.title} value output`}
          />
        </div>
      ) : (
        <>
          {data.ports.map((port) => (
            <div className="blueprint-port" key={port}>
              <Handle
                type="target"
                id={port}
                position={Position.Left}
                isConnectable={!data.locked}
                aria-label={`${data.title} ${port} input`}
              />
              <span>{port}</span>
            </div>
          ))}
          <Handle
            type="source"
            position={Position.Right}
            id="image"
            isConnectable={false}
          />
        </>
      )}
    </div>
  );
}
const nodeTypes = { card: CardNode };
const commonPorts = [
  "scale",
  "rotation",
  "position.x",
  "position.y",
  "opacity",
  "colors.hue",
];
const controlId = (id: string) => `control:${id}`;
const layerId = (id: string) => `layer:${id}`;
export function Blueprint(props: {
  project: Project;
  selected?: string;
  time: number;
  update: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Blueprint · controls & effects" onClose={props.onClose} wide>
      <ReactFlowProvider>
        <Graph {...props} />
      </ReactFlowProvider>
    </Modal>
  );
}
function Graph({
  project: p,
  selected,
  time,
  update,
  undo,
  redo,
}: Omit<Parameters<typeof Blueprint>[0], "onClose">) {
  const [error, setError] = useState(""),
    [scope, setScope] = useState("selected"),
    [showProperties, setShowProperties] = useState(
      () => window.innerWidth > 760,
    ),
    [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null),
    [previewTime, setPreviewTime] = useState(Math.min(time, p.duration * 0.35)),
    [playing, setPlaying] = useState(false),
    [previewDraft, setPreviewDraft] = useState<Project | null>(null),
    [fitting, setFitting] = useState(true),
    [selectedNode, setSelectedNode] = useState(
      selected ? layerId(selected) : "",
    ),
    [connection, setConnection] = useState<{
      control: string;
      index: number;
    } | null>(null),
    [source, setSource] = useState(p.controls[0]?.id ?? ""),
    [destination, setDestination] = useState(selected ?? p.layers[0]?.id ?? ""),
    [port, setPort] = useState("scale"),
    [extraPorts, setExtraPorts] = useState<Record<string, string[]>>({});
  const flow = useReactFlow<Card>();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && addMenu) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setAddMenu(null);
        return;
      }
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "z") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === "Delete" || key === "x") {
        e.preventDefault();
        e.stopImmediatePropagation();
        remove();
        return;
      }
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && key === "d") {
        e.preventDefault();
        e.stopImmediatePropagation();
        duplicateNode();
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setAddMenu({ x: 32, y: 112 });
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [addMenu, p, selectedNode, connection]);
  const initialized = useNodesInitialized(),
    graphHost = useRef<HTMLDivElement>(null),
    initialFit = useRef(false);
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      last = performance.now(),
      elapsed = previewTime;
    const tick = (now: number) => {
      elapsed = (elapsed + Math.min(0.1, (now - last) / 1000)) % p.duration;
      last = now;
      setPreviewTime(Math.floor(elapsed * p.fps) / p.fps);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, p.duration, p.fps]);
  useEffect(() => {
    if (!p.controls.some((c) => c.id === source))
      setSource(p.controls[0]?.id ?? "");
    if (!p.layers.some((l) => l.id === destination))
      setDestination(p.layers[0]?.id ?? "");
  }, [p.controls, p.layers, source, destination]);
  const act = (fn: () => Project) => {
    try {
      update(fn());
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  const destinationLayer = p.layers.find((l) => l.id === destination),
    selectedLayer = p.layers.find(
      (l) =>
        layerId(l.id) === selectedNode ||
        selectedNode.startsWith(`modifier:${l.id}:`),
    ),
    selectedControl = p.controls.find((c) => controlId(c.id) === selectedNode),
    selectedBindingControl = p.controls.find(
      (c) => c.id === connection?.control,
    ),
    binding = selectedBindingControl?.bindings[connection?.index ?? -1];
  const shownLayers =
    scope === "all" ? p.layers : p.layers.filter((l) => l.id === destination);
  const makeNodes = (ignoreSaved = false): Card[] => {
    const nodes: Card[] = p.controls.map((c, i) => ({
      id: controlId(c.id),
      type: "card",
      position: { x: 0, y: i * 180 },
      dragHandle: "header",
      data: {
        title: c.name,
        subtitle: "Number control",
        ports: [],
        control: c,
        value: (value) => act(() => setControl(p, c.id, value)),
      },
    }));
    for (const [index, l] of shownLayers.entries()) {
      const targets = parameterTargets(l),
        bound = p.controls.flatMap((c) =>
          c.bindings.filter((b) => b.layer === l.id).map((b) => b.target),
        ),
        ports = [
          ...new Set([...commonPorts, ...(extraPorts[l.id] ?? []), ...bound]),
        ].filter((path) => targets.some((t) => t.path === path));
      nodes.push({
        dragHandle: "header",
        id: layerId(l.id),
        type: "card",
        position: { x: 350, y: index * 420 },
        data: {
          title: l.name,
          subtitle: `${l.type}${l.locked ? " · locked" : ""}`,
          ports,
          locked: l.locked,
        },
      });
      l.modifiers.forEach((m, i) =>
        nodes.push({
          id: `modifier:${l.id}:${m.id}`,
          type: "card",
          position: { x: 690 + i * 280, y: index * 420 },
          data: {
            title: MODIFIER_NAMES[m.type],
            subtitle: `${l.name} · ${m.enabled ? "enabled" : "off"}`,
            ports: ["image"],
            locked: true,
          },
        }),
      );
    }
    nodes.push({
      id: "output",
      type: "card",
      position: {
        x:
          750 +
          Math.max(0, ...shownLayers.map((l) => l.modifiers.length)) * 280,
        y: 100,
      },
      data: {
        title: "Effect output",
        subtitle: `${p.canvas.width} × ${p.canvas.height} · ${p.layers.length} layers`,
        ports: ["image"],
        locked: true,
      },
    });
    return nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNode,
      position:
        (!ignoreSaved && p.editor.blueprint?.[node.id]) || node.position,
    }));
  };
  const [nodes, setNodes, onNodesChange] = useNodesState<Card>(makeNodes());
  useEffect(() => {
    const next = makeNodes();
    setNodes((old) =>
      next.map((n) => ({
        ...old.find((v) => v.id === n.id),
        ...n,
        position:
          p.editor.blueprint?.[n.id] ??
          old.find((value) => value.id === n.id)?.position ??
          n.position,
      })),
    );
  }, [p, scope, destination, extraPorts, selectedNode]);
  const topology = nodes.map((n) => n.id).join("|");
  useEffect(() => {
    if (initialFit.current || !initialized) return;
    let alive = true;
    let frame = 0,
      attempts = 0;
    const fit = () => {
      const measured = flow.getNodes();
      if (
        measured.map((n) => n.id).join("|") !== topology ||
        measured.some((n) => !n.measured?.width || !n.measured?.height)
      ) {
        if (++attempts < 30) frame = requestAnimationFrame(fit);
        else setFitting(false);
        return;
      }
      initialFit.current = true;
      void flow
        .fitView({ padding: 0.08, minZoom: 0.8, maxZoom: 1 })
        .then(() => {
          if (alive) setFitting(false);
        });
    };
    frame = requestAnimationFrame(fit);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [initialized, topology]);
  const add = (key: string) => {
    act(() => {
      const id = `node-${crypto.randomUUID().slice(0, 8)}`,
        result = addCatalogNode(p, key, id, selectedLayer?.id ?? destination),
        box = graphHost.current?.getBoundingClientRect(),
        point = flow.screenToFlowPosition({
          x: (box?.x ?? 0) + (box?.width ?? 800) * 0.5 - 120,
          y: (box?.y ?? 0) + (box?.height ?? 600) * 0.4 - 60,
        });
      const occupied = [
        ...flow.getNodes(),
        ...p.layers.map((l, index) => ({
          position: p.editor.blueprint?.[layerId(l.id)] ?? {
            x: 350,
            y: index * 420,
          },
          measured: { width: 260, height: 340 },
        })),
        {
          position: p.editor.blueprint?.output ?? {
            x:
              750 +
              Math.max(
                0,
                ...result.project.layers.map((l) => l.modifiers.length),
              ) *
                280,
            y: 100,
          },
          measured: { width: 260, height: 130 },
        },
      ];
      const height = key.startsWith("layer:")
        ? 340
        : key.startsWith("control:")
          ? 150
          : 110;
      const free = (x: number, y: number) =>
        occupied.every(
          (n) =>
            x + 280 < n.position.x - 16 ||
            x > n.position.x + (n.measured?.width ?? 260) + 16 ||
            y + height < n.position.y - 16 ||
            y > n.position.y + (n.measured?.height ?? 300) + 16,
        );
      const candidates = Array.from({ length: 49 }, (_, i) => ({
        x: point.x + ((i % 7) - 3) * 300,
        y: point.y + (Math.floor(i / 7) - 3) * 220,
      })).sort(
        (a, b) =>
          Math.hypot(a.x - point.x, a.y - point.y) -
          Math.hypot(b.x - point.x, b.y - point.y),
      );
      const vacant = candidates.find((v) => free(v.x, v.y)) ?? {
        x: Math.max(0, ...occupied.map((n) => n.position.x + 320)),
        y: point.y,
      };
      point.x = vacant.x;
      point.y = vacant.y;
      void flow.setCenter(point.x + 130, point.y + height / 2, {
        zoom: Math.max(0.85, flow.getZoom()),
      });
      setAddMenu(null);
      graphHost.current?.focus({ preventScroll: true });
      setSelectedNode(result.node);
      setConnection(null);
      setShowProperties(true);
      setPlaying(false);
      setPreviewTime(p.duration * 0.25);
      if (key.startsWith("control:")) setSource(id);
      if (key.startsWith("layer:")) {
        setDestination(id);
      }
      return applyEdits(result.project, [
        {
          action: "update_project",
          patch: {
            editor: {
              blueprint: {
                ...result.project.editor.blueprint,
                [result.node]: point,
              },
            },
          },
        },
      ]);
    });
  };
  const remove = () => {
    if (connection) {
      act(() => disconnectControl(p, connection.control, connection.index));
      setConnection(null);
      return;
    }
    if (selectedControl) {
      act(() =>
        editCreative(p, { action: "remove_control", id: selectedControl.id }),
      );
      setSelectedNode("");
      return;
    }
    if (selectedNode.startsWith("modifier:") && selectedLayer) {
      act(() =>
        editCreative(p, {
          action: "remove_modifier",
          layer: selectedLayer.id,
          id: selectedNode.split(":")[2],
        }),
      );
      setSelectedNode(layerId(selectedLayer.id));
      return;
    }
    if (selectedLayer) {
      act(() =>
        applyEdits(p, [{ action: "remove_layer", id: selectedLayer.id }]),
      );
      setSelectedNode("");
      return;
    }
    setError("Select a layer, modifier, control or parameter wire to delete.");
  };
  const duplicateNode = () => {
    const id = `node-${crypto.randomUUID().slice(0, 8)}`,
      original = flow.getNode(selectedNode);
    if (!original) return;
    act(() => {
      let next: Project;
      if (selectedControl) {
        next = editCreative(p, {
          action: "put_control",
          control: {
            ...selectedControl,
            id,
            name: uniqueLayerName(
              `${selectedControl.name} copy`,
              p.controls.map((c) => c.name),
            ),
            bindings: [],
          },
        });
        setSelectedNode(controlId(id));
      } else if (selectedNode.startsWith("modifier:") && selectedLayer) {
        const modifier = selectedLayer.modifiers.find(
          (m) => m.id === selectedNode.split(":")[2],
        )!;
        next = editCreative(p, {
          action: "put_modifier",
          layer: selectedLayer.id,
          modifier: { ...modifier, id },
        });
        setSelectedNode(`modifier:${selectedLayer.id}:${id}`);
      } else if (selectedLayer) {
        next = duplicateEditorLayer(p, selectedLayer.id, id);
        setSelectedNode(layerId(id));
        setDestination(id);
        setScope("all");
      } else return p;
      const node = selectedControl
        ? controlId(id)
        : selectedNode.startsWith("modifier:")
          ? `modifier:${selectedLayer!.id}:${id}`
          : layerId(id);
      return applyEdits(next, [
        {
          action: "update_project",
          patch: {
            editor: {
              blueprint: {
                ...next.editor.blueprint,
                [node]: {
                  x: original.position.x + 60,
                  y: original.position.y + 60,
                },
              },
            },
          },
        },
      ]);
    });
  };
  const edges = useMemo(() => {
    const result: Edge[] = [];
    for (const c of p.controls)
      c.bindings.forEach((b, index) => {
        if (shownLayers.some((l) => l.id === b.layer))
          result.push({
            id: `binding:${c.id}:${index}`,
            source: controlId(c.id),
            sourceHandle: "value",
            target: layerId(b.layer),
            targetHandle: b.target,
            label: `${b.mode} ×${b.factor} ${b.offset ? `+${b.offset}` : ""}`,
            data: { control: c.id, index },
            selected:
              connection?.control === c.id && connection.index === index,
            deletable: false,
            style: { stroke: "#bba0ff", strokeWidth: 2 },
            interactionWidth: 24,
          });
      });
    for (const l of shownLayers) {
      const chain = [
        layerId(l.id),
        ...l.modifiers.map((m) => `modifier:${l.id}:${m.id}`),
        "output",
      ];
      for (let i = 1; i < chain.length; i++)
        result.push({
          id: `pipeline:${chain[i - 1]}:${chain[i]}`,
          source: chain[i - 1],
          sourceHandle: "image",
          target: chain[i],
          targetHandle: "image",
          selectable: false,
          deletable: false,
          style: { stroke: "#6c9f95", strokeDasharray: "5 4" },
        });
    }
    return result;
  }, [p, scope, destination, connection]);
  const connectParameter = (control: string, layer: string, target: string) => {
    const descriptor = parameterTargets(
      p.layers.find((l) => l.id === layer)!,
    ).find((t) => t.path === target);
    return connectControl(p, control, layer, target, {
      mode:
        descriptor?.kind === "curve" || target === "scale" ? "multiply" : "set",
    });
  };
  const connect = (value: Connection) => {
    if (
      !value.source.startsWith("control:") ||
      !value.target.startsWith("layer:") ||
      value.sourceHandle !== "value" ||
      !value.targetHandle
    ) {
      setError("Connect a number control output to a layer parameter input.");
      return;
    }
    act(() =>
      connectParameter(
        value.source.slice(8),
        value.target.slice(6),
        value.targetHandle!,
      ),
    );
  };
  const patchBinding = (patch: Partial<Binding>) => {
    if (!connection || !selectedBindingControl || !binding) return;
    act(() =>
      editCreative(p, {
        action: "put_control",
        control: {
          ...selectedBindingControl,
          bindings: selectedBindingControl.bindings.map((b, i) =>
            i === connection.index ? { ...b, ...patch } : b,
          ),
        },
      }),
    );
  };
  return (
    <div
      className="blueprint-workspace"
      onKeyDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            "input,textarea,select,[contenteditable]",
          )
        )
          return;
        const key = e.key.toLowerCase();
        if (e.shiftKey && key === "a") {
          e.preventDefault();
          e.stopPropagation();
          setAddMenu({ x: 32, y: 112 });
        } else if (e.key === "Delete" || key === "x") {
          e.preventDefault();
          e.stopPropagation();
          remove();
        } else if ((e.shiftKey || e.ctrlKey || e.metaKey) && key === "d") {
          e.preventDefault();
          e.stopPropagation();
          duplicateNode();
        } else if ((e.ctrlKey || e.metaKey) && key === "z") {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) redo();
          else undo();
        } else if (e.key === "Home") {
          e.preventDefault();
          void flow.fitView({ padding: 0.08, maxZoom: 1 });
        } else if (
          e.code === "Space" &&
          !(e.target as HTMLElement).closest("button,summary,a,[role=button]")
        ) {
          e.preventDefault();
          setPlaying((v) => !v);
        }
      }}
    >
      <div className="blueprint-toolbar">
        <button
          className="primary"
          aria-label="Add node"
          onClick={() => setAddMenu({ x: 32, y: 112 })}
        >
          + Add <kbd>Shift A</kbd>
        </button>
        <button onClick={undo}>Undo</button>
        <button onClick={redo}>Redo</button>
        <button
          disabled={!selectedLayer && !selectedControl && !connection}
          onClick={remove}
        >
          Delete
        </button>
        <button
          disabled={!selectedLayer && !selectedControl}
          onClick={duplicateNode}
        >
          Duplicate
        </button>
        <button
          aria-pressed={showProperties}
          onClick={() => setShowProperties((v) => !v)}
        >
          Properties
        </button>
        <select
          aria-label="Blueprint layers"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
          }}
        >
          <option value="selected">Chosen layer</option>
          <option value="all">All layers</option>
        </select>
        <button
          disabled={fitting}
          onClick={async () => {
            setFitting(true);
            await flow.fitView({ padding: 0.15, maxZoom: 1 });
            setFitting(false);
          }}
        >
          Fit nodes
        </button>
        <button onClick={() => void flow.zoomTo(1)}>100%</button>
        <button
          onClick={() => {
            const node = flow.getNode(selectedNode);
            if (node)
              void flow.setCenter(
                node.position.x + 120,
                node.position.y + 100,
                { zoom: 1 },
              );
          }}
        >
          Frame selected
        </button>
        <button
          onClick={() => {
            const arranged = makeNodes(true);
            setNodes(arranged);
            act(() => ({
              ...p,
              editor: {
                ...p.editor,
                blueprint: Object.fromEntries(
                  arranged.map((n) => [n.id, n.position]),
                ),
              },
            }));
          }}
        >
          Arrange
        </button>
        <span>
          Drag a purple output to a parameter. Click a wire to edit it.
        </span>
      </div>
      {error && (
        <p role="alert" className="workspace-error">
          {error}
          <button
            aria-label="Dismiss Blueprint error"
            onClick={() => setError("")}
          >
            ×
          </button>
        </p>
      )}
      <div
        className={`blueprint-main ${showProperties ? "has-properties" : ""}`}
      >
        <div
          ref={graphHost}
          tabIndex={0}
          className="blueprint-graph"
          aria-label="Blueprint node graph"
          aria-busy={fitting}
        >
          <ReactFlow<Card>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            onConnect={connect}
            onPaneContextMenu={(e) => {
              e.preventDefault();
              setAddMenu({ x: e.clientX, y: e.clientY });
            }}
            onNodeContextMenu={(e, node) => {
              e.preventDefault();
              setSelectedNode(node.id);
              setAddMenu({ x: e.clientX, y: e.clientY });
            }}
            onPaneClick={() => {
              setConnection(null);
            }}
            onNodeClick={(_, node) => {
              setSelectedNode(node.id);
              setConnection(null);
              const parts = node.id.split(":");
              if (parts[0] === "layer" || parts[0] === "modifier")
                setDestination(parts[1]);
              if (parts[0] === "control") setSource(parts[1]);
              setShowProperties(true);
            }}
            onEdgeClick={(_, edge) => {
              if (edge.data?.control)
                setConnection({
                  control: String(edge.data.control),
                  index: Number(edge.data.index),
                });
            }}
            onNodeDragStop={(_, node) =>
              act(() => ({
                ...p,
                editor: {
                  ...p.editor,
                  blueprint: {
                    ...p.editor.blueprint,
                    [node.id]: node.position,
                  },
                },
              }))
            }
            deleteKeyCode={null}
            nodesConnectable={!fitting}
            nodesDraggable={!fitting}
            minZoom={0.15}
            maxZoom={2}
            colorMode="dark"
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        {showProperties && (
          <aside className="blueprint-sidebar">
            <div className="blueprint-preview">
              <Viewport
                project={previewDraft ?? p}
                time={previewTime}
                update={() => {}}
                onError={setError}
                onInteract={() => {}}
              />
            </div>
            <div className="blueprint-transport">
              <button
                aria-label={playing ? "Pause Blueprint" : "Play Blueprint"}
                onClick={() => setPlaying((v) => !v)}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <input
                aria-label="Blueprint playhead"
                type="range"
                min={0}
                max={p.duration}
                step={1 / p.fps}
                value={previewTime}
                onChange={(e) => {
                  setPlaying(false);
                  setPreviewTime(Number(e.target.value));
                }}
              />
              <small>{previewTime.toFixed(2)}s</small>
            </div>
            <div className="blueprint-properties">
              <details>
                <summary>Connect parameters</summary>
                <label className="field">
                  <span>Control output</span>
                  <select
                    aria-label="Blueprint control"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">Choose control</option>
                    {p.controls.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Layer input</span>
                  <select
                    aria-label="Blueprint layer"
                    value={destination}
                    onChange={(e) => {
                      setDestination(e.target.value);
                      setPort("scale");
                    }}
                  >
                    <option value="">Choose layer</option>
                    {p.layers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {l.locked ? " · locked" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Parameter input</span>
                  <select
                    aria-label="Blueprint parameter"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  >
                    {destinationLayer &&
                      parameterTargets(destinationLayer).map((t) => (
                        <option key={t.path}>{t.path}</option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={
                    !destinationLayer || destinationLayer.locked || !source
                  }
                  onClick={() => {
                    setExtraPorts((v) => ({
                      ...v,
                      [destination]: [...(v[destination] ?? []), port],
                    }));
                    act(() => connectParameter(source, destination, port));
                  }}
                >
                  Connect
                </button>
                <button
                  disabled={!destinationLayer}
                  onClick={() =>
                    setExtraPorts((v) => ({
                      ...v,
                      [destination]: [...(v[destination] ?? []), port],
                    }))
                  }
                >
                  Show input port
                </button>
              </details>
              {connection && binding && selectedBindingControl && (
                <section aria-label="Connection properties">
                  <h3>
                    {selectedBindingControl.name} → {binding.target}
                  </h3>
                  <label className="field">
                    <span>Operation</span>
                    <select
                      aria-label="Connection mode"
                      value={binding.mode}
                      onChange={(e) =>
                        patchBinding({
                          mode: e.target.value as Binding["mode"],
                        })
                      }
                    >
                      <option value="multiply">Multiply base value</option>
                      <option value="set">Set value</option>
                      <option value="add">Add to base value</option>
                    </select>
                  </label>
                  <NumberField
                    label="Connection factor"
                    value={binding.factor}
                    step={0.01}
                    onChange={(factor) => patchBinding({ factor })}
                  />
                  <NumberField
                    label="Connection offset"
                    value={binding.offset}
                    step={0.01}
                    onChange={(offset) => patchBinding({ offset })}
                  />
                  <p className="field-help">
                    Input = control × factor + offset. The operation applies it
                    to the base value or every key of a curve. Controls run in
                    project order.
                  </p>
                  <button
                    onClick={() => {
                      act(() =>
                        disconnectControl(
                          p,
                          connection.control,
                          connection.index,
                        ),
                      );
                      setConnection(null);
                    }}
                  >
                    Disconnect
                  </button>
                </section>
              )}
              {selectedControl && (
                <details open>
                  <summary>Number control settings</summary>
                  <label className="field">
                    <span>Name</span>
                    <input
                      aria-label="Node control name"
                      value={selectedControl.name}
                      onChange={(e) => {
                        if (e.target.value)
                          act(() =>
                            editCreative(p, {
                              action: "put_control",
                              control: {
                                ...selectedControl,
                                name: e.target.value,
                              },
                            }),
                          );
                      }}
                    />
                  </label>
                  <NumberField
                    label="Node minimum"
                    value={selectedControl.min}
                    step={0.01}
                    onChange={(min) =>
                      act(() =>
                        editCreative(p, {
                          action: "put_control",
                          control: { ...selectedControl, min },
                        }),
                      )
                    }
                  />
                  <NumberField
                    label="Node maximum"
                    value={selectedControl.max}
                    step={0.01}
                    onChange={(max) =>
                      act(() =>
                        editCreative(p, {
                          action: "put_control",
                          control: { ...selectedControl, max },
                        }),
                      )
                    }
                  />
                  <button
                    onClick={() =>
                      act(() =>
                        editCreative(p, {
                          action: "remove_control",
                          id: selectedControl.id,
                        }),
                      )
                    }
                  >
                    Delete control
                  </button>
                </details>
              )}
              {selectedLayer && !selectedNode.startsWith("modifier:") && (
                <div className="blueprint-layer-inspector">
                  <Inspector
                    layer={selectedLayer}
                    project={p}
                    update={(patch) =>
                      act(() => updateLayerData(p, selectedLayer.id, patch))
                    }
                    updateProject={(value) => act(() => value)}
                    preview={setPreviewDraft}
                  />
                </div>
              )}
              {selectedLayer && selectedNode.startsWith("modifier:") && (
                <ModifierPanel
                  open
                  focusId={selectedNode.split(":")[2]}
                  layer={selectedLayer}
                  project={p}
                  update={(value) => act(() => value)}
                />
              )}
              <details>
                <summary>How this graph renders</summary>
                <p>
                  Number controls feed layer parameters. Green dashed wires show
                  the fixed layer → ordered modifiers → composite output
                  pipeline. Edit its modifier order in Modifiers; image wires
                  cannot be rewired. Select All layers for the complete
                  composition. No executable scripts are stored.
                </p>
              </details>
            </div>
          </aside>
        )}
      </div>
      {addMenu && (
        <AddNodeMenu
          items={nodeCatalog(p, selectedLayer?.id ?? destination)}
          position={addMenu}
          onChoose={add}
          onClose={() => setAddMenu(null)}
        />
      )}
    </div>
  );
}
