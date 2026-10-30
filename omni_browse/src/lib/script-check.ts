// Is a reply in the language the customer chose? Used by the language tests (the agent has the same check in
// voice-agent-py/coverpilot/langcheck.py). Hindi and Marathi share the Devanagari script, so the script alone does
// not tell them apart: a few common words that only one of them uses do.

export type IndicLang = 'hi' | 'mr';

const DEVANAGARI = /[ऀ-ॿ]/g;
const LATIN = /[A-Za-z]/g;

// Product words and names that stay in English letters in a Hindi or Marathi answer.
const KEEP_ENGLISH = /\b(rider|riders|premium|free[- ]?look|section|irdai|nexasure|omnicb|mwpa|pan|aadhaar|kyc|nominee|appointee|ok|guardian|integrity|ci|atpd|upi|otp|pin|gst|uin)\b/gi;

const HINDI_WORDS = new Set(['है', 'हैं', 'आप', 'आपका', 'आपकी', 'आपके', 'नहीं', 'सकते', 'सकता', 'सकती', 'और', 'यह', 'लिए', 'करें', 'कीजिए', 'होगा', 'होगी', 'हूँ', 'हूं', 'मैं', 'था', 'थी', 'कितना', 'कितनी', 'कितने', 'क्या', 'कौन', 'होता', 'होती', 'होते', 'मुझे', 'मेरी', 'मेरे', 'मेरा', 'कैसे', 'चाहिए', 'वाली', 'वाला', 'जाए', 'जाता', 'करना', 'रहा', 'रही', 'बताइए', 'मिलता', 'मिलती', 'भी', 'पर', 'में', 'को', 'से', 'के', 'की']);
const MARATHI_WORDS = new Set(['आहे', 'आहेत', 'आणि', 'तुम्ही', 'तुमचा', 'तुमची', 'तुमचे', 'तुमच्या', 'नाही', 'शकता', 'मध्ये', 'साठी', 'करा', 'होईल', 'मी', 'होते', 'तुम्हाला', 'आपल्या', 'आपण', 'किती', 'म्हणजे', 'काय', 'कोण', 'होऊ', 'शकतो', 'शकते', 'झाली', 'झाले', 'असतो', 'असते', 'असतात', 'घ्यावे', 'मिळते', 'मिळतो', 'मला', 'माझ्या', 'माझा', 'माझी', 'माझे', 'करायचा', 'करायची', 'सांगा', 'विसरलो', 'येईल', 'लागते', 'लागतो', 'करावे', 'यांचा', 'त्याचा', 'ते', 'हे', 'ला', 'चा', 'ची', 'चे']);
// Marathi attaches these to the noun before them (रायडरमध्ये, प्रीमियमसाठी, रुग्णालयातील), so a whole-word list misses them.
const MARATHI_SUFFIXES = ['मध्ये', 'साठी', 'ातील', 'ाचा', 'ाची', 'ाचे', 'ांचा', 'ांची', 'ांचे'];

/** Share of letters that are Devanagari, ignoring product words that stay in English letters. */
export function devanagariShare(text: string): number {
  const cleaned = text.replace(KEEP_ENGLISH, ' ');
  const dev = (cleaned.match(DEVANAGARI) || []).length;
  const lat = (cleaned.match(LATIN) || []).length;
  return dev + lat === 0 ? 0 : dev / (dev + lat);
}

export function guessIndicLanguage(text: string): IndicLang | 'unknown' {
  const tokens = text.split(/[\s,.!?;:()"'।|/-]+/).filter(Boolean);
  let hi = 0;
  let mr = 0;
  for (const t of tokens) {
    if (HINDI_WORDS.has(t)) hi++;
    if (MARATHI_WORDS.has(t) || (t.length > 5 && MARATHI_SUFFIXES.some((x) => t.endsWith(x)))) mr++;
  }
  if (hi === mr) return 'unknown';
  return hi > mr ? 'hi' : 'mr';
}

// Spoken Hindi and Marathi mix in English nouns on purpose, so the line is drawn well below that: an English sentence is
// 0% Devanagari and a few English words are not a failure.
export const MIN_SHARE = 0.35;

export interface ReplyCheck {
  ok: boolean;
  why: string;
}

/** A reply passes when it is at least MIN_SHARE Devanagari and the other language's marker words do not outnumber the expected one's. */
export function checkReplyLanguage(text: string, expected: IndicLang): ReplyCheck {
  const t = text.trim();
  if (!t) return { ok: false, why: 'empty' };
  const share = devanagariShare(t);
  if (share < MIN_SHARE) return { ok: false, why: `script ${Math.round(share * 100)}% Devanagari` };
  const guess = guessIndicLanguage(t);
  if (guess !== 'unknown' && guess !== expected) return { ok: false, why: `wrong language (${guess})` };
  return { ok: true, why: guess === 'unknown' ? 'script ok, language words unclear' : 'ok' };
}
