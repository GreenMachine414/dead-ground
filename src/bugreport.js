// Bug reports: validation, the vulgar-language filter and sending through Web3Forms.
// The access key is public by design; the destination email lives on Web3Forms' side.
import { version } from '../package.json';

const ENDPOINT = 'https://api.web3forms.com/submit';
const ACCESS_KEY = '9d8855c1-7d46-4def-9f8e-391f02e939ec';
export const BUG_MIN = 10;
export const BUG_MAX = 1000;
export const BUG_KEEP = 20; // reports remembered for editing
const COOLDOWN = 30000;

// whole words only (so "class", "assist", "Scunthorpe" and "cockpit" are fine)
const WORDS = [
  'ass', 'asses', 'arse', 'arses', 'dick', 'dicks', 'cock', 'cocks', 'cunt', 'cunts', 'piss', 'pissed', 'pissing',
  'prick', 'pricks', 'tit', 'tits', 'titty', 'titties', 'boob', 'boobs', 'pussy', 'pussies', 'cum', 'fag', 'fags',
  'retard', 'retards', 'retarded', 'slag', 'skank', 'porn', 'nigga', 'niggas', 'nigger', 'niggers', 'spic', 'chink',
  'kike', 'tranny', 'wtf', 'stfu', 'gtfo', 'fck', 'fcking', 'fk', 'bollocks',
];
// also caught inside longer words ("bullshit", "motherfucker")
const STEMS = [
  'fuck', 'fuk', 'fuq', 'shit', 'bitch', 'whore', 'slut', 'asshole', 'dickhead', 'bastard', 'motherf', 'wank', 'twat',
  'faggot', 'jizz', 'dildo', 'cocksuck', 'dumbass', 'jackass', 'smartass',
];
const collapse = (s) => s.replace(/(.)\1+/g, '$1'); // "fuuuck" -> "fuck"
// stretched spellings are checked too, unless collapsing would make a normal word ("ass" -> "as")
const WORD_SET = new Set([...WORDS, ...WORDS.map(collapse).filter((w) => w.length >= 4)]);
const STEMS_C = STEMS.map(collapse);
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

const vulgarWord = (t) => {
  const c = collapse(t);
  return WORD_SET.has(t) || WORD_SET.has(c) || STEMS.some((s, i) => t.includes(s) || c.includes(STEMS_C[i]));
};

export function hasVulgar(text) {
  const norm = text
    .toLowerCase()
    .replace(/(?<=[a-z])[013457@$!]+|[013457@$!]+(?=[a-z])/g, (m) => [...m].map((ch) => LEET[ch]).join('')) // "sh1t", "$hit"
    .replace(/(?<=[a-z])[*._]+(?=[a-z])/g, ''); // "f*ck", "f.u.c.k"
  const tokens = norm.split(/[^a-z]+/);
  let spaced = ''; // "f u c k"
  for (const t of tokens) {
    if (t.length === 1) {
      spaced += t;
      continue;
    }
    if (spaced.length > 2 && vulgarWord(spaced)) return true;
    spaced = '';
    if (t && vulgarWord(t)) return true;
  }
  return spaced.length > 2 && vulgarWord(spaced);
}

// an error message, or null when the report can be sent
export function checkReport(text, reports, now = Date.now()) {
  if (text.length < BUG_MIN) return `Please write at least ${BUG_MIN} characters.`;
  if (text.length > BUG_MAX) return `Please keep it under ${BUG_MAX} characters.`;
  if (hasVulgar(text)) return 'Please keep it clean: remove the vulgar language and try again.';
  const last = reports.reduce((m, r) => Math.max(m, r.sent || 0), 0);
  const wait = Math.ceil((COOLDOWN - (now - last)) / 1000);
  if (wait > 0) return `Please wait ${wait}s before sending another report.`;
  return null;
}

export const newReportId = () => Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0');

export async function sendReport(r, player) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      access_key: ACCESS_KEY,
      subject: `Dead Ground bug report/feedback #${r.id}${r.edits ? ` (edit ${r.edits})` : ''}`,
      from_name: 'Dead Ground',
      report: r.id,
      edit: r.edits ? `Edit ${r.edits} (replaces the earlier version)` : 'Original',
      player,
      version,
      message: r.text,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.success) throw new Error(j.message || `HTTP ${res.status}`);
}
