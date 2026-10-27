"use client";
import { useState } from "react";
import { usePreferences, type Preferences } from "./preferences";
export function Appearance({
  developerTools = false,
}: {
  developerTools?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const [prefs, setPrefs] = usePreferences();
  return (
    <section className="panel">
      <h2>Display &amp; sound</h2>
      <label htmlFor="theme">Appearance</label>
      <select
        id="theme"
        value={prefs.theme}
        onChange={(e) =>
          setPrefs({ ...prefs, theme: e.target.value as Preferences["theme"] })
        }
      >
        <option value="system">Use device setting</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      {(
        [
          ["accessible", "Accessibility Mode"],
          ["reduced", "Reduce motion"],
          ["large", "Larger text"],
          ["mute", "Mute game audio"],
        ] as const
      ).map(([key, label]) => (
        <label className="check" key={key}>
          <input
            type="checkbox"
            checked={prefs[key]}
            onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <details className="disclosure">
        <summary>About these options</summary>
        <p>
          Accessibility Mode combines larger text, reduced motion and simpler
          backgrounds. The separate controls let you change only text or motion.
          Your device’s reduced-motion setting is always respected.
        </p>
      </details>
      {developerTools && process.env.NODE_ENV === "development" && (
        <button
          type="button"
          className="secondary"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          Toggle developer phone preview
        </button>
      )}
      {developerTools && process.env.NODE_ENV === "development" && preview && (
        <div className="device-preview">
          <p>390px browser viewport · homepage preview</p>
          <iframe
            src="/"
            title="Developer phone viewport"
            width="390"
            height="700"
          />
        </div>
      )}
    </section>
  );
}
