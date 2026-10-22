import { defaultFilterVert, Filter, GlProgram, type Container } from "pixi.js";
import {
  OutlineFilter,
  PixelateFilter,
  ColorReplaceFilter,
  ShockwaveFilter,
} from "pixi-filters";
import type { Modifier } from "../core/creative-schema.js";
import type { Layer } from "../core/model.js";
import { colorAt } from "../core/math.js";

const rgb = (color: string | number) => {
  const n = typeof color === "number" ? color : parseInt(color.slice(1), 16);
  return new Float32Array(
    [n >> 16, (n >> 8) & 255, n & 255].map((n) => n / 255),
  );
};
const header = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform float uTime;
uniform float uSeed;
uniform float uPixelArt;
uniform vec4 uSettings;
uniform vec3 uLow;
uniform vec3 uHigh;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash2(i), hash2(i+vec2(1,0)), f.x), mix(hash2(i+vec2(0,1)), hash2(i+vec2(1,1)), f.x), f.y);
}
vec4 sampleAt(vec2 coord) {
  if (uPixelArt > 0.5) coord = (floor(coord*uInputSize.xy)+0.5)*uInputSize.zw;
  if (any(lessThan(coord, uInputClamp.xy)) || any(greaterThan(coord, uInputClamp.zw))) return vec4(0.0);
  return texture(uTexture, coord);
}
`;
/** Original shaders; time and randomness are explicit, so scrubbing never accumulates state. */
class CreativeFilter extends Filter {
  readonly uniforms: {
    uTime: number;
    uSeed: number;
    uPixelArt: number;
    uSettings: Float32Array;
    uLow: Float32Array;
    uHigh: Float32Array;
  };
  constructor(
    body: string,
    seed: number,
    pixelArt: boolean,
    settings: number[],
    low = "#000000",
    high = "#ffffff",
  ) {
    super({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: header + `void main() { ${body} }`,
        name: "vfx-creative-filter",
      }),
      resources: {
        creative: {
          uTime: { value: 0, type: "f32" },
          uSeed: { value: seed, type: "f32" },
          uPixelArt: { value: pixelArt ? 1 : 0, type: "f32" },
          uSettings: { value: new Float32Array(settings), type: "vec4<f32>" },
          uLow: { value: rgb(low), type: "vec3<f32>" },
          uHigh: { value: rgb(high), type: "vec3<f32>" },
        },
      },
      resolution: 1,
      antialias: "off",
    });
    this.uniforms = this.resources.creative.uniforms;
  }
}
export interface AnimatedFilter {
  filter: Filter;
  update: (time: number, root: Container) => void;
}
export function createModifier(
  m: Modifier,
  seed: number,
  pixelArt: boolean,
): AnimatedFilter {
  let filter: Filter;
  if (m.type === "outline")
    filter = new OutlineFilter({
      thickness: m.thickness,
      color: m.color,
      alpha: m.alpha,
      quality: 0.2,
    });
  else if (m.type === "pixelate") filter = new PixelateFilter(m.size);
  else if (m.type === "color-replace")
    filter = new ColorReplaceFilter({
      originalColor: m.from,
      targetColor: m.to,
      tolerance: m.tolerance,
    });
  else if (m.type === "shockwave")
    filter = new ShockwaveFilter({
      amplitude: m.amplitude,
      wavelength: m.wavelength,
      speed: m.speed,
      radius: m.radius,
    });
  else if (m.type === "ramp")
    filter = new CreativeFilter(
      `vec4 c = sampleAt(vTextureCoord); float v = dot(c.rgb / max(c.a, 0.00001), vec3(0.2126,0.7152,0.0722)); finalColor = vec4(mix(uLow,uHigh,clamp(v,0.0,1.0))*c.a,c.a);`,
      seed,
      pixelArt,
      [0, 0, 0, 0],
      m.low,
      m.high,
    );
  else if (m.type === "noise-warp") {
    filter = new CreativeFilter(
      `vec2 p = (vTextureCoord*uInputSize.xy + uOutputFrame.xy)/128.0*uSettings.y;
      vec2 offset = vec2(noise(p+uTime*uSettings.z),noise(p+vec2(19.2,7.1)+uTime*uSettings.z))-0.5;
      finalColor = sampleAt(vTextureCoord + offset*uSettings.x*uInputSize.zw);`,
      seed,
      pixelArt,
      [m.strength, m.frequency, m.speed, 0],
    );
    filter.padding = m.strength;
  } else {
    filter = new CreativeFilter(
      `vec4 c = sampleAt(vTextureCoord); float n = noise((vTextureCoord*uInputSize.xy+uOutputFrame.xy)/128.0*uSettings.y+uTime*uSettings.z);
      float keep = uSettings.x <= 0.0 ? 1.0 : (uSettings.x >= 1.0 ? 0.0 : step(uSettings.x,n));
      float edge = uSettings.w <= 0.0 ? 0.0 : 1.0-smoothstep(uSettings.x,uSettings.x+uSettings.w,n);
      finalColor = vec4(mix(c.rgb,uHigh*c.a,edge)*keep,c.a*keep);`,
      seed,
      pixelArt,
      [m.amount, m.frequency, m.speed, m.edge],
      "#000000",
      m.color,
    );
  }
  return {
    filter,
    update(time, root) {
      if (filter instanceof CreativeFilter) filter.uniforms.uTime = time;
      if (filter instanceof ShockwaveFilter) {
        filter.time = time;
        filter.center = { x: root.x, y: root.y };
      }
    },
  };
}
const fieldBody = `
vec4 source = texture(uTexture,vTextureCoord);
vec2 q = vTextureCoord*uInputSize.xy/max(uOutputFrame.zw,vec2(1.0));
vec2 p = q*uSettings.y;
float value = 0.0;
if (uSettings.x < 0.5) {
  float amplitude = 0.5, total = 0.0;
  for (int i=0;i<5;i++) {
    if (float(i) >= uSettings.w) break;
    value += noise(p+vec2(uTime,-uTime*0.7))*amplitude;
    total += amplitude; p *= 2.0; amplitude *= 0.5;
  }
  value /= max(total,0.001);
} else if (uSettings.x < 1.5) {
  vec2 cell = floor(p), f = fract(p); float d = 2.0;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
    vec2 o=vec2(float(x),float(y)), h=vec2(hash2(cell+o),hash2(cell+o+19.1));
    h=0.5+0.4*sin(vec2(uTime)+h*6.2831853); d=min(d,length(o+h-f));
  }
  value=1.0-clamp(d,0.0,1.0);
} else if (uSettings.x < 2.5) value=1.0-clamp(length((q-0.5)*2.0),0.0,1.0);
else if (uSettings.x < 3.5) value=1.0-clamp(max(abs(q.x-0.5),abs(q.y-0.5))*2.0,0.0,1.0);
else value=0.5+0.5*sin((q.x+q.y)*uSettings.y*6.2831853+uTime);
float alpha=smoothstep(uSettings.z,min(1.0001,uSettings.z+uSoftness),value)*source.a;
if (uFalloff > 0.0) alpha *= smoothstep(0.0,uFalloff,1.0-length((q-0.5)*2.0));
finalColor=vec4(mix(uLow,uHigh,value)*alpha,alpha);
`;
export function createField(
  layer: Extract<Layer, { type: "field" }>,
  seed: number,
  pixelArt: boolean,
) {
  // Softness is a fifth scalar; keep the common uniform block small.
  const fragment =
    header +
    "uniform float uSoftness;\nuniform float uFalloff;\nvoid main() {" +
    fieldBody +
    "}";
  const filter = new Filter({
    glProgram: GlProgram.from({
      vertex: defaultFilterVert,
      fragment,
      name: "vfx-procedural-field",
    }),
    resources: {
      creative: {
        uTime: { value: 0, type: "f32" },
        uSeed: { value: seed, type: "f32" },
        uPixelArt: { value: pixelArt ? 1 : 0, type: "f32" },
        uSettings: {
          value: new Float32Array([
            ["noise", "cells", "radial", "box", "stripes"].indexOf(
              layer.pattern,
            ),
            layer.frequency,
            0,
            layer.octaves,
          ]),
          type: "vec4<f32>",
        },
        uLow: { value: rgb(layer.colors[0].color), type: "vec3<f32>" },
        uHigh: { value: rgb(layer.highlight), type: "vec3<f32>" },
        uSoftness: { value: layer.softness, type: "f32" },
        uFalloff: { value: layer.falloff, type: "f32" },
      },
    },
    resolution: 1,
    antialias: "off",
  });
  return {
    filter,
    update(time: number, normalized: number, cutoff: number) {
      const u = filter.resources.creative.uniforms;
      u.uTime = time * layer.speed;
      u.uSettings[2] = cutoff;
      u.uLow = rgb(colorAt(layer.colors, normalized));
    },
  };
}
