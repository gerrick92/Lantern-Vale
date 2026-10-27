# Architecture

Lantern Vale is one Next.js application and one RPG Maker MZ game. Next Route Handlers provide the game/account backend. A separate Supabase Edge Function provides only restricted settlement signing, isolating the signing key from the web deployment; it owns no gameplay, account UI or duplicate API. Its source and existing key are provisioned, and its economy address matches the verified deployment. Signing and the contract are enabled. GLOW gameplay is available to every registered player with current TOTP and a linked wallet; developer status never grants or restricts gameplay. Hosting access during deployment review is separate from player eligibility.

| Location                                | Responsibility                                                             |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `apps/web/src/app/`                     | Routes, layouts and HTTP entry points                                      |
| `apps/web/src/features/`                | Account, wallet, settings, game and deployment UI                          |
| `apps/web/src/components/`              | Shared navigation, providers and visual primitives                         |
| `apps/web/src/lib/`                     | Small browser/shared adapters and validation                               |
| `apps/web/src/server/`                  | Server-only identity, database access and receipt verification             |
| `game/rules/`                           | Environment-independent TypeScript game rules, schemas and catalog         |
| `game/plugins/`                         | Original JavaScript MZ presentation modules                                |
| `game/scripts/`                         | Map authoring, plugin compilation, asset packaging and integrity checks    |
| `game/mz-source/`                       | Editable native MZ project and compiled plugins                            |
| `apps/web/public/games/mosslight/`      | Complete generated playable export                                         |
| `contracts/`                            | Foundry contracts, tests and disabled legacy deployment script             |
| `supabase/migrations/`                  | Ordered schema, RLS and transactional functions                            |
| `supabase/functions/settlement-signer/` | Restricted settlement signing service                                      |
| `tests/`                                | Feature unit tests, server/database integration, browser and hosted checks |

`mosslight` paths/message identifiers and `SLMS` Solidity filenames are compatibility identifiers. The displayed product is Lantern Vale and its ERC-20 symbol is GLOW. Renaming protocol identifiers is not necessary to rename the product.

## Trust and storage

| Layer             | Authority                                                                   |
| ----------------- | --------------------------------------------------------------------------- |
| Supabase Auth     | Provider-validated account and TOTP session                                 |
| Postgres RLS      | Account-private profiles, contacts, linked wallets and rounds               |
| Sepolia contracts | Supply, balances, transfers, faucet cooldown and confirmed payments         |
| Server            | Verified receipts, paid actions, concurrency and reward eligibility         |
| Browser/MZ        | Rendering and action requests; practice state and preferences are untrusted |

React components do not import privileged server modules. The browser wallet provider is separate from shared chain constants/ABIs so backend code does not initialize Wagmi. Shared game rules depend on neither React nor server credentials; the same rules are bundled for MZ and imported by the server. Running them in a browser does not make that browser authoritative.

The MZ bridge checks origin and parent window, round identity, per-mount nonce and request IDs. Preference messages cannot acknowledge pending actions. Paid results advance monotonically and only matching responses finish pending requests. The browser companion sends validated intents to the API; it never submits an authoritative victory.

## Routes and APIs

Home and Info (`/features`) are public. `/auth` handles registration/sign-in; authenticated visits go to Settings. Settings permits public display preferences but gates account controls. Dashboard, Wallet and Play require an active Supabase account, AAL2 and a current verified TOTP factor. The proxy also gates direct game resources; game license notices remain public. The entire `/dev/*` namespace and its pages require the single server-configured `DEVELOPER_USER_ID` and verified account/TOTP checks. Settings shows developer links only to that owner. Developer routes return 404 in production for everyone. Ordinary authenticated local practice uses `/adventure/test` without developer controls.

All private API handlers verify identity. Mutations require the configured Origin, a bounded JSON body and schema validation. Responses are private/no-store, with sanitized errors. Rate limits are stored in Postgres.

Players register with email/password through Supabase and then enroll a Lantern Vale TOTP factor. The hosted demo auto-confirms registration without sending email. Supabase's `email_confirmed_at` is therefore an account-activation marker, not proof of inbox ownership. Server authorization uses validated account UUIDs, AAL2 and an active factor; no role is granted from an email address or editable profile. Social sign-in and identity linking are not part of this flow. Faucet eligibility remains onchain per wallet. Existing callback handling remains for previously issued account links; the app does not offer email password reset while no sender is configured.

| API                                       | Purpose                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `GET/POST /api/profile`                   | Current user's display name                                                     |
| `GET /api/account/data`                   | Private, bounded JSON export for the verified current account                   |
| `GET/POST /api/account/deletion`          | Read, create or cancel a deletion request; never erase an account automatically |
| `GET/POST/DELETE /api/contacts`           | Private contact CRUD and favorites                                              |
| `GET/DELETE /api/wallet`                  | Read/remove the current binding                                                 |
| `POST /api/wallet/challenge`              | Five-minute SIWE challenge for the signed-in account                            |
| `POST /api/wallet/verify`                 | Verify signature and atomically consume the challenge                           |
| `GET /api/rounds`, `GET /api/rounds/[id]` | Account-owned round history/state                                               |
| `POST /api/rounds`                        | Verify settlement entry and atomically register it                              |
| `POST /api/rounds/[id]/actions`           | Owner/wallet/version-checked actions with purchase receipts                     |
| `POST /api/rounds/[id]/claim`             | Reconcile, sign and persist a terminal result through the restricted signer     |
| `POST /api/payments/review`               | Reserve one entry or purchase review for the account                            |
| `GET /api/payments/pending`               | Restore the account's pending review                                            |
| `POST /api/payments/recover`              | Bounded canonical receipt lookup by immutable payment ID                        |
| `POST /api/payments/expire`               | Release an expired review only after proving it was unpaid onchain              |

