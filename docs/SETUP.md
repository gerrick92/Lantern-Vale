# Setup and operations

Use Node 24 and npm 11. Run commands from the repository root. The verified environment is Windows x64/PowerShell; WSL is not needed. Foundry's Windows binary is pinned as an optional npm dependency so Linux web builds can skip it. Contract testing on other operating systems needs `forge` on PATH and has not been validated. First compilation may download Solidity 0.8.30.

```powershell
npm ci
Copy-Item .env.example apps/web/.env.local
npm run dev
```

Copy the example only for a new checkout. **Do not overwrite an existing configured environment.** The app listens at `http://127.0.0.1:3000`.

## Windows launcher

After installing dependencies, configuring services and restoring the complete game export, run `npm run launcher:build` once. Double-click **Lantern Vale.exe** in the project root. It uses Node.js 24 and starts the existing Next.js app on `127.0.0.1:3000`; Supabase and Sepolia need no local terminals. It opens Edge after the app responds, preserving the installed MetaMask profile. If the app is already running, it opens that instance instead.

Keep the launcher console open while playing. Ctrl+C or closing that console stops only the server tree it started. An existing server, Edge and unrelated processes remain untouched. A different service on port 3000 produces an error instead of being terminated. The launcher does not install dependencies, change credentials, deploy contracts or run migrations. `npm run dev` remains available and uses Webpack, matching the verified local startup.

The executable is an unsigned local build from `scripts/launcher/Launcher.cs`, with `scripts/launcher/start.mjs` handling prerequisite/startup checks. Keep it beside the repository files; it is not a standalone game or installer. The build uses Windows' installed .NET Framework compiler and downloads nothing. `npm run launcher:check` checks prerequisites without starting services. `npm run launcher:test` builds and tests it without opening a browser.

## Environment

| Variable                                                         | Use                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                       | Public project URL                                                                                                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                           | Public Supabase key, protected by RLS                                                                                  |
| `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`             | Server-only privileged database/test access                                                                            |
| `APP_ORIGIN`                                                     | Exact application origin; required in production                                                                       |
| `SEPOLIA_RPC_URL`                                                | Optional private server RPC                                                                                            |
| `NEXT_PUBLIC_SEPOLIA_RPC_URL`                                    | Browser RPC; must be safe to publish                                                                                   |
| `NEXT_PUBLIC_TOKEN_ADDRESS`, `NEXT_PUBLIC_FAUCET_ADDRESS`        | Verified Sepolia token and faucet addresses                                                                            |
| `DEVELOPER_USER_ID`                                              | Server-only Supabase user UUID allowed to use local developer tools                                                    |
| `NEXT_PUBLIC_GAME_GATEWAY_ADDRESS`, `NEXT_PUBLIC_REWARD_ADDRESS` | Legacy integration addresses; not new settlement configuration                                                         |
| `SEPOLIA_GAME_ECONOMY_ADDRESS`                                   | Server-only candidate settlement address; leave empty until an authorized deployment is verified                       |
| `SEPOLIA_GAME_DEPLOYMENT_BLOCK`                                  | Verified candidate deployment block; bounds payment-ID recovery scans                                                  |
| `SETTLEMENT_SIGNER_URL`, `SETTLEMENT_SIGNER_TOKEN`               | Server-only HTTPS restricted signing endpoint and access credential; leave empty until the game deployment is verified |
| `NEXT_PUBLIC_DEPLOYMENT_BLOCK`                                   | Actual start block for bounded transfer history                                                                        |
| `REWARD_SIGNER_ADDRESS`, `ETHERSCAN_API_KEY`                     | Future authorized deployment/verification configuration                                                                |
| `REWARDS_ENABLED`                                                | Retained legacy release setting; leave disabled                                                                        |
| `RPG_MZ_PATH`                                                    | Licensed local MZ installation, only needed to rebuild game resources                                                  |

Contract fields in the example are intentionally empty. The existing local environment is configured from verified deployment receipts. Do not fill fresh configuration with invented examples or call unconfigured balances zero. Local environment files and database-admin credentials are ignored and must stay out of Git, logs and screenshots.

The claim handler has no environment-private-key signing fallback. Setting a candidate address or legacy reward flag cannot enable paid play; `paidEconomyReady` remains false until the complete security gates pass.

Set `DEVELOPER_USER_ID` only from the intended owner's verified Supabase user ID. Never use a display name or editable user metadata as authorization. The current owner's ID was read through their own authenticated profile endpoint and stored only in the ignored server environment. An empty or malformed value disables developer tools. In development, that verified account sees **Settings → Developer tools**; everyone else gets 404 for `/dev/*`. Production disables these tools for all accounts, including the owner. Do not replace the configured owner with a test fixture to run tests.

## Supabase

The working project now has migrations 001–008, direct email/password registration and TOTP. Preserve its configuration and the user's authenticator. The 25 October promotion checked the exact baseline, retained existing Auth/application rows, verified final permissions and registered migration history in one transaction. Real hosted account/TOTP/RLS/SIWE and account-data checks pass afterward. For a new account-service project, apply all eight migrations in order, disable confirmation emails for this approved testnet demo, set a minimum 12-character password and allow TOTP. All eight source files are frozen; future schema changes require a new migration, including staging-only changes.

### Player registration

The approved flow is **email/password → Google Authenticator → MetaMask ownership link**. Players use the website, never the Supabase dashboard. No Google, Microsoft or GitHub sign-in, personal email sender, new mailbox, billing or paid provider is required.

Both hosted projects were updated on 27 October after a staging rehearsal. The reviewed CLI diff changed only `auth.email.enable_confirmations` from true to false. Undeclared settings, existing users and authenticator factors were preserved. Keep email/password and signups enabled, the 12-character password minimum and TOTP enrollment/verification enabled. Keep Google, Azure and GitHub providers disabled.

Registration returns a Supabase session immediately and opens the authenticator checkpoint. Private pages/APIs require validated server claims, AAL2 and a current verified TOTP factor. Supabase auto-populates `email_confirmed_at`; it does not prove ownership of the entered email. Identity and developer permissions use the account UUID, never an email or player-editable metadata. Existing accounts and passwords continue to work.

