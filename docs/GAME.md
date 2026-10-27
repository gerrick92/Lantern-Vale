# Game and token rules

Lantern Vale is one RPG Maker MZ adventure: an inn, a fairy clearing, two forests and the final mountain shrine. Six classes have distinct stats, skills and two class-specific spells. The inn retains the bedroom, innkeeper, equipment/items/spells merchants and Vesper. Secret paths can bypass ordinary enemies; defeating the final guardian is mandatory. Clearing each forest restores its lanterns.

## Approved economy

GLOW is the paid ERC-20 token, not a second currency alongside “tokens.” Practice counters are separate and never convert to GLOW. Sepolia ETH is used only for network gas. No USD peg, price chart or cash redemption exists.

| Action                                  | Rule                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Entry                                   | One token, after class confirmation                                      |
| Weapon, armor, tonic, ether, each spell | One each; each stock item once per round                                 |
| Vesper / fairy                          | One each; once per round                                                 |
| Inn healing and curse removal           | One; repeatable when needed                                              |
| Victory                                 | Return **all** used tokens, including entry, purchases, NPCs and healing |
| Boss-only bonus                         | One token                                                                |
| All five normal enemies and boss        | Two bonus tokens total, not three                                        |
| Paid bonus allowance                    | Ten per wallet in a rolling 24 hours; returns do not consume allowance   |
| Defeat                                  | Lose only used tokens; unspent wallet funds remain untouched             |
| Faucet                                  | Transfer five existing GLOW per wallet per rolling 24 hours, when funded |

There is no arbitrary round-spending cap or round-count limit. At zero daily bonus allowance a paid victory would still return every deposit. Defeat settlement recycles deposits to the faucet; it does not mint or burn them. Owner minting is bounded by 1,000,000 outstanding GLOW; holder burns reopen capacity under `ERC20Capped`.

Practice begins with 30 counters per new game, charges entry after confirmation, and ends at 31 or 32 after victory. Its unlimited resets and bonuses are local testing behavior. The GLOW settlement contract is **deployed, funded with 100 GLOW and unpaused**. Paid rules use confirmed one-GLOW deposits rather than a separate adventure-gold balance. Only server-verified payment context can grant a priced action; this context is not accepted as a browser intent. Every registered player can use GLOW mode after TOTP and wallet linking; no developer role, invitation or tester list is required. See [security requirements](SECURITY.md).

Vesper's practice outcomes are Inspired (25%), exhaustion (25%) and a comic slap (50%). The first two apply after the bedroom fade reaches black. The fairy grants woodland strength (25%) or a toad curse (75%). These seeded practice outcomes are never a source of paid randomness. Local demo controls choose a fresh round's outcome and cannot authorize GLOW.

The GLOW implementation uses the same probabilities with verified drand quicknet draws. Entry fixes all six encounter slots; each NPC purchase fixes its own draw from the canonical payment block time. The first draw at least 60 seconds after payment is used. While waiting, the game shows a payment overlay and automatically retries registration of that same receipt. If the bounded wait expires, **Continue adventure** retries recovery without charging again. Proofs are stored and verified again before settlement. This is public beacon verification on the server, not an onchain VRF; [Security](SECURITY.md) records its trust and availability limits.

Paid NPC scenes wait for that confirmed outcome before starting their choreography. Stats and transformations are revealed at the same moment as in practice, including Vesper's bedroom blackout. The parent keeps only the matching payment action alive during wallet review; ordinary actions retain their short timeout. Rejection or an abandoned review unlocks the native scene. An interrupted cinematic restores its already-recorded outcome on reload without another charge; it does not reroll the result. No practice seed or demo override determines a paid outcome.

In GLOW mode, confirm a class or priced action inside the game to open MetaMask directly. Status and optional recovery details remain inside the game view. Fullscreen includes this overlay, the selected class is locked to the receipt, and confirmed entry loads its saved map without another title-screen click. **F4** and **Fullscreen game** use the same parent container; **Show companion** opens the text controls without leaving fullscreen.

## Playing locally

Run `npm run dev`, sign in with email/password and complete TOTP verification, then select **Play → Start game — Test → New Game**. Arrow keys or taps move; Enter interacts; Esc returns through menus. The website provides pause, fullscreen and a DOM action companion. Settings controls mute and reduced motion. Continue resumes a valid rules-version-5 practice save; invalid or older saves are ignored. History is a separate account-owned paid-round view.

