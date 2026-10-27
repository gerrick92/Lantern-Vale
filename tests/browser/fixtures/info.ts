import { test as base, expect } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";

// The bundled Firefox can fail Browser.removeBrowserContext after HTTP
// navigation on Windows. Closing a whole, fresh browser per public Info test
// avoids that lifecycle path without bypassing CSP or page assertions.
export const test = base.extend({
  context: async (
    { playwright, browserName, baseURL, viewport, launchOptions },
    provide,
  ) => {
    const root = resolve("test-results/info-profiles");
    await mkdir(root, { recursive: true });
    const profile = await mkdtemp(resolve(root, "anonymous-"));
    const context = await playwright[browserName].launchPersistentContext(
      profile,
      {
        ...launchOptions,
        headless: true,
        baseURL,
        viewport,
        ...(browserName === "firefox"
          ? { firefoxUserPrefs: { "media.volume_scale": "0.0" } }
          : { args: [...(launchOptions.args || []), "--mute-audio"] }),
      },
    );
    try {
      await provide(context);
    } finally {
      await context.close();
      const child = relative(root, profile);
      if (!child || child.startsWith("..") || isAbsolute(child))
        throw new Error("Refusing to remove a profile outside test output.");
      await rm(profile, { recursive: true, force: true });
    }
  },
});
export { expect };
