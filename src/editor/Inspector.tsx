import type { Layer, Project, Vec } from "../core/model.js";
import {
  Check,
  CurveEditor,
  GradientEditor,
  NumberField,
  Select,
} from "./controls.js";
export function Inspector({
  layer: l,
  project: p,
  update,
  updateProject,
}: {
  layer?: Layer;
  project: Project;
  update: (patch: Record<string, unknown>) => void;
  updateProject: (p: Project) => void;
}) {
  const n = (
    label: string,
    key: string,
    value: number,
    min = 0,
    max = 1024,
    step = 1,
    unit?: string,
  ) => (
    <NumberField
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={unit}
      onChange={(v) => update({ [key]: v })}
    />
  );
  const vector = (label: string, value: Vec, key: string) => (
    <div className="two-fields">
      <NumberField
        label={`${label} X`}
        value={value.x}
        onChange={(x) => update({ [key]: { ...value, x } })}
      />
      <NumberField
        label={`${label} Y`}
        value={value.y}
        onChange={(y) => update({ [key]: { ...value, y } })}
      />
    </div>
  );
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <span>INSPECTOR</span>
        <small>{l ? l.type : "project"}</small>
      </div>
      <div className="inspector-scroll">
        <details open>
          <summary>Canvas & playback</summary>
          <label className="field">
            <span>Effect name</span>
            <input
              aria-label="Effect name"
              value={p.name}
              onChange={(e) =>
                e.target.value && updateProject({ ...p, name: e.target.value })
              }
            />
          </label>
          <div className="two-fields">
            <NumberField
              label="Canvas width"
              value={p.canvas.width}
              min={16}
              max={512}
              onChange={(width) =>
                updateProject({ ...p, canvas: { ...p.canvas, width } })
              }
            />
            <NumberField
              label="Canvas height"
              value={p.canvas.height}
              min={16}
              max={512}
              onChange={(height) =>
                updateProject({ ...p, canvas: { ...p.canvas, height } })
              }
            />
          </div>
          <div className="two-fields">
            <NumberField
              label="Effect duration"
              value={p.duration}
              min={0.1}
              max={10}
              step={0.1}
              unit="s"
              onChange={(duration) => updateProject({ ...p, duration })}
            />
            <NumberField
              label="Frame rate"
              value={p.fps}
              min={1}
              max={60}
              unit="fps"
              onChange={(fps) => updateProject({ ...p, fps })}
            />
          </div>
          <NumberField
            label="Random seed"
            value={p.seed}
            min={0}
            max={0xffffffff}
            onChange={(seed) => updateProject({ ...p, seed })}
          />
          <Check
            label="Pixel art"
            value={p.canvas.pixelArt}
            onChange={(pixelArt) =>
              updateProject({ ...p, canvas: { ...p.canvas, pixelArt } })
            }
          />
          <Check
            label="Loop playback"
            value={p.loop}
            onChange={(loop) => updateProject({ ...p, loop })}
          />
        </details>
        {l ? (
          <>
            <div className="selected-heading">
              <span className={`type-dot ${l.type}`} />
              <input
                aria-label="Layer name"
                value={l.name}
                onChange={(e) =>
                  e.target.value && update({ name: e.target.value })
                }
              />
              <small>{l.id}</small>
            </div>
            {l.locked ? (
              <div className="locked-notice">
                This layer is locked. Unlock it in the layer list to edit its
                properties.
              </div>
            ) : (
              <>
                <details open>
                  <summary>Transform</summary>
                  {vector("Position", l.position, "position")}
                  <div className="two-fields">
                    {n("Rotation", "rotation", l.rotation, -3600, 3600, 1, "°")}
                    {n("Scale", "scale", l.scale, 0.01, 16, 0.05)}
                  </div>
                  <Select
                    label="Blend mode"
                    value={l.blend}
                    options={["normal", "add", "screen", "multiply"]}
                    onChange={(blend) => update({ blend })}
                  />
                </details>
                <details open>
                  <summary>Timing</summary>
                  <div className="two-fields">
                    {n("Start", "start", l.start, 0, 10, 0.01, "s")}
                    {n("Duration", "duration", l.duration, 0.02, 10, 0.01, "s")}
                  </div>
                  <Check
                    label="Repeat layer"
                    value={l.repeat}
                    onChange={(repeat) => update({ repeat })}
                  />
                </details>
                <details>
                  <summary>Transform keyframes</summary>
                  <CurveEditor
                    label="Move X"
                    keys={l.motion.x}
                    signed
                    onChange={(x) => update({ motion: { ...l.motion, x } })}
                  />
                  <CurveEditor
                    label="Move Y"
                    keys={l.motion.y}
                    signed
                    onChange={(y) => update({ motion: { ...l.motion, y } })}
                  />
                  <CurveEditor
                    label="Rotate"
                    keys={l.motion.rotation}
                    signed
                    max={3600}
                    onChange={(rotation) =>
                      update({ motion: { ...l.motion, rotation } })
                    }
                  />
                  <CurveEditor
                    label="Scale multiplier"
                    keys={l.motion.scale}
                    max={16}
                    min={0.01}
                    onChange={(scale) =>
                      update({ motion: { ...l.motion, scale } })
                    }
                  />
                </details>
                {l.type === "particles" && (
                  <>
                    <details open>
                      <summary>Emission</summary>
                      <Select
                        label="Emission mode"
                        value={l.mode}
                        options={["burst", "stream", "path"]}
                        onChange={(mode) => update({ mode })}
                      />
                      {l.mode === "stream"
                        ? n("Rate", "rate", l.rate, 1, 1000, 1, "/s")
                        : n("Count", "count", l.count, 1, 2000)}
                      <div className="two-fields">
                        <NumberField
                          label="Life min"
                          value={l.life[0]}
                          min={0.02}
                          max={l.life[1]}
                          step={0.01}
                          unit="s"
                          onChange={(v) => update({ life: [v, l.life[1]] })}
                        />
                        <NumberField
                          label="Life max"
                          value={l.life[1]}
                          min={l.life[0]}
                          max={10}
                          step={0.01}
                          unit="s"
                          onChange={(v) => update({ life: [l.life[0], v] })}
                        />
                      </div>
                      <div className="two-fields">
                        <NumberField
                          label="Speed min"
                          value={l.speed[0]}
                          min={0}
                          max={l.speed[1]}
                          onChange={(v) => update({ speed: [v, l.speed[1]] })}
                        />
                        <NumberField
                          label="Speed max"
                          value={l.speed[1]}
                          min={l.speed[0]}
                          max={1000}
                          onChange={(v) => update({ speed: [l.speed[0], v] })}
                        />
                      </div>
                      <div className="two-fields">
                        {n("Angle", "angle", l.angle, -3600, 3600, 1, "°")}
                        {n("Spread", "spread", l.spread, 0, 360, 1, "°")}
                      </div>
                      {l.mode === "path" ? (
                        n(
                          "Path travel",
                          "travel",
                          l.travel,
                          0.01,
                          10,
                          0.01,
                          "s",
                        )
                      ) : (
                        <>
                          <Select
                            label="Spawn shape"
                            value={l.spawn.shape}
                            options={["point", "disk", "ring", "box"]}
                            onChange={(shape) =>
                              update({ spawn: { ...l.spawn, shape } })
                            }
                          />
                          {["disk", "ring"].includes(l.spawn.shape) && (
                            <NumberField
                              label="Spawn radius"
                              value={l.spawn.radius}
                              min={0}
                              max={512}
                              onChange={(radius) =>
                                update({ spawn: { ...l.spawn, radius } })
                              }
                            />
                          )}
                          {l.spawn.shape === "box" && (
                            <div className="two-fields">
                              <NumberField
                                label="Spawn width"
                                value={l.spawn.width}
                                min={0}
                                max={1024}
                                onChange={(width) =>
                                  update({ spawn: { ...l.spawn, width } })
                                }
                              />
                              <NumberField
                                label="Spawn height"
                                value={l.spawn.height}
                                min={0}
                                max={1024}
                                onChange={(height) =>
                                  update({ spawn: { ...l.spawn, height } })
                                }
                              />
                            </div>
                          )}
                        </>
                      )}
                    </details>
                    <details>
                      <summary>Motion & forces</summary>
                      {vector("Gravity", l.gravity, "gravity")}
                      {n("Drag", "drag", l.drag, 0, 20, 0.1)}
                      {n("Turbulence", "turbulence", l.turbulence, 0, 300)}
                      {n("Frequency", "frequency", l.frequency, 0.1, 30, 0.1)}
                      <div className="two-fields">
                        <NumberField
                          label="Spin min"
                          value={l.spin[0]}
                          min={-3600}
                          max={l.spin[1]}
                          onChange={(v) => update({ spin: [v, l.spin[1]] })}
                        />
                        <NumberField
                          label="Spin max"
                          value={l.spin[1]}
                          min={l.spin[0]}
                          max={3600}
                          onChange={(v) => update({ spin: [l.spin[0], v] })}
                        />
                      </div>
                    </details>
                    <details open>
                      <summary>Particle appearance</summary>
                      <Select
                        label="Particle shape"
                        value={l.shape}
                        options={[
                          "circle",
                          "square",
                          "spark",
                          ...(p.assets.length ? ["sprite"] : []),
                        ]}
                        onChange={(shape) =>
                          update({
                            shape,
                            ...(shape === "sprite" && !l.asset
                              ? { asset: p.assets[0].id }
                              : {}),
                          })
                        }
                      />
                      {l.shape === "spark" &&
                        n("Stretch", "stretch", l.stretch, 1, 16, 0.1)}
                      <CurveEditor
                        label="Size"
                        keys={l.size}
                        onChange={(size) => update({ size })}
                      />
                    </details>
                  </>
                )}
                {l.type === "path" && (
                  <details open>
                    <summary>Stroke</summary>
                    <CurveEditor
                      label="Width"
                      keys={l.width}
                      onChange={(width) => update({ width })}
                    />
                    <CurveEditor
                      label="Draw progress"
                      keys={l.draw}
                      max={1}
                      onChange={(draw) => update({ draw })}
                    />
                    {n("Taper", "taper", l.taper, 0, 1, 0.05)}
                    <Check
                      label="Closed path"
                      value={l.closed}
                      onChange={(closed) => update({ closed })}
                    />
                    <p className="hint">
                      Drag the numbered points in the viewport. Double-click the
                      viewport to add a point.
                    </p>
                  </details>
                )}
                {l.type === "ring" && (
                  <details open>
                    <summary>Ring geometry</summary>
                    <CurveEditor
                      label="Radius"
                      keys={l.radius}
                      onChange={(radius) => update({ radius })}
                    />
                    <CurveEditor
                      label="Width"
                      keys={l.width}
                      onChange={(width) => update({ width })}
                    />
                    <div className="two-fields">
                      {n("Arc", "arc", l.arc, 1, 360, 1, "°")}
                      {n("Segments", "segments", l.segments, 3, 128)}
                    </div>
                  </details>
                )}
                {(l.type === "sprite" ||
                  (l.type === "particles" && l.shape === "sprite")) && (
                  <details open>
                    <summary>Sprite / flipbook</summary>
                    <label className="field">
                      <span>Texture</span>
                      <select
                        aria-label="Texture"
                        value={l.asset}
                        onChange={(e) => update({ asset: e.target.value })}
                      >
                        {p.assets.map((a) => (
                          <option value={a.id} key={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Select
                      label="Frame playback"
                      value={l.frameMode}
                      options={["life", "loop", "once", "pingpong"]}
                      onChange={(frameMode) => update({ frameMode })}
                    />
                    {n("Flipbook FPS", "frameFps", l.frameFps, 1, 120)}
                    {l.type === "sprite" && (
                      <>
                        <CurveEditor
                          label="Sprite width"
                          keys={l.width}
                          max={512}
                          onChange={(width) => update({ width })}
                        />
                        <CurveEditor
                          label="Sprite height"
                          keys={l.height}
                          max={512}
                          onChange={(height) => update({ height })}
                        />
                      </>
                    )}
                  </details>
                )}
                {"points" in l && (l.type === "path" || l.mode === "path") && (
                  <details>
                    <summary>Path points · {l.points.length}</summary>
                    {l.points.map((point, i) => (
                      <div className="point-row" key={i}>
                        <small>{i + 1}</small>
                        <NumberField
                          label={`Point ${i + 1} X`}
                          value={point.x}
                          onChange={(x) =>
                            update({
                              points: l.points.map((v, n) =>
                                n === i ? { ...v, x } : v,
                              ),
                            })
                          }
                        />
                        <NumberField
                          label={`Point ${i + 1} Y`}
                          value={point.y}
                          onChange={(y) =>
                            update({
                              points: l.points.map((v, n) =>
                                n === i ? { ...v, y } : v,
                              ),
                            })
                          }
                        />
                        <button
                          title="Delete point"
                          disabled={l.points.length <= 2}
                          onClick={() =>
                            update({
                              points: l.points.filter((_, n) => n !== i),
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </details>
                )}
                <details open>
                  <summary>Color & opacity</summary>
                  <GradientEditor
                    stops={l.colors}
                    onChange={(colors) => update({ colors })}
                  />
                  <CurveEditor
                    label="Opacity"
                    keys={l.opacity}
                    max={1}
                    onChange={(opacity) => update({ opacity })}
                  />
                </details>
                <details>
                  <summary>Glow</summary>
                  <NumberField
                    label="Glow strength"
                    value={l.glow.strength}
                    min={0}
                    max={4}
                    step={0.1}
                    onChange={(strength) =>
                      update({ glow: { ...l.glow, strength } })
                    }
                  />
                  <NumberField
                    label="Glow blur"
                    value={l.glow.blur}
                    min={0}
                    max={16}
                    step={0.5}
                    onChange={(blur) => update({ glow: { ...l.glow, blur } })}
                  />
                </details>
              </>
            )}
          </>
        ) : (
          <div className="empty-state">
            Select a layer to edit its shape, timing, colors and keyframes.
          </div>
        )}
      </div>
    </aside>
  );
}
