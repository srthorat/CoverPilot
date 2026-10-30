// Builds fictional ID-card test images and PDFs for measuring the privacy shield on layouts other than the three
// bundled samples. Everything here is made up: the names, numbers, address and the QR-like pattern (not a real
// QR code). The face and signature are cropped from the bundled sample cards.
//
//   cd omni_browse && node ../tools/id-cards/build.mjs ../tools/id-cards/out      (needs the Playwright Chromium)
//
// Writes <name>.png / .jpg / .pdf plus manifest.json (file, document type, the fictional ID number to look for).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright lives in omni_browse/node_modules; run this from omni_browse (see the command above).
const { chromium } = createRequire(path.join(process.cwd(), 'package.json'))('@playwright/test');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(HERE, '../../omni_browse/public/samples');
const out = path.resolve(process.argv[2] || path.join(HERE, 'out'));
fs.mkdirSync(out, { recursive: true });
const b64 = (f) => fs.readFileSync(path.join(SAMPLES, f)).toString('base64');
const AAD = `data:image/png;base64,${b64('sample-aadhaar.png')}`;
const PAN = `data:image/png;base64,${b64('sample-pan.png')}`;
const photoFit = (w, h) =>
  `<div style="width:${w}px;height:${h}px;position:relative;border:1px solid #bbb;overflow:hidden;box-sizing:border-box"><div style="position:absolute;left:0;top:0;width:220px;height:260px;background:url(${AAD}) -40px -130px no-repeat;background-size:1000px 630px;transform:scale(${w / 220},${h / 260});transform-origin:0 0"></div></div>`;
const sig = (w, h) =>
  `<div style="width:${w}px;height:${h}px;position:relative;overflow:hidden"><div style="position:absolute;left:0;top:0;width:180px;height:110px;background:url(${PAN}) -770px -445px no-repeat;background-size:1000px 630px;transform:scale(${w / 180},${h / 110});transform-origin:0 0"></div></div>`;

// A QR-like pattern (three finder squares and seeded random modules), fictional and not decodable.
function qr(size, seed = 7) {
  const n = 25;
  const m = size / n;
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let r = '';
  const finder = (x, y) => {
    r += `<rect x="${x * m}" y="${y * m}" width="${7 * m}" height="${7 * m}" fill="#000"/><rect x="${(x + 1) * m}" y="${(y + 1) * m}" width="${5 * m}" height="${5 * m}" fill="#fff"/><rect x="${(x + 2) * m}" y="${(y + 2) * m}" width="${3 * m}" height="${3 * m}" fill="#000"/>`;
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      if (!inF && rnd() > 0.52) r += `<rect x="${x * m}" y="${y * m}" width="${m}" height="${m}" fill="#000"/>`;
    }
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#fff">${r}</svg>`;
}

const FONT = `font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;`;
const DEV = `font-family:"Kohinoor Devanagari","Devanagari MT",sans-serif;`;
const CARD = (inner, bg = '#fff') =>
  `<div id="card" style="position:relative;width:1000px;height:630px;background:${bg};border-radius:22px;overflow:hidden;${FONT}">${inner}</div>`;
const NOTE = (c = '#555') => `<div style="position:absolute;left:40px;bottom:14px;font-size:15px;color:${c}">SAMPLE DOCUMENT FOR DEMO PURPOSES ONLY. Fictional data.</div>`;

