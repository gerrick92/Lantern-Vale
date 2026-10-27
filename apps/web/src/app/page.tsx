import Image from "next/image";
import Link from "next/link";
import { currentUser } from "@/server/current-user";
import { RpgIcon, Ornament } from "@/components/rpg-icon";

export default async function Home() {
  const user = await currentUser();
  return (
    <>
      <section className="home-welcome" aria-labelledby="vale-title">
        <div className="welcome-art">
          <Image
            src="/art/lantern-vale-forest-v2.png"
            alt="A cloaked adventurer carries a lantern toward a woodland inn beneath the moon"
            fill
            sizes="(max-width: 1440px) 100vw, 1440px"
            quality={75}
            preload
          />
        </div>
        <div className="welcome-copy">
          <RpgIcon name="lantern" className="title-lantern" />
          <h1 id="vale-title">
            Lantern <span>Vale</span>
          </h1>
          <Ornament />
          <p>{user ? "Welcome back." : "Your adventure starts here."}</p>
          <div className="welcome-actions">
            {user ? (
              <>
                <Link href="/adventure" className="button quest-choice">
                  <RpgIcon name="sword" />
                  Play game
                </Link>
                <Link href="/dashboard" className="button quest-choice">
                  <RpgIcon name="shield" />
                  Open dashboard
                </Link>
              </>
            ) : (
              <>
                <Link href="/auth" className="button quest-choice">
                  <RpgIcon name="key" />
                  Sign in
                </Link>
                <Link
                  href="/auth?mode=register"
                  className="button quest-choice"
                >
                  <RpgIcon name="book" />
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
      <section className="home-features" aria-labelledby="home-features-title">
        <h2 id="home-features-title">
          <span>Features</span>
        </h2>
        <div className="feature-summaries">
          <div>
            <RpgIcon name="sword" className="feature-symbol" />
            <div>
              <h3>Play an RPG. Earn tokens.</h3>
              <p>Six classes. Turn-based battles.</p>
            </div>
          </div>
          <div>
            <RpgIcon name="coins" className="feature-symbol" />
            <div>
              <h3>Connect your wallet.</h3>
              <p>MetaMask on Sepolia.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
