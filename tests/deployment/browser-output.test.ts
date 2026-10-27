import { expect, it } from "vitest";
import { isAbsolute, relative, resolve } from "node:path";
import config from "../../playwright.config";

it("browser output cleanup cannot contain operational backups or release packages", () => {
  expect(config.outputDir).toBeTruthy();
  const output = resolve(config.outputDir!);
  for (const retained of [
    "hosted-backup",
    "release",
    "map-backups",
    "demo-feedback",
  ])
    for (const directory of [
      output,
      ...(config.projects || []).map((project) =>
        resolve(project.outputDir || output),
      ),
    ]) {
      const inside = relative(directory, resolve("test-results", retained));
      expect(
        inside === "" || (!inside.startsWith("..") && !isAbsolute(inside)),
      ).toBe(false);
    }
});
