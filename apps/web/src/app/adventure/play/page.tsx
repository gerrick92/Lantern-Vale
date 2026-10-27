import { canUseGlow } from "@/server/economy-access";
import { currentUser } from "@/server/current-user";
import { PrivatePage } from "@/components/private-page";
import { GameSession } from "@/features/game/game-session";
export const metadata = { title: "Play Lantern Vale" };
export default async function Play({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  const { round } = await searchParams;
  const user = await currentUser();
  const enabled = !!user && canUseGlow(user.id);
  return (
    <>
      <p className="eyebrow">The forest remembers your footsteps</p>
      <h1>Lantern Vale</h1>
      <PrivatePage>
        <GameSession
          initialRoundId={
            round && /^[0-9a-f-]{36}$/i.test(round) ? round : undefined
          }
          enabled={enabled}
        />
      </PrivatePage>
    </>
  );
}
