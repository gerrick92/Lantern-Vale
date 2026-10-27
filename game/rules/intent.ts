import { z } from "zod";
export const intentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("visit"),
      place: z.enum(["inn", "item", "weapon", "armor", "magic"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("buy"),
      item: z.enum(["potion", "ether", "weapon", "armor", "spark", "mend"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("move"),
      destination: z.enum(["inn", "clearing", "forest1", "forest2", "shrine"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("encounter"),
      slot: z.number().int().min(0).max(5),
    })
    .strict(),
  z
    .object({ type: z.literal("magic"), spell: z.enum(["spark", "mend"]) })
    .strict(),
  z
    .object({
      type: z.literal("puzzle"),
      answer: z.enum(["moon", "sun", "flame"]),
    })
    .strict(),
  ...(
    [
      "attack",
      "skill",
      "guard",
      "potion",
      "ether",
      "rest",
      "dancer",
      "fairy",
      "shortcut",
      "clue",
      "abandon",
    ] as const
  ).map((type) => z.object({ type: z.literal(type) }).strict()),
]);
export type Intent = z.infer<typeof intentSchema>;
