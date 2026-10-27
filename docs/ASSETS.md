# Asset provenance and distribution

## Website

Website images were created with OpenAI's built-in image generation tool on 20–21 October 2026. No paid asset purchase or external paid image API was used. They are original fantasy scenes/adult characters; no Final Fantasy logos, music, sprites or extracted franchise art are bundled. Provenance is not trademark clearance.

| Source                                                             | Use                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `apps/web/public/art/lantern-vale-forest-v2.png`                   | Current woodland homepage/account image; original human lantern-bearer                     |
| `apps/web/public/art/lantern-vale-forest-v2.webp`                  | Optimized interior background from the same source                                         |
| `apps/web/public/art/lantern-vale-v1.png`                          | Adventure cover and MZ title image                                                         |
| `apps/web/art/lantern-cast-v2.png`                                 | Original transparent six-character, two-pose atlas source                                  |
| `apps/web/public/art/lantern-cast-v2-compact.webp`                 | Nearest-neighbor compact atlas used by account/wallet illustrations                        |
| `apps/web/src/components/rpg-icon.tsx`                             | Original code-native pixel equipment icons                                                 |
| `docs/assets/lantern-vale-header.svg`, `apps/web/src/app/icon.svg` | Original README banner and favicon using the existing pixel lantern motif; no MZ resources |

The forest brief specified an indigo woodland, amber inn, small human lantern-bearer, quiet left area for HTML text and no franchise likeness/text/logo. The cover brief specified an inn, moonwell, two forests and distant small cave. The atlas brief specified twelve transparent cells, six original adult characters with resting/action poses, with a second pass correcting cell overlap. Superseded study/first-cover/first-atlas images and unused duplicate derivatives were removed after reference checks; the active originals above remain.

Cinzel is self-hosted from the [Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/cinzel). Its full SIL Open Font License remains at `apps/web/public/fonts/Cinzel-OFL.txt`. No browser request to Google Fonts is required.

## RPG Maker game

The game uses the user's licensed RPG Maker MZ 1.9.0 `newdata` and `corescript/v1.9.0` resources. Exact engine/music/effect provenance is in `game/asset-provenance.json`. Original maps, dialogue, rules, plugin code and the toad pixel pattern are project work. No DLC or purchased music is included. Unlicensed commercial-game folders and the standalone character image without provenance were not imported.

Required notices remain in `game/mz-source/CREDITS.txt` and `THIRD_PARTY_LICENSES.txt`, and in the complete export. The game credits acknowledge **©Gotcha Gotcha Games Inc./YOJI OJIMA 2020** and RPG Maker MZ. Zod's MIT notice is included with the bundled rules. Keep vendor notices in the copied engine files.

On 25 October, review of the linked EULA's distribution appendix identified a missing player notice about extraction, modification, redistribution and reuse of company resources. That notice is now included in both the credits generator and finished-game credits. This closes the identified notice gap; it is not a blanket licensing certification for future assets or distribution arrangements.

The same review found that the separate runtime notice file contained only Zod's license. Complete notices for PixiJS, Effekseer, localForage (including Apache 2.0 and its lie/immediate dependencies), Pako and its zlib port, stb_vorbis and M+ fonts are now retained under `game/licenses/`, with source URLs and content hashes. Build and sync generate the finished game's `THIRD_PARTY_LICENSES.txt` from those records and the installed Zod license. Existing vendor headers remain untouched. Pako's supplied minified runtime has no version marker; its notice uses the upstream 1.x license, without claiming an exact runtime version. The decoder identifies stb_vorbis as its basis. No third-party runtime was upgraded during this notice repair.

Official engine art/audio stays inside the RPG Maker-made game, not the Next.js UI. Raw official resources and the generated finished-game export are intentionally ignored in Git. Do not distribute the editor, Steam files or a standalone asset library. The complete approved game export must accompany deployment; ignoring raw assets is not permission to omit resources required to play.

**27 October distribution review:** the current 220-resource finished export retains the required MZ attribution, extraction/reuse restrictions and runtime notices, and contains no editor or Steam installation files. The Next.js artwork is original and separate. The protected Vercel artifact includes the complete game; GitHub source excludes licensed runtime assets. This review covers that artifact against the linked [MZ EULA](https://store.steampowered.com/eula/1096900_eula_1), not future DLC, purchased music or other redistribution arrangements. Review additions against their own terms before distribution.