// ---- Aadhaar layouts
const aadhaarBilingual = () =>
  CARD(`
  <div style="height:70px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;border-bottom:8px solid #f7931e">भारत सरकार &nbsp; GOVERNMENT OF INDIA</div>
  <div style="position:absolute;left:40px;top:110px;width:190px;height:240px">${photoFit(190, 240)}</div>
  <div style="position:absolute;left:260px;top:105px;right:200px;font-size:25px;line-height:1.5">
    <div style="${DEV}font-size:27px;font-weight:600">मीरा कृष्णन नायर</div>
    <div style="font-weight:700;font-size:28px">Meera Krishnan Nair</div>
    <div>जन्म तिथि / DOB: 03/11/1989</div>
    <div>महिला / FEMALE</div>
    <div style="font-size:19px;color:#333;margin-top:6px">Address: 17, Lotus Residency, Anna Nagar, Chennai, Tamil Nadu - 600040</div>
  </div>
  <div style="position:absolute;right:40px;top:100px">${qr(150, 11)}</div>
  <div style="position:absolute;left:0;right:0;top:400px;text-align:center;font:700 58px 'Courier New',monospace;letter-spacing:4px">5128 3746 9051</div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:62px;background:#c8102e;color:#fff;font-size:26px;font-weight:700;display:flex;align-items:center;justify-content:center;${DEV}">आधार - आम आदमी का अधिकार</div>
`);
const aadhaarAltLayout = () =>
  CARD(
    `
  <div style="height:60px;background:#1b3a6b;color:#fff;font-size:24px;font-weight:600;display:flex;align-items:center;padding-left:30px">Unique Identification Authority of India</div>
  <div style="position:absolute;left:30px;top:90px;font-size:21px;color:#444">Aadhaar number</div>
  <div style="position:absolute;left:30px;top:122px;font:700 54px 'Menlo','Courier New',monospace;letter-spacing:3px">5128 3746 9051</div>
  <div style="position:absolute;left:30px;top:215px;font-size:25px;line-height:1.55;width:560px"><b style="font-size:29px">Meera Krishnan Nair</b><br>Date of birth: 03/11/1989<br>Gender: Female<br><span style="font-size:19px;color:#333">17, Lotus Residency, Anna Nagar, Chennai, Tamil Nadu - 600040</span></div>
  <div style="position:absolute;right:30px;top:90px">${photoFit(200, 250)}</div>
  <div style="position:absolute;right:30px;top:360px">${qr(170, 3)}</div>
  ${NOTE()}
`,
    '#f3f6fb',
  );
const eAadhaarLetter = () => `<div id="card" style="width:794px;height:1123px;background:#fff;${FONT}position:relative;padding:36px;box-sizing:border-box">
  <div style="font-size:12px;color:#444;display:flex;justify-content:space-between"><span>Enrolment No.: 1234/56789/01234 (fictional)</span><span>Fictional letter, demo only</span></div>
  <div style="font-size:15px;margin-top:20px;line-height:1.5">To<br><b>Meera Krishnan Nair</b><br>17, Lotus Residency, Anna Nagar<br>Chennai, Tamil Nadu - 600040<br>Mobile: 90000 00000</div>
  <div style="margin-top:36px;font-size:14px;line-height:1.5;color:#222">Your Aadhaar is a unique, lifelong identity number (demo wording). Keep this letter safe.</div>
  <div style="margin:40px auto 0;width:620px;height:360px;border:2px solid #222;position:relative;background:#fff">
    <div style="height:42px;background:#f7931e;color:#000;font-weight:700;font-size:18px;display:flex;align-items:center;padding-left:14px">Government of India · Aadhaar (fictional)</div>
    <div style="position:absolute;left:18px;top:62px">${photoFit(120, 150)}</div>
    <div style="position:absolute;left:160px;top:60px;font-size:17px;line-height:1.55"><b style="font-size:20px">Meera Krishnan Nair</b><br>DOB: 03/11/1989<br>Female<br><span style="font-size:13px;color:#333">17, Lotus Residency, Anna Nagar, Chennai - 600040</span></div>
    <div style="position:absolute;right:18px;top:60px">${qr(110, 5)}</div>
    <div style="position:absolute;left:0;right:0;bottom:30px;text-align:center;font:700 34px 'Courier New',monospace;letter-spacing:3px">5128 3746 9051</div>
  </div></div>`;

