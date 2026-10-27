"use client";
import { useEffect, useRef } from "react";
import {
  classes,
  locations,
  roads,
  shopItems,
  shopItemFor,
  classSpells,
  encounterLocations,
  paymentItem,
  type GameState,
  type Intent,
} from "@game/rules";
export function ActionControls({
  state: s,
  disabled,
  onAction,
}: {
  state: GameState;
  disabled: boolean;
  onAction: (intent: Intent) => Promise<void>;
}) {
  const group = useRef<HTMLFieldSetElement>(null);
  const lastFocused = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const previous = lastFocused.current;
    // Preserve keyboard position when a one-use purchase or a battle command disappears.
    // Never steal focus from the canvas, another control, or an open payment review.
    if (
      previous &&
      !previous.isConnected &&
      document.activeElement === document.body
    ) {
      group.current?.focus();
      lastFocused.current = null;
    }
  }, [s]);
  const actions: { label: string; intent: Intent }[] = [];
  const price = (tokens: number) =>
    s.mode === "practice"
      ? `${tokens} practice token${tokens === 1 ? "" : "s"}`
      : `${tokens} GLOW`;
  if (s.phase === "town") {
    for (const place of ["inn", "item", "weapon", "armor", "magic"] as const)
      actions.push({
        label: place === "inn" ? "Speak to Nessa" : `Visit ${place} counter`,
        intent: { type: "visit", place },
      });
    for (const [item, value] of Object.entries(shopItems))
      if (
        s.visited.includes(value.vendor) &&
        !s.purchased.includes(item as keyof typeof shopItems) &&
        !((item === "spark" || item === "mend") && s.spells.includes(item))
      )
        actions.push({
          label: `${shopItemFor(s.classId, item as keyof typeof shopItems).name} · ${price(value.cost)}`,
          intent: { type: "buy", item: item as keyof typeof shopItems },
        });
    if (
      s.visited.includes("inn") &&
      (s.curse || s.hp < s.maxHp || s.mp < s.maxMp)
    )
      actions.push({
        label: `Rest and cure · ${price(1)}`,
        intent: { type: "rest" },
      });
    if (!s.dancerDone)
      actions.push({
        label: `Accept dancer’s offer · ${price(1)}`,
        intent: { type: "dancer" },
      });
  }
  if (s.phase === "town" || s.phase === "trail") {
    actions.push({
      label: "Read the woodland verse",
      intent: { type: "clue" },
    });
    const index = roads.indexOf(s.location);
    for (const destination of [roads[index - 1], roads[index + 1]].filter(
      Boolean,
    ))
      actions.push({
        label: `Go to ${locations[destination].name}`,
        intent: { type: "move", destination },
      });
    if (s.location === "clearing" && !s.fairyDone)
      actions.push({
        label: `Accept the fairy’s dance · ${price(1)}`,
        intent: { type: "fairy" },
      });
    if (s.location === "forest1" && !s.shortcutOpened)
      actions.push({
        label: "Follow the pale-flower shortcut",
        intent: { type: "shortcut" },
      });
    if (s.location === "forest2" && !s.runeSolved)
      for (const answer of ["moon", "sun", "flame"] as const)
        actions.push({
          label: `Touch the ${answer} stone`,
          intent: { type: "puzzle", answer },
        });
    encounterLocations.forEach((place, slot) => {
      if (place === s.location && !s.cleared.includes(slot))
        actions.push({
          label: `Face road creature ${slot + 1}`,
          intent: { type: "encounter", slot },
        });
    });
  }
  if (s.phase === "combat") {
    for (const type of ["attack", "skill", "guard", "potion", "ether"] as const)
      actions.push({
        label:
          type === "skill"
            ? `${classes[s.classId].skill} · 6 MP`
            : type === "guard"
              ? "Defend · recover 6 MP"
              : type === "potion"
                ? `Moss Tonic · ${s.potions} left`
                : type === "ether"
                  ? `Dew Ether · ${s.ethers} left`
                  : "Attack",
        intent: { type },
      });
    for (const spell of s.spells)
      actions.push({
        label: `${classSpells[s.classId][spell].name} · 8 MP`,
        intent: { type: "magic", spell },
      });
  }
  return (
    <fieldset
      ref={group}
      tabIndex={-1}
      disabled={disabled}
      aria-busy={disabled}
      style={{ border: 0, padding: 0 }}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLButtonElement)
          lastFocused.current = event.target;
      }}
    >
      <legend>
        {["victory", "defeat"].includes(s.phase)
          ? "Adventure complete"
          : "Available actions"}
      </legend>
      <div className="game-controls">
        {actions.map((action) => {
          const reason = unavailableReason(s, action.intent);
          return (
            <button
              type="button"
              key={JSON.stringify(action.intent)}
              disabled={!!reason}
              aria-label={reason ? `${action.label}: ${reason}` : undefined}
              title={reason || undefined}
              onClick={() => void onAction(action.intent)}
            >
              {action.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// Presentation only. The authoritative reducer and payment verifier still reject invalid actions.
function unavailableReason(state: GameState, intent: Intent) {
  if (
    state.mode === "practice" &&
    paymentItem(intent) !== undefined &&
    state.practiceBalance < 1
  )
    return "Not enough practice tokens";
  if (intent.type === "skill" && state.mp < 6) return "Requires 6 MP";
  if (intent.type === "magic" && state.mp < 8) return "Requires 8 MP";
  if (intent.type === "potion" && state.potions === 0) return "No tonics left";
  if (intent.type === "ether" && state.ethers === 0) return "No ethers left";
  if (intent.type === "buy" && intent.item === "potion" && state.potions >= 5)
    return "Tonic bag is full";
  if (intent.type === "buy" && intent.item === "ether" && state.ethers >= 3)
    return "Ether bag is full";
  return "";
}
