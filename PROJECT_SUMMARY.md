# Lantern Vale — current checkpoint

Updated **27 October 2026**. The approved website, six-class native RPG Maker MZ game, accounts and wallet remain intact. **The game contract is unpaused for controlled owner acceptance. The public application is not finished or published.**

## Completed and verified

| Area                    | Evidence                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GLOW and faucet         | Deployed on Sepolia, exact Sourcify matches, funded faucet, real owner claims and cooldown verified.                                                                                                                                                    |
| Game contract           | `0x9bd16131ec0e61c92ee3e6e8e8ea8f61a17519eb`, deployed and funded with 100 GLOW. Canonical receipts and exact Sourcify source match verified. No redeployment needed.                                                                                   |
| Accounts                | Existing email/TOTP, profile, SIWE and wallet checks pass. Both existing users and their verified authenticator factors were preserved.                                                                                                                 |
| Database                | Migrations **001–008** applied to Staging and Sepolia. Add migrations; never rewrite these applied sources.                                                                                                                                             |
| Game recovery           | Encrypted game-only action journal in private Staging storage; key retained in the existing Vercel project. Hosted outage/retry, checkpoint replay, later-action restoration and idempotency pass. Auth credentials are excluded.                       |
| Restricted signer       | Version 4 source downloaded and matched. Existing key preserved. Enabled for controlled acceptance; anonymous, incorrect-credential and browser-origin probes deny access. Unarchived game state cannot be signed.                                      |
| Local acceptance access | Only the configured developer account in development mode can use the explicit acceptance setting. All server mutations still require an active account, TOTP and ownership. Production remains closed.                                                 |
| Checkpoints             | Existing offsite checkpoint and hosted disposable Auth restoration passed earlier. Fresh local encrypted checkpoint `capture-3ziZse` and isolated restore pass after 008. Its full offsite refresh was blocked by approval review; it was not uploaded. |

## Current entry check

The owner completed activation. Read-only verification confirms the successful owner `unpause()` transaction on chain **11155111**, its canonical receipt and confirmed `paused=false` state. See `deployments/game-activation.json`; the original paused deployment snapshot remains unchanged.

**PASS, live owner entry:** the owner signed the account-wallet link and confirmed one GLOW for Warrior. Canonical receipt `0xb93fdd31a9eaf7b148cdcb347dbfb43ccee0009b4a62fa110d1e033e1315e5f5` is registered to the saved Warrior round. Its first registration waited on drand round 33406760 and returned 503. Recovering that same receipt succeeded without another payment; read-only verification finds the town state with one GLOW used. Edge visibly reaches the inn in fullscreen.

**PASS, subsequent fresh entry:** transaction `0x9232ec703e1f3649d577d2c02353e4ee06ede4a1dd61ab5efd94258fba9bdde8` registered automatically after three pending-draw responses. Edge shows its Warrior in the inn, with one GLOW used. Both separate entries remain saved; the observed wallet balance is 13 GLOW. Approval does not transfer GLOW. These are timestamped observations, not fixed application balances.

Payment feedback now distinguishes wallet preparation, allowance, payment, confirmations and the roughly one-minute encounter-draw wait. It stays inside the game/fullscreen view. Restored reviews recover first; a known unsent review can explicitly continue in MetaMask. Known rejected requests can retry, while ambiguous or submitted payments remain recovery-only. A saved allowance hash is checked before continuing. Eight isolated Chromium cases, 39 focused tests, TypeScript/lint and production build pass. Evidence: `test-results/payment-prompt/confirmed-entries.json`, `live-warrior.png` and the browser report. The game source/export and approved cave were not changed in this follow-up.

## Verified victory and NPC follow-up

**PASS, live owner purchase and victory:** round `0016c9f3-8fb6-497a-9f9d-2e9a6b1f3877` records Warrior, entry plus one class-spell purchase, all five normal enemies and the boss defeated. Canonical settlement `0x021daa3a821d4edff87e7bc5088d474473311cd74185dba60e4170bd42064780` returns both spent GLOW and awards two bonus GLOW: four transferred to the paying wallet. The escrow is settled; the observed wallet balance at 21:21 UTC is 15 GLOW. Evidence: `test-results/paid-npc/live-victory.json`. These are recorded observations, not fixed application balances.

