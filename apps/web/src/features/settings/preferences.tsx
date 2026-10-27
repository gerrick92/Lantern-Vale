"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  preferenceKey,
  parsePreferences,
  preferencesSnapshot,
  storagePreferencesChanged,
  storePreferences,
} from "@/lib/preferences-store";
export type { Preferences } from "@/lib/preferences-store";
function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== preferenceKey) return;
    storagePreferencesChanged();
    callback();
  };
  window.addEventListener("storage", storage);
  window.addEventListener("mosslight:appearance", callback);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("mosslight:appearance", callback);
  };
}
export function usePreferences() {
  const raw = useSyncExternalStore(subscribe, preferencesSnapshot, () => "");
  const prefs = useMemo(() => parsePreferences(raw), [raw]);
  return [prefs, storePreferences] as const;
}
export function ThemeSync() {
  const [prefs] = usePreferences();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.accessible = String(prefs.accessible);
    root.dataset.reduced = String(prefs.reduced || prefs.accessible);
    root.dataset.large = String(prefs.large || prefs.accessible);
  }, [prefs]);
  return null;
}
