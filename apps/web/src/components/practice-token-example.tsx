"use client";

import { useState } from "react";

export function PracticeTokenExample() {
  const [spent, setSpent] = useState(5);
  return (
    <figure className="practice-example">
      <figcaption>Try a practice round</figcaption>
      <p id="practice-example-help">
        Start with 30 practice tokens. Spending includes the one-token entry
        after you confirm your class, purchases, encounters and healing.
      </p>
      <label htmlFor="practice-example-spent">
        Tokens spent: <strong>{spent}</strong>
      </label>
      <input
        id="practice-example-spent"
        type="range"
        min="1"
        max="30"
        step="1"
        value={spent}
        aria-describedby="practice-example-help"
        onChange={(event) => setSpent(Number(event.target.value))}
      />
      <div className="practice-outcomes" aria-live="polite" aria-atomic="true">
        <div>
          <h4>Defeat the boss</h4>
          <p className="info-number">
            31 <span>left</span>
          </p>
          <p>
            {30 - spent} unspent + {spent} returned + 1 bonus. Defeat every
            normal enemy too for 2 bonus instead, ending with 32.
          </p>
        </div>
        <div>
          <h4>Lose the round</h4>
          <p className="info-number">
            {30 - spent} <span>left</span>
          </p>
          <p>{spent} spent and lost. Unspent tokens are kept for that round.</p>
        </div>
      </div>
      <p className="info-note">
        An illustration, not a wallet balance. Every new test game starts at 30
        again. Practice never grants GLOW, and test replays are unlimited. In
        the planned GLOW mode, bonuses stop at 10 per wallet over 24 hours; all
        tokens used are still returned when you win.
      </p>
    </figure>
  );
}
