/** Open-source software and fonts shipped in the app (shown in Settings → Open-source licences). */
export interface Licence {
  name: string;
  licence: string;
  copyright: string;
  url: string;
}

export const LICENCES: readonly Licence[] = [
  { name: 'three.js', licence: 'MIT', copyright: '© 2010-2026 three.js authors', url: 'https://github.com/mrdoob/three.js' },
  { name: 'React, React DOM', licence: 'MIT', copyright: '© Meta Platforms, Inc. and affiliates', url: 'https://github.com/facebook/react' },
  { name: 'Zustand', licence: 'MIT', copyright: '© 2019 Paul Henschel', url: 'https://github.com/pmndrs/zustand' },
  { name: 'uqr', licence: 'MIT', copyright: '© Project Nayuki, © 2023 Anthony Fu', url: 'https://github.com/unjs/uqr' },
  { name: 'idb', licence: 'ISC', copyright: '© 2016 Jake Archibald', url: 'https://github.com/jakearchibald/idb' },
  { name: 'Workbox', licence: 'MIT', copyright: '© Google LLC', url: 'https://github.com/GoogleChrome/workbox' },
  { name: 'Capacitor and plugins', licence: 'MIT', copyright: '© Ionic', url: 'https://github.com/ionic-team/capacitor' },
  { name: 'Manrope (font)', licence: 'SIL Open Font License 1.1', copyright: '© 2019 The Manrope Project Authors', url: 'https://github.com/sharanda/manrope' },
  { name: 'Noto Sans Devanagari (font)', licence: 'SIL Open Font License 1.1', copyright: '© 2022 The Noto Project Authors', url: 'https://github.com/notofonts/devanagari' },
];
