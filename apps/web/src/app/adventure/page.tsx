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
  const enabled = !!user && canUseGlow();
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
                    : "GLOW mode is temporarily unavailable."}
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
                Choosing your class costs 1 GLOW. Each purchase, optional
                encounter or rest costs another 1 GLOW. Prepare at the inn with
                equipment, supplies and spells suited to your class.
              </p>
              <p>
                Defeat the boss to receive every GLOW used in the round, plus 1
                bonus GLOW, or 2 in total for defeating all normal enemies and
                the boss. Bonuses are limited to 10 GLOW per wallet over a
                rolling 24 hours. Lose the round and only the GLOW you used is
                lost; unspent wallet tokens remain yours.
              </p>
              <p>
                Register, complete Google Authenticator setup and link MetaMask
                to play. Claim 5 GLOW from the Dashboard faucet every 24 hours
                while its pool is funded. Sepolia test ETH pays network fees.
                GLOW has no monetary value. Local Test mode uses 30 separate
                practice counters.
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
