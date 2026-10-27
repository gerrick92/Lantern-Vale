# Lantern Vale — current checkpoint

Updated **27 October 2026**. **Real GLOW gameplay is available to every registered player after TOTP and wallet linking.** No developer role, invitation or tester list is required. Only administrative tools are owner-only; production returns 404 for those tools.

## Product and services

- Six-class RPG Maker MZ adventure, approved fantasy website, shops, optional NPC scenes, hidden forest routes and final boss are preserved. The approved cave remains byte-identical.
- Players register with their own email/password, enroll Google Authenticator, link MetaMask, claim five GLOW per wallet every 24 hours and play. Existing accounts and factors are unchanged. There is no account-count or two-wallet limit.
- Direct registration uses Supabase without confirmation email or social providers. Email ownership is not verified; email password reset is unavailable. Signed-in password changes remain available. No personal sender or paid service is used.
- GLOW, faucet and game contracts run on Sepolia 11155111. All three have exact Etherscan and Sourcify source matches. The game is funded and unpaused; no redeployment is needed.
- Migrations 001–008, restricted signer version 4 and encrypted offsite game journals are active. Server authorization, RLS, ownership, canonical receipts, randomness and replay protection remain required for every player.

## Verified gameplay

| Check                                  | Evidence                                                                                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry, purchase and full-clear victory | Round `0016c9f3-8fb6-497a-9f9d-2e9a6b1f3877`: two GLOW used, both returned plus two bonus GLOW. Settlement `0x021daa3a821d4edff87e7bc5088d474473311cd74185dba60e4170bd42064780`.                                           |
| Combat defeat and recycling            | Round `637dd82e-6da8-41ed-a9e3-7486b7217997`, contract round 5: one GLOW used, zero returned/bonus, one recycled to the faucet. Settlement `0xd85b87d1432d08080601c9b64e57aeb6f88946ddfb4025b18516f76b4fdefaf3`.           |
| Optional encounters                    | Both passed the owner's live playtest. All five outcomes also have isolated native-game tests; these are separate evidence.                                                                                                |
| Ordinary player access                 | Fresh public registrations pass TOTP, SIWE, private-data isolation and developer-route denial. A nondeveloper receives and recovers a real Sepolia entry plan on the working Vercel backend without sending a transaction. |

Victory returns every GLOW used in that round plus one boss-only or two full-clear bonus GLOW, capped at ten bonus GLOW per wallet per rolling 24 hours. Defeat recycles only used GLOW. Unspent wallet funds remain untouched. Practice counters never become GLOW.

## Hosting and source

The full app builds on the existing free Vercel Hobby project. The working GLOW deployment has passed protected and public-origin account/API checks, including entry-review generation for an ordinary player. Browser registration, QR/TOTP, enabled Start game and desktop/phone layouts pass. The public site is **https://lantern-vale.vercel.app**. Anonymous visitors can register without Vercel access. Public-origin account and GLOW-entry-review checks pass without a bypass. Deployment/preview URLs remain protected, private APIs require authentication and developer routes return 404.

The user approved working-service credentials in Vercel's server-only secret storage. The upload contains no credentials, owner/player keys, backups or editor files. Its complete 220-resource finished game includes all required notices. Supabase's site URL and exact callback now include the public origin while preserving the existing local callback.

Source: [gerrick92/Lantern-Vale](https://github.com/gerrick92/Lantern-Vale), branch `codex/lantern-vale`. The compiled Windows launcher is ignored; its source and build instructions are included. Only audited files are published. Existing receipts, payment journals and private recovery files must be preserved.

## Evidence limits and follow-up

Friends' real separate-wallet faucet/transfer/full-game tests are reserved for the user. Actual bonus-limit boundaries, prolonged signer outages, physical devices, NVDA and Firefox Accessibility Inspector remain distinct checks; no automated suite proves all of them. Community voting remains planned. GLOW has no USD peg or cash promise.

Current reports: `test-results/hosting/`, `test-results/paid-npc/` and `test-results/source-review/`. Exact source verification: `deployments/etherscan.json`. Historical results and recovery limits remain in [Review](docs/REVIEW.md) and [Security](docs/SECURITY.md). See [Roadmap](docs/ROADMAP.md) for remaining checks.
