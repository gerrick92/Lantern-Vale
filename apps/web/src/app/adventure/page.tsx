import { canUseGlow } from "@/server/economy-access";
import { currentUser } from "@/server/current-user";
import Image from "next/image";
import Link from "next/link";
import { PrivatePage } from "@/components/private-page";
import { RecentRounds } from "@/features/game/recent-rounds";
export const metadata = { title: "Play" };
export default async function Adventure({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const history = (await searchParams).view === "history";
  const user = await currentUser();
  const enabled = !!user && canUseGlow(user.id);
  return (
    <>
      <h1>Play</h1>
      <PrivatePage>
        <nav className="tabs" aria-label="Game pages">
          <Link href="/adventure" aria-current={!history ? "page" : undefined}>
            Play
          </Link>
          <Link
            href="/adventure?view=history"
            aria-current={history ? "page" : undefined}
          >
            History
          </Link>
        </nav>
        {history ? (
          <RecentRounds />
        ) : (
          <>
            <div className="adventure-intro">
              <div className="adventure-art">
                <Image
                  src="/art/lantern-vale-v1.png"
                  alt="The woodland inn and mountain trail of Lantern Vale"
                  width={1536}
                  height={1024}
                  sizes="(max-width: 700px) 100vw, 650px"
                />
              </div>
              <section className="adventure-launch">
                <h2>Lantern Vale</h2>
                <div className="game-launch-actions">
                  {enabled ? (
                    <Link href="/adventure/play" className="button">
                      Start game
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      aria-describedby="glow-availability"
                    >
                      Start game
                    </button>
                  )}
                  {process.env.NODE_ENV === "development" ? (
                    <Link href="/adventure/test" className="button">
                      Start game — Test
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      aria-describedby="test-availability"
                    >
                      Start game — Test
                    </button>
                  )}
                </div>
                <p id="glow-availability" className="small-note">
                  {enabled
                    ? "Entry and each purchase use 1 Sepolia GLOW."
                    : "GLOW mode is not available yet."}
                </p>
                {process.env.NODE_ENV !== "development" && (
                  <p id="test-availability" className="small-note">
                    Test mode is available on the local development site.
                  </p>
                )}
              </section>
            </div>
            <details className="disclosure">
              <summary>How to play</summary>
              <p>
                Choose one of six classes, prepare at the inn, and venture
                through the woods to find and defeat the final boss. Hidden
                paths can help you slip past enemies along the way.
              </p>
              <h3>Tokens</h3>
              <p>
                In Test mode, you begin with 30 practice tokens. Choosing your
                class spends one token on entry. At the inn, spend more on
                equipment, supplies and rest to improve your chances.
              </p>
              <p>
                Defeat the boss and your spent practice tokens are refunded.
                Lose or abandon the run and that spending is lost; unspent
                tokens are untouched. For example, spending five tokens and
                losing costs five tokens. Victory adds one bonus token, or two
                in total if you defeat every normal enemy and the boss.
              </p>
              <p>
                Practice tokens stay in the test game. GLOW uses Sepolia test
                tokens with no monetary value; its payments and rewards are not
                available yet.
              </p>
              <h3>Controls</h3>
              <p>
                Use the arrow keys or tap to move, Enter or a tap to interact,
                and Esc to go back. Click inside the game before using the
                keyboard. The game page also offers button controls, pause and
                fullscreen.
              </p>
            </details>
          </>
        )}
      </PrivatePage>
    </>
  );
}
