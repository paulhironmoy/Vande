# History of this branch

Facts about how `cricket-clean` came to be, so that a large commit is read as what it is. Measured with
`git log --reverse --numstat 38924bd..6738bbe` on 2026-11-08 ("changed lines" is insertions plus deletions, text files only).

## How it was made

The work of the Practice wedge sat in one local checkpoint commit, `4a376ae`, titled "work in progress": 1,541 files,
347,708 insertions and 10,153 deletions (about 337,000 lines net), on top of `38924bd`, which is `main`. On 2026-11-08 that
tree, and the uncommitted work done after it, was rebuilt as 55 logical commits on a new local branch, `cricket-clean`, and
10 later commits were added (documentation, a scripts README, the removal of six `.meta` files of folders that do not exist,
test and tooling fixes found on a clean copy, and the Director size test). The
checkpoint itself is not in this branch; it is kept as the tag `checkpoint-4a376ae` in the owner's repository. The
decision-log row of 2026-11-08 02:45Z in [VANDE-PRODUCT-SEQUENCE.md](VANDE-PRODUCT-SEQUENCE.md) records the rebuild.

So the history is a reconstruction. It does not show the order in which the work was done, and the commit messages were
written afterwards. 65 commits sit on `38924bd`: 27 change more than 5,000 lines (5 of them more than 20,000) and 38 change
at most 5,000.

## Commits above 5,000 changed lines

Each is the import of one subsystem, a mechanical change or generated data; the reason is on the line.

| Commit | Changed lines | Files | Reason |
| --- | ---: | ---: | --- |
| `e351b7e` | 6,017 | 13 | Import of the owner briefs, the interface and asset constitution and the decision records (documents) |
| `c0d22bb` | 20,146 | 4 | Generated data: the frozen simulation v3 fixtures (golden packets, bat poses, body and reach data) |
| `296425d` | 6,283 | 17 | Import of the motion pack toolchain: VMP1 exporter, reader, metrics, Unity reference reader |
| `c8ad228` | 10,673 | 24 | Import of the Blender motion generators for the VC17 skeleton and the MakeHuman helpers |
| `520e338` | 5,925 | 29 | Import of the audio engine: crowd emotion, contact voices, takes, haptics, captions |
| `e959928` | 33,289 | 135 | Import of Practice simulation v3: contract, frozen physics, input, rules, coach, platform. **Does not typecheck alone** |
| `c1ca8c7` | 41,521 | 112 | Import of Render3D: first-person stage, humans, camera, field inset, Director. **Does not typecheck alone** |
| `5b69a42` | 35,866 | 194 | Import of the Practice UI: home, setup, play, coach, summaries, flow, i18n, app shell |
| `ddf45ed` | 8,135 | 44 | Import of the Unity bridge: strict packet codec, validator, session, controller |
| `ab3a581` | 10,772 | 35 | Import of the Unity result-packet decoding off the main thread, with tests |
| `68ab4d8` | 7,317 | 35 | Import of the Unity trace playback, touch capture and performance code |
| `d5cea70` | 6,104 | 51 | Import of the Unity audio: feedback classifier, voice policy, routing, recorded takes |
| `443acd9` | 7,045 | 52 | Import of the Unity HUD: production view, layout, advanced text, themes and font |
| `af46cb7` | 6,569 | 10 | Import of the Unity presentation core: contracts, profile, trace sampling, procedural world |
| `0cf4aa9` | 16,252 | 35 | Import of the Unity characters: rig, baked meshes, motion, gait and character format |
| `64a69ae` | 10,005 | 52 | Import of the Unity batter: arms, predicted swing bat, touch-down bat, hand-over |
| `50cff39` | 9,012 | 61 | Import of the Unity environment: stadium, pitch, props, effects, textures, shaders |
| `34e93ec` | 6,747 | 52 | Import of the Unity Director core: the C# port of keys, noise, plan, bake and sample |
| `e48e961` | 7,055 | 29 | Import of the Unity Director stage: head and gaze, breath, fidgets, world binding |
| `26c1f8b` | 8,148 | 18 | Import of the Unity editor tools: exporters, evidence runners, cover-drive capture |
| `1232ecf` | 6,424 | 25 | Import of the Android host for the opt-in Unity view: gates, validator, Gradle wiring |
| `cfefe91` | 18,531 | 45 | Import of the Android scripts: device evidence, size and release policy, build |
| `415d7e7` | 9,219 | 14 | Import of the Unity asset exporters: meshes, characters, gear, kit, human, motion |
| `f8536db` | 8,781 | 23 | Import of the capture and comparison runner: web, WebGL and Android capture, metrics |
| `918b179` | 6,110 | 26 | Import of documents: evaluation method, capture-compare runner, player experience |
| `6a2dfa6` | 5,720 | 13 | Import of the licence texts and the asset register; 3,647 of the lines are the generated hero provenance record |
| `2b75b4d` | 58,951 | 690 | Mechanical commit: Prettier over `src/` and `tests/`, no behaviour change |

## Reading it

- `2b75b4d` only reformats. It is listed in `.git-blame-ignore-revs`; tell git to skip it in `blame` with
  `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- Two commits do not typecheck alone, and their messages say so: `e959928` (7 `tsc` errors; three Render3D files import a
  constant the frozen physics no longer has) and `c1ca8c7` (4 errors; `tests/unit/practice/ui/fakes.ts`). The independent
  review checked 13 commits: these two fail, and the 11 others (every commit after the rebuild and two neighbours)
  typecheck alone. The rest were not checked one by one; the branch tip typechecks.
- The commit messages are not relabelled as imports; this page is the label.
