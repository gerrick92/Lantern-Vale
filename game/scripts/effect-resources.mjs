// Effekseer stores resource names as UTF-16 strings in its INFO chunk.
export function effectResources(buffer) {
  const paths = new Set();
  for (const offset of [0, 1]) {
    // Restrict the scan to ASCII resource-name runs; compressed binary is not Unicode text.
    let text = "";
    for (let i = offset; i + 1 < buffer.length; i += 2) {
      const code = buffer.readUInt16LE(i);
      text += code >= 32 && code < 127 ? String.fromCharCode(code) : "\n";
    }
    for (const path of text.match(
      /(?:Texture|Model)[/\\][\w./\\-]+\.(?:png|efkmodel)/g,
    ) || []) {
      const normalized = path.replaceAll("\\", "/");
      if (normalized.split("/").some((part) => part === ".." || !part))
        throw new Error("Unsafe effect resource path.");
      paths.add(normalized);
    }
  }
  return [...paths].sort();
}
