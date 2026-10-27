# Testing

Run commands from the repository root. Local fixtures, hosted services and real wallet transactions provide different evidence. Tests never sign with a player's wallet or broadcast a deployment.

## Local verification

```powershell
npm run typecheck
npm run typecheck:signer
npm run lint
npm run format:check
npm test
npm run contracts:test
npm run game:verify
```

`npm run test:offline -- --glow-review` runs the sequential local workflow: static checks, unit/database fixtures, contracts, export verification, build, packaging and isolated Chromium/Firefox tests. It stops on failure and needs no running app or hosted account. Dependencies, Solidity, browsers, licensed game resources and native database tools must already be available. This selects service-free tests; it is not an operating-system network sandbox. Use `npm run test:offline -- --list` to inspect the stages.

Keep Vitest and Playwright at one worker. Run builds and browsers sequentially to limit memory use. A sandbox failure to start a database or browser is BLOCKED evidence; rerun the affected fixture with appropriate process permissions.

| Command                                                                         | Scope                                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `npm test -- tests/game`                                                        | Rules, saves, maps and effects                                  |
| `npm test -- tests/server`                                                      | Auth, receipts, signing, SQL/RLS and recovery                   |
| `npm test -- tests/wallet`                                                      | Addresses, units, accounting and payment journals               |
| `npm run contracts:coverage`                                                    | Instrumented Solidity coverage; inspect warnings                |
| `npm run game:balance`                                                          | 11,232 simulations under a disclosed tactical policy            |
| `npm run launcher:test`                                                         | Windows launcher build, prerequisites and child-process cleanup |
| `npm run database:rehearse`                                                     | Populated legacy-schema upgrade and rollback in local fixtures  |
| `npm run database:backup-test`                                                  | Synthetic native PostgreSQL/DPAPI capture and restore           |
| `npm run recovery:drill`                                                        | Exact-checkpoint restore and interrupted paid journeys          |
| `npm run release:package -- --glow-review`                                      | Complete game/application package and integrity checks          |
| `npm test -- tests/deployment/package.test.ts tests/deployment/hosting.test.ts` | Package privacy and hosted build guards                         |

