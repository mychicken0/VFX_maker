import { createHash } from "node:crypto";
export interface CachedImage {
  uri: string;
  name: string;
  mimeType: "image/png";
  bytes: number;
  sha256: string;
  file: string;
  revision: string;
  draft: boolean;
  width: number;
  height: number;
  role: string;
  time?: number;
  layer?: string;
  png: Buffer;
}
export class ImageCache {
  private entries = new Map<string, CachedImage>();
  private bytes = 0;
  put(
    value: Omit<CachedImage, "uri" | "bytes" | "sha256" | "mimeType">,
  ): CachedImage {
    const sha256 = createHash("sha256").update(value.png).digest("hex");
    const id = createHash("sha256")
        .update(JSON.stringify({ ...value, png: undefined, sha256 }))
        .digest("hex"),
      uri = `vfx://images/${id}`;
    const existing = this.entries.get(uri);
    if (existing) {
      this.entries.delete(uri);
      this.entries.set(uri, existing);
      return existing;
    }
    const item: CachedImage = {
      ...value,
      uri,
      sha256,
      mimeType: "image/png",
      bytes: value.png.length,
    };
    if (item.bytes > 24 * 1024 * 1024)
      throw Error("Preview exceeds image cache budget");
    while (
      this.entries.size >= 16 ||
      this.bytes + item.bytes > 24 * 1024 * 1024
    ) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(uri, item);
    this.bytes += item.bytes;
    return item;
  }
  get(uri: string) {
    const item = this.entries.get(uri);
    if (!item)
      throw Error(
        "Image resource expired or unknown; observe the project again",
      );
    this.entries.delete(uri);
    this.entries.set(uri, item);
    return item;
  }
  list() {
    return [...this.entries.values()].map((i) => ({
      uri: i.uri,
      name: i.name,
      mimeType: i.mimeType,
      size: i.bytes,
      description: `${i.role} · ${i.file} · revision ${i.revision} · ${i.draft ? "DRAFT" : "saved"}`,
    }));
  }
}