// ---- PAN layouts
const panNewQr = () =>
  CARD(
    `
  <div style="height:78px;background:#12467f;color:#fff;display:flex;align-items:center;padding-left:34px;font-size:28px;font-weight:700">आयकर विभाग / INCOME TAX DEPARTMENT</div>
  <div style="position:absolute;left:34px;top:110px">${photoFit(170, 210)}</div>
  <div style="position:absolute;left:230px;top:104px;font-size:20px;color:#333">Permanent Account Number<div style="font:700 44px 'Courier New',monospace;color:#000;margin-top:2px">BKQPN7392R</div></div>
  <div style="position:absolute;left:230px;top:200px;font-size:20px;color:#333">Name<div style="font-size:28px;font-weight:700;color:#000">MEERA KRISHNAN NAIR</div></div>
  <div style="position:absolute;left:230px;top:274px;font-size:20px;color:#333">Date of Birth<div style="font-size:26px;font-weight:700;color:#000">03/11/1989</div></div>
  <div style="position:absolute;right:34px;top:100px">${qr(160, 9)}</div>
  <div style="position:absolute;left:34px;bottom:70px">${sig(200, 80)}</div>
  ${NOTE()}
`,
    '#fbf9f2',
  );
const panOldScan = () =>
  CARD(
    `
  <div style="height:70px;background:#1c4e8e;color:#fff;display:flex;align-items:center;padding-left:30px;font:700 26px Georgia,'Times New Roman',serif">INCOME TAX DEPARTMENT · GOVT. OF INDIA</div>
  <div style="position:absolute;right:36px;top:96px">${photoFit(180, 220)}</div>
  <div style="position:absolute;left:36px;top:100px;font:20px Georgia,serif;color:#222">Permanent Account Number</div>
  <div style="position:absolute;left:36px;top:128px;font:700 50px 'Courier New',monospace;letter-spacing:2px;color:#000">BKQPN7392R</div>
  <div style="position:absolute;left:36px;top:210px;font:20px Georgia,serif">Name</div>
  <div style="position:absolute;left:36px;top:236px;font:700 30px Georgia,serif">MEERA KRISHNAN NAIR</div>
  <div style="position:absolute;left:36px;top:300px;font:20px Georgia,serif">Father's Name</div>
  <div style="position:absolute;left:36px;top:326px;font:700 28px Georgia,serif">KRISHNAN NAIR</div>
  <div style="position:absolute;left:36px;top:395px;font:20px Georgia,serif">Date of Birth</div>
  <div style="position:absolute;left:36px;top:420px;font:700 28px Georgia,serif">03/11/1989</div>
  <div style="position:absolute;right:50px;bottom:40px">${sig(220, 90)}</div>
  ${NOTE('#444')}
`,
    '#efe9d8',
  );
const ePanPdf = () => `<div id="card" style="width:794px;height:1123px;background:#fff;${FONT}position:relative;padding:40px;box-sizing:border-box">
  <div style="text-align:center;font-weight:700;font-size:18px">e-PAN (fictional, demo only)</div>
  <div style="margin:30px auto 0;width:640px;height:400px;border:2px solid #12467f;position:relative;background:#f4f7fb">
    <div style="height:46px;background:#12467f;color:#fff;font-weight:700;font-size:18px;display:flex;align-items:center;padding-left:16px">INCOME TAX DEPARTMENT · GOVT. OF INDIA</div>
    <div style="position:absolute;left:20px;top:64px">${photoFit(130, 160)}</div>
    <div style="position:absolute;left:176px;top:62px;font-size:14px;color:#333">Permanent Account Number<div style="font:700 32px 'Courier New',monospace;color:#000">BKQPN7392R</div></div>
    <div style="position:absolute;left:176px;top:140px;font-size:14px;color:#333">Name<div style="font-size:20px;font-weight:700;color:#000">MEERA KRISHNAN NAIR</div></div>
    <div style="position:absolute;left:176px;top:200px;font-size:14px;color:#333">Date of Birth<div style="font-size:18px;font-weight:700;color:#000">03/11/1989</div></div>
    <div style="position:absolute;right:20px;top:64px">${qr(110, 21)}</div>
    <div style="position:absolute;left:20px;bottom:20px">${sig(160, 64)}</div>
  </div></div>`;