**Recovery limit:** save the password and authenticator. No public email sender is configured, so email password reset is unavailable and the reset page sends nothing. Signed-in players can change their password in Settings. Neither an email claim nor an admin bypass is an acceptable substitute for ownership or TOTP. Adding verified-email recovery later needs a separately configured sender and review.

Run `node tests/hosted/registration.mjs --staging`, then `node tests/hosted/registration.mjs` for public signup, duplicate protection, TOTP, repeat-login challenge and existing-account preservation checks. Each creates and removes only its own fixture, stores no credentials and writes a report under `test-results/registration/`. `npm run test:hosted` verifies two ordinary players’ private data, TOTP, developer denial and SIWE with an unfunded ephemeral test wallet. `npm run test:account` uses the actual registration form and rendered QR. These checks do not claim real player-owned MetaMask transactions or public GLOW release.

The unused Google project `lantern-vale` (project number `716961227327`), including its `Lantern Vale Web` OAuth client, was shut down on 27 October with the user's explicit approval. Google displayed "Project is pending deletion" and scheduled deletion after 26 November 2026. This is a confirmed shutdown/deletion request, not proof of permanent erasure before that date. The client was never connected to Supabase; no billing or trial was configured. Microsoft was not registered, and the GitHub form was never submitted. Do not restore or resume those integrations. Supabase accounts, Google Authenticator, MetaMask, Vercel and game contracts were not changed by this cleanup.

### Separate staging service

**Lantern Vale Staging**, project reference `nisviqoxcfbtwccdjqoz`, was created on the Free/Nano plan in London (`eu-west-2`). On 24 October 2026, PostgreSQL 17.11 preflight confirmed zero public tables and zero Auth users. All six exact migrations were applied in one transaction, guarded against a nonempty database and checked for RLS and privileged-function exposure before commit. Thirteen tables and fourteen privileged functions passed both the transaction audit and a subsequent independent audit. Hashes, query identifiers and results are under ignored `test-results/online/staging/`.

`tests/hosted/staging.sql` is a repeatable empty-staging rehearsal. It inserts synthetic fixtures in one transaction, exercises actual database roles/functions/policies, rolls back and verifies no fixture rows remain. Run the entire file only against an approved empty staging service with migrations 001–008; never run individual selections or use the existing account database. SQL-injected assurance claims and synthetic receipt values are not real Auth sessions or onchain evidence. This rehearsal never executes cleanup or deletes a real account.

The staging dashboard SQL application did not populate CLI migration history. The working project separately registered all six migrations during its verified promotion. Do not run a blind `supabase db push` or rerun either project's migrations; compare that project's history with the applied source hashes first. Historical candidate comments inside applied files remain unchanged.

Staging credentials belong in ignored `apps/web/.env.staging.local`, with the staging URL and `APP_ORIGIN=http://127.0.0.1:3002`. This is separate configuration, not a replacement for the working `apps/web/.env.local`. The temporary staging runtime is an ignored source copy under `test-results/online/staging/` with its own environment and Next.js build directory. It is private test infrastructure and must not be distributed or included in reports/archives. Starting it does not enable paid play or configure a developer owner.

Staging Auth now has a minimum password length of 12, Site URL `http://127.0.0.1:3002` and the exact redirect `http://127.0.0.1:3002/auth/callback`. TOTP remains enabled; confirmation emails were disabled on 27 October for direct registration. The remaining settings were saved and verified on 24 October. `npm run test:staging-config` creates one disposable account, checks redirect selection and the password boundary, and removes its fixture. It loads only the reviewed staging environment, sends no emails and logs no credentials or authentication links. Public inbox delivery and operational recovery remain unverified.

### Existing-database upgrade rehearsal

Run `npm run database:rehearse` to test the 001/002 → 006 upgrade entirely in memory, with synthetic existing accounts, wallet links, adventures, actions, large legacy claims and payment tombstones. It verifies preservation, RLS/MFA, replay rejection and rollback after a failed check. It does not load environment files or contact Supabase.

Run `npm run database:review` to generate a rollback-only SQL review and integrity manifest in a new ignored `test-results/database-upgrade/review-*` directory. The generator verifies the exact LF-encoded migration bytes against `supabase/applied-migrations.json`; applied files must not be edited. A new migration requires a newly reviewed plan. No apply mode exists and no SQL is submitted by this command.

The generated SQL is for an **approved isolated clone of the existing 001/002 database**, after a verified backup and during a maintenance window. It takes exclusive locks on the existing app tables with bounded waits. Run the complete file, never individual selections. Schema and effective grants are compared with the reviewed local reference, each existing app row is compared inside the transaction without returning private data, and existing rounds must remain `legacy`. Successful execution ends with `ROLLBACK` and checks the original schema is restored. On any error, explicitly roll back the session and investigate; never replace rollback with commit to bypass a failed check. A partial/already upgraded schema or permission drift is rejected. Provider extensions or PostgreSQL catalog differences may also require manual review; a mismatch is not authorization to remove the guard.

This prepares a clone-only upgrade review. A separate `scripts/promote-database.mjs` command performed the authorized working-service promotion after the fresh native restore and encrypted off-host checkpoint passed. It validates the 001/002 baseline, preserves Auth/application records in a repeatable-read transaction, applies the exact reviewed 003–006 sources, verifies final schema/permissions and registers all six migration sources. It rejects drift and an already registered history; do not rerun it against the upgraded service. Auth uses read-only locks because its tables belong to the provider. Paid release remains disabled.

### Encrypted hosted backup and local restore

On Windows, `npm run database:backup` captures Lantern Vale Sepolia read-only using the existing ignored `.env.supabase-admin` file's `SUPABASE_DB_PASSWORD`. It checks the configured project, pins the observed session-pooler endpoint and verifies TLS with the reviewed Supabase CA. It never prints the password or raw database diagnostics. Do not replace these credentials with a login password, API key or another project's password.

