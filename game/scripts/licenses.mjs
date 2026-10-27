import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function runtimeNotices(root = resolve(import.meta.dirname, "../..")) {
  const directory = resolve(root, "game/licenses");
  const entries = JSON.parse(
    readFileSync(resolve(directory, "manifest.json"), "utf8"),
  );
  const sections = entries.map(({ name, file, source, sha256 }) => {
    if (!/^[a-z0-9.-]+\.txt$/.test(file))
      throw new Error("Invalid license path.");
    const text = readFileSync(resolve(directory, file), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== sha256)
      throw new Error(`Reviewed license notice changed: ${file}`);
    return `${name}\nSource: ${source}\n\n${text.trim()}\n`;
  });
  sections.push(
    `Zod — MIT License\n\n${readFileSync(resolve(root, "node_modules/zod/LICENSE"), "utf8").trim()}\n`,
  );
  return (
    "Lantern Vale — third-party runtime notices\n\nThe following licenses apply to their respective open-source components.\nOriginal vendor notices in the runtime files are also retained.\n\n" +
    sections.join(
      "\n------------------------------------------------------------\n\n",
    )
  );
}
