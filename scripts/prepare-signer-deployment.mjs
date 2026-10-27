import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Produces a public source bundle only. No credentials, provisioning or
// deployment are performed; dependency versions come from the Deno import map.
const root = resolve(import.meta.dirname, "..");
const imports = JSON.parse(
  readFileSync(
    resolve(root, "supabase/functions/settlement-signer/deno.json"),
    "utf8",
  ),
).imports;
const base = resolve(root, "test-results/signer-deployment");
mkdirSync(base, { recursive: true });
const directory = mkdtempSync(resolve(base, "review-"));
await build({
  absWorkingDir: root,
  entryPoints: ["supabase/functions/settlement-signer/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["node:*"],
  banner: {
    js: "// Generated from checked TypeScript source.\n// @ts-nocheck",
  },
  outfile: resolve(directory, "index.ts"),
  minify: false,
  plugins: [
    {
      name: "pinned-deno-imports",
      setup(builder) {
        builder.onResolve({ filter: /^(viem(?:\/.*)?|zod)$/ }, ({ path }) => {
          const pinned = imports[path];
          if (!/^npm:[a-z-]+@\d+\.\d+\.\d+(?:\/[a-z-]+)?$/.test(pinned ?? ""))
            throw new Error("Unpinned signing dependency.");
          return { path: pinned, external: true };
        });
      },
    },
  ],
});
const bytes = readFileSync(resolve(directory, "index.ts"));
const record = {
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
  entry: "supabase/functions/settlement-signer/index.ts",
  state: "Disabled unless explicitly configured; no secret in bundle",
};
writeFileSync(
  resolve(directory, "source.json"),
  JSON.stringify(record, null, 2) + "\n",
  { flag: "wx" },
);
console.log(`Prepared signer source review: ${directory}`);
console.log(
  `SHA-256 ${record.sha256}; ${record.bytes} bytes; nothing deployed.`,
);
