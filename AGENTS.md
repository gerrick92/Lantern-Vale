# Lantern Vale — repository instructions

This is an existing application. Preserve user changes, configured accounts, working functionality and the approved visual direction. Do not restart the project or reuse deleted prototypes. All new or modified UI, game dialogue, comments, documentation, tests and status reports must be in English.

Read `README.md` and `PROJECT_SUMMARY.md`, then the relevant guides in `docs/`: `ARCHITECTURE.md`, `SECURITY.md`, `SETUP.md`, `GAME.md`, `ASSETS.md` and `TESTING.md`. `ORIGINAL_SOFTSTACK_ASSIGNMENT.md` remains the mandatory external baseline. Current scoped user decisions supersede older plans. The product is Lantern Vale / GLOW; SLMS/mosslight identifiers remain internal compatibility names.

## Architecture

- Keep one Next.js App Router application with strict TypeScript, semantic React, Tailwind, Wagmi/Viem, Supabase Auth/Postgres/RLS and server Route Handlers. Do not introduce a second backend without a concrete need.
- Privileged credentials/database logic stay behind `server-only`. Authenticate on the server and enforce RLS, ownership, input limits and validation; UI gates alone are insufficient.
- Email/TOTP identity, browser wallet connection and SIWE ownership are separate. Never hardcode the user's wallet, account or historical balance.
- Use `bigint` and units helpers for token math. Check chain, address, token, spender, recipient, amount and canonical mined receipts. Submitted hashes are not confirmed payments.
- Paid rounds/reward eligibility are server-authoritative. Browser events, storage, practice state, postMessage and victory flags are untrusted. Persist versions, idempotency and receipt tombstones; reject replay and cross-chain claims.
- Preserve six classes and one native RPG Maker MZ game with a complete reproducible export. MZ runtime/presentation stays JavaScript; shared rules live in `game/rules`, original presentation in `game/plugins`. Do not substitute a React/canvas prototype.
- Preserve the approved final cave byte-for-byte unless explicitly asked to change it; its hash is in `docs/GAME.md`. Full game rebuilds overwrite generated maps/database: preserve editor changes first.
- Keep responsive light/dark, mute, reduced motion, opt-in Accessibility Mode and developer-only phone preview. Normal mode must still meet accessibility requirements. Respect semantics, focus, contrast and touch sizing.

## Security and external dependencies

- Ethereum Sepolia 11155111 only. No mainnet, real-money promise, USD peg, fake balances, invented addresses or fabricated receipts/results.
- Paid deployment/start/rewards stay disabled until every gate in `docs/SECURITY.md` is met. Do not silently drop real ERC-20 payouts from the assignment or enable the incompatible legacy flow.
- Stop payout/deployment for client-forged rewards, replay, cross-account access, wrong-recipient transfers, exposed secrets or critical contract risks. Fix and report; never bypass the gate.
- Never collect/store player keys or seeds. Never commit environment secrets, service/signer keys, sessions or credential-bearing recordings. Separate restricted reward signing from owner mint authority; provisioning and recovery require review.
- Never edit applied SQL migrations to change deployed behavior: add a migration. No destructive hosted data operations or contract redeployment as routine cleanup.
- MetaMask is already configured in the user's Edge browser. Preserve that setup and their working authenticator. User signatures, external login/inbox, deployment authorization, paid services and required editor GUI actions are genuine dependencies.
- Continue unrelated work if one external step is blocked. Ask only for indispensable user actions, explaining the exact action.

## Assets, verification and delivery

- Follow actual MZ/DLC/plugin terms and preserve notices. Official MZ resources belong inside the finished MZ game, not a standalone website asset library. Never distribute editor/Steam files. A finished export must play without an MZ installation even though raw licensed resources are omitted from Git.
- Check Git status before edits, preserve unrelated work and maintain recovery. Prefer focused modules over wrappers or arbitrary file splitting. Keep tool configuration at its expected paths.
- Test incrementally; run appropriate types/lint/format/build/unit/Foundry/browser/game checks before delivery. Commands and evidence limits are in `docs/TESTING.md`.
- Report actual PASS/FAIL/BLOCKED. Live MetaMask, deployed addresses/ABIs, balances, receipts and a separate-wallet public journey are distinct gates; local tests never substitute for them.
- Axe, HTML validation, Lighthouse, keyboard, Firefox Accessibility Inspector and NVDA are separate evidence. Never claim 100% WCAG from a Lighthouse score.
- Maintain concise current docs and `PROJECT_SUMMARY.md`. Generated reports/screenshots belong under ignored `test-results/`. Do not recreate a historical instruction pack.
