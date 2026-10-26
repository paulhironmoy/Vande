# Social copy: translation status

Source: `en.ts` (558 keys: cups, Cricket Rooms, leaderboards, the Daily Top 100, highlights and consent, the public
highlight landing, practice, profile, badges, the 10 predefined banter phrases and the 78 city names of the fixed list).
Other files are partials of it; a missing key falls back to English at runtime, so a locale never shows a raw key.
Placeholders and plural syntax must match English; `tests/unit/social/i18n.test.ts` checks every file, the coverage
counts in this table and the MACHINE-DRAFTED markings.

| Locale | Script | Coverage | Status | Before release |
| --- | --- | --- | --- | --- |
| `en` English | Latin | 558 / 558 | Source | Copy review |
| `hi` हिन्दी Hindi | Devanagari | 558 / 558 (city names in Devanagari) | Complete, written in-house (AI-authored) | Native-speaker review recommended |
| `hi-Latn` Hinglish | Latin | 480 / 558 (all copy; the 78 city names fall back to their English spellings) | Complete, written in-house (AI-authored), conversational "tum" register for banter and chat lines | Native-speaker review recommended |
| `bn` বাংলা Bengali | Bengali | 114 / 558 (core) | **MACHINE-DRAFTED** | **Human linguistic QA required** |
| `te` తెలుగు Telugu | Telugu | 114 / 558 (core) | **MACHINE-DRAFTED** | **Human linguistic QA required** |
| `mr` मराठी Marathi | Devanagari | 114 / 558 (core) | **MACHINE-DRAFTED** | **Human linguistic QA required** |
| `ta` தமிழ் Tamil | Tamil | 114 / 558 (core) | **MACHINE-DRAFTED** | **Human linguistic QA required** |
| `gu` ગુજરાતી Gujarati | Gujarati | 114 / 558 (core) | **MACHINE-DRAFTED** | **Human linguistic QA required** |
| `kn` ಕನ್ನಡ Kannada | Kannada | 114 / 558 (core) | **MACHINE-DRAFTED** | **Human linguistic QA required** |
| `ml` മലയാളം Malayalam | Malayalam | 114 / 558 (core) | **MACHINE-DRAFTED** | **Human linguistic QA required** |
| `pa` ਪੰਜਾਬੀ Punjabi | Gurmukhi | 114 / 558 (core) | **MACHINE-DRAFTED** | **Human linguistic QA required** |

None of the machine-drafted files has been reviewed by a native speaker. Do not describe them as reviewed or
production quality in store listings or release notes until a reviewer signs off here (vendor or person, date,
commit). The Hindi and Hinglish files are complete but AI-authored; a native-speaker pass is still recommended.

"Core" = common actions, the main states, sharing, the titles and primary actions of every social screen, cup
statuses and fixtures, room controls (mute, notification frequency, report, block), leaderboard scopes, the Top 100
headline states, the highlight statuses and consent buttons (including the 18+ confirmation), the landing's main
actions, the profile's main fields, both badges and the 10 banter phrases. Explanatory paragraphs (rules, consent
consequences, ranking details) show in English in the drafted locales until they are translated and reviewed.

Copy rules: honest only (real counts and public deadlines, never invented players, activity or countdowns); never a
result before its reveal; aliases only, never real names; plain statements of what consent, withdrawal and blocking do.
