# VANDE — Privacy

**Short version: VANDE keeps everything on your device. We do not collect, send or sell any data.**

VANDE: Republic Under Pressure is an independent game. It is not affiliated with, endorsed by or connected to the
Government of India, any political party or any public institution.

## What the game stores (on your device only)

* Your campaign progress and the chapter you are currently playing, so you can resume after closing the app.
* Your results, personal bests and the long-term condition of your Republic.
* Your daily-challenge results.
* Your settings (reduced motion, contrast, text size, sound, haptics, captions, timer pace).

This data lives in your browser's IndexedDB (web and PWA) or in the app's private storage (Android). It never leaves
the device unless **you** export it or share a result card.

## What the game does not do

* No account, sign-in, email or phone number.
* No analytics, tracking pixels, advertising identifiers or crash reporting.
* No servers: there is nothing for the game to send data to. Opponents are simulated locally.
* No location, camera, microphone or contacts access. The Android app requests only the network permission that the
  WebView component requires; all game assets are bundled, and the game plays fully offline.
* Android automatic backup is turned off, so progress is not copied to any cloud account.

## Sharing and challenge links

When you tap *Challenge friends* or *Share*, the game draws a result image on your device and opens your system's
share sheet. The challenge link contains only the scenario id, a random seed, the difficulty, the chosen opponents and
your score — no names, device identifiers or personal information. Whoever opens the link plays the same scenario
locally; nothing is reported back to you or to us.

## Your controls

Home → Republic:

* **Export local progress** — downloads a JSON file of everything the game stores.
* **Reset the Republic** — clears long-term condition and history, keeps settings.
* **Delete all local progress** — removes every stored item, including settings.

Uninstalling the app or clearing site data removes everything as well.

## Content

Scenarios, characters, institutions and events are fictional. Rights moments are educational content, not legal advice;
each shows its review date and links to an official public source where available.

## Changes

If this policy changes, the new version ships with the app and is dated below.

*Last updated: 2026-10-23 · Contact: open an issue at https://github.com/paulhironmoy/Vande/issues*