Both native NPC scenes incorrectly retained a practice-only guard. They now request a confirmed server outcome using the existing matching odds: Vesper 25% Inspired / 25% drained / 50% slap; Ilyra 25% woodland strength / 75% toad. Paid outcomes still use verified future-beacon randomness. The game applies their visible effects at the cinematic reveal, and a matching payment-review heartbeat keeps the native action alive during wallet/draw waits. Practice, maps and the approved cave remain intact. See [verification](docs/REVIEW.md).

**PASS, user-reported live NPC checks:** the owner subsequently tested both optional GLOW encounters and confirmed they work. This establishes their observed playthrough, not independent receipt verification of all five possible outcomes. Boss-only/bonus-limit cases, loss recycling and signer outage/recovery remain separate checks. Preserve pending journals and recover existing payments rather than paying again. Friends' separate-account/wallet and live playtests are reserved for the user. Browser fixtures remain separate from real receipts.

## Documentation and local startup

The README now has an original Lantern Vale header, a clickable contents menu, gameplay/economy explanations and setup/start instructions. `Lantern Vale.exe` is a locally compiled, source-included Windows launcher. It checks prerequisites, starts one Next.js server, opens Edge, and reuses an existing app. Closing its console stops only the processes it started. Four isolated launcher checks pass. The executable is Git-ignored; build it with `npm run launcher:build`.

The old root browser report was preserved under `test-results/release-preparation/previous-browser-report`; new default reports go under `test-results/browser-report`. Required configuration, private credentials, backups and the game remain intact. The favicon now uses the existing lantern motif.

## Public release work

- New-player registration uses email/password directly in Supabase, with confirmation emails disabled by the user's explicit 27 October decision. Public signup, duplicate-account denial, TOTP, repeat-login challenges and existing-account preservation pass on both projects. The actual browser registration/QR flow passes; two players pass RLS, developer denial and SIWE checks with an unfunded test wallet. Social sign-in code and buttons were removed. Email ownership is not verified and email password reset is unavailable; Settings still supports authenticated password changes. No sender or paid service is used. With explicit user approval, the unused Google project `lantern-vale`, including its OAuth client, was shut down on 27 October. Google confirms deletion is scheduled after 26 November 2026. It was never installed in Supabase. See [account setup](docs/SETUP.md#player-registration).
- Etherscan verification remains pending; exact Sourcify verification is complete. The shared Etherscan mirror reported its daily quota.
- The complete app is deployed successfully on the free Vercel Hobby plan as a protected review, using the separate Staging database. Cloud registration, real QR/TOTP enrollment, two-account RLS/SIWE isolation, private API guards and desktop/phone page checks pass. The public domains remain unassigned; no placeholder is published. The GitHub repository `gerrick92/Lantern-Vale` exists; source review/upload is in progress.
- Final separate-player, physical-device, NVDA/Firefox accessibility and asset-distribution checks remain distinct evidence.

## Recovery and evidence

- Hosted game drill: `test-results/game-recovery/hosted-nojzkL/result.json` — PASS with disposable Staging data only.
- Migration preservation: `test-results/game-recovery/fix-owner-frbbhbkwtgqczdjfhedi.json` — two users/two verified factors unchanged.
- Native current-schema restore: `test-results/hosted-backup/capture-3ziZse/rehearsal-L06gFk` — PASS.
- Deployed signer: `deployments/supabase-signer.json`; original contract receipts: `deployments/game-economy.json`.
- Historical hosted Auth restore: `test-results/auth-recovery/hosted-3Ew6yB/result.json`. Provider runtime/root keys were retained; total provider loss was not tested.

The economy remains one GLOW per entry or priced action; victory returns **every GLOW used in the round**, plus one boss-only or two full-clear bonus GLOW, capped at ten bonus GLOW per wallet per rolling 24 hours. Defeat recycles used GLOW to the faucet. Unspent wallet funds are untouched. Practice counters cannot pay GLOW.

Preserve the cave hash in `docs/GAME.md`, configured credentials and existing transaction journals. The Git tree contains prior staged, unstaged and untracked work with no initial commit or remote. Do not reset or blanket-stage it. Current verification commands and limits are in `docs/TESTING.md`; final results belong in `docs/REVIEW.md` and ignored `test-results/`.
