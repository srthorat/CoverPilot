// One-off check of the independent reader on one image: node tools/id-cards/reader-debug.mjs <image> [pan|aadhaar|salary-slip]
// (run from omni_browse). Uses the same framing as the app's own OCR route, which is the one Spark answers.
import fs from 'node:fs';
import path from 'node:path';

const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const get = (k) => {
  const m = new RegExp(`^${k}=(?:"([^"]*)"|'([^']*)'|(\\S*))`, 'm').exec(env);
  return m ? m[1] ?? m[2] ?? m[3] ?? '' : '';
};
const file = process.argv[2];
const type = process.argv[3] || 'aadhaar';
const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
const url = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
const base = (get('META_MODEL_BASE_URL') || 'https://api.meta.ai/v1').replace(/\/$/, '');
const PARTIAL = ' If a value is only partly readable, give the characters you can read and write ? for each one you cannot.';
const system =
  type === 'salary-slip'
    ? 'You are an income-proof OCR engine. Read the salary slip image and return ONLY a JSON object with these keys: documentType ("salary-slip"), fullName (employee name), employerName, payPeriod, monthlyGross (gross monthly earnings, digits only), annualIncome, bankAccountNumber (digits only or null), uan (digits only or null), idNumber (PAN if printed, else null). Return null for anything not clearly readable; never guess.' + PARTIAL + ' Do not add commentary.'
    : 'You are a KYC document OCR engine. Read the identity document image and return ONLY a JSON object with these keys: documentType ("pan" or "aadhaar"), fullName, dob (DD/MM/YYYY), gender ("Male"/"Female"/null), idNumber (the PAN or Aadhaar number exactly as printed, digits/letters only), fatherName, address, pincode (6 digits or null). Parts of the image may be pixelated or blacked out for privacy: return null for any field you cannot read clearly and never guess or reconstruct redacted characters.' + PARTIAL + ' Do not add commentary.';
const body = {
  model: get('META_MODEL_SPARK') || 'muse-spark-1.3',
  temperature: 0,
  reasoning_effort: 'low',
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: [{ type: 'text', text: `Extract the fields from this ${type === 'salary-slip' ? 'salary slip' : 'identity document'}.` }, { type: 'image_url', image_url: { url } }] },
  ],
};
const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${get('META_MODEL_API_KEY')}` }, body: JSON.stringify(body) });
console.log('status', res.status);
const j = await res.json();
console.log(JSON.stringify(j.choices?.[0]?.message?.content ?? j).slice(0, 700));