// ---- Salary slips
const slipTable = () =>
  CARD(`
  <div style="padding:26px 34px;font-family:'Times New Roman',serif;color:#111">
  <div style="text-align:center;font-size:30px;font-weight:700">Orchid Analytics Pvt. Ltd.</div>
  <div style="text-align:center;font-size:18px;margin-bottom:12px">Pay slip for the month of June 2026</div>
  <table style="width:100%;border-collapse:collapse;font-size:19px" border="1" cellpadding="6">
    <tr><td>Employee name</td><td><b>Meera Krishnan Nair</b></td><td>Employee code</td><td>OA-3381</td></tr>
    <tr><td>PAN</td><td style="font-family:'Courier New',monospace">BKQPN7392R</td><td>UAN</td><td style="font-family:'Courier New',monospace">101234567890</td></tr>
    <tr><td>Bank account</td><td style="font-family:'Courier New',monospace">431002987654</td><td>Designation</td><td>Data Analyst</td></tr>
  </table>
  <table style="width:100%;border-collapse:collapse;font-size:19px;margin-top:14px" border="1" cellpadding="6">
    <tr><th align="left">Earnings</th><th align="right">Amount</th><th align="left">Deductions</th><th align="right">Amount</th></tr>
    <tr><td>Basic</td><td align="right">62,000.00</td><td>Provident fund</td><td align="right">7,440.00</td></tr>
    <tr><td>HRA</td><td align="right">31,000.00</td><td>Professional tax</td><td align="right">200.00</td></tr>
    <tr><td>Special allowance</td><td align="right">27,000.00</td><td>TDS</td><td align="right">11,800.00</td></tr>
    <tr><td><b>Gross monthly</b></td><td align="right"><b>1,20,000.00</b></td><td><b>Net pay</b></td><td align="right"><b>1,00,560.00</b></td></tr>
  </table>
  <div style="font-size:15px;margin-top:10px;color:#333">Computer generated, fictional demo document. Annual CTC 14,40,000.</div></div>
`);
const slipLandscapePdf = () => `<div id="card" style="width:1123px;height:794px;background:#fff;${FONT}padding:36px;box-sizing:border-box;color:#111;position:relative">
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0d6e6e;padding-bottom:8px"><b style="font-size:26px;color:#0d6e6e">Orchid Analytics Pvt. Ltd.</b><span style="font-size:15px">Salary slip · June 2026 (fictional)</span></div>
  <div style="display:flex;gap:40px;margin-top:20px;font-size:17px;line-height:1.7"><div><b>Meera Krishnan Nair</b><br>Employee code: OA-3381<br>Designation: Data Analyst</div><div>Gross: ₹1,20,000.00<br>Net pay: ₹1,00,560.00<br>Annual CTC: ₹14,40,000</div></div>
  <table style="width:100%;border-collapse:collapse;margin-top:24px;font-size:16px" cellpadding="6"><tr style="background:#e6f2f2"><th align="left">Earnings</th><th align="right">₹</th><th align="left">Deductions</th><th align="right">₹</th></tr>
  <tr><td>Basic</td><td align="right">62,000.00</td><td>Provident fund</td><td align="right">7,440.00</td></tr><tr><td>HRA</td><td align="right">31,000.00</td><td>TDS</td><td align="right">11,800.00</td></tr><tr><td>Special allowance</td><td align="right">27,000.00</td><td>Professional tax</td><td align="right">200.00</td></tr></table>
  <div style="position:absolute;left:36px;right:36px;bottom:30px;border-top:1px solid #999;padding-top:8px;font-size:14px;color:#222;display:flex;gap:30px;flex-wrap:wrap">
    <span>PAN <span style="font-family:'Courier New',monospace">BKQPN7392R</span></span><span>UAN <span style="font-family:'Courier New',monospace">101234567890</span></span><span>A/c <span style="font-family:'Courier New',monospace">431002987654</span></span></div></div>`;

