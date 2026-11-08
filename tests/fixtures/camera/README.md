# Camera test fixtures

Synthetic camera videos for the camera end-to-end tests, and small landmark traces for the camera unit tests.

**What they are.** Video rendered by VANDE in Blender from its own owner-made character (an MPFB body on the 75-bone game skeleton,
posed from VC17 hand paths written in `scripts/blender/camera/swing_clips.py`). No third-party footage and no web images of people.

**What they prove.** They run the whole camera path end to end: permission, capture, frame timing, the pose worker, the mapper, the
tracker, the frozen physics and the record. They check that a given body movement gives the expected class and direction, that a lost
track and a black picture are noticed, and that the fall-back to mouse or touch works.

**What they do not prove.** They are automated fixtures, not player results. They say nothing about whether a person can bat with the
camera, about accuracy or comfort for real people, about real webcam latency (the fake device has no sensor delay), or about other
lighting, clothes, rooms, skin tones, browsers or phones.

**Files.**

- `manifest.json`: every clip with its frames, size, sha256, handedness, stroke, marker times, authored hand-path numbers and the expected
  class, plus the tool versions and the hash of every generator script.
- `traces/*.trace.json`: the pose engine's landmarks per frame for each clip (seven landmarks, four numbers each), for `tests/unit/input/camera`.
  `trace.ts` expands one into the `PoseFrame` list the mapper takes.
- `noise-model.json`: the landmark noise, dropouts and lag measured on those clips.
- The videos themselves (about 4 MB each) are not in git. `node scripts/camera-fixtures/generate.mjs all` writes them to
  `test-results-camera-fixtures/videos/` (ignored by `.gitignore`; not `test-results/`, which Playwright empties at the start of every run).
  `node scripts/camera-fixtures/generate.mjs check` compares them with the manifest.
- No tracked file here is over 2 MB.