Native backup fixtures require the reviewed Windows PostgreSQL tools in [Setup](SETUP.md#encrypted-hosted-backup-and-local-restore). Skipped cases are not a successful restore. Simulated win rates are not human difficulty measurements or an anti-bot assessment.

## Browser tests

Install browsers once:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.tools/browsers"
npx playwright install chromium firefox
```

After creating a current release package, `npm run test:e2e:offline` runs isolated registration, account, payment, native-game, NPC, forest-progression and wallet-refresh fixtures. Requests use local files or intercepted responses; tests do not operate the user's browser.

`npm run test:e2e` additionally needs the development app at `http://127.0.0.1:3000`. `TEST_BASE_URL` selects another test origin. The full development suite is not a production suite: developer controls and practice are absent from production.

Useful focused runs:

```powershell
npx playwright test tests/browser/paid-entry.spec.ts tests/browser/paid-npc.spec.ts tests/browser/game-fullscreen.spec.ts --project=chromium
npx playwright test tests/browser/game-progression.spec.ts tests/browser/npc-follow.spec.ts tests/browser/supply.spec.ts
npx playwright test tests/browser/info.spec.ts
```

Playwright clears its output directory. Use `test-results/browser` or another dedicated run directory, **never the shared test-results root**, which also holds recovery archives. HTML reports use `test-results/browser-report`. Traces/videos are disabled and automated audio is muted. Do not capture passwords, QR secrets or cookies.

## Hosted checks

These commands contact services and create disposable accounts. They need private configuration and an approved fixture policy. They remove only their own fixtures; existing accounts and authenticators must remain unchanged.

| Command                                        | Scope                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `node tests/hosted/registration.mjs --staging` | Staging signup, duplicate protection, TOTP and existing-account preservation |
| `node tests/hosted/registration.mjs`           | Registration checks against the working service                              |
| `npm run test:hosted`                          | Two ordinary accounts, RLS, TOTP, SIWE and developer denial                  |
| `npm run test:account`                         | Actual registration form, QR enrollment and account/password/logout UI       |
| `npm run test:staging-config`                  | Staging password boundary and redirects                                      |
| `node tests/hosted/auth-recovery.mjs`          | Staging fixture restore with the original password and TOTP                  |
| `node tests/hosted/game-recovery.mjs`          | Staging journal outage, retry and later-action restore                       |
| `node tests/hosted/vercel.mjs`                 | Protected cloud account/API checks                                           |
| `node tests/hosted/vercel-browser.mjs`         | Protected cloud QR/TOTP and responsive UI                                    |
| `npm run test:production`                      | Built app on temporary port 3001, account tests, guards and Lighthouse       |

Cloud review tests need the authorized Vercel CLI and private automation credential, sent only to the exact review origin. Entry-review fixtures use an unfunded wallet: a prepared payment plan is not a real payment.

`npm run test:all -- --glow-review` includes hosted mutations. It needs the development app on port 3000 and free port 3001. It rebuilds rules/presentation and syncs the export, but does not regenerate maps. Read [Setup](SETUP.md) before using recovery or migration tools.

The native signer runtime has a separate local check:

```powershell
$env:DENO_DIR = Join-Path $PWD '.tools/deno/cache'
& '.tools/deno/node_modules/deno/deno.exe' test --allow-net=127.0.0.1 --config supabase/functions/settlement-signer/deno.json tests/server/signer.deno.ts
```

It uses ephemeral unfunded keys and loopback HTTP, without provisioning the real signer.

## Release verification

Recorded for the **27 October 2026 public release** at [lantern-vale.vercel.app](https://lantern-vale.vercel.app). Results describe executed checks, not guarantees about every device or future change.

| Check                              | Result                | Scope                                                                                                                        |
| ---------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Types, lint, formatting and build  | PASS                  | Local checks and completed Vercel build                                                                                      |
| Unit/local integration             | PASS                  | 315 cases in the full run; the four-case native backup rerun completed the two sandbox-blocked cases, covering all 317 cases |
| Contracts                          | PASS                  | 31 Foundry cases, including cap/mint/self-burn/transfers, faucet and settlement; two burn checks also rerun separately       |
| Game export                        | PASS                  | 220 files match the manifest; unchanged cave and fresh packaged native-game loading                                          |
| Public account journey             | PASS                  | Fresh registration, QR/TOTP, SIWE, entry review and recovery without developer membership or Vercel bypass                   |
| Access isolation                   | PASS                  | Two-account RLS; denial of guests, removed factors and cross-origin mutations; production developer routes return 404        |
| Public UI                          | PASS for tested scope | Desktop/390px account layouts, targeted axe checks and Info-page browser tests                                               |
| Contract verification              | PASS                  | Exact Etherscan and Sourcify matches for all three contracts; [records](../deployments/etherscan.json)                       |
| Real GLOW victory                  | PASS                  | Two deposited GLOW returned plus two bonus GLOW; both NPCs also passed the owner's playtest                                  |
| Real GLOW defeat                   | PASS                  | No refund/bonus; one deposited GLOW recycled to the faucet                                                                   |
| Recovery                           | PASS for tested scope | Encrypted checkpoint retrieval, native restore, hosted password/TOTP restore and later-action journal replay                 |
| Development dependency audit       | OPEN finding          | Earlier braces advisory in the ESLint tooling chain, described below                                                         |
| Friends' full live-wallet journeys | USER TESTING          | Separate-wallet claims, transfers and complete rounds                                                                        |
| Manual accessibility and devices   | NOT YET VERIFIED      | NVDA, Firefox Accessibility Inspector and physical phone/mobile wallets                                                      |

Live receipts: [full-clear victory](https://sepolia.etherscan.io/tx/0x021daa3a821d4edff87e7bc5088d474473311cd74185dba60e4170bd42064780), [combat defeat](https://sepolia.etherscan.io/tx/0xd85b87d1432d08080601c9b64e57aeb6f88946ddfb4025b18516f76b4fdefaf3). Deployment/funding records remain in `deployments/`; historical receipts are not current balances.

Private reports remain under ignored `test-results/hosting/`: `public-release.json`, `public-hosted-accounts.json`, `public-browser-accounts.json`, `live-defeat.json`, `all-player-unit.json` and `all-player-native-backup.json`. NPC and source-audit reports have separate directories. Historical implementation notes remain recoverable in Git history.

The earlier audit found [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) in the development ESLint/fast-glob/micromatch chain; the runtime-only audit found no known vulnerabilities. No incompatible forced downgrade was applied. Audit results are time-sensitive: rerun `npm audit` and `npm audit --omit=dev` before a dependency update or release and assess the result.

Keyboard, HTML validation, axe, viewport tests and Lighthouse are distinct checks. None proves full WCAG conformance, canvas screen-reader support, photosensitivity safety or a professional security audit. Live daily-bonus boundaries, prolonged outages, signer rotation and total provider/root-key loss remain outside the recorded acceptance scope. See [Security](SECURITY.md).

## Source publication

Run `node scripts/review-source.mjs` before staging, then `node scripts/review-source.mjs --index` to audit staged bytes. They write an ignored hash manifest and path list without uploading files. Targeted credential checks do not detect every possible secret format.

Keep environments, private tooling, recovery archives, reports, licensed raw resources and the compiled launcher out of Git. [Assets](ASSETS.md) explains public authoring source versus the finished deployment artifact.
