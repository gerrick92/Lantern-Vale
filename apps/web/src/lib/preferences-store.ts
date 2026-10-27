export type Preferences = {
  theme: "system" | "light" | "dark";
  accessible: boolean;
  reduced: boolean;
  large: boolean;
  mute: boolean;
};
export const preferenceKey = "mosslight:appearance";
let temporary: string | undefined;

export function parsePreferences(raw: string): Preferences {
  let saved: Partial<Preferences> = {};
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (value && typeof value === "object" && !Array.isArray(value))
      saved = value;
  } catch {
    // Corrupt stored preferences must never prevent account access.
  }
  return {
    theme:
      saved.theme === "light" || saved.theme === "dark"
        ? saved.theme
        : "system",
    accessible: saved.accessible === true,
    reduced: saved.reduced === true,
    large: saved.large === true,
    mute: saved.mute === true,
  };
}

export function preferencesSnapshot() {
  if (temporary !== undefined) return temporary;
  try {
    return localStorage.getItem(preferenceKey) || "";
  } catch {
    return "";
  }
}

export function storagePreferencesChanged() {
  temporary = undefined;
}

export function storePreferences(value: Preferences) {
  temporary = JSON.stringify(parsePreferences(JSON.stringify(value)));
  try {
    localStorage.setItem(preferenceKey, temporary);
  } catch {
    // Display and accessibility controls still work for this visit without storage.
  }
  window.dispatchEvent(new Event("mosslight:appearance"));
}
