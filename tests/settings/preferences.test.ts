import { afterEach, expect, it, vi } from "vitest";
import {
  parsePreferences,
  preferencesSnapshot,
  storagePreferencesChanged,
  storePreferences,
} from "../../apps/web/src/lib/preferences-store";

afterEach(() => {
  storagePreferencesChanged();
  vi.unstubAllGlobals();
});

it("recovers from corrupt and non-object saved preferences without crashing the site", () => {
  for (const raw of ["null", "[]", "true", "7", '"dark"', "{broken"]) {
    expect(parsePreferences(raw)).toEqual({
      theme: "system",
      accessible: false,
      reduced: false,
      large: false,
      mute: false,
    });
  }
  expect(
    parsePreferences('{"theme":"dark","accessible":"false","large":true}'),
  ).toMatchObject({ theme: "dark", accessible: false, large: true });
});

it("keeps accessibility and mute controls usable when browser storage is blocked", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Blocked");
    },
    setItem: () => {
      throw new Error("Blocked");
    },
  });
  const events = new EventTarget();
  const changed = vi.fn();
  events.addEventListener("mosslight:appearance", changed);
  vi.stubGlobal("window", events);
  expect(preferencesSnapshot()).toBe("");
  const value = {
    theme: "dark" as const,
    accessible: true,
    reduced: false,
    large: false,
    mute: true,
  };
  storePreferences(value);
  expect(parsePreferences(preferencesSnapshot())).toEqual(value);
  expect(changed).toHaveBeenCalledOnce();
});

it("refreshes cross-tab preferences when storage changes", () => {
  let stored = '{"theme":"light"}';
  vi.stubGlobal("localStorage", {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
  vi.stubGlobal("window", new EventTarget());
  storePreferences({
    theme: "dark",
    accessible: false,
    reduced: true,
    large: false,
    mute: false,
  });
  stored = '{"theme":"light","mute":true}';
  storagePreferencesChanged();
  expect(parsePreferences(preferencesSnapshot())).toMatchObject({
    theme: "light",
    mute: true,
    reduced: false,
  });
});
