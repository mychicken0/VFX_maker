import { useEffect, useMemo, useState } from "react";
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
import {
  controlSchema,
  type Control,
  type Binding,
} from "../core/creative-schema.js";
import {
  connectControl,
  disconnectControl,
  parameterTargets,
  setControl,
} from "../core/parameters.js";
import { editCreative } from "../core/creative.js";
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
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(
      () => void flow.fitView({ padding: 0.15, maxZoom: 1 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [initialized, scope, destination, p.controls.length, p.layers.length]);
  const act = (fn: () => Project) => {
    try {
      update(fn());
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  const destinationLayer = p.layers.find((l) => l.id === destination),
    selectedLayer = p.layers.find((l) => layerId(l.id) === selectedNode),
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
      position:
        (!ignoreSaved && p.editor.blueprint?.[node.id]) || node.position,
    }));
  };
  const [nodes, setNodes, onNodesChange] = useNodesState<Card>(makeNodes());
  useEffect(() => {
    const next = makeNodes();
    setNodes((old) =>
      next.map((n) => ({
        ...n,
        position:
          p.editor.blueprint?.[n.id] ??
          old.find((value) => value.id === n.id)?.position ??
          n.position,
      })),
    );
  }, [p, scope, destination, extraPorts]);
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
      connectControl(
        p,
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
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === "z" &&
          !(e.target as HTMLElement).closest("input,textarea,select")
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) redo();
          else undo();
        }
      }}
    >
      <div className="blueprint-toolbar">
        <button
          onClick={() =>
            act(() => {
              const id = `control-${crypto.randomUUID().slice(0, 8)}`;
              setSource(id);
              return editCreative(p, {
                action: "put_control",
                control: controlSchema.parse({ id, name: "New control" }),
              });
            })
          }
          disabled={p.controls.length >= 16}
        >
          + Number control
        </button>
        <button onClick={undo}>Undo</button>
        <button onClick={redo}>Redo</button>
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
          onClick={() => void flow.fitView({ padding: 0.15, maxZoom: 1 })}
        >
          Fit nodes
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
      <div className="blueprint-main">
        <div className="blueprint-graph" aria-label="Blueprint node graph">
          <ReactFlow<Card>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            onConnect={connect}
            onNodeClick={(_, node) => {
              setSelectedNode(node.id);
              setConnection(null);
              const parts = node.id.split(":");
              if (parts[0] === "modifier") setSelectedNode(layerId(parts[1]));
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
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
            minZoom={0.15}
            maxZoom={2}
            colorMode="dark"
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        <aside className="blueprint-sidebar">
          <div className="blueprint-preview">
            <Viewport
              project={p}
              time={time}
              update={() => {}}
              onError={setError}
              onInteract={() => {}}
            />
          </div>
          <div className="blueprint-properties">
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <details open>
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
                  act(() => connectControl(p, source, destination, port));
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
                      patchBinding({ mode: e.target.value as Binding["mode"] })
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
                  Input = control × factor + offset. The operation applies it to
                  the base value or every key of a curve. Controls run in
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
            {selectedLayer && (
              <ModifierPanel
                layer={selectedLayer}
                project={p}
                update={(value) => act(() => value)}
              />
            )}
            <details>
              <summary>How this graph renders</summary>
              <p>
                Number controls feed layer parameters. Green dashed wires show
                the fixed layer → ordered modifiers → composite output pipeline.
                Edit its modifier order in Modifiers; image wires cannot be
                rewired. Select All layers for the complete composition. No
                executable scripts are stored.
              </p>
            </details>
          </div>
        </aside>
      </div>
    </div>
  );
}
