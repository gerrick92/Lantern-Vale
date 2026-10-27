# Setup and operations

The public app is [lantern-vale.vercel.app](https://lantern-vale.vercel.app). Vercel serves the website/API; Supabase provides accounts, data, restricted signing and recovery storage. Players do not need this computer, RPG Maker or access to either provider dashboard.

Use Node.js 24 and npm 11. Windows x64/PowerShell is the verified local environment. Commands run from the repository root.

## Local startup

```powershell
npm ci
if (-not (Test-Path -LiteralPath apps/web/.env.local)) {
    Copy-Item -LiteralPath .env.example -Destination apps/web/.env.local
}
```

Configure that file, restore the complete game export as described in [Game](GAME.md#authoring-and-export), then run `npm run dev`. Open `http://127.0.0.1:3000` in the MetaMask browser. Never overwrite an existing configured environment. A fresh Git clone contains authoring source but omits licensed engine resources.

For a production build, run `npm run build` and `npm start`. Stop the development server first if reusing port 3000. Both scripts intentionally use Webpack. `npm run test:production` uses its own temporary server on port 3001.

### Windows launcher

Run `npm run launcher:build` once, then double-click **Lantern Vale.exe** beside the README. It checks prerequisites, starts the app and opens Edge after it responds. If the app already runs, it opens that instance. Supabase and Sepolia require no local terminals.

Keep the console open. Ctrl+C or closing it stops only the server tree it started; an existing server and unrelated processes remain untouched. A different service on port 3000 causes an error rather than termination.

The unsigned executable is built locally with Windows' installed .NET Framework compiler. Source is in `scripts/launcher/`; the generated executable is ignored by Git. It is not an installer or standalone game and does not change accounts, deploy contracts or run migrations. `npm run launcher:check` verifies prerequisites; `npm run launcher:test` runs isolated tests without opening a browser.

## Environment

Use `.env.example` as the complete variable list. Only `NEXT_PUBLIC_*` values may enter browser code.

| Variable                                                                                 | Purpose                                                         |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                       | Public account-service configuration, protected by RLS          |
| `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`                                     | Server-only database access                                     |
| `APP_ORIGIN`                                                                             | Exact origin; required in production                            |
| `SEPOLIA_RPC_URL`, `NEXT_PUBLIC_SEPOLIA_RPC_URL`                                         | Server/browser Sepolia RPC; browser URL must be safe to publish |
| `NEXT_PUBLIC_TOKEN_ADDRESS`, `NEXT_PUBLIC_FAUCET_ADDRESS`                                | Verified deployed addresses                                     |
| `NEXT_PUBLIC_DEPLOYMENT_BLOCK`                                                           | Start block for bounded transfer-history queries                |
| `SEPOLIA_GAME_ECONOMY_ADDRESS`, `SEPOLIA_GAME_DEPLOYMENT_BLOCK`                          | Verified settlement contract and receipt-recovery start block   |
| `SETTLEMENT_SIGNER_URL`, `SETTLEMENT_SIGNER_TOKEN`                                       | Server-only restricted signing endpoint/access                  |
| `REWARD_SIGNER_ADDRESS`                                                                  | Public address of the separate settlement signer                |
| `GAME_RECOVERY_URL`, `GAME_RECOVERY_SECRET`, `GAME_RECOVERY_KEY`, `GAME_RECOVERY_STREAM` | Server-only independent game-journal storage and encryption     |
| `DEVELOPER_USER_ID`                                                                      | Exact Supabase UUID allowed to use local administrative tools   |
| `GLOW_ACCEPTANCE_ENABLED`                                                                | Local owner activation tool only; never player eligibility      |
| `RPG_MZ_PATH`                                                                            | Licensed MZ installation, needed only for resource rebuilding   |
| `ETHERSCAN_API_KEY`                                                                      | Optional source-verification tooling                            |
| `NEXT_PUBLIC_GAME_GATEWAY_ADDRESS`, `NEXT_PUBLIC_REWARD_ADDRESS`, `REWARDS_ENABLED`      | Legacy integration; leave unused/disabled                       |

Do not invent addresses or report an unconfigured balance as zero. Existing deployment records supply the public configuration. Keep environments, database credentials, sessions and recovery material out of Git, screenshots and logs.

Developer access uses the server-configured account UUID, never an email, display name or editable profile metadata. Missing configuration disables the tools. In development only that account sees **Settings → Developer tools**; production returns 404 for all `/dev/*` routes. All registered players can use GLOW mode after TOTP and wallet linking.

## Supabase

The working service is **Lantern Vale Sepolia** (`frbbhbkwtgqczdjfhedi`); independent staging/recovery is **Lantern Vale Staging** (`nisviqoxcfbtwccdjqoz`). Both have migrations 001–008. Preserve existing users, factors and configuration.

Applied sources are pinned in `supabase/applied-migrations.json`. Never edit or blindly rerun applied SQL, including staging files. Future schema changes need a new migration. Compare actual schema/history before any `db push`; dashboard SQL execution does not automatically populate CLI history.

### Player registration

The flow is **email/password → Google Authenticator-compatible TOTP → MetaMask ownership link**. Players register on the website and never receive developer access.

Keep email/password signups enabled, confirmation emails disabled, minimum password length 12, and TOTP enrollment/verification enabled. Google, Azure and GitHub login remain disabled. This testnet setup uses no SMTP sender or social provider.

Registration returns an AAL1 session and opens authenticator setup. Private routes require server-validated identity, AAL2 and a current verified factor. Supabase auto-populates `email_confirmed_at`; this is account activation, not proof of inbox ownership. Never use a claimed email to merge accounts, grant roles or bypass recovery.

**Save the password and authenticator.** Email password reset is unavailable. Signed-in players can change their password in Settings. Lost-factor recovery requires a reviewed identity check; an administrator bypass is not a substitute.

Working service URL configuration:

- Site URL: `https://lantern-vale.vercel.app`
- Redirects: `https://lantern-vale.vercel.app/auth/callback` and `http://127.0.0.1:3000/auth/callback`

Use exact origins, not wildcard preview URLs. Existing accounts and TOTP factors remain valid when moving between approved origins, although a new browser origin may need a fresh sign-in and wallet connection.

### Separate staging service

Staging configuration belongs in ignored `apps/web/.env.staging.local`, never over the working environment. Its local app origin is `http://127.0.0.1:3002`, with the matching `/auth/callback`. Temporary staging runtimes contain private configuration and must not be distributed.

`tests/hosted/staging.sql` is a rollback-only rehearsal for an approved **empty** staging database. Its guards reject existing records. Run the whole file; injected assurance claims and synthetic receipt values are not real Auth or blockchain evidence. Current staging also retains recovery objects: never reset the project to run a test.

Hosted registration, isolation and recovery test commands are documented in [Testing](TESTING.md#hosted-checks).

### Account data and maintenance

Settings → Account data offers a private JSON export and a cancellable deletion request. Exports whitelist profile, contacts, wallet binding, round/action history and payment/result summaries. Exact token values remain strings. Auth secrets, sessions, SIWE messages and raw signatures are excluded. Limits are 10,000 history records and an 8 MiB database payload; larger requests fail explicitly rather than truncate.

A deletion request does **not** erase data or refund deposits. Before erasure, an operator must verify identity/intent, stop new writes, reconcile pending reviews and all deposits with canonical chain state, preserve replay tombstones and review backup retention. A terminal game or expired review alone does not prove settlement. The full erasure procedure still needs staging review. Blockchain records cannot be deleted.

Maintenance has no public endpoint or schedule. It can remove only wallet challenges expired over 24 hours and rate-limit rows older than two days, in bounded batches. Preview in an approved staging maintenance session:

```sql
select public.cleanup_account_ephemera(); -- Dry run.
```

After reviewing and authorizing the result, `select public.cleanup_account_ephemera(true, 500);` applies a batch. It never clears accounts, wallet links, rounds, actions or payment evidence.

## Signing and randomness

The restricted service in `supabase/functions/settlement-signer/` is deployed and enabled for validated settlements. Its public signer is `0xfeA1f112afC1906E3317597323Eb175993971Ca9`, separate from token/game ownership. Version 4's five source files match the provisioned service. See [provisioning](../deployments/signer-provisioning.json) and [service evidence](../deployments/supabase-signer.json).

The private signing key stays in Supabase function Secrets, never the web app or browser. Only the endpoint and bearer credential belong in the app's server environment. Provider settings are:

| Function setting                                              | Purpose                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `LV_SIGNING_ENABLED`                                          | Enable only after provisioning/role checks                              |
| `LV_SIGNER_PRIVATE_KEY`                                       | Existing separate signing key, never an owner/player key                |
| `LV_SIGNER_TOKEN`                                             | Independent random service credential, at least 32 base64url characters |
| `LV_ECONOMY_ADDRESS`, `LV_TOKEN_ADDRESS`, `LV_FAUCET_ADDRESS` | Verified contracts                                                      |
| `LV_SEPOLIA_RPC_URL`                                          | HTTPS Sepolia RPC without inline URL credentials                        |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                   | Provider access to the authoritative game database                      |

Gateway JWT validation is disabled only for this function because its handler enforces a separate constant-time server credential check. User JWTs and publishable keys cannot authorize signing. The function rejects browser requests and checks domain, chain, contract roles, retained terminal state, recipient, class, deposits and expiry. It trusts the authoritative database and the app's receipt/beacon verification; it is a restricted software signer, not an HSM.

Run `npm run typecheck:signer`, the signer tests, and native `deno check` before changes. `node scripts/prepare-signer-deployment.mjs` creates a source bundle without deploying. No app build or test provisions the signer automatically.

Drand quicknet needs no account or subscription. Entry and NPC outcomes use a fixed future round at least 60 seconds after the canonical payment block, verified against a pinned BLS trust root. Waiting normally takes about a minute. Recover an existing payment after an outage; never charge again or choose another draw. See [Security](SECURITY.md#randomness-boundary).

### Existing signer custody

`node scripts/signer-custody.mjs --verify` retrieves the encrypted custody object from private staging Storage and separately retained wrapping key/identity through the authorized Vercel CLI. It proves possession using a non-settlement challenge and reports only public metadata. It sends no chain transaction.

Preserve `LV_SIGNER_RECOVERY_KEY_V1`, `LV_SIGNER_CUSTODY_V1`, `LV_SIGNER_SERVICE_TOKEN_V1` and their matching encrypted objects. These development-only operational recovery values are not browser settings. Both provider accounts are dependencies. Never regenerate the signer as a retry or rotate custody while existing deposits/results depend on it.

## Wallet and contracts

Use Ethereum Sepolia, chain ID **11155111**. Link a wallet with the player's SIWE ownership signature. Sepolia ETH pays network gas; the GLOW faucet supplies only GLOW.

The [README contract table](../README.md#contracts) lists the active token, faucet and settlement contracts. All have exact Etherscan/Sourcify matches. The faucet was initially funded with 5,000 GLOW and the game with 100 GLOW; these are historical funding amounts, not current balances.

**Do not redeploy the completed contracts to add players or restart the app.** The game is funded and unpaused; [activation](../deployments/game-activation.json) and [deployment receipts](../deployments/game-economy.json) are retained.

Local developer tools can review saved receipts. `scripts/verify-deployment.mjs` independently checks token/faucet receipts. `scripts/prepare-game-deployment.mjs` and `scripts/verify-game-deployment.mjs` are for separately authorized **new paused deployments**; the latter deliberately rejects active/used contracts and must not be used to declare this running game invalid. Preserve all completed journals and plans.

## Vercel hosting

The complete app runs on the existing free Hobby project. The production domain is public; unique deployment/preview URLs retain Vercel sign-in protection. `deployments/web.json` records the published artifact. GitHub Pages cannot serve the required authenticated API routes.

| Setting                               | Value                                                        |
| ------------------------------------- | ------------------------------------------------------------ |
| Root Directory                        | `apps/web`                                                   |
| Framework / Node                      | Next.js / 24.x                                               |
| Include source outside Root Directory | Enabled                                                      |
| Install                               | `npm ci --include=dev --include-workspace-root`              |
| Build                                 | `node ../../scripts/verify-hosted-game.mjs && npm run build` |
| Output                                | Default `.next`; no static export                            |

Deploy from a **fresh verified package**, not the working checkout:

```powershell
npm run release:package -- --glow-review
node scripts/verify-package.mjs <generated-directory>
node scripts/deploy-review.mjs --glow
```

The last command is a dry run. The review deployment helper requires the existing Hobby project, protection on all URLs and matching working services before accepting `--deploy`. Its `--public-origin` option configures the verified production origin but neither assigns an alias nor opens access. A future release using this helper must review protection first; do not bypass the guard against the currently public project.

After protected checks, publication is a separate promotion/alias/access-policy step. Verify the exact public origin, private API denial, account/TOTP/SIWE flow and ordinary-player GLOW access before opening it. The existing public deployment has passed these checks.

Packages contain the finished MZ runtime and required notices, but no credentials, caches, backups or editor asset library. Verify the untouched package before installing/linking/building, which intentionally adds files outside its manifest. Package verification is an integrity/selected-secret check, not a cryptographic signature or universal secret detector.

Automatic GitHub source-only deployment is insufficient because the licensed game export is ignored in Git. Keep it off until a reviewed artifact workflow supplies that export. Never force-add raw MZ libraries as a workaround. Web builds do not run contract deployments or SQL migrations.

Store working Supabase, restricted signer access and game-recovery credentials only in Vercel's server environment. No player/owner key, signing private key or developer account ID belongs there. Public values are baked into the build. Use the exact `APP_ORIGIN=https://lantern-vale.vercel.app`; keep staging configuration separate. CLI credentials remain under ignored `.tools/private/vercel`.

## Recovery and database operations

These are maintainer procedures, not installation steps. Preserve private local tooling and archives even though they are excluded from Git.

### Existing-database upgrade rehearsal

`npm run database:rehearse` tests the historical 001/002 → 006 upgrade with populated in-memory fixtures. `npm run database:review` writes rollback-only SQL and a source-hash manifest without contacting Supabase.

Generated SQL is for an isolated, approved legacy clone after backup. Run the whole transaction and retain its rollback; never change it to commit to bypass a failed check. `scripts/promote-database.mjs` performed the completed working-service promotion and rejects already registered history. It is not a routine startup command.

### Encrypted hosted backup and local restore

`npm run database:backup` captures the fixed working service read-only using ignored `.env.supabase-admin` and its database password. It pins the session-pooler endpoint and verifies TLS. Credentials and raw diagnostics are never printed.

Reviewed native tools live under `.tools/postgresql-17.11/runtime/pgsql/`. The Windows 17.11-5 archive SHA-256 is `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`; the pinned Supabase CA at `.tools/postgresql-17.11/supabase-ca.crt` has SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. Review version/certificate replacements.

Captures go to fresh `test-results/hosted-backup/capture-*` directories, encrypted with Windows DPAPI CurrentUser. Read-back decryption, archive validation and hashes must pass. Restore only into a disposable local cluster:

```powershell
npm run database:restore-rehearse -- test-results/hosted-backup/capture-<id>
```

The command accepts no remote restore destination. It requires reviewed private-directory ACLs, starts a loopback-only SCRAM cluster, compares data/schema/security and removes that cluster afterward. If the source changed since capture, take a new checkpoint rather than bypass the mismatch. `supabase/review/hosted-baseline.sql` is a reference, not a migration.

DPAPI archives depend on this Windows profile. A logical database restore does not restore provider settings, Storage files or Auth encryption root keys. Matching rows alone does not prove login/TOTP recovery.

### Retained encrypted checkpoint

`node scripts/retain-hosted-backup.mjs --retain <capture-directory>` retains an approved checkpoint in the private staging `lantern-recovery` bucket using AES-256-GCM and immutable object identities. Vercel's development-only `LV_BACKUP_RECOVERY_KEY_V1` and separate per-checkpoint manifest digest protect recovery independently of this computer.

The retained post-upgrade checkpoint is `capture-FlYXAU`; `capture-tRayff` preserves the older state. The later local `capture-3ziZse` passed restore but has not replaced that full offsite checkpoint. Later game actions use the separate journal below.

`node scripts/retain-hosted-backup.mjs --recover capture-flyxau` retrieves and authenticates the remote checkpoint without relying on a local archive or replacing a key. It saves newly DPAPI-encrypted archives for a disposable restore rehearsal. Preserve both provider accounts, ciphertext, keys and trusted manifest records. Never print decrypted contents.

### Hosted Auth recovery drill

`node tests/hosted/auth-recovery.mjs` creates, checkpoints, removes and restores only its own staging identity, then verifies its original password/TOTP and private API access. The fixture is cleaned up and unrelated accounts compared. This passes with existing provider runtime/root keys intact; it does not establish recovery after losing those keys.

### Game journal

Migrations 007–008 persist ordered game-only events in the same transaction as actions/payments. The app encrypts them into the independent private staging `game-recovery` bucket and verifies retention before acknowledging an outcome. Auth secrets and sessions never enter this journal.

Preserve `GAME_RECOVERY_*` configuration and Vercel's operational `LV_GAME_RECOVERY_KEY_V1`/configuration record. Never rotate keys without retaining access to previous records. `node tests/hosted/game-recovery.mjs` drills outage, retry, data loss and consecutive replay using a disposable fixture without a blockchain transaction.

### Recovery rehearsal and operating procedure

`npm run recovery:drill` uses synthetic local snapshots, not real hosted backups. Actual incident recovery requires:

1. Stop new reviews, actions and result issuance; use the authorized contract pause procedure where needed. Preserve pending transactions and journals.
2. Retain the database checkpoint, later events and independently trusted checkpoint identity. Preserve service configuration and restricted signer recovery separately.
3. Restore to an isolated destination with matching schema/code. Verify hashes, rows, RLS, ownership and provider Auth/key requirements.
4. Reconcile every payment with canonical chain state, randomness and existing signatures. Authenticate the latest complete-transaction marker and consecutive journal events through `readGameRecovery`; review `scripts/game-recovery-replay.mjs` before applying replay SQL.
5. Reconcile account erasure and unsettled rounds, test recovery and review reopening. Never recreate an erased identity or overwrite the working service automatically.

A snapshot cannot prove no later writes occurred; chain receipts cannot reconstruct combat actions. Permanent action loss or loss of both provider recovery capabilities remains an operational limit. Never fabricate a result, refund or replacement payment to work around missing evidence. [Security](SECURITY.md) and [Testing](TESTING.md#release-verification) record the verified scope.
