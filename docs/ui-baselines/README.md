# UI competitive baselines

This directory keeps versioned, evaluator-scored UI comparisons for VANDE Practice. A baseline is immutable once
recorded: a changed implementation receives a new build-id file rather than overwriting the old result.

## Current baseline

| Recorded (UTC) | VANDE build | UI-only score | Best comparator | Record |
| --- | --- | ---: | ---: | --- |
| 2026-10-28T23:19:24Z | `38924bd+05f72561424b` | **6.2/10** | Cricket League, **8.3/10** | [`38924bd-05f72561424b.md`](38924bd-05f72561424b.md) |

## Re-score rule

Use the same rubric and weights in the current record. Capture, at minimum, launch or resume, setup, live batting,
ball outcome and over-complete states on the scored build. Record build identity, UTC time, device, viewport, renderer,
quality tier, evidence paths and evaluator. Never infer a human preference score from an AI visual audit.

This is a competitive UI tracker, not either locked ceiling rubric and not a release gate. Player and stadium art,
animation, camera feel, physics, audio, performance and human player experience require separate evidence.
