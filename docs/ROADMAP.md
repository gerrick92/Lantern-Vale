# Roadmap

Updated **27 October 2026**. The original assignment requires everyone to be able to play. **GLOW gameplay has no developer or tester restriction.** Registration, current TOTP, a linked wallet, sufficient GLOW/test ETH and valid payments are the player requirements.

| Milestone                        | Status                  | Evidence                                                                                                                                                                     |
| -------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fantasy website and native RPG   | PASS                    | Approved responsive design, six classes, shops, NPC scenes, forest shortcuts, combat and final boss; complete export and unchanged cave.                                     |
| Public player accounts           | PASS                    | Own email/password, mandatory TOTP, profiles, wallet ownership and RLS. Fresh accounts never gain developer privileges.                                                      |
| GLOW and daily faucet            | PASS                    | Live Sepolia contracts, capped supply, five GLOW per wallet every 24 hours, real claims/cooldown. No player-count cap.                                                       |
| Real GLOW gameplay               | PASS for recorded flows | Owner entry/purchases, full-clear victory returns and bonuses, NPCs, combat defeat/recycling. Ordinary players pass real entry-review generation without developer status.   |
| Contract source verification     | PASS                    | Exact matches for all three contracts on Etherscan and Sourcify.                                                                                                             |
| Recovery and signing             | PASS for recorded scope | Restricted signer, private journals, database/checkpoint and later-action restore drills. Provider root-key loss is not established.                                         |
| GitHub and documentation         | PASS                    | Public source repository, README, launcher source, setup/game/security guides and audited asset separation.                                                                  |
| Hosted application               | PASS on public origin   | Full working-service Vercel build at https://lantern-vale.vercel.app. Fresh-account, TOTP, wallet linking and ordinary-player GLOW entry reviews pass without Vercel bypass. |
| Friends' live acceptance         | USER TESTING            | Separate-wallet claim/transfer and complete game journeys; the user will test with friends.                                                                                  |
| Manual accessibility and devices | NOT YET VERIFIED        | NVDA, Firefox Accessibility Inspector, physical phones/mobile wallets. Viewport, axe and keyboard results are separate evidence.                                             |

The website explains GLOW supply, faucet cooldown, round deposits, winning and losing. There is no USD peg, fake value chart or real-money promise. All infrastructure remains on existing free services.

## Next

Share the public link, record friends' feedback and fix any reproduced issues. Further live bonus-boundary and outage exercises remain useful operational checks; do not misrepresent them as already passed or use them to reserve gameplay for developers.

## Future

Community proposals/voting, extra quests and balance improvements remain planned. No voting rights are attached to GLOW today. New features need their own implementation and tests.

[README](../README.md) · [Recorded tests](TESTING.md#release-verification) · [Original assignment](ORIGINAL_SOFTSTACK_ASSIGNMENT.md)
