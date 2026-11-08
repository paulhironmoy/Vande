# MediaPipe Tasks Vision 0.10.35 and the Pose Landmarker Lite model (camera batting)

Recorded 2026-11-08T09:14Z by CAMERA. These files are downloaded by a player only when they choose Camera (docs/PRACTICE_CAMERA_INPUT.md);
they are never part of the first-ball install. Every hash below is checked by `scripts/camera/pack.mjs` before a pack is built.

| Item | Licence | Source and retrieval | Size, sha256 |
| --- | --- | --- | --- |
| `@mediapipe/tasks-vision` 0.10.35 (JavaScript, `vision_bundle.mjs`) | Apache License 2.0 (package.json `license`; upstream `LICENSE` in this folder) | `npm view`, registry tarball, 2026-11-08; published 2026-04-27; tarball sha256 `84597a25e13d123b5f4cbe768bb72e97a2c28c7a465f0ace287d8cbe5246bff0` | 136,993 B, `55d7ab624fbb70dcc5adc4ae6d7ea9cfcb569139d3dbfbf2b1deafcb966bc0fe` |
| Engine loader (`wasm/vision_wasm_module_internal.js`, Emscripten ES module) | Apache License 2.0 (same package) | same tarball | 322,082 B, `1f1d6215324a1fe62f6742d49a3db911170987ca18ad8c1b75f1a1c82acf2b44` |
| Engine WASM (`wasm/vision_wasm_module_internal.wasm`) | Apache License 2.0 (same package); it statically links other open-source components (for example TensorFlow Lite, XNNPACK) published under permissive licences by the MediaPipe project; the npm package ships no separate notice list | same tarball | 11,153,641 B, `617b8e0248dbd27e9d7ece4218004eae4cefb499196d1bb4fa0e3fef21708756` |
| `pose_landmarker_lite.task` (BlazePose GHUM 3D, float16: `pose_detector.tflite` + `pose_landmarks_detector.tflite`) | **Apache License 2.0, stated in the model card only** ("LICENSED UNDER Apache License, Version 2.0"); the tflite files and Google's documentation page carry no licence text | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`, 2026-11-08; vendored at `assets-src/camera/pose_landmarker_lite.task` | 5,777,746 B, `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| Model card (`Model Card BlazePose GHUM 3D.pdf`) | evidence of the model's licence | `https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf`, 2026-11-08; copy and text under release/product-sequence/stage-3-chase/CAMERA/sources/ | 1,398,977 B, `e982460cedece5ad9a46aa8f13523328e9ab95d7d5b2b8c99b33f13f6a79ca86` |
| Upstream `LICENSE` (Apache-2.0 plus a Lucent notice for a text-task directory not shipped here) | Apache License 2.0 | `https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE`, 2026-11-08 | 12,331 B, `8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8` |

**Open risk, reported plainly (not a blocker):** the model's licence is written in its model card, not in the file, and the compiled engine's
embedded third-party notices are not published as a list. No non-commercial term was found. If either is unacceptable the free alternative is
MoveNet (Apache-2.0, TF Hub) through TensorFlow.js; no model card check was done for it.

**What the model card limits** (and the product respects): one person; a person within about 4 m; the head visible; z is not metric (the mapper uses
x and y only); "any form of surveillance or identity recognition is explicitly out of scope" (nothing here identifies anyone); accuracy of the Lite model
varies by region, skin tone and gender (average PDJ 87.0%, range 83.2 to 89.7 by region; 80.5 to 87.8 by skin tone), so camera batting is opt-in and never
the only way to play.

Test pictures used only for the smoke test (never shipped, never a repository fixture): two United States Marine Corps photographs, public domain as works of
the US Government, from Wikimedia Commons ("Anthony Ruiz.jpg", by Pfc. John Robbart III) and DVIDS 5610441 ("Team USA wins third game in Japan-USA
Collegiate Baseball Championship", by Cpl. Stephen Campbell). The camera e2e uses pictures rendered by us from the owner-made VC17 character instead.
