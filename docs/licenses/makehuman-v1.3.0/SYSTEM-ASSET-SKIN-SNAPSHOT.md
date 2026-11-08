# MakeHuman official system-asset skin snapshot

This is the immutable acquisition and modification record for the single CC0
skin albedo used by VANDE's Stage 1 production-character candidate. It does not
change the candidate's independent `REJECT / REWORK` presentation status and is
not legal, identity, Android-size, reach, device, or player acceptance.

## Authority and exact source

- Pinned MakeHuman application: tag `v1.3.0`, commit
  `1f508f6083b2f823dab15de924b3bde72e08d77c` at
  <https://github.com/makehumancommunity/makehuman>. Its pinned
  `makehuman/download_assets_git.py` designates the first-party
  `makehumancommunity/makehuman-assets` repository as the source of official
  bundled assets.
- Immutable official pack index: repository
  <https://github.com/makehumancommunity/makehuman-static-website>, commit
  `09ec378f9aff822a1c95d55bac19e6367ff92e12`, path
  `content/Assets/AssetPacks/makehuman_system_assets.md`, SHA-256
  `eb034452e780c06ef4ed042d4408ee34f43add9984c1803e69025ef6432316dd`.
  That index identifies the selected male skin as a `makehuman_system` asset
  from the asset repository under `CC0`.
- Direct public archive URL (no account, login, purchase, click-through, or
  terms acceptance):
  <https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip>.
- Archive: 280,737,770 bytes; SHA-256
  `b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107`;
  server `Last-Modified: 2024-04-14T13:28:46Z`.
- Selected archive entry (upstream's exact historical name retained only for
  traceability):
  `skins/young_caucasian_male/young_lightskinned_male_diffuse.png`;
  3,693,828 bytes; 2048×2048 RGB PNG; SHA-256
  `862a26e335e958b70534cb5f0d7c47ef30ab148a56c42b3e9da969cf76f12963`.
- Acquisition completed `2026-10-30T09:26:27Z`. The full 267 MiB archive was
  removed from scratch after its checksum and the selected entry were verified;
  it remains reproducible from the exact URL and hash above. No other pack
  texture is shipped or used.

The historical asset repository named by the application bootstrap is no
longer publicly addressable at GitHub. This record therefore pins the exact
official index commit, archive URL, archive bytes/hash, and entry bytes/hash;
it does not invent an asset-repository commit.

## Licence snapshot

The official index commit labels the selected system skin `CC0`. The pinned
MakeHuman v1.3.0 [licence summary](LICENSE.md) defines bundled textures and
other graphical assets as CC0, and the exact [CC0 terms](LICENSE.ASSETS.md) are
archived beside this record. Attribution is not required. The source atlas
contains its own `PUBLICDOMAIN MAKEHUMAN.ORG` notice in a non-skin UV corner;
VANDE did not add a team, sponsor, player, or manufacturer mark.

## Deterministic VANDE derivative

- Output:
  `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/human-skin-albedo-1024.png`.
- Created `2026-10-30T09:28:42Z`; 1,065,858 bytes; 1024×1024 RGB PNG;
  SHA-256
  `a7700f7a538fa723647296416b77713aefda9e6ad3ba037f30bf4c9eab6ad0d0`.
- Tool: FFmpeg 9.0.1, built with Apple clang 17.0.0.
- Exact transformation:
  `ffmpeg -hide_banner -loglevel error -i <source> -vf scale=1024:1024:flags=lanczos -frames:v 1 -compression_level 9 -pred mixed -update 1 <output>`.
- Modification: Lanczos downscale and PNG recompression only. There was no
  retouching, recolouring, generated imagery, face replacement, or separate
  eye/hair acquisition.
- AI status: the source is not claimed to be AI-generated and VANDE used no
  generative model, real-player reference image, or inferred identity. The
  texture is used only for the generic fictional candidate. No demographic,
  nationality, real-person, or real-player identity is asserted.

Unity samples this albedo only on shader region 0 (head, neck, forearms and
hands). VANDE's original unbranded procedural cricket kit, trousers, and shoes
remain authoritative for regions 1–3. A missing texture, or a retained VPM1
mesh without the VPM2 UV capability bit, fails closed to the previous
procedural skin material.

## Deliberate non-claims

Independent identity/publicity review remains `UNPROVEN`. Fresh Unity visual
review, physical Android devices, Play-split/fresh-installed bytes, GPU memory,
India-weighted reach, and human-player results have not been established by
this source record. The current exact presentation decision remains
`REJECT / REWORK` until an independent evaluator reviews a new build.