Useful manual checks: walk through the bedroom doorway and speak across Nessa's counter; verify the NPC never crosses walls and stats change after blackout; dance at the pond; leave while cursed; bypass mobs through the concealed route; compare Attack, Skill, Magic, Item and Defend; watch the third-turn enemy special; defeat the guardian and return to the sunlit inn. An item consumes a battle turn.

The October 22 presentation pass crops class portraits before asynchronously loaded textures can display their full sprite sheet. Forest exits cover the entire open road width. The inn has smaller woven rugs, wall decorations, a writing desk and a travelling musician; woodland routes include varied undergrowth, fallen logs and a cold campfire. A compact map HUD hides during staged scenes. Vesper's bedroom music fades in, and the fairy pauses with the player before the transformation. Physical enemy attacks include a wind-up and lunge even when native Effekseer effects are enabled. Reopen the game and choose New Game to review the complete updated sequence.

The 25 October demo follow-up fixes a keyboard battle race: a winning command could update the rules before its animation was installed, leaving an animation lock behind on the map. Battle exits now wait for the pending action and final animation. Vesper follows the hero continuously at one tile of separation and ends beside the bed; effects still resolve after blackout. Forests start darker, each normal victory relights a lantern and reduces the darkness, and a full clear restores daylight. The northern flower-path turn and return to the road now have matching subtle flowers. These shared map/battle presentation changes also apply to the gated paid runtime; they do not enable payments or alter reward rules.

The approved final map must remain byte-identical unless the user requests a cave change:

`game/mz-source/data/Map005.json` SHA-256:
`96fbeb700c4da10cbb31be635888ebd47d30fca7734afc46b7dc1c07a3c7d071`

## Authoring and export

```powershell
# Rules or presentation changes; preserve maps and the practice switch.
npm run game:rules
npm run game:plugins
npm run game:sync
npm run game:verify

# Rebuild authored maps only, with backups and the final cave protected.
npm run game:maps
npm run game:sync

# Regenerate maps/database and copy licensed engine resources intentionally.
$env:RPG_MZ_PATH="C:/path/to/RPG Maker MZ"
npm run game:build
npm run game:sync
```

`game:build` requires licensed MZ 1.9.0 and **overwrites generated map/database data**. Preserve editor changes first. Map authoring is in `game/scripts/maps.mjs`; shared rules are in `game/rules/`; presentation JavaScript is in `game/plugins/`. Compiled `MosslightBridge.js` and `MosslightRules.js` remain in MZ's native plugin directory. Edit their sources and rebuild rather than editing the compiled copies.

`game:maps` regenerates only authored maps and their index. It first verifies both the existing and generated final cave against the approved hash, then backs up changed files under ignored `test-results/map-backups/` before writing. It never writes the final cave, copies licensed assets, rebuilds the database or changes the practice switch. Review any editor changes before using this command too.

Open `game/mz-source/Game.rmmzproject` in the licensed editor. For a release artifact, `npm run game:build -- --release` disables practice before sync. This does not enable paid play. Normal practice is limited to loopback/editor and verified accounts.

Sync checks source paths before copying. Verification checks exact file lists, SHA-256 hashes, maps, plugins, audio and native effect dependencies, and rejects unexpected files instead of deleting them. The export includes runtime, images, fonts, sound, effects and WASM; a player needs neither Steam nor MZ. Distribution boundaries are in [Assets](ASSETS.md).

The DOM companion assists critical choices, but canvas class selection and exploration have not received a complete screen-reader/physical-device audit. Reduced motion suppresses battle particles and dashes while retaining names and results; this is not a photosensitivity certification.

The companion now retains keyboard position when a purchased item or battle command disappears, keeps focus outside the game undisturbed, and disables commands lacking MP/items. It omits already-known shop spells and unnecessary full-health rests. A concise live region announces current health, mana, enemy/next attack and the latest event; the full event history remains readable without repeatedly announcing every old line. Both game modes have focusable skip targets.

The local balance report covers 11,232 simulations with a disclosed one-turn tactical policy that breaks prolonged heal/guard loops. Every class completes all 324 normal encounter combinations with starting or stocked equipment under this policy. Stock generally shortens battles; class recovery and NPC penalties remain distinct. Exhaustion is much easier for the healing classes to survive. Starting-inventory toad runs fail the tested routes, while some stocked classes can survive the curse through much longer battles. Human difficulty, repeated legal play and final class tuning still need playtesting. No combat values, rules version, maps, NPC presentation or token rewards were changed in this pass.
