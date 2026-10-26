/**
 * ICU-lite message formatting. Supported syntax (a strict subset of ICU MessageFormat):
 *
 *   {name}                                   argument (numbers are locale-formatted)
 *   {n, number}  {n, number, percent}        locale number
 *   {count, plural, =0 {none} one {# ball} other {# balls}}   Intl.PluralRules; `#` is the formatted count
 *   {kind, select, bowled {Bowled} other {Out}}
 *
 * Apostrophes are literal (copy uses them freely); braces are reserved. Patterns are parsed once and cached.
 */
export type MessageParams = Record<string, string | number | null | undefined>;

type Node =
  | { k: 'text'; v: string }
  | { k: 'arg'; name: string; style: 'none' | 'number' | 'percent' }
  | { k: 'plural'; name: string; offset: number; options: Record<string, Node[]> }
  | { k: 'select'; name: string; options: Record<string, Node[]> }
  | { k: 'hash' };

const cache = new Map<string, Node[]>();

class Parser {
  i = 0;
  constructor(readonly s: string) {}

  parse(inPlural: boolean, untilBrace: boolean): Node[] {
    const out: Node[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push({ k: 'text', v: text });
      text = '';
    };
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === '}' && untilBrace) break;
      if (ch === '{') {
        flush();
        out.push(this.parseArg());
        continue;
      }
      if (ch === '#' && inPlural) {
        flush();
        out.push({ k: 'hash' });
        this.i++;
        continue;
      }
      text += ch;
      this.i++;
    }
    flush();
    return out;
  }

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  private ident(): string {
    this.ws();
    const start = this.i;
    while (this.i < this.s.length && /[^\s,{}]/.test(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }

  private expect(ch: string) {
    this.ws();
    if (this.s[this.i] !== ch) throw new Error(`ICU-lite: expected '${ch}' at ${this.i} in "${this.s}"`);
    this.i++;
  }

  private parseArg(): Node {
    this.expect('{');
    const name = this.ident();
    this.ws();
    if (this.s[this.i] === '}') {
      this.i++;
      return { k: 'arg', name, style: 'none' };
    }
    this.expect(',');
    const type = this.ident();
    this.ws();
    if (type === 'number') {
      let style: 'number' | 'percent' = 'number';
      if (this.s[this.i] === ',') {
        this.i++;
        style = this.ident() === 'percent' ? 'percent' : 'number';
      }
      this.expect('}');
      return { k: 'arg', name, style };
    }
    if (type !== 'plural' && type !== 'select') throw new Error(`ICU-lite: unsupported type '${type}' in "${this.s}"`);
    this.expect(',');
    const options: Record<string, Node[]> = {};
    let offset = 0;
    for (;;) {
      this.ws();
      if (this.s[this.i] === '}') {
        this.i++;
        break;
      }
      const key = this.ident();
      if (key.startsWith('offset:')) {
        offset = Number(key.slice(7)) || 0;
        continue;
      }
      this.expect('{');
      options[key] = this.parse(type === 'plural', true);
      this.expect('}');
    }
    if (!options.other) throw new Error(`ICU-lite: '${name}' needs an 'other' option in "${this.s}"`);
    return type === 'plural' ? { k: 'plural', name, offset, options } : { k: 'select', name, options };
  }
}

export function parseMessage(pattern: string): Node[] {
  let ast = cache.get(pattern);
  if (!ast) {
    ast = new Parser(pattern).parse(false, false);
    cache.set(pattern, ast);
  }
  return ast;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

export function numberFormat(locale: string, opts?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${opts ? JSON.stringify(opts) : ''}`;
  let f = numberFormats.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, opts);
    } catch {
      f = new Intl.NumberFormat('en-IN', opts);
    }
    numberFormats.set(key, f);
  }
  return f;
}

function plural(locale: string): Intl.PluralRules {
  let p = pluralRules.get(locale);
  if (!p) {
    try {
      p = new Intl.PluralRules(locale);
    } catch {
      p = new Intl.PluralRules('en');
    }
    pluralRules.set(locale, p);
  }
  return p;
}

function render(nodes: Node[], params: MessageParams, locale: string, hashValue: number | null): string {
  let out = '';
  for (const n of nodes) {
    switch (n.k) {
      case 'text':
        out += n.v;
        break;
      case 'hash':
        out += hashValue === null ? '#' : numberFormat(locale).format(hashValue);
        break;
      case 'arg': {
        const v = params[n.name];
        if (v === undefined || v === null) {
          out += `{${n.name}}`;
        } else if (typeof v === 'number') {
          out += n.style === 'percent' ? numberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(v) : numberFormat(locale).format(v);
        } else {
          out += v;
        }
        break;
      }
      case 'plural': {
        const raw = Number(params[n.name] ?? 0);
        const value = raw - n.offset;
        const exact = n.options[`=${raw}`];
        const branch = exact ?? n.options[plural(locale).select(value)] ?? n.options.other;
        out += render(branch, params, locale, value);
        break;
      }
      case 'select': {
        const v = String(params[n.name] ?? 'other');
        out += render(n.options[v] ?? n.options.other, params, locale, hashValue);
        break;
      }
    }
  }
  return out;
}

/** Formats an ICU-lite pattern. Malformed patterns fall back to the raw pattern so the UI never crashes. */
export function formatMessage(pattern: string, params: MessageParams | undefined, locale: string): string {
  if (!params && pattern.indexOf('{') === -1) return pattern;
  try {
    return render(parseMessage(pattern), params ?? {}, locale, null);
  } catch {
    return pattern;
  }
}
