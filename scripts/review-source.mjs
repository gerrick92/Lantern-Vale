import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { digest, inspectContent } from "./verify-package.mjs";

const root = resolve(import.meta.dirname, "..");
const dotFiles = new Set([
  ".env.example",
  ".gitignore",
  ".gitattributes",
  ".prettierignore",
]);

export function sourcePath(path) {
  if (
    !path ||
    path.includes("\\") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === ".." ||
          /[:\x00-\x1f\x7f]|[. ]$/.test(part) ||
          (part.startsWith(".") && !dotFiles.has(path)),
      ) ||
    /(?:^|\/)(?:node_modules|test-results|out|cache|broadcast)(?:\/|$)/i.test(
      path,
    ) ||
    /\.(?:exe|dll|log|map|tsbuildinfo|dump|backup|dpapi|bak|db|sqlite3?|pfx|p12|pgpass|key|zip|gz|tgz|tar|7z|bz2|xz)$/i.test(
      path,
    ) ||
    /^apps\/web\/public\/games\//.test(path) ||
    (/^game\/mz-source\//.test(path) &&
      !/^game\/mz-source\/(?:data\/[A-Za-z0-9]+\.json|js\/plugins\/Mosslight(?:Bridge|Rules)\.js|js\/(?:plugins|practice-config)\.js|(?:CREDITS|THIRD_PARTY_LICENSES)\.txt|Game\.rmmzproject|index\.html|package\.json)$/.test(
        path,
      ))
  )
    throw new Error(`Source publication forbids this path: ${path}`);
  return path;
}

export function inspectSource(path, bytes) {
  sourcePath(path);
  // The source repository contains original MZ authoring data; the deployment
  // package deliberately does not. Reuse its credential and backup checks
  // without applying the deployment's different directory policy.
  const name =
    path === ".env.example"
      ? path
      : /\.(?:png|webp|woff2?)$/i.test(path)
        ? "asset.bin"
        : "source.txt";
  inspectContent(name, bytes);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function reviewSource(staged = false) {
  const tracked = git(["ls-files", "--cached", "-z"])
    .toString()
    .split("\0")
    .filter(Boolean);
  const candidates = staged
    ? tracked
    : [
        ...tracked,
        ...git(["ls-files", "--others", "--exclude-standard", "-z"])
          .toString()
          .split("\0")
          .filter(Boolean),
      ];
  const removed = [];
  const files = [];
  for (const path of [...new Set(candidates)].sort()) {
    const absolute = resolve(root, path);
    if (!staged && !existsSync(absolute)) {
      removed.push(path);
      continue;
    }
    sourcePath(path);
    if (existsSync(absolute) && !lstatSync(absolute).isFile())
      throw new Error(`Source is not a regular file: ${path}`);
    const bytes = staged ? git(["show", `:${path}`]) : readFileSync(absolute);
    try {
      inspectSource(path, bytes);
    } catch {
      throw new Error(`Source content review failed: ${path}`);
    }
    files.push({ path, bytes: bytes.length, sha256: digest(bytes) });
  }
  const output = resolve(root, "test-results/source-review");
  mkdirSync(output, { recursive: true });
  const report = {
    status: "PASS",
    scope: staged ? "git-index" : "working-source",
    checkedAt: new Date().toISOString(),
    files,
    removed,
  };
  writeFileSync(
    resolve(output, staged ? "index.json" : "manifest.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  if (!staged)
    writeFileSync(
      resolve(output, "paths.nul"),
      [...files.map((file) => file.path), ...removed].join("\0") + "\0",
    );
  console.log(
    JSON.stringify({
      status: report.status,
      scope: report.scope,
      files: files.length,
      removed: removed.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
    }),
  );
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  reviewSource(process.argv.includes("--index"));