The portable PostgreSQL 17.11 tools live under `.tools/postgresql-17.11/runtime/pgsql/`; no Windows service or system installation is needed. The [official Windows download page](https://www.postgresql.org/download/windows/) links the EDB binaries. The downloaded `postgresql-17.11-5-windows-x64-binaries.zip` has SHA-256 `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`. The dashboard's [Supabase CA certificate](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt) is saved as `.tools/postgresql-17.11/supabase-ca.crt`, SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. Review new versions/certificates before changing these pins. See [Supabase TLS guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).

Each capture creates a new ignored `test-results/hosted-backup/capture-*` directory with a custom-format database dump, password-free role definitions and a hash manifest. Database/role contents pass through memory and are saved only under Windows DPAPI CurrentUser encryption. Read-back decryption and archive validation must pass. Commands reject child errors, oversized output above 256 MiB and timeouts; they do not silently create partial backups.

Run `npm run database:restore-rehearse -- test-results/hosted-backup/capture-<id>` with an actual successful capture directory. The command accepts no remote restore destination. It requires `.tools/private` to have inheritance disabled and access limited to the current Windows user and SYSTEM, with full inheritable access for that user. The current workspace is configured; another checkout must establish and review those ACLs first. A fresh SCRAM-protected PostgreSQL cluster listens only on loopback. It restores `auth`, `public` and `supabase_migrations` tables, roles, ownership, grants and the reviewed RLS event trigger: 41 tables after promotion, compared with 36 in the old baseline. Row hashes/counts and app security definitions are compared with the live source without returning account records. If the source changed since capture, comparison fails; take a new checkpoint rather than bypassing it.

The reviewed `supabase/review/hosted-baseline.sql` is a local reference, **not a migration**. It preserves the inspected automatic RLS helper exactly. Fingerprints use deterministic ordering and verify NOT NULL through column nullability across PostgreSQL 17/18. The upgrade runs as `postgres`, preserving source database ownership/default-grant behavior. Native PostgreSQL requires a temporary local superuser attribute to assign the existing event-trigger owner; it is removed inside that transaction before commit. No hosted role is changed. Migrations 003–006 run only on the clone, check existing records and permissions, then roll back. The clone is stopped and removed; an encrypted clone dump, rollback-only SQL and PASS/FAIL/BLOCKED report remain in a new `rehearsal-*` directory.

This establishes a real database capture and **local logical restore**, not a recovered Supabase Auth service. Provider extensions, Storage object files, settings and encryption root keys are not restored. Auth rows matching does not prove a restored Auth server can issue sessions or decrypt TOTP factors. The local DPAPI copy requires this Windows profile/machine. The separate retention procedure below removes that dependency for its retained checkpoint. Hosted Auth restoration and later game-action recovery now have separate successful drills; this capture command alone proves neither. Live settlement/signer-outage acceptance remains open. Capture/restore commands never migrate the source. See [Supabase backup/restore boundaries](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### Retained encrypted checkpoint

`node scripts/retain-hosted-backup.mjs --retain <checkpoint-directory>` retains an approved capture in the existing free Lantern Vale Staging project's private `lantern-recovery` Storage bucket. The current post-upgrade checkpoint is `capture-FlYXAU`; `capture-tRayff` preserves the pre-upgrade state. Each database/role archive is encrypted in memory with AES-256-GCM, a fresh nonce and authenticated object identity. Uploads never overwrite existing objects. No plaintext database or recovery key is saved in the source checkout.

The independent recovery key is `LV_BACKUP_RECOVERY_KEY_V1` in the existing Lantern Vale Vercel project's **development-only encrypted** environment. It is deliberately recoverable by authorized project administrators, not an application/browser setting. A separate per-checkpoint variable retains the manifest SHA-256. Preserve these variables and both provider accounts; deleting either provider's retained data/key breaks recovery. No paid storage, public bucket, automatic retention job or new account was created.

The retention check discards the original encryption key, retrieves it through the already authorized official Vercel CLI, downloads the cloud ciphertext, decrypts it, validates its digest/archive format, and verifies anonymous/public-URL access is denied. `offsite.json` contains only checkpoint metadata. For recovery, configure the authorized CLI and staging service access on Windows, then run `node scripts/retain-hosted-backup.mjs --recover capture-flyxau`. The lowercase identifier names the remote checkpoint. This mode reads no local backup and never creates or replaces a recovery key. It authenticates the cloud manifest against the separate Vercel digest, validates exact project/object paths and hashes, decrypts in memory and saves only newly DPAPI-protected archives to a fresh capture directory. Run `npm run database:restore-rehearse -- <new-directory>` for a disposable native restore; it never restores over the working service. The 25 October cloud-only recovery produced `capture-lb9eOB`, and its `rehearsal-0Ny2XF` matches all 41 account/application/migration tables and all six immutable migration sources. This verifies cloud-file recovery and local restore; hosted Auth restoration and changes after the checkpoint remain separate checks. Never print credentials, archive data or the key.

### Hosted Auth recovery drill

`node tests/hosted/auth-recovery.mjs` runs only against the reviewed staging project and accepts no target/user arguments. It creates a disposable confirmed identity and TOTP factor, saves an encrypted fixture checkpoint, removes that fixture, restores its four Auth/profile tables, then verifies fresh password login, the same authenticator and AAL2-protected profile access. It removes the fixture afterward and compares unrelated Auth identities, factors and profiles. No email is sent and no existing account is deleted or restored.

The 26 October run passes under `test-results/auth-recovery/hosted-3Ew6yB/result.json`. The test uses the authorized CLI and the ignored staging environment; private SQL output is suppressed. Its temporary SQL files contain only the synthetic fixture's restore data and are removed after each query. The retained fixture checkpoint is Windows-DPAPI encrypted. This tests the existing hosted Auth runtime with its provider keys intact, not a replacement project's keys or recovery of later game actions. Preserve the provider accounts and keys; [Supabase's restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) describes the separate encryption-key boundary.

### Account data and maintenance

Settings → Account data provides a private JSON download and an explicit, cancellable deletion request. Migration `202610240006_account_data.sql` and its 003–005 dependencies are now applied to the working service. Hosted checks confirm export, request/cancellation and account isolation. Existing profile, authentication and wallet features continue working.

Exports use a consistent database statement snapshot and include the current account's profile, contacts, wallet binding, adventure/action history, payment reviews/receipts and result summaries. Token amounts and large chain numbers are strings. Authentication secrets, sessions, SIWE messages and raw signatures are excluded. Device preferences/practice saves are browser-local. A request exceeding 10,000 history records or an 8 MiB database payload fails explicitly and needs an operator-assisted export; it never silently drops records. Downloaded files contain private data and should not be committed or shared as test evidence.

Deletion requests do **not** erase data or disable the account automatically. The user types `DELETE`, can cancel, and sees whether adventure/payment records require review. An open payment review remains unresolved even after its deadline; a victory/defeat or cached signature is not proof of settlement. No automated Auth deletion endpoint, notification service or deadline promise has been introduced. Before fulfilling a request, an operator must reauthenticate/confirm the user's intent, prevent new writes, reconcile all deposits and pending transactions at canonical Sepolia state, preserve replay tombstones, and review the backup-retention process so a restore cannot resurrect deleted private data. The actual Auth deletion/retention procedure still needs staging review. Do not manually delete private rounds to make a request appear clear. Public blockchain records cannot be erased.

Cleanup is a service-only SQL function, with no public endpoint, cron job or automatic execution. It is restricted to wallet challenges expired for more than 24 hours and rate-limit rows older than two days. Each table has an independently bounded batch of 1–1,000 rows (default 500), with locked rows skipped. It never touches accounts, deletion requests, wallet links, adventures, actions, payment reviews, receipts or settlement results. In an approved staging maintenance session, preview with:

```sql
select public.cleanup_account_ephemera(); -- Dry run; counts are capped per table.
```

Only after reviewing the preview and authorizing that environment's cleanup, use `select public.cleanup_account_ephemera(true, 500);`. Repeat bounded batches until a dry run returns zero; this does not expire payment reviews or authorize another charge. No hosted cleanup has been run.

## Candidate signing and randomness

The restricted signer is implemented in `supabase/functions/settlement-signer/`. It is **deployed and enabled for controlled owner acceptance** in Lantern Vale Sepolia. The original recovered key and separate service credential are installed in provider Secrets; no paid service or replacement signer was created. Five downloaded source files match exactly. Anonymous, incorrect and project-publishable credentials receive 401; browser origins receive 400; the authorized caller receives 400 for a malformed result, proving the restricted service is active without signing test data. The verified game economy address is now bound in provider Secrets and the local server environment; no settlement is issued. [Deployment evidence](../deployments/supabase-signer.json) and [provisioning evidence](../deployments/signer-provisioning.json) record these checks.

`node scripts/prepare-signer-deployment.mjs` creates a fresh public source bundle and SHA-256 record under ignored `test-results/signer-deployment/`, using the pinned Deno import map. The current review bundle is 14,843 bytes; the live deployment uses the five original pinned source/configuration files, independently downloaded and compared byte-for-byte. It reads no secrets and deploys nothing. Type-check the original source and Deno bundle before any subsequent deployment.

The candidate uses Supabase's Deno Edge Function runtime, independently of Vercel. `deno.json` pins its imports and `deno.lock` records dependency integrity. `npm run typecheck:signer` checks the source with TypeScript; `deno check --config supabase/functions/settlement-signer/deno.json supabase/functions/settlement-signer/index.ts` checks the actual Deno entry point. `npm test -- tests/server/signer-service.test.ts tests/server/signer-runtime.test.ts` runs the policy, adapter and failure tests with unfunded ephemeral fixture keys. None of these commands deploys a service or reads player keys.

### Existing signer custody

The public signing address is `0xfeA1f112afC1906E3317597323Eb175993971Ca9`; [custody evidence](../deployments/signer-custody.json) records its verified recovery. `node scripts/signer-custody.mjs --verify` retrieves the encrypted object from the existing private staging bucket and its separate wrapping key/trusted identity through the authorized Vercel CLI. It authenticates the envelope, checks role separation, proves possession with a non-settlement EIP-191 challenge and verifies anonymous/public access denial. It returns only public metadata. No local plaintext key, player wallet, chain transaction, function provisioning or activation is involved.

`--prepare` was used once to create this custody. Subsequent runs verify the existing key; partial provider state causes a stop rather than silent replacement. Preserve `LV_SIGNER_RECOVERY_KEY_V1`, `LV_SIGNER_CUSTODY_V1` and the matching encrypted object. These two Vercel variables are development-only operational recovery records, not web-app signing configuration. Both provider accounts remain recovery dependencies. Never remove or rotate custody while outstanding deposits/results depend on that signer. The existing key was installed in Supabase Secrets on 26 October using approved CLI access. `LV_SIGNER_SERVICE_TOKEN_V1` is a separate encrypted, development-only Vercel operational recovery value for the service credential. Never regenerate the signing key as a setup retry.

Reviewed provisioning must supply these **provider-held Edge Function** settings (never browser or application key storage):

| Setting                                      | Purpose                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `LV_SIGNING_ENABLED`                         | Absent/false keeps the function inert, without reading a key or contacting services                                             |
| `LV_SIGNER_PRIVATE_KEY`                      | Existing recovered, separate reward-signing key in provider Secrets; never an owner/player key, browser variable or source file |
| `LV_SIGNER_TOKEN`                            | Independently generated random service credential, at least 32 base64url characters                                             |
| `LV_ECONOMY_ADDRESS`                         | Verified settlement contract address, after authorized deployment                                                               |
| `LV_TOKEN_ADDRESS` / `LV_FAUCET_ADDRESS`     | Verified token and recycling faucet addresses                                                                                   |
| `LV_SEPOLIA_RPC_URL`                         | HTTPS Sepolia RPC endpoint without inline URL credentials                                                                       |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Provider-supplied access to the matching authoritative game database                                                            |

Only the function URL, bearer credential and public signer address belong in the application's server environment. The plaintext private key never goes to Vercel or the application; Vercel holds separately scoped recovery material and the server bearer credential, never the plaintext signing key. `supabase/config.toml` specifies disabled gateway JWT validation **only for this function**, because the handler requires its own server credential; ordinary user JWTs cannot authorize it. This reviewed configuration is applied, and live custom-credential isolation passes while controlled signing is enabled. Do not deploy with an alternative handler or remove that credential check.

The function checks the fixed chain/domain/type, pinned contract/token/pool, confirmed escrow, current signer, separation from both ownership roles, persisted terminal result, class, deposits and expiry. Before returning a signature it rechecks the canonical block and current signing/ownership roles. A compact database projection avoids imposing a spending limit through growing logs. It does not independently replay combat or reverify all beacon/payment proofs: those remain the Next.js server's responsibility. Database and RPC integrity therefore remain trusted. Provider secret storage is software key custody, not an HSM or proof against a compromised operator.

Supabase advertises a free Edge Functions allowance; confirm the existing project's free limits before any provisioning. Encrypted key custody and independent recovery are now verified. Provider-secret installation and disabled endpoint isolation pass. Paused-contract rotation, outage recovery and durable database recovery still require an actual staging drill. No deployment command is run by the app build, test runner or packaging scripts. [Provider dependency guidance](https://supabase.com/docs/guides/functions/dependencies) and [function pricing](https://supabase.com/docs/guides/functions/pricing) are the platform references.

The public drand quicknet adapter needs no account, API key or subscription. It uses fixed HTTPS relays, a pinned public key and `drand-client` signature verification. Entry and NPC outcomes may wait about a minute after the payment block; recover the existing payment to retry. A relay outage cannot authorize a replacement draw or a second charge. The independent threshold beacon is an external trust/availability dependency; it is not an onchain randomness contract. See the [drand developer guide](https://docs.drand.love/developer/) and [client source](https://github.com/drand/drand-client).

On 22 October 2026 the existing Supabase organization display name was changed to **Lantern Vale** and the project to **Lantern Vale Sepolia**, then verified in the dashboard. The project reference, database, membership and authenticator were preserved.

Set the site URL to the application origin and allow `/auth/callback` on that origin. The local values are `http://127.0.0.1:3000` and `http://127.0.0.1:3000/auth/callback`. Add the actual HTTPS host before release. Dashboard SQL execution does not automatically populate CLI migration tracking; do not rerun applied migrations blindly.

The default Supabase sender is not used by new-player registration. Confirmation emails are disabled for the explicitly approved testnet demo. Email password reset is unavailable; authenticated password changes remain supported. The previous Brevo/personal SMTP and social-provider plans were superseded on 27 October. Do not continue those setups or purchase a domain/service. See [player registration](#player-registration) for configuration and limits.

Sign in, choose **Set up authenticator**, scan the QR in Google Authenticator or use the expandable manual key, then enter the current six-digit code. Never share the QR/key/code. Email/password identity, wallet connection and signed wallet ownership are separate steps.

## Recovery rehearsal and operating procedure

Run `npm run recovery:drill` from the original repository. It uses in-memory PostgreSQL fixtures with migrations 001–008, takes physical snapshots, closes the original instance and restores into a fresh instance. Reports, immutable snapshot directories and integrity manifests are written under ignored `test-results/recovery/`. No environment file, hosted database, real Auth data, user wallet or external signer is used. These artifacts contain synthetic records only; the helper rejects a real Auth schema and database role passwords. They are not backups of the configured Supabase project.

The helper checks source fingerprints, archive hashes, exact record inventories and restored security definitions. Callers must pause writes before capture; before/after inventories are an additional check, not a substitute for stopping writers. Restore accepts a separately retained expected checkpoint digest and never overwrites an existing database. The three paid-journey tests resume after an entry awaiting its beacon, a committed purchase with a lost response, and a persisted signed result. They recheck canonical-chain fixtures and reuse the same payment rather than charging again.

Before paid release, an operator must demonstrate the following against an approved staging service:

1. Disable new payment reviews, game actions and result issuance, then pause the settlement contract through its authorized owner procedure. Preserve payment journals, pending reviews and public receipts. Never clear a pending payment to work around an outage. Any transaction or signature already issued still needs reconciliation.
2. Retain a verified database backup and the recoverable changes since it, together with a separately protected record of the latest trusted checkpoint. Cover Auth identities/factors, profiles, wallet links, rounds/actions/versions, reviews, both payment ledgers, randomness proofs and signed results, plus schemas, grants, functions, triggers and RLS. Back up service configuration and restricted signer recovery through their reviewed secret-management procedures, separately from application artifacts. Do not export player keys or seed phrases.
3. Restore to an isolated staging destination with matching code/schema versions. Validate hashes, row counts, ownership, permissions and constraints before connecting an application. Reconcile Auth identities, outstanding sessions/factors and deleted-account tombstones; an old backup must not resurrect a deleted account. Do not restore directly over the live service or automatically reapply migrations.
4. Reconcile every pending review and receipt against canonical Sepolia transactions, payment IDs, deposits and settled rounds. Reverify randomness and cached signatures, including current signer and expiry. Recover unpaid expirations or already-paid registration through the existing reviewed paths; never fabricate receipts, outcomes or refunds. Independently recover all acknowledged actions after the checkpoint before accepting new actions.
5. Demonstrate isolated entry/purchase interruption, won/lost rounds, replay rejection and signer outage/rotation recovery. Record the recoverable checkpoint time, missing interval, restore duration and operator approval. Only then review reopening payment acceptance. Keep unresolved rounds blocked rather than rewinding them or changing their result.

**A snapshot and its matching manifest cannot prove that no later writes occurred.** Chain receipts also cannot reconstruct offchain combat actions. Permanent loss of those actions remains a release blocker, even if all deposit totals match. The local drill demonstrates exact-checkpoint restoration, not zero data loss, provider backup availability, point-in-time recovery, signer recovery or a recovery-time guarantee. Encrypted off-host checkpoint retention and a separate game-only journal are now implemented and drilled. The game journal excludes Auth data; total provider/root-key loss remains outside the verified scope. No paid backup service has been selected or purchased. The private review ZIP is application source/runtime, not a database backup.

## Wallet and release

MetaMask is already installed in the user's Edge browser with Sepolia selected. The user confirmed that connection persists and that the account/wallet ownership link works. New users link in Settings with their own signature; automation must not sign for them. Sepolia ETH pays gas; the GLOW faucet does not supply ETH. Obtain test ETH through an appropriate Sepolia faucet without disclosing a seed or key.

GLOW is deployed on Sepolia at `0x5833635b652e3b93d39e0895b9c82891c6bb626b`; its faucet is `0xb0bbbdcbde6d89f40208641d608f22a3f1352bfa`. All three canonical receipts, compiled inputs, live configuration and the exact 5,000-GLOW funding event were independently verified on 22 October 2026. [Public evidence](../deployments/sepolia.json) records the hashes and checked block. The user's [first five-token claim and cooldown](../deployments/sepolia-faucet-claim.json) passed, and [Sourcify verified both sources exactly](../deployments/sepolia-source-verification.json). Etherscan's mirror hit a submission quota and Blockscout reported unable to verify; neither mirror is verified. Separate-wallet claim/transfer testing remains pending. No public application is deployed. The legacy Solidity deployment script remains disabled; paid contracts remain blocked under [Security](SECURITY.md).

### Token/faucet deployment

The completed token/faucet deployment must not be repeated to add paid gameplay. After a separate public signing address and a whole-GLOW bonus reserve have been reviewed, `node scripts/prepare-game-deployment.mjs --signer <public-address> --bonus <whole-GLOW>` prepares an unsigned **paused** economy deployment review under `test-results/game-deployment/`. It reads the existing public deployment record, checks Sepolia at a confirmed block, token ownership/pending ownership, the faucet's token, deployed code, signer separation and remaining mint capacity. The constructor data and choices are fingerprinted; no key, signature, broadcast, unpause or environment change is involved. Funding remains a description until the new contract has a verified deployment receipt, so there is no placeholder recipient. The command does not satisfy the recovery, provisioning or authorization gates below; `--help` is safe without configuration. The saved review uses the recovered public signer `0xfeA1f112afC1906E3317597323Eb175993971Ca9` and a 100-GLOW reserve. Both transactions were subsequently authorized by the user, confirmed in MetaMask and independently verified. Preserve that plan and the completed journal.

#### Paused game contract review

`deployments/game-economy-plan.json` preserves that public unsigned proposal. **Settings → Developer tools → Game contract review** opens `/dev/deploy/game`. The page and its `/verify` POST endpoint enforce the existing development-only, exact-account, active-account and current TOTP/AAL2 guards. The POST also requires the application Origin and a strict bounded body. They load the compiled contract only after authentication and reject a plan that differs from the public token/faucet record, signer custody address, compiled creation artifact or configured token/faucet. Updating a proposal means reviewing and replacing this public file with a fresh generated plan, not editing a receipt or clearing the original deployment journal.

The page provides an unsigned-plan download, public receipt verification and a guarded browser transaction sender. The user authorizes deployment and reserve funding separately and confirms each in MetaMask. Server preparation revalidates the plan and chain before each step; the browser checks the wallet, fees and saved journal. Explicit estimated EIP-1559 fees are sent to MetaMask. Interrupted submissions must be reconciled rather than resent. The original token/faucet journal is separate and unchanged. No private key is requested or loaded by these tools.

**Deployment completed on 26 October:** the game contract at `0x9bd16131Ec0E61c92ee3E6E8e8EA8F61a17519Eb` was deployed paused and funded with the authorized 100-GLOW initial reserve. It has since been unpaused for controlled owner acceptance, with the restricted signer enabled; owner entry, purchase and full-clear settlement are verified. The original reserve is historical funding, not a current balance. Preserve its existing journal, [deployment receipts](../deployments/game-economy.json) and [activation record](../deployments/game-activation.json); do not redeploy. Its exact creation/runtime sources match on [Sourcify](https://repo.sourcify.dev/11155111/0x9bd16131ec0e61c92ee3e6e8e8ea8f61a17519eb). Public activation remains subject to the remaining security checks.

After the separately authorized transactions exist, run from the repository root:

```powershell
node scripts/verify-game-deployment.mjs <deployment-hash>
node scripts/verify-game-deployment.mjs <deployment-hash> <funding-hash>
```

Both the owner page and CLI use a fresh confirmed Sepolia snapshot. They require two confirmations, exact payer/zero ETH/calldata, canonical receipts, the sender/nonce-derived created address, compiled runtime matching outside compiler-declared immutable slots, and the exact signing domain and token/faucet/signer/owner roles. The contract must remain paused with no played rounds, escrow or reserved player bonuses. Before funding, its balance must be zero and the proposed reserve must fit the remaining cap. After funding, the exact mint event, recipient and amount must match; current balance and available bonus pool must equal that initial reserve. Unexpected funds require reconciliation. Every inspected block is checked again before returning PASS.

The first check returns unsigned funding data only for the verified new contract. The second confirms funding. Neither is authorization, source publication, finality or paid activation. The CLI writes a public report under `test-results/game-deployment/verified-*`; it has no `--apply` option and never changes environment addresses. Explorer source verification, live signer/recovery drills and paid/nonowner journeys remain separate gates.

#### Existing token/faucet receipts

The existing deployment journal has completed all three steps and the verified addresses are configured locally. Preserve the journal and report; do not start another deployment. Earlier partial reports are historical snapshots, not current balances.

1. Run `npm run contracts:build` and `npm run contracts:test`. Keep the reviewed artifacts unchanged throughout deployment.
2. In the user's MetaMask browser, sign in with TOTP and open `http://127.0.0.1:3000/dev/deploy`. Review the selected Sepolia owner and the three steps: token, faucet, 5,000 GLOW funding. No private key is exported or stored.
3. Choose **Resume and verify saved receipts** before a new session. Authorize the plan, estimate each transaction, then choose **Review next transaction in MetaMask**. The user confirms each transaction. Wait for two canonical confirmations before continuing.
4. Download the public receipt report. Preserve the journal and report; an ambiguous request must be reconciled against MetaMask Activity before retrying. Do not clear browser storage or change wallet/build midway.
5. Run `node scripts/verify-deployment.mjs <report.json>` for independent read-only checks. Only after these pass, run the same command with `--apply` to save verified addresses in the existing ignored environment and a public `deployments/sepolia.json` report. Restart/rebuild the app. This verifier never broadcasts or enables paid play.
6. Review the source-verification evidence; the current contracts have exact Sourcify matches. From a separate nonowner wallet, claim five GLOW, verify the balance/receipt and cooldown, then transfer to another wallet and verify both balances. The owner's successful claim does not establish this separate-wallet journey.

This stage mints 5,000 tokens entirely to the faucet; the earlier 100,000-token allocation is not used. A funded faucet transfers tokens rather than minting per claim. Future reward funding requires a separate reviewed plan. The faucet cannot supply gas ETH.

A Next-capable host must include server routes, configured origins/secrets and the **complete MZ export**. A source-only checkout omits licensed runtime assets until they are rebuilt or supplied in an approved finished-game artifact. Static-only hosting cannot serve this backend.

## Vercel hosting

The complete app has passed a protected cloud review on the existing Hobby project. The review uses the separate Staging database, deployment-specific server credentials and an exact Vercel HTTPS origin. Registration, QR/TOTP, private APIs and responsive private pages pass. See [the current review](REVIEW.md#protected-cloud-review--27-october-2026). It is not the public GLOW release.

For another protected upload, first obtain approval for Vercel protection on **all deployments**. The default policy protects deployment URLs but can leave automatically created project aliases public, even with `--skip-domain`. `node scripts/deploy-review.mjs` performs a dry run against a freshly verified package and refuses that weaker policy. Add `--deploy` only for an authorized upload. It supplies credential values through the official CLI's private process environment, not arguments or package files. The staged-review flag never opens GLOW or developer routes.

The initial review's automatically created alias was removed. Its deployment URL requires Vercel sign-in, and both project domains return 404. Production needs its own reviewed connection, explicit HTTPS `APP_ORIGIN`, Supabase URL configuration and completed security gates before assigning the public domain.

The user selected **Vercel** on 25 October 2026. The original assignment permits either GitHub Pages or Vercel. Keep the existing Next.js application, Route Handlers, Supabase services and Sepolia contracts. GitHub remains the source repository; GitHub Pages cannot run this application's cookie-based authentication, request validation or privileged server routes. No static-export conversion or additional backend is planned.

Vercel's [Next.js support](https://vercel.com/docs/frameworks/full-stack/nextjs) and [Node 24 support](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) match the existing stack. The [Hobby plan](https://vercel.com/docs/plans/hobby) is free for personal, noncommercial projects and has usage limits. Use it for the personal Sepolia demonstration only while those terms apply. Do not start a paid trial, buy a domain, enable paid add-ons or upgrade. The free Lantern Vale workspace and project are configured; CLI authorization is verified. No working deployment or Git remote exists.

**The user authorized publication of the finished app; incomplete publication remains deferred.** The first requested preview was assigned to production by Vercel and failed during compilation; it never became ready. Vercel's first-successful-deployment behavior prevents the intended preview-only start. A proposed static production placeholder was not approved and was not published. Do not use a placeholder or remove the application target guard to bypass this decision. Review the production target guard only when the finished app meets its release gates. Current project: `prj_e6pw3goMLbaj0PzAfYiTky6DgUib`, workspace `lantern-vale`; standard Vercel authentication protects preview deployments.

Official Vercel CLI 65.2.0 is installed locally under ignored `.tools/vercel`, without changing app dependencies. Invoke its `dist/index.js` through Node with `--global-config` pointing to the absolute `.tools/private/vercel` directory and `VERCEL_TELEMETRY_DISABLED=1`. That private configuration must never enter an upload package. The user has approved the CLI device request; verify the account/scope through the official CLI before resuming setup. Do not create or print personal access tokens as a shortcut.

### Build and upload source

When the finished app meets its release gates, deployment must use a **fresh verified private release package**, not a CLI upload of the working checkout. Run `npm run release:package`, then verify the untouched directory with `node scripts/verify-package.mjs <directory>`. The package includes the complete finished MZ game and its notices, plus `apps/web/vercel.json` and the hosted-game check. It excludes local environments, database backups, sessions and editor asset libraries. Do not copy any environment file into the upload directory. Add approved environment values privately in Vercel instead.

After the account/project setup and distribution review, link only that clean package to the intended Vercel project. Keep the generated project-link directory local and ignored. Use these project settings:

| Setting                                                       | Value                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| Plan                                                          | Hobby, personal noncommercial demonstration                   |
| Framework                                                     | Next.js                                                       |
| Root Directory                                                | `apps/web`                                                    |
| Include source files outside Root Directory in the Build Step | Enabled; shared rules and the npm workspace are above the app |
| Node.js                                                       | 24.x                                                          |
| Install command                                               | `npm ci --include=dev --include-workspace-root`               |
| Build command                                                 | `node ../../scripts/verify-hosted-game.mjs && npm run build`  |
| Output directory                                              | Next.js default `.next`; do not set `out` or a static export  |

The [monorepo source option](https://vercel.com/docs/monorepos/monorepo-faq) is required. The install command explicitly includes the workspace root: an actual cloud build otherwise omitted root build dependencies, including Tailwind PostCSS. `next.config.ts` traces runtime dependencies from the workspace root. The Windows-only Forge binary is optional; no contract build, deployment or SQL migration runs during the web build. The hosted-game check rejects missing/altered game files, enabled local practice, an unreviewed paid release and any Vercel target other than preview. It works after dependency installation, unlike the strict untouched-package verification. Review this target guard explicitly when approving a future production application release.

An automatic GitHub import alone is currently insufficient: the finished MZ export is deliberately ignored in Git. Keep automatic source-only deployment off until a reviewed build-artifact workflow supplies that exact export. Do not force-add raw MZ libraries to the public repository to work around this. Initial verified-package deployment and later source publication are separate steps.

### Environments and origins

Use staging Supabase credentials only for a preview environment, and the existing Lantern Vale Sepolia credentials only for the separately reviewed production environment. Store the privileged Supabase key as a server-only secret, never in `NEXT_PUBLIC_*`, the repository, upload package, command line or build log. Preserve the working local environment and authenticator.

Nine preview variables are configured. The user explicitly approved transferring the existing staging key to Vercel's sensitive Secret storage. A metadata-only audit confirms that key is preview-only, production has zero variables and no signer or developer-owner settings are present. `APP_ORIGIN` remains unset until an actual approved application hostname is available; no Supabase callback was changed. The assigned production domain currently has no ready application.

Configure the existing variables from the Environment table above. Set the public Supabase URL/publishable key, verified token/faucet addresses and deployment block; set the server-only Supabase key and exact HTTPS `APP_ORIGIN`. Public variables are baked into the build, so changing them requires a rebuild. Leave settlement addresses and signing credentials unset, `REWARDS_ENABLED=false`, and `DEVELOPER_USER_ID` unset. Developer tools remain unavailable to everyone in production builds.

After Vercel assigns a real stable hostname, set `APP_ORIGIN` to that exact origin and add its exact `/auth/callback` to the corresponding Supabase redirect allowlist. For the final production hostname, update Site URL after review while preserving the approved local callback. Never invent a hostname, accept arbitrary preview origins or use a wildcard callback. If a preview uses a different hostname, configure and test that specific origin before authenticated mutations; do not weaken `checkOrigin`. Users may need to sign in and approve the wallet connection on the new origin. Existing Supabase accounts, TOTP factors and wallet ownership records stay in their current project.

### Release boundary and verification

A hosted preview can verify the site, authentication and faucet while paid play remains closed. It is **not a completed playable public release**: packaged practice is intentionally disabled, and real GLOW play still needs every gate in [Security](SECURITY.md). Email/password registration and TOTP pass against the configured services. Published-origin registration/sign-in, final game-asset distribution review and the separate-wallet journey remain outstanding.

Before promoting an approved deployment, verify HTTPS, headers, exact-origin rejection, email/password registration, sign-in/TOTP, private account ownership, SIWE domain binding, canonical Sepolia balances and faucet receipts. Verify `/dev/*` returns 404 and no paid action is accidentally enabled. Test the actual cloud build and runtime; a Windows build or npm Linux-target dry run is only local preparation evidence. Record the actual deployment URL and results, never a guessed URL.

Once deployed, Vercel serves the application and Supabase stores accounts/data without this PC running. The encrypted off-host checkpoint now uses private staging Storage and a separate Vercel-held recovery key. A separate disposable staging drill verifies password/TOTP after restoring Auth rows with the existing provider keys. Later game actions pass the separate hosted journal recovery drill. Owner activation and a real full-clear payout are complete; the broader live lifecycle and signer-outage checks remain open.

## Production locally

### Private review package

Run `npm run release:package` on Windows after `game:verify` succeeds. It creates a new directory, a ZIP and `test-results/release/latest.json`; existing output is never overwritten except the latest-report pointer. The explicit allowlist includes application source, shared rules, pinned package metadata, empty environment placeholders, public deployment evidence, candidate contract/SQL sources, documentation and all 220 finished-game files. It excludes local environments, credentials, sessions, build caches, node_modules and MZ editor/source asset libraries.

The packaged practice flag is false and the paid gate remains false. Only the package's copy changes; local practice and the original cave remain untouched. The bundle README describes application installation/build/start and verification. It is a private review handoff, not public deployment authorization. Verify a fresh extraction using `node scripts/verify-package.mjs` before installing or building; those later steps intentionally create files outside the manifest. No migration or deployment runs automatically. The original repository remains the source for tests and game authoring.

All files have SHA-256 hashes and byte lengths. ZIP entries have sorted paths and fixed timestamps for reproducibility on the same toolchain. The credential scan covers common private-key/JWT/Supabase formats and nonempty environment placeholders; it is not a universal secret detector. Final distribution review remains required under [Assets](ASSETS.md).

### Running the build

```powershell
npm run build
npm start
```

Stop the development server first if reusing port 3000. The Webpack build is intentional: the Turbopack native worker previously failed on this Windows machine. `npm run test:production` instead uses temporary port 3001 and stops only its own server. See [Testing](TESTING.md).

## Controlled GLOW acceptance and game journal

Migrations 007 and 008 are applied to both services and pinned in `supabase/applied-migrations.json`. No migration runs at app startup. The latest encrypted local database checkpoint is `capture-3ziZse`; its isolated restore passed. Its new full offsite upload was blocked by automatic approval review, so the existing retained checkpoint remains unchanged. The separately approved game-only journal is already hosted.

`GAME_RECOVERY_URL` points to the independent Staging project. `GAME_RECOVERY_SECRET`, `GAME_RECOVERY_KEY` and `GAME_RECOVERY_STREAM` are server-only configuration. The private `game-recovery` bucket contains AES-256-GCM records bound to project, stream, account and sequence. The existing free Vercel project retains `LV_GAME_RECOVERY_KEY_V1` and its configuration record; these are operational development secrets, not browser variables or upload-package contents. Never rotate the encryption key without retaining access to previous records.

`node tests/hosted/game-recovery.mjs` creates only a disposable Staging fixture. It uses a synthetic contract identifier, makes no onchain transaction, simulates an archive outage and game-data loss, replays the checkpoint plus later actions, then removes the fixture. Public replay tombstones remain, so each run uses a distinct synthetic round. Evidence: `test-results/game-recovery/hosted-nojzkL/result.json`.

For an actual recovery, stop writers and use an isolated destination. Restore the trusted account/schema checkpoint first, applying any missing reviewed migrations on that isolated destination. Obtain the latest authenticated complete-transaction marker and verify the consecutive encrypted events with `readGameRecovery`. Review the SQL from `scripts/game-recovery-replay.mjs` before executing it. Reconcile onchain receipts and account deletions before reconnecting the app. Never overwrite the working database or recreate an erased identity automatically.

The existing signer is enabled and its five source files match version 4. `GLOW_ACCEPTANCE_ENABLED=true` permits only the exact `DEVELOPER_USER_ID` in development; all normal email/TOTP, ownership, receipt and recovery checks still apply. Production remains closed. The owner completed the zero-value Sepolia `unpause()` from `/dev/deploy/game`; its receipt is verified in `deployments/game-activation.json`. No further activation transaction or mint is needed for this controlled acceptance. See `PROJECT_SUMMARY.md` for completed live gameplay and remaining public-release evidence.
