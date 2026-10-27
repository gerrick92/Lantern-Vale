import { describe, it, expect } from "vitest";
import { effectResources } from "../../game/scripts/effect-resources.mjs";

describe("Effekseer resource packaging", () => {
  it("finds, normalizes and deduplicates resource names at either byte alignment", () => {
    const resource = Buffer.from(
      "Texture/Slash1.png\0Texture\\Slash1.png\0Model/Rock.efkmodel\0",
      "utf16le",
    );
    for (const offset of [0, 1]) {
      const binary = Buffer.concat([
        Buffer.alloc(offset, 255),
        resource,
        Buffer.from([0, 216, 255, 255, 0, 220]),
      ]);
      expect(effectResources(binary)).toEqual([
        "Model/Rock.efkmodel",
        "Texture/Slash1.png",
      ]);
    }
  });
  it("rejects resource traversal instead of copying outside the game", () => {
    expect(() =>
      effectResources(Buffer.from("Texture/../../secret.png\0", "utf16le")),
    ).toThrow("Unsafe");
  });
});
