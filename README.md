![Lantern Vale](docs/assets/lantern-vale-header.svg)

Lantern Vale is a turn-based fantasy RPG built in RPG Maker MZ, with a web app for accounts, wallets and **GLOW**, its ERC-20 token on Ethereum Sepolia. Choose a class, prepare at the inn and find the guardian that has stolen the valley’s dawn.

[The game](#the-game) · [How to play](#how-to-play) · [GLOW](#glow) · [Tech stack](#tech-stack) · [Installation](#installation) · [Running locally](#running-locally) · [Testing](#testing) · [Contracts](#contracts) · [Project guide](#project-guide)

**[Play Lantern Vale](https://lantern-vale.vercel.app)** — a free Sepolia demo. Every registered player can use the real GLOW game after authenticator setup and wallet linking. Entry, purchases, victory payouts and defeat recycling are verified on Sepolia. [Current checkpoint](PROJECT_SUMMARY.md) · [Roadmap](docs/ROADMAP.md)

## The game

The adventure begins at a woodland inn. Merchants sell equipment, supplies and spells suited to your class. The innkeeper restores health and removes curses. Two optional encounters can help you—or leave you wishing you had kept your token.

Beyond the inn are two forest routes, hidden paths and a mountain shrine. Enemies vary between rounds. Clearing the forest brings its lanterns back to life. You can take shortcuts past ordinary enemies, but defeating the guardian is mandatory and a full clear earns the larger bonus.

Choose from **Warrior, Dark Knight, White Mage, Black Mage, Ranger and Thief**. Each has distinct stats, a combat skill and purchasable spells. Your class is fixed for the round.

The website includes profiles, Google Authenticator-compatible TOTP, signed wallet linking, a faucet, transfers, contacts and adventure history. Settings provides light/dark themes, reduced motion, larger text, mute and an opt-in Accessibility Mode. Community voting is planned, not implemented.

## How to play

1. Create an account with your own email and a password of at least 12 characters. Set up Lantern Vale in Google Authenticator, then enter its code. No confirmation email, Google login or Supabase dashboard account is needed.
2. Connect MetaMask on **Ethereum Sepolia**. Sign the wallet-ownership message to link it to your account; this transfers no tokens.
3. Claim five GLOW from the Dashboard faucet, once per wallet every 24 hours while the pool is funded. Sepolia test ETH is needed separately for network fees.
4. Open Play, choose **Start game**, select a class and confirm its one-GLOW entry in MetaMask.
5. Prepare at the inn, explore the forest and defeat the guardian. Attacks, skills, spells, items and defending each consume a combat turn.
6. On victory, confirm settlement to receive all GLOW used in that round plus the eligible bonus. A loss forfeits only those used tokens.

MetaMask may request an allowance approval followed by the payment itself. Approval does not transfer GLOW. Entry and optional encounters also wait for a verified random draw, normally available about a minute after payment. Leave the game open while it finishes. If interrupted, resume the saved adventure/payment rather than paying again.

| Control                 | Action                        |
| ----------------------- | ----------------------------- |
| Arrow keys or tap/click | Move and navigate             |
| Enter                   | Confirm or interact           |
| Esc                     | Cancel or open the game menu  |
| F4 / Fullscreen game    | Toggle fullscreen             |
| Show companion          | Open accessible text controls |

**Start game — Test** is local practice: 30 counters per new round, no wallet transactions. Practice counters never become GLOW. Practice and developer tools are disabled in release builds. [Full game guide](docs/GAME.md)

## GLOW

GLOW is a Sepolia test token with no USD peg, cash redemption or promised monetary value.

| Rule                                    | Amount                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| Entry                                   | 1 GLOW                                                          |
| Each equipment, item or spell purchase  | 1 GLOW; each stock item once per round                          |
| Each optional NPC encounter             | 1 GLOW; once per round                                          |
| Inn healing and curse removal           | 1 GLOW; repeatable                                              |
| Win                                     | Return **all GLOW used in that round**                          |
| Boss / all five normal enemies and boss | +1 / +2 bonus GLOW total                                        |
| Bonus limit                             | 10 GLOW per wallet over a rolling 24 hours                      |
| Lose                                    | Used GLOW goes to the faucet; unspent wallet funds remain yours |
| Faucet                                  | 5 existing GLOW per wallet every 24 hours, while funded         |

Winning returns your deposits even at the bonus limit. There is no fixed spending or play-count cap. Faucet claims transfer existing tokens, not newly minted ones.

GLOW uses 18 decimals and caps outstanding supply at **1,000,000**. The owner can mint within the cap; holders can burn their own tokens, reopening mint capacity. The game keeps player deposits separate from its bonus reserve.

## Tech stack

| Layer                     | Technology                                                            |
| ------------------------- | --------------------------------------------------------------------- |
| Website and API           | Next.js App Router, React, strict TypeScript, Tailwind CSS            |
| Wallet and chain          | Wagmi, Viem, MetaMask, Ethereum Sepolia                               |
| Accounts and data         | Supabase Auth, Postgres, row-level security, TOTP, SIWE               |
| Contracts                 | Solidity, OpenZeppelin, Foundry                                       |
| Game                      | RPG Maker MZ, native JavaScript presentation, shared TypeScript rules |
| Randomness and settlement | Verified drand quicknet draws, restricted Supabase signing function   |
| Tests                     | Vitest, Playwright, local Postgres/PGlite, Foundry, axe               |
| Hosting                   | Vercel for the app; Supabase for accounts and data                    |

This testnet demo does not verify ownership of entered email addresses. Save your password and authenticator: email password reset is unavailable. A signed-in player can change their password in Settings. New accounts receive no developer privileges.

The server validates payments and progression. Browser state, practice saves and client victory messages cannot authorize rewards. [Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md)

## Installation

You need **Node.js 24 LTS and npm 11**, configured Supabase services and the complete licensed game export. Windows can build the launcher using the installed .NET Framework compiler. Foundry and Playwright browsers are required for their tests, not to start the app.

From the project root:

```powershell
npm ci

# First setup only. Preserve an existing configured environment.
if (-not (Test-Path -LiteralPath apps/web/.env.local)) {
    Copy-Item -LiteralPath .env.example -Destination apps/web/.env.local
}
```

Source: [gerrick92/Lantern-Vale](https://github.com/gerrick92/Lantern-Vale). A fresh clone contains the authored game data and plugins. The licensed finished-game export is supplied separately for deployment; the repository is not a standalone RPG Maker asset download.

Configure `apps/web/.env.local` using [Setup](docs/SETUP.md). Privileged credentials stay server-only. Never put secrets in Git or chat. Existing accounts, contracts and authenticator factors do not need to be recreated.

A source checkout omits RPG Maker’s licensed runtime assets. Restore the approved finished export or follow [the game build instructions](docs/GAME.md#authoring-and-export) using a licensed MZ installation. Players need neither RPG Maker nor Steam. Full map rebuilds overwrite authored data; preserve editor changes first.

## Running locally

```powershell
npm run dev
```

Open **[http://127.0.0.1:3000](http://127.0.0.1:3000)** in your MetaMask browser. This starts the single Next.js app and its API. Supabase and Sepolia are hosted services; no separate database or blockchain terminal is needed.

For a one-click Windows start:

```powershell
npm run launcher:build   # Once, or after updating launcher source
npm run launcher:check   # Check prerequisites without starting anything
```

Double-click **Lantern Vale.exe** beside this README. It starts the app, waits for it to respond and opens Edge (or the default browser if Edge is unavailable). Keep its console open. **Ctrl+C or closing that console stops only the server it started.** If Lantern Vale was already running, the launcher reuses it and leaves it running. Other processes on port 3000 are left alone.

The launcher installs nothing, changes no account settings and makes no wallet requests. It is a local development helper, not a standalone game. The generated executable is unsigned and ignored by Git; source is in `scripts/launcher/`.

For a local production build:

```powershell
npm run build
npm start
```

Stop the development server first; both use port 3000. Production supports real GLOW gameplay for ordinary players. Developer tools and local practice stay closed. The public Vercel site runs without this PC being online. [Hosting setup and release checks](docs/SETUP.md#vercel-hosting)

## Testing

```powershell
npm run typecheck
npm run lint
npm test
npm run contracts:test
npm run game:verify
npm run test:offline -- --glow-review
```

The offline workflow runs sequentially and needs its tools installed already. It does not sign MetaMask transactions or change hosted accounts. `npm run test:all` also includes disposable hosted-account checks; read [Testing](docs/TESTING.md) first. Reports belong in `test-results/`.

[Recorded results](docs/REVIEW.md) distinguish local tests, actual receipts and human testing. Automated accessibility checks do not establish full WCAG conformance.

## Contracts

All three run on **Ethereum Sepolia · chain ID 11155111**.

| Contract        | Address                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GLOW            | [0x5833635b652e3b93D39E0895B9C82891C6BB626b](https://sepolia.etherscan.io/address/0x5833635b652e3b93D39E0895B9C82891C6BB626b) |
| Faucet          | [0xb0bbbDCbdE6D89F40208641D608F22A3F1352BfA](https://sepolia.etherscan.io/address/0xb0bbbDCbdE6D89F40208641D608F22A3F1352BfA) |
| Game settlement | [0x9bd16131ec0e61c92ee3e6e8e8ea8f61a17519eb](https://sepolia.etherscan.io/address/0x9bd16131ec0e61c92ee3e6e8e8ea8f61a17519eb) |

All three contracts have exact source matches on Etherscan and Sourcify. The public verification record, compiler version and submitted-input hashes are in [deployments/etherscan.json](deployments/etherscan.json). Source verification confirms matching code, not a security audit.

For test ETH, choose a free faucet from [Ethereum’s Sepolia directory](https://ethereum.org/developers/docs/networks/#sepolia) and check the incoming balance. Provider requirements and cooldowns vary. GLOW comes separately from the Dashboard faucet and cannot pay gas.

## Project guide

```text
apps/web/       Website, API routes and finished game export
game/           Shared rules, MZ project, presentation and build tools
contracts/      Solidity source and Foundry tests
supabase/       Applied migrations and restricted signer
deployments/    Public contract and service verification records
scripts/        Build, launcher, packaging and recovery tools
tests/          Unit, browser and integration checks
docs/           Setup, architecture, game, assets and release guides
```

`mosslight` and `SLMS` remain in internal paths and protocol identifiers for compatibility. The product is Lantern Vale and the token is GLOW.

Preserve applied migrations, payment journals, deployment records and recovery material. A verified release package must include the finished game; a source-only GitHub upload cannot run it. [Asset provenance and licenses](docs/ASSETS.md) · [Original assignment](docs/ORIGINAL_SOFTSTACK_ASSIGNMENT.md)
