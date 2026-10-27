export type RpgIconName =
  "home" | "book" | "shield" | "coins" | "sword" | "gear" | "key" | "lantern";

const shapes: Record<RpgIconName, { d: string; fill: string }[]> = {
  home: [
    { d: "M3 11h18v10H3z", fill: "#b88a54" },
    { d: "M1 10h3V7h3V4h4V2h2v2h4v3h3v3h3v3H1z", fill: "#6e9eaa" },
    { d: "M5 14h4v4H5zm10 0h4v4h-4z", fill: "#ffde88" },
    { d: "M10 15h4v6h-4z", fill: "#313b51" },
  ],
  book: [
    { d: "M2 4h8l2 2 2-2h8v16h-8l-2 2-2-2H2z", fill: "#a97946" },
    { d: "M3 3h6l2 2v13l-2-1H3zm12 0h6v14h-6l-2 1V5z", fill: "#eed5a2" },
    {
      d: "M5 7h4v1H5zm0 3h4v1H5zm10-3h4v1h-4zm0 3h4v1h-4zm0 3h3v1h-3z",
      fill: "#927452",
    },
  ],
  shield: [
    { d: "M3 3h18v11h-2v3h-3v3h-3v2h-2v-2H8v-3H5v-3H3z", fill: "#d8b66c" },
    { d: "M5 5h14v8h-2v3h-3v3h-4v-3H7v-3H5z", fill: "#608193" },
    { d: "M11 7h2v4h3v2h-3v4h-2v-4H8v-2h3z", fill: "#f8df9c" },
  ],
  coins: [
    { d: "M2 12h14v8H2zm2-2h10v12H4z", fill: "#b57935" },
    { d: "M2 12h14v3H2zm2-2h10v7H4z", fill: "#ecc36c" },
    { d: "M12 2h8v2h2v10h-2v2h-8v-2h-2V4h2z", fill: "#e5b55a" },
    { d: "M14 4h4v2h2v6h-2v2h-4v-2h-2V6h2z", fill: "#ffe6a4" },
    { d: "M15 6h2v6h-2zM5 12h6v1H5z", fill: "#9a632d" },
  ],
  sword: [
    { d: "M16 2h6v6h-2v2h-2v2h-2v2h-2v2h-4v-4h2v-2h2V8h2z", fill: "#c8e1e4" },
    {
      d: "M20 4h2v4h-2v2h-2v2h-2v2h-2v2h-2v-4h2v-2h2V8h2V6h2z",
      fill: "#769baa",
    },
    { d: "M5 10h2v2h2v2h2v2h2v2h-4v-2H7v-2H5zM2 19h3v3H2z", fill: "#eac47b" },
    { d: "M6 15h3v3H6v3H3v-3h3z", fill: "#a5784f" },
  ],
  gear: [
    {
      d: "M9 2h6v3h3V3h3v6h-3v6h3v6h-6v-3H9v3H3v-6h3V9H3V3h6z",
      fill: "#b79762",
    },
    { d: "M8 6h8v2h2v8h-2v2H8v-2H6V8h2z", fill: "#e3c98e" },
    { d: "M10 9h4v1h1v4h-1v1h-4v-1H9v-4h1z", fill: "#53647d" },
  ],
  key: [
    {
      d: "M5 2h7v2h2v7h-2v2H9v9H5v-4H2v-3h3v-2H3v-2H1V4h2V2z",
      fill: "#d6aa60",
    },
    { d: "M5 4h5v2h2v3h-2v2H5V9H3V6h2z", fill: "#ffe4a1" },
    { d: "M6 6h3v3H6z", fill: "#354762" },
  ],
  lantern: [
    {
      d: "M9 1h6v2h2v4h-2V3H9v4H7V3h2zM7 7h10v2h3v2H4V9h3zM4 20h16v3H4z",
      fill: "#d3a65b",
    },
    { d: "M5 11h14v9H5z", fill: "#845b37" },
    { d: "M7 11h10v9H7z", fill: "#f4bf59" },
    { d: "M11 12h2v3h2v4H9v-4h2z", fill: "#fff0b2" },
  ],
};

export function RpgIcon({
  name,
  className = "",
}: {
  name: RpgIconName;
  className?: string;
}) {
  return (
    <svg
      className={`rpg-icon ${className}`}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {shapes[name].map(({ d, fill }, index) => (
        <path key={index} d={d} fill={fill} />
      ))}
    </svg>
  );
}

export function Ornament() {
  return (
    <svg
      className="ornament"
      width="176"
      height="20"
      viewBox="0 0 176 20"
      aria-hidden="true"
    >
      <path
        d="M0 10h64m48 0h64M68 10l6-4 6 4-6 4Zm14 0 6-8 6 8-6 8Zm14 0 6-4 6 4-6 4Z"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}
