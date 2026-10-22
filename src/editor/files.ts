export function downloadFile(
  bytes: Uint8Array,
  name: string,
  mime = "application/octet-stream",
) {
  const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: mime }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const safeFilename = (name: string) =>
  name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-|-$/g, "") || "effect";
