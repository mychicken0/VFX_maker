import { optimizePng } from "../core/pixels.js";
self.onmessage = (event: MessageEvent) => {
  try {
    const result = optimizePng(
      new Uint8Array(event.data.bytes),
      event.data.options,
    );
    self.postMessage(
      { id: event.data.id, png: result.png, stats: result.stats },
      { transfer: [result.png.buffer] },
    );
  } catch (e) {
    self.postMessage({
      id: event.data.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
