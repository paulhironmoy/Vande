/** Bespoke inline illustrations for the first-run panels. People are warm dot clusters; never insects. */

const people = [
  [30, 96], [44, 104], [58, 94], [70, 108], [38, 118], [54, 122], [66, 126], [80, 118], [26, 112], [48, 86], [62, 80], [78, 96], [90, 106], [34, 130],
];

export function HearIllustration() {
  return (
    <svg viewBox="0 0 240 160" role="img" aria-label="A crowd of people speaking to a public official who is listening">
      <defs>
        <radialGradient id="warm" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#f0a24a" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#f0a24a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="240" height="160" fill="transparent" />
      <ellipse cx="58" cy="108" rx="52" ry="36" fill="url(#warm)" />
      {people.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 5 : 4} fill="#f7f9fc" opacity={0.55 + (i % 4) * 0.1} />
      ))}
      {/* speech arcs */}
      <path d="M104 92a22 22 0 0 1 0 26" fill="none" stroke="#62d6ff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      <path d="M114 84a36 36 0 0 1 0 42" fill="none" stroke="#62d6ff" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      <path d="M124 76a50 50 0 0 1 0 58" fill="none" stroke="#62d6ff" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      {/* listening official */}
      <circle cx="182" cy="84" r="13" fill="#38a0ff" />
      <path d="M156 136c0-18 12-28 26-28s26 10 26 28" fill="#136ef6" />
      <path d="M160 140h44" stroke="#0b1d36" strokeWidth="2" />
      {/* ground line */}
      <path d="M16 142h208" stroke="rgba(170,182,200,0.35)" strokeWidth="1" />
    </svg>
  );
}

export function VerifyIllustration() {
  return (
    <svg viewBox="0 0 240 160" role="img" aria-label="Three evidence cards: one verified, one being inspected, one exposed as manipulated">
      <rect width="240" height="160" fill="transparent" />
      <path d="M20 128h200" stroke="rgba(98,214,255,0.25)" strokeWidth="1" strokeDasharray="3 5" />
      {/* card 1 verified */}
      <g transform="rotate(-8 60 80)">
        <rect x="26" y="44" width="68" height="84" rx="8" fill="#0e2140" stroke="rgba(170,182,200,0.35)" />
        <rect x="36" y="56" width="40" height="5" rx="2.5" fill="rgba(170,182,200,0.5)" />
        <rect x="36" y="67" width="48" height="5" rx="2.5" fill="rgba(170,182,200,0.3)" />
        <path d="M60 84l6 4v5c0 4-2.6 7.5-6 8.5-3.4-1-6-4.5-6-8.5v-5l6-4z" fill="#2ed3c4" opacity="0.95" />
        <path d="M56.5 93l2.5 2.5 5-5" stroke="#06101c" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* card 2 inspected */}
      <g>
        <rect x="88" y="36" width="68" height="88" rx="8" fill="#112a4f" stroke="rgba(98,214,255,0.5)" />
        <rect x="98" y="48" width="40" height="5" rx="2.5" fill="rgba(170,182,200,0.5)" />
        <rect x="98" y="59" width="48" height="5" rx="2.5" fill="rgba(170,182,200,0.3)" />
        <rect x="98" y="70" width="30" height="5" rx="2.5" fill="rgba(170,182,200,0.3)" />
        <circle cx="120" cy="98" r="11" fill="none" stroke="#62d6ff" strokeWidth="2.5" />
        <path d="M128 106l9 9" stroke="#62d6ff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="120" cy="98" r="5" fill="rgba(98,214,255,0.25)" />
      </g>
      {/* card 3 manipulated */}
      <g transform="rotate(9 182 86)">
        <rect x="150" y="46" width="68" height="84" rx="8" fill="#0e2140" stroke="rgba(224,64,90,0.55)" />
        <rect x="160" y="58" width="40" height="5" rx="2.5" fill="rgba(170,182,200,0.5)" />
        <rect x="160" y="69" width="48" height="5" rx="2.5" fill="rgba(170,182,200,0.3)" />
        <path d="M172 92l5-4 3 3 5-3 3 6-3 3 2 5-6 1-4 3-3-4-3-3 1-7z" fill="none" stroke="#e0405a" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M166 112l34-30" stroke="#e0405a" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function ProtectIllustration() {
  return (
    <svg viewBox="0 0 240 160" role="img" aria-label="A balance line holding people on one side and a city on the other, both protected">
      <rect width="240" height="160" fill="transparent" />
      {/* arcs echoing the mark */}
      <path d="M40 60c20-34 60-44 80-12" fill="none" stroke="#4da3ff" strokeWidth="3" strokeLinecap="round" />
      <path d="M200 60c-20-34-60-44-80-12" fill="none" stroke="#2ed3c4" strokeWidth="3" strokeLinecap="round" />
      {/* equilibrium line */}
      <path d="M28 96h184" stroke="#f7f9fc" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="120" cy="96" r="5" fill="#62d6ff" />
      <path d="M120 101v28" stroke="rgba(170,182,200,0.5)" strokeWidth="2" />
      <path d="M100 130h40" stroke="rgba(170,182,200,0.5)" strokeWidth="2" strokeLinecap="round" />
      {/* people under a shield */}
      {[
        [48, 84], [60, 80], [72, 86], [54, 90], [66, 92], [40, 90],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill="#f7f9fc" opacity={0.7 + (i % 2) * 0.2} />
      ))}
      <path d="M56 46l10 4v7c0 6-4 10.5-10 12.5-6-2-10-6.5-10-12.5v-7l10-4z" fill="rgba(77,163,255,0.25)" stroke="#4da3ff" strokeWidth="1.5" />
      {/* city */}
      <rect x="156" y="66" width="12" height="28" rx="2" fill="#2ed3c4" opacity="0.8" />
      <rect x="172" y="56" width="14" height="38" rx="2" fill="#2ed3c4" opacity="0.6" />
      <rect x="190" y="72" width="12" height="22" rx="2" fill="#2ed3c4" opacity="0.75" />
      <rect x="146" y="78" width="8" height="16" rx="2" fill="#2ed3c4" opacity="0.5" />
      {[160, 176, 194].map((x) => (
        <rect key={x} x={x} y="62" width="3" height="3" fill="#07111f" opacity="0.8" />
      ))}
      <ellipse cx="176" cy="96" rx="40" ry="6" fill="rgba(46,211,196,0.18)" />
    </svg>
  );
}