`commit_game_action` locks the round, checks version and request idempotency, and saves action/state together. Payment receipt identifiers survive account deletion to prevent reuse. `consume_wallet_challenge` atomically links a unique wallet and consumes its challenge. Privileged functions are not executable by browser roles.

## Account data

Migration 006 adds service-only account exports and deletion requests. Route handlers bind the account ID from verified Auth, never from the request body. Exports whitelist fields in a single SQL statement snapshot and retain exact token units as strings. Missing migrations disable the new panel safely. Deletion is a cancellable request for operator review; all adventure records and unresolved payment reviews require reconciliation before an operator can consider erasure. A separate bounded maintenance function removes only expired wallet challenges and obsolete rate-limit rows, defaulting to a dry run. No client receives maintenance RPC access. See [Setup](SETUP.md#account-data-and-maintenance).

## Paid integration boundary

`LanternGameEconomy.sol` is deployed on Sepolia, funded with an initial 100-GLOW reserve and unpaused. `lib/settlement.ts` defines its ABI and typed result. Server receipt verification checks exact one-GLOW payments, canonical blocks and round entitlements. Migration 003 adds a service-only `settlement_payments` ledger and transactional entry/purchase functions. The purchase receipt and resulting game action commit together; failed versions or terminal state roll both back. Immutable receipt identifiers survive account deletion.

The entry page checks the signed account-wallet link before loading native MZ class selection. Settings and entry share the same SIWE linking component. In-game class confirmation requests the server review and opens MetaMask; feedback overlays the game. `GameSession` owns the fullscreen container and preserves it across registration, while MZ's F4 delegates to that parent. The saved class enters the map automatically after its snapshot arrives. The reviewed entry binds class, payment ID and deadline in contract calldata. Exact one-GLOW approvals precede payment; a scoped browser journal and service-only pending review retain interrupted attempts. Restored reviews attempt recovery, never automatically resubmit a wallet transaction. Only the typed `DRAW_PENDING` response retries registration of the same receipt, bounded to seven attempts 16 seconds apart. Other errors require an explicit retry. Migration 004 serializes reviews per account, blocks other actions while a purchase is unresolved and commits review completion with the paid action. An expired review is released only after a confirmed canonical block proves the payment ID was unused. This is not a refund of a paid loss.

Paid rules receive verified item and randomness context from the server, never through a browser intent. The entry and NPC draws use fixed future drand rounds, a pinned quicknet trust root and independently verified BLS signatures. Proofs remain in migration 003's receipt ledger. Terminal preparation rechecks receipts, encounter outcomes and current escrow before deriving EIP-712 data.

Wallet feedback separates allowance permission from the actual one-GLOW transfer and subsequent confirmation/draw wait. Restoring a review never automatically sends a wallet transaction. After recovery, an explicit click may resume a prepared review or await its known allowance receipt. Only an explicit EIP-1193 rejection with no saved transaction hash resets a request to prepared. Ambiguous requests remain locked for recovery. Journal hints cannot grant entry; live contract and server receipt checks remain authoritative.

The external signer adapter accepts only a signature for that exact data, verifies the current onchain signer and persists the public signed result in migration 005 before returning it. A valid saved result can be reused during signer outages; expired results or signer rotation require reissuance. The browser separately verifies the result against its adventure and current escrow before requesting settlement. No private-key fallback exists. The signer is provisioned in provider Secrets and enabled for verified terminal results. Migrations 001–008 are applied to staging and the working service; the working upgrade also registered migration history after checking the exact baseline and preserving existing records.

Dashboard supply reporting can separate settlement deposits, reserved bonuses and available bonus funds at one block without counting the pool twice. No settlement figures are displayed from a fabricated address. The verified economy address is now configured server-side alongside the existing token and faucet; the same account and wallet requirements apply to every player.

The old gateway/distributor, ABI, receipt parser and migrations remain as historical tested foundations, not as the approved economy. Do not remove or silently migrate applied SQL files. GLOW entry, actions and claims enforce the invariants in [Security](SECURITY.md) for every player. The deployment sender cannot unpause the contract. A separate owner-only activation control prepares only a verified Sepolia unpause; this administrative control is separate from ordinary player access.

## Game-action recovery

Migrations 007–008 add a private, transactionally ordered game-only journal. Each review, state/action change, receipt and signed result enters the same database transaction as its journal event. The server encrypts events and a complete-transaction marker into independent private Staging storage, reads them back, verifies the chain and acknowledges retention before returning an outcome. Restrictive RLS and the external signer deny unarchived state. Original SQL payload text preserves exact large numbers. Auth credentials, sessions and TOTP data never enter this journal.

Replay accepts only authenticated, consecutive events for one existing account, with fixed table/operation allowlists. It refuses divergent checkpoints and conflicting rows, preserves ownership/constraints and runs transactionally. A deleted owner is never recreated; operator review is required for erasure/retention. The hosted fixture drill covers outage, retry, data loss and idempotent restoration.
