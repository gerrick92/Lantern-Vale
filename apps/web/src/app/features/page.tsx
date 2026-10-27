import Link from "next/link";
import { RpgIcon } from "@/components/rpg-icon";
import { PracticeTokenExample } from "@/components/practice-token-example";
import { tokenCount, tokenPlan } from "@/lib/token-info";
import { checkedAddress, contracts } from "@/lib/chain";

export const metadata = {
  title: "Info",
  description:
    "Explore Lantern Vale: game rules, GLOW test tokens, wallet connection, community voting plans and the development roadmap.",
};

export default function Information() {
  const deployed = !!contracts.token && !!contracts.faucet;
  const settlement = process.env.SEPOLIA_GAME_ECONOMY_ADDRESS
    ? checkedAddress(process.env.SEPOLIA_GAME_ECONOMY_ADDRESS)
    : undefined;
  return (
    <div className="information-page">
      <h1>Info</h1>
      <section className="feature-explanation" id="rpg">
        <h2>
          <RpgIcon name="sword" />
          Play an RPG. Earn tokens.
        </h2>
        <details className="feature-details">
          <summary>
            Read more<span className="sr-only"> about the game and tokens</span>
          </summary>
          <div>
            <p>
              Choose from six classes and explore Lantern Vale through
              turn-based battles, hidden paths and a final boss.
            </p>
            <p>
              Sign in and complete Google Authenticator verification to play.
              Test mode starts with 30 practice tokens. Entry costs one token
              after choosing a class. Victory returns everything you used, plus
              one bonus token, or two for defeating every enemy and the boss.
              Defeat loses only the tokens used.
            </p>
            <p>
              GLOW adventures are in player testing before public release.
              Practice counters and Sepolia test tokens have no monetary value.
            </p>
            <Link href="/adventure" className="inline-link">
              Go to Play
            </Link>
          </div>
        </details>
      </section>
      <section className="feature-explanation" id="wallet">
        <h2>
          <RpgIcon name="coins" />
          Connect your wallet.
        </h2>
        <details className="feature-details">
          <summary>
            Read more<span className="sr-only"> about wallet connection</span>
          </summary>
          <div>
            <p>
              Connect MetaMask on Ethereum Sepolia to see your wallet address
              and live ETH balance. Linking that wallet to your account requires
              a signed ownership message.
            </p>
            <p>
              Your wallet stays under your control. You approve transactions in
              MetaMask; the website never asks for your recovery phrase or
              private key.
            </p>
            <p>
              {deployed
                ? "GLOW and its faucet are deployed on Sepolia."
                : "GLOW transfers and the token faucet require deployed contracts."}{" "}
              Sepolia ETH pays network fees; it is separate from GLOW.
            </p>
            <Link href="/wallet" className="inline-link">
              Open wallet
            </Link>
          </div>
        </details>
      </section>
      <section className="feature-explanation" id="tokens">
        <h2>
          <RpgIcon name="lantern" />
          GLOW tokens
        </h2>
        <details className="feature-details">
          <summary>
            Read more<span className="sr-only"> about GLOW tokens</span>
          </summary>
          <div className="info-chapter">
            <p className="info-notice">
              <strong>
                {deployed ? "Token and faucet deployed." : "Not deployed yet."}
              </strong>{" "}
              GLOW is Lantern Vale’s ERC-20 test token on Ethereum Sepolia. The
              figures below describe the initial allocation and approved game
              rules. GLOW adventures are in player testing before public
              release.
            </p>
            <h3>Network and contracts</h3>
            <p>Ethereum Sepolia · chain ID 11155111 · 18 decimals</p>
            <dl className="allocation-legend">
              {(
                [
                  ["GLOW token", contracts.token],
                  ["Daily faucet", contracts.faucet],
                  ["Game settlement", settlement],
                ] as const
              ).map(([name, address]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    {address ? (
                      <a
                        className="address inline-link"
                        href={`https://sepolia.etherscan.io/address/${address}`}
                      >
                        {address}
                      </a>
                    ) : (
                      "Not configured"
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="info-note">
              Explorer links show the configured addresses. The contracts&apos;
              sources have exact Sourcify matches; Etherscan source verification
              is still pending.
            </p>
            <h3>How many tokens?</h3>
            <figure className="supply-figure">
              <figcaption>
                {deployed
                  ? "Supply at initial funding"
                  : "Planned initial supply"}
              </figcaption>
              <p className="info-number">
                {tokenCount(tokenPlan.cap)} <span>GLOW cap</span>
              </p>
              <div className="supply-track" aria-hidden="true">
                <span
                  style={{
                    width: `${(Number(tokenPlan.initialMint) / Number(tokenPlan.cap)) * 100}%`,
                  }}
                />
              </div>
              <div className="supply-labels">
                <span>
                  <strong>{tokenCount(tokenPlan.initialMint)}</strong> initial
                  mint · 0.5%
                </span>
                <span>
                  <strong>
                    {tokenCount(tokenPlan.cap - tokenPlan.initialMint)}
                  </strong>{" "}
                  unminted capacity · 99.5%
                </span>
              </div>
            </figure>
            <p>
              The cap limits the total supply at any one time. Only the token
              owner can mint within that cap. Holders can burn their own tokens;
              burning reduces supply and opens room for the owner to mint again.
              The token uses 18 decimal places. The Dashboard reads current
              supply directly from Sepolia when contracts are configured.
            </p>
            <figure className="allocation-figure">
              <figcaption>
                Initial allocation of {tokenCount(tokenPlan.initialMint)} GLOW
              </figcaption>
              <div className="allocation-track" aria-hidden="true">
                <span
                  className="allocation-owner"
                  style={{ flex: Number(tokenPlan.ownerAllocation) }}
                />
                <span
                  className="allocation-rewards"
                  style={{ flex: Number(tokenPlan.rewardPool) }}
                />
                <span
                  className="allocation-faucet"
                  style={{ flex: Number(tokenPlan.faucetPool) }}
                />
              </div>
              <dl className="allocation-legend">
                <div>
                  <dt>Owner allocation · none in this stage</dt>
                  <dd>{tokenCount(tokenPlan.ownerAllocation)} GLOW</dd>
                </div>
                <div>
                  <dt>Reward pool · funding to be agreed</dt>
                  <dd>{tokenCount(tokenPlan.rewardPool)} GLOW</dd>
                </div>
                <div>
                  <dt>Faucet pool · 100% of initial mint</dt>
                  <dd>{tokenCount(tokenPlan.faucetPool)} GLOW</dd>
                </div>
              </dl>
            </figure>
            <p>
              {deployed
                ? "The initial mint funded the faucet with 5,000 GLOW. These figures record that allocation; current balances change as wallets claim tokens."
                : "These are planned allocations, not live balances. The first deployment will fund only the faucet."}{" "}
              Game reward funding needs a separate reviewed plan. Faucet claims
              and rewards transfer existing pool tokens; they do not mint new
              ones. An empty pool cannot pay out.
            </p>

            <h3>How much can I claim per day?</h3>
            <div className="claim-limits">
              <section>
                <h4>{deployed ? "Sepolia faucet" : "Faucet · planned"}</h4>
                <p className="info-number">
                  {tokenCount(tokenPlan.faucetClaim)} <span>GLOW</span>
                </p>
                <p>
                  One claim per wallet, then wait {tokenPlan.cooldownHours}{" "}
                  hours.
                </p>
                <p>
                  The faucet provides tokens for testing while its pool has
                  funds. It is not a reward for winning.
                </p>
              </section>
              <section>
                <h4>Game bonuses · player testing</h4>
                <p className="info-number">
                  {tokenCount(tokenPlan.dailyBonusLimit)}{" "}
                  <span>GLOW maximum per 24 hours</span>
                </p>
                <p>
                  Win {tokenCount(tokenPlan.bossReward)} bonus for the boss, or{" "}
                  {tokenCount(tokenPlan.fullClearBonus)} in total for all normal
                  enemies and the boss.
                </p>
                <p>
                  Bonuses are limited to 10 per wallet over a rolling 24 hours.
                  Every token used is still returned on victory, even at the
                  bonus limit.
                </p>
              </section>
            </div>
            <figure className="claim-clock">
              <figcaption>Faucet: each claim starts a 24-hour wait</figcaption>
              <ol>
                <li>
                  <strong>Monday, 15:00</strong>
                  <span>Successful claim</span>
                </li>
                <li>
                  <strong>24 hours</strong>
                  <span>Cooldown</span>
                </li>
                <li>
                  <strong>Tuesday, 15:00</strong>
                  <span>Earliest next claim</span>
                </li>
              </ol>
            </figure>
            <p>
              Faucet cooldown and game bonus allowance are separate. Neither
              resets at midnight. Each paid bonus stops counting after 24 hours.
              If you have earned nine, the next win can add only one. You may
              keep playing after reaching ten; winning still returns all tokens
              used. Limits are per wallet, not per person. A funded pool is
              required.
            </p>

            <h3>Spending, winning and losing</h3>
            <PracticeTokenExample />
            <p>
              GLOW is the name of the token used in paid play. Entry, each shop
              purchase, each optional encounter and each healing visit cost one
              GLOW. Shop purchases and NPC encounters are available once per
              round; healing can be repeated when needed. There is no total
              spending cap.
            </p>
            <p>
              Use eight GLOW and win: all eight return, plus the eligible bonus.
              Lose: those eight move to the faucet recycling pool, while the
              rest of your wallet stays untouched. Tokens are transferred, not
              burned or mined. Practice uses separate local counters, with the
              same per-round rules and no daily bonus limit.
            </p>
            <p>
              The first owner entry, shop purchase and full-clear victory payout
              are verified on Sepolia. Further player and recovery checks
              continue before GLOW play opens to everyone.
            </p>

            <h3>Is GLOW linked to USD?</h3>
            <p>
              No. GLOW has no USD peg, cash redemption or promised monetary
              value. There is no GLOW/USD exchange rate to show. Practice tokens
              are local game counters; GLOW is a Sepolia test token; Sepolia ETH
              pays test-network fees. They are three different things.
            </p>
            <p>
              Ethereum uses test networks to try applications before a live
              launch. Mainnet ETH prices do not price Sepolia ETH or GLOW. Read{" "}
              <a
                className="inline-link"
                href="https://ethereum.org/developers/docs/networks/"
              >
                Ethereum’s explanation of test networks
              </a>
              .
            </p>
            <h3>Who controls the token?</h3>
            <p>
              You control your connected wallet and approve its transactions in
              MetaMask. The project owner controls minting within the cap and
              can pause new game entries and purchases. Already signed, eligible
              settlements remain available while paused. A separate reward
              signer is required. The new settlement design has no administrator
              withdrawal of player deposits. It depends on a server signer to
              verify outcomes; signer recovery and independent security review
              remain release gates. These are administrator powers, not
              community votes.
            </p>
          </div>
        </details>
      </section>

      <section className="feature-explanation" id="voting">
        <h2>
          <RpgIcon name="book" />
          Community voting
        </h2>
        <details className="feature-details">
          <summary>
            Read more<span className="sr-only"> about community voting</span>
          </summary>
          <div className="info-chapter">
            <p className="info-notice">
              <strong>Planned, not available.</strong> There are no active polls
              or voting rights attached to GLOW today.
            </p>
            <p>
              The aim is to let players help choose future quests, enemies and
              quality-of-life improvements. A first version could use advisory
              polls: community feedback, with the project responsible for what
              it builds. No voting system has been selected yet.
            </p>
            <figure className="voting-flow">
              <figcaption>A proposed community process</figcaption>
              <ol>
                <li>
                  <RpgIcon name="book" />
                  <strong>Propose</strong>
                  <span>A clear idea and scope</span>
                </li>
                <li>
                  <RpgIcon name="shield" />
                  <strong>Discuss &amp; vote</strong>
                  <span>Published rules and deadline</span>
                </li>
                <li>
                  <RpgIcon name="lantern" />
                  <strong>Publish the result</strong>
                  <span>The decision and next steps</span>
                </li>
              </ol>
            </figure>
            <p>
              Before opening a vote, we need to decide who can participate, how
              duplicate accounts are handled, whether votes are per account or
              token-weighted, the minimum participation needed, and whether the
              result is advisory or binding. GLOW ownership currently grants no
              control over the treasury, rewards or roadmap.
            </p>
          </div>
        </details>
      </section>

      <section className="feature-explanation" id="roadmap">
        <h2>
          <RpgIcon name="lantern" />
          Roadmap
        </h2>
        <details className="feature-details">
          <summary>
            Read more<span className="sr-only"> about the roadmap</span>
          </summary>
          <div className="info-chapter">
            <p>
              Our goal: a polished fantasy RPG with secure accounts, a wallet
              you control, and verifiable GLOW rewards on Sepolia.
            </p>
            <figure className="roadmap-figure">
              <figcaption>From the inn to a connected adventure</figcaption>
              <ol className="roadmap-trail">
                <li>
                  <RpgIcon name="home" />
                  <div>
                    <span className="roadmap-state">Complete</span>
                    <h3>The adventure takes shape</h3>
                    <p>
                      One RPG Maker MZ game, six classes, hidden paths, battles
                      and a final boss, with a fantasy website, light and dark
                      themes, and accessibility options.
                    </p>
                  </div>
                </li>
                <li>
                  <RpgIcon name="lantern" />
                  <div>
                    <span className="roadmap-state">Complete</span>
                    <h3>Game rules</h3>
                    <p>
                      One-token entry and purchases, full victory returns, boss
                      bonuses and the rolling ten-token bonus limit are
                      implemented, with payment recovery and saved adventures.
                    </p>
                  </div>
                </li>
                <li>
                  <RpgIcon name="coins" />
                  <div>
                    <span className="roadmap-state">
                      {deployed ? "Complete" : "Planned"}
                    </span>
                    <h3>Connect the Sepolia economy</h3>
                    <p>
                      {deployed
                        ? "GLOW and its faucet are deployed on Sepolia. Claim five GLOW every 24 hours while the faucet has funds. The game contract has its own funded bonus reserve."
                        : "Deploy GLOW and its faucet on Ethereum Sepolia."}
                    </p>
                  </div>
                </li>
                <li>
                  <RpgIcon name="shield" />
                  <div>
                    <span className="roadmap-state">Complete</span>
                    <h3>Player accounts</h3>
                    <p>
                      Register with your own email and password, set up Google
                      Authenticator and link MetaMask. Players have private
                      profiles and wallets, without developer access.
                    </p>
                  </div>
                </li>
                <li aria-current="step">
                  <RpgIcon name="shield" />
                  <div>
                    <span className="roadmap-state">
                      Current · player testing
                    </span>
                    <h3>GLOW adventures</h3>
                    <p>
                      The first owner entry, purchase and full-clear payout are
                      verified on Sepolia. Both optional encounters passed the
                      owner’s live playtest. Defeat, recovery and independent
                      player checks continue before the public launch.
                    </p>
                  </div>
                </li>
                <li>
                  <RpgIcon name="home" />
                  <div>
                    <span className="roadmap-state">Next · public launch</span>
                    <h3>Welcome new players</h3>
                    <p>
                      The complete app is running in a protected cloud review.
                      Registration and authenticator setup pass there. Finish
                      live player checks, then open the vale to everyone.
                    </p>
                  </div>
                </li>
                <li>
                  <RpgIcon name="book" />
                  <div>
                    <span className="roadmap-state">Future · to be agreed</span>
                    <h3>Let players shape the vale</h3>
                    <p>
                      Introduce community proposals and voting once
                      participation rules are agreed. Use playtest feedback to
                      choose what the world needs next.
                    </p>
                  </div>
                </li>
              </ol>
            </figure>
          </div>
        </details>
      </section>
    </div>
  );
}
