import { defineEffect, path, particles, curve, colors, arcPoints } from 'vfx-maker';

export default defineEffect({
  name: 'Custom cyan crescent', seed: 17, duration: 1.2, fps: 30,
  layers: [
    path({
      id: 'crescent', name: 'Crescent', points: arcPoints(40, 220, 420, 40),
      duration: 0.8, width: curve(7, 3, 0), colors: colors('#ffffff', '#2bdeee', '#4664f4'),
      glow: { strength: 1.1, blur: 3 },
    }),
    particles({
      id: 'motes', name: 'Cooling motes', mode: 'path', points: arcPoints(40, 220, 420, 40),
      travel: 0.3, count: 90, life: [0.3, 0.75], speed: [0, 18], gravity: { x: 0, y: 15 },
      size: curve(1.8, 0), colors: colors('#b5ffff', '#26a5e8'),
    }),
  ],
});
