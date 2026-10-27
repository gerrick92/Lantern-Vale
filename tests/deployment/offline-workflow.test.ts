import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

it("offline verification excludes hosted fixtures and game regeneration", () => {
  const stages: string[] = JSON.parse(
    execFileSync(
      process.execPath,
      ["scripts/check-all.mjs", "--offline", "--list"],
      {
        encoding: "utf8",
      },
    ),
  );
  for (const stage of [
    "test:hosted",
    "test:account",
    "test:production",
    "test:e2e",
    "game:build",
    "game:maps",
    "game:rules",
    "game:plugins",
    "game:sync",
  ])
    expect(stages).not.toContain(stage);
  expect(stages).toContain("game:verify");
  expect(stages).toContain("test:e2e:offline");
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  for (const stage of stages) expect(scripts[stage]).toBeTruthy();
  expect(scripts["test:e2e:offline"]).not.toMatch(
    /test:hosted|(?:^|[\s/])(?:auth|site)\.spec/,
  );
});