// ---- the set
const SET = [
  { name: 'ad-bilingual', type: 'aadhaar', id: '512837469051', html: aadhaarBilingual, kind: 'png' },
  { name: 'ad-bilingual-rot3', type: 'aadhaar', id: '512837469051', html: aadhaarBilingual, kind: 'png', rotate: 3 },
  { name: 'ad-bilingual-480w', type: 'aadhaar', id: '512837469051', html: aadhaarBilingual, kind: 'png', scale: 0.48 },
  { name: 'ad-bilingual-2400w', type: 'aadhaar', id: '512837469051', html: aadhaarBilingual, kind: 'png', scale: 2.4 },
  { name: 'ad-alt-layout', type: 'aadhaar', id: '512837469051', html: aadhaarAltLayout, kind: 'png' },
  { name: 'ad-phone', type: 'aadhaar', id: '512837469051', html: aadhaarBilingual, kind: 'phone' },
  { name: 'ad-eletter', type: 'aadhaar', id: '512837469051', html: eAadhaarLetter, kind: 'pdf', w: 794, h: 1123 },
  { name: 'pn-new-qr', type: 'pan', id: 'BKQPN7392R', html: panNewQr, kind: 'png' },
  { name: 'pn-old-scan', type: 'pan', id: 'BKQPN7392R', html: panOldScan, kind: 'png', rotate: -2, grain: true },
  { name: 'pn-phone', type: 'pan', id: 'BKQPN7392R', html: panNewQr, kind: 'phone' },
  { name: 'pn-epan-pdf', type: 'pan', id: 'BKQPN7392R', html: ePanPdf, kind: 'pdf', w: 794, h: 1123 },
  { name: 'sl-table', type: 'salary-slip', id: '101234567890', html: slipTable, kind: 'png' },
  { name: 'sl-landscape-pdf', type: 'salary-slip', id: '101234567890', html: slipLandscapePdf, kind: 'pdf', w: 1123, h: 794 },
  { name: 'sl-lowres', type: 'salary-slip', id: '101234567890', html: slipTable, kind: 'png', scale: 0.55 },
];

const NOISE = `<svg width="0" height="0" style="position:absolute"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/></filter></svg>`;
const doc = (body, w, h, extra = '') => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#ddd;width:${w}px;height:${h}px;overflow:hidden;${extra}">${NOISE}${body}`;

const browser = await chromium.launch();
const manifest = [];
for (const c of SET) {
  const dsf = c.kind === 'png' ? (c.scale ?? 1) : 1;
  const ctx = await browser.newContext({ deviceScaleFactor: dsf, viewport: { width: c.w || 1000, height: c.h || 630 } });
  const p = await ctx.newPage();
  let file;
  if (c.kind === 'png') {
    const body = c.html();
    if (c.rotate) {
      const grain = c.grain ? `<div style="position:absolute;inset:0;filter:url(#n);opacity:.28;mix-blend-mode:multiply;pointer-events:none"></div>` : '';
      await p.setViewportSize({ width: 1100, height: 760 });
      await p.setContent(doc(`<div style="position:absolute;left:50px;top:65px;width:1000px;height:630px;transform:rotate(${c.rotate}deg);box-shadow:0 2px 10px #0004">${body}${grain}</div>`, 1100, 760, 'background:#e8e8e8'));
      file = `${c.name}.png`;
      await p.screenshot({ path: path.join(out, file) });
    } else {
      await p.setContent(doc(body, 1000, 630));
      file = `${c.name}.png`;
      await p.locator('#card').screenshot({ path: path.join(out, file) });
    }
  } else if (c.kind === 'phone') {
    await p.setViewportSize({ width: 1600, height: 1200 });
    const body = c.html();
    await p.setContent(
      doc(
        `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 40% 35%,#c9a77c,#8a6a45 70%,#5b4328)"></div>
      <div style="position:absolute;left:330px;top:300px;transform:perspective(1100px) rotateX(24deg) rotateY(-16deg) rotateZ(5deg) scale(.96);box-shadow:20px 30px 40px #0007">${body}</div>
      <div style="position:absolute;inset:0;filter:url(#n);opacity:.22;mix-blend-mode:multiply"></div>
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 55%,#0006 100%)"></div>`,
        1600,
        1200,
        'filter:blur(0.7px)',
      ),
    );
    file = `${c.name}.jpg`;
    await p.screenshot({ path: path.join(out, file), type: 'jpeg', quality: 62 });
  } else {
    await p.setContent(doc(c.html(), c.w, c.h));
    file = `${c.name}.pdf`;
    await p.pdf({ path: path.join(out, file), width: `${c.w}px`, height: `${c.h}px`, printBackground: true });
  }
  manifest.push({ file, name: c.name, type: c.type, id: c.id, kind: c.kind });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`wrote ${manifest.length} cards to ${out}`);
