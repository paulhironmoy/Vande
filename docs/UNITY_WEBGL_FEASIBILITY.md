# Unity Web feasibility gate

Status: **desktop engineering preview passed through run-up; mobile feasibility not run**

This gate prevents the Android Unity decision from silently becoming a web-architecture decision. Unity documents
Web support for compatible WebGL 2, HTML5, 64-bit and WebAssembly browsers, including supported mobile-browser
families, but that is compatibility—not evidence that VANDE's live batting load, memory or latency is acceptable.

Primary references:

- https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-browsercompatibility.html
- https://docs.unity3d.com/6000.0/Documentation/Manual/system-requirements.html

## Current decision

- Android: continue release verification of the opt-in Unity-as-a-Library path.
- Web/PWA release: retain the measured Three.js stage and Classic fallback.
- Web engineering preview: the Unity path may be used only behind its explicit
  preview flags and unqualified admission state.
- Do not ship or advertise a Unity Web path until the exact same source revision passes every gate below.
- A successful desktop build is not mobile-browser parity.

## Exact engineering-preview launch

The repository scripts are the supported entrypoints. Build before preview so
the two explicit engineering-only flags are compiled into the same verified
bundle that is served:

```text
npm run build:unity
npm run preview:unity
```

`dev:unity`, `build:unity` and `preview:unity` request both the Unity WebGL
renderer and the conspicuous `engineering-preview-unqualified` admission. The
ordinary `dev`, `build` and `preview` scripts request neither; they retain the
release web renderer and Classic fallback. Previewing cannot retrofit flags
into an older bundle, and the artifact verifier rejects a Unity export whose
build identity, Unity-source digest or file hashes do not match current source.

Unity 6000.3.27f1 and Web Build Support are now installed. A fresh schema-2
WebGL export for repository build `38924bd+bdb1608de832` passed the packaging
and publication-mirror verifier. A desktop Chromium smoke on a fresh local origin
then reached the visible, interactive Unity canvas and the `runup` phase in
10.667 seconds, with renderer `unity-webgl`, admission
`engineering-preview-unqualified`, a connected 1366×768 canvas, and no captured
console error. This is a bounded engineering result only: the smoke stopped at
run-up and did not complete a delivery, an over, a lifecycle cycle or a mobile
browser row. Subsequent source changes supersede that generated artifact for any
new release decision.

The latest sealed Unity-inclusive preview source identity is
`38924bd+05f72561424b`. Its
matching artifacts in this evidence cycle are Android preview artifacts; no
matching current-source WebGL export or browser runtime result is recorded.
Therefore the older desktop smoke remains useful historical engineering evidence
only and cannot certify the current source.

No physical mobile-browser measurement, installed-PWA result, cold-network
profile, input-latency result, memory soak, compatibility matrix, lifecycle run,
offline return or cross-renderer parity package exists. Therefore the result does
not pass this feasibility gate and does not authorize replacing Three.js or
Classic on web.

## Test artifact

Build one production, release-compressed Unity Web artifact containing only the accepted one-delivery vertical slice.
Record:

- exact repository build ID and simulation/contract versions;
- exact Unity Editor patch and package-lock hashes;
- compression mode and server headers;
- every emitted file's raw and transferred bytes;
- content hash of the deployed test artifact;
- whether assets are embedded, streamed or cached;
- whether threads are enabled and, if so, the required cross-origin-isolation headers.

The comparison must use the matching production Three.js artifact. Do not compare a development Three.js build with a
release Unity build, or vice versa.

The completed desktop preview proves that the current exporter can produce a
provenance-bound artifact and that a supported desktop browser can enter the
Unity run-up. It is not the production comparison artifact required by this
section.

## Required matrix

At minimum:

| Class | Required coverage |
| --- | --- |
| Android mobile web | A supported low device near VANDE's Android cutoff, one current mid device and one current high device, in current Chrome |
| iOS mobile web | One supported older iPhone and one current iPhone, in Safari |
| Desktop | Current Chrome, Safari, Firefox and Chromium Edge on supported 64-bit systems |
| Network | Warm cache; cold 10 Mbps / 100 ms RTT; offline return after a successful install/cache |
| Session | First delivery, one complete over, ten-over memory soak, background/foreground and context loss where the browser exposes it |

## Go/no-go gates

All measurements come from physical mobile devices for the mobile rows.

| Dimension | Gate |
| --- | --- |
| Download | Every byte and request disclosed; the one-delivery artifact has an explicit product-approved budget and does not enter the existing PWA precache accidentally. |
| Startup | Practice tap to controllable first release remains under the existing 10 s requirement on the accepted mid device and network profile, with no hidden second download after Play. |
| Frame pacing | The existing Full/Balanced/Classic thresholds in `docs/PRACTICE.md` and `docs/PERFORMANCE.md` pass for 30 complete deliveries per claimed tier. |
| Input | Pointer down to visible bat response is ≤50 ms for the Full claim; raw, mapped and authoritative timestamps share a measured monotonic mapping with uncertainty recorded. |
| Memory | Peak and retained memory are captured for first load, one over and ten overs; no browser kill, tab reload or unbounded growth is allowed. A numeric ceiling must be set from the physical-device measurements before acceptance. |
| Compatibility | Every required browser either completes the same deterministic delivery/replay or is routed to the retained Three.js/Classic path before play. |
| Lifecycle | Background, foreground, page hide, page restore, orientation, audio interruption and context loss never duplicate or reroll a result. |
| Offline | After the declared cache/install step, a complete over works without network and without a runtime fetch that can strand the player. |
| Accessibility | The live surface preserves the accepted keyboard, captions, reduced-motion, contrast and screen-reader alternative; a canvas-only success is insufficient. |
| Parity | Given the same canonical result, Unity Web, Unity Android, Three.js and Classic show the same contact, field outcome, score, wicket and replay identity. |

## Measurement package

Store the immutable result under a build-ID directory and include:

```text
manifest.json                 exact files, hashes, raw/transferred bytes
environment.json              browser, OS, device, RAM, network shaping, Unity patch
startup.json                  navigation/loader/interactive/first-release timestamps
frames.ndjson                 frame intervals and phase markers
input.ndjson                  raw clocks, mapping samples, uncertainty and visible response
memory.csv                    load/ball/over/ten-over/background samples
compatibility.csv             browser/device outcome and fallback used
lifecycle.ndjson              interruption and recovery events
parity.json                   canonical delivery/result/replay digests by renderer
screenshots/ and video/       first release, contact, outcome, replay and failures
VERDICT.md                    pass/fail per gate; no averaged-away failures
```

Until that package exists and independently passes, “Unity Web support” means
only a successful desktop engineering preview, not VANDE mobile-web feasibility
or permission to replace the current web renderer.
