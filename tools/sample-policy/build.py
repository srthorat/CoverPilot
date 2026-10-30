#!/usr/bin/env python3
"""Builds the two fictional sample policy PDFs used by the demo.

    python3 tools/sample-policy/build.py            # writes two HTML files next to this script
    then render each to PDF with the gstack browse binary (see README.md)

Everything is fictional: NexaSure is not a real insurer and every identifier is labelled as demo.
The personal values (name, PAN, Aadhaar, mobile, email) are fictional on purpose, so the app's
masking of personal numbers can be shown on a document that looks real.
"""

import base64
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
LOGO = base64.b64encode((HERE.parent.parent / "omni_browse/public/brand/nexasure-mark.png").read_bytes()).decode()

CSS = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 9.6pt; line-height: 1.42; color: #1b1f33; }
.page { position: relative; width: 210mm; height: 296.5mm; padding: 13mm 15mm 17mm; overflow: hidden; page-break-after: always; background: #fff; }
.page:last-child { page-break-after: auto; }
.wm { position: absolute; left: 0; right: 0; top: 118mm; text-align: center; font-size: 120pt; font-weight: 700; letter-spacing: 8pt; color: rgba(88,43,232,.055); transform: rotate(-28deg); pointer-events: none; }
.logo { display: inline-block; background: url(data:image/png;base64,__LOGO__) center/contain no-repeat; }
.lh { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #582be8; padding-bottom: 6px; margin-bottom: 8px; }
.lh .brand { display: flex; align-items: center; gap: 10px; }
.lh .logo { width: 62px; height: 51px; border-radius: 6px; }
.lh .name { font-size: 19pt; font-weight: 700; color: #130a3a; letter-spacing: -.3pt; line-height: 1.05; }
.lh .tag { font-size: 8pt; color: #5a5f7a; }
.lh .meta { text-align: right; font-size: 7.6pt; color: #4a4f68; line-height: 1.35; }
.lh.small .logo { width: 44px; height: 36px; }
.lh.small .name { font-size: 13pt; }
h1 { font-size: 15.5pt; margin: 6px 0 2px; color: #130a3a; }
.sub { color: #5a5f7a; font-size: 8.6pt; margin-bottom: 7px; }
h2 { font-size: 10.6pt; margin: 10px 0 3px; padding: 2px 7px; background: #efeaff; color: #24135e; border-left: 3px solid #582be8; }
h3 { font-size: 9.6pt; margin: 6px 0 1px; color: #24135e; }
p { margin: 2px 0 4px; }
table { width: 100%; border-collapse: collapse; margin: 3px 0 6px; font-size: 9pt; }
td, th { border: 1px solid #c9c6d8; padding: 3px 6px; vertical-align: top; text-align: left; }
th { background: #f4f1ff; font-weight: 700; }
table.t4 td { width: 31%; }
table.t4 td.k { width: 19%; }
td.k { width: 36%; background: #fbfaff; font-weight: 600; color: #2b2f4a; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.box { border: 1px solid #c9c6d8; padding: 5px 8px; border-radius: 4px; background: #fcfbff; }
.box h3 { margin-top: 0; }
.note { background: #f4f0ff; border: 1px solid #cdbdff; padding: 4px 8px; font-size: 8.6pt; margin: 5px 0; }
.demo { color: #7b2d00; font-size: 8pt; }
ol, ul { margin: 2px 0 4px 16px; padding: 0; }
li { margin: 1px 0; }
.sig { margin-top: 10px; display: flex; justify-content: space-between; align-items: flex-end; }
.sig .hand { font-family: "Snell Roundhand", "Brush Script MT", cursive; font-size: 24pt; color: #1f3a8a; line-height: 1; }
.foot { position: absolute; left: 15mm; right: 15mm; bottom: 7mm; border-top: 1px solid #c9c6d8; padding-top: 3px; font-size: 7.6pt; color: #5a5f7a; display: flex; justify-content: space-between; }
.foot b { color: #3a2a8a; }
""".replace("__LOGO__", LOGO)

IDENT = """
<table>
<tr><td class="k">Insurer</td><td>NexaSure, an AI-first digital insurance company <span class="demo">(fictional demo insurer)</span></td></tr>
<tr><td class="k">Product</td><td>NexaSure Flexi Shield, individual pure term life insurance</td></tr>
<tr><td class="k">UIN</td><td>000N001V01 <span class="demo">(demo product, not registered with IRDAI)</span></td></tr>
<tr><td class="k">IRDAI registration / CIN</td><td>Not applicable, fictional demo insurer / Not applicable (fictional)</td></tr>
<tr><td class="k">Registered office</td><td>NexaSure Demo Tower, 1 Sample Road, Pune 411000 <span class="demo">(fictional address)</span></td></tr>
<tr><td class="k">Customer care</td><td>1800-000-0000 <span class="demo">(demo)</span> · care@nexasure.example · nexasure.example</td></tr>
</table>"""

HOLDER = """
<table class="t4">
<tr><td class="k">Policyholder and life assured</td><td>Rahul Shankar Sharma</td><td class="k">Date of birth</td><td>14/08/1992</td></tr>
<tr><td class="k">Gender</td><td>Male</td><td class="k">PAN</td><td>ABCPS1234K</td></tr>
<tr><td class="k">Aadhaar</td><td>4321 8765 9012</td><td class="k">Mobile</td><td>9876543210</td></tr>
<tr><td class="k">Email</td><td colspan="3">rahul.sharma@example.com</td></tr>
<tr><td class="k">Address</td><td colspan="3">402, Sea Breeze Apartments, Marine Drive, Mumbai 400001</td></tr>
</table>"""


def page(n, total, body, first=False, kind="good"):
    if first:
        title = "Policy Document and Schedule" if kind == "good" else "Proposed Policy Document"
        head = f"""<div class="lh"><div class="brand"><span class="logo"></span><div><div class="name">NexaSure</div><div class="tag">AI-first digital insurance company</div></div></div>
<div class="meta">Policy no. NXS-DEMO-2026-000123<br>Proposal no. NXP-DEMO-4821<br>UIN 000N001V01 (demo)</div></div>
<h1>{title}</h1><div class="sub">NexaSure Flexi Shield · individual pure term life insurance · SAMPLE DOCUMENT FOR DEMONSTRATION, fictional insurer, not an issued policy</div>"""
    else:
        head = """<div class="lh small"><div class="brand"><span class="logo"></span><div><div class="name">NexaSure</div></div></div>
<div class="meta">Policy no. NXS-DEMO-2026-000123 · Flexi Shield · UIN 000N001V01 (demo)</div></div>"""
    return f"""<section class="page"><div class="wm">SAMPLE</div>{head}{body}
<div class="foot"><span><b>NexaSure Flexi Shield</b> · SAMPLE DOCUMENT FOR DEMONSTRATION · fictional insurer, not an issued policy</span><span>Page {n} of {total}</span></div></section>"""


def good():
    p1 = f"""{IDENT}<h2>Policyholder</h2>{HOLDER}
<h2>Policy schedule</h2>
<table class="t4">
<tr><td class="k">Policy number</td><td>NXS-DEMO-2026-000123</td><td class="k">Proposal number</td><td>NXP-DEMO-4821</td></tr>
<tr><td class="k">Date of proposal</td><td>29 Oct 2026</td><td class="k">Date of issue</td><td>30 Oct 2026</td></tr>
<tr><td class="k">Policy commencement</td><td>30 Oct 2026</td><td class="k">Policy term</td><td>30 years</td></tr>
<tr><td class="k">Policy expiry</td><td>29 Oct 2056</td><td class="k">Premium payment term</td><td>30 years</td></tr>
<tr><td class="k">Sum assured</td><td>1.5 crore rupees (₹1,50,00,000)</td><td class="k">Premium payment mode</td><td>Monthly</td></tr>
<tr><td class="k">Premium due date</td><td>5th of every month</td><td class="k">Grace period</td><td>15 days (monthly), 30 days (other modes)</td></tr>
<tr><td class="k">Nominee and share</td><td>One nominee, 100 percent</td><td class="k">Appointee</td><td>Not applicable (nominee is an adult)</td></tr>
</table>
<div class="note">This schedule forms part of the policy. Please read the whole document, including the terms and conditions on pages 3 and 4, and tell us within the free-look period if anything is not as you expected.</div>"""
    p2 = """<h2>Nomination details</h2>
<table><tr><th>No.</th><th>Nominee name</th><th>Relationship</th><th>Date of birth</th><th>Share</th></tr>
<tr><td>1</td><td>Priya Rahul Sharma</td><td>Spouse</td><td>19/08/1996</td><td>100%</td></tr></table>
<table class="t4">
<tr><td class="k">Appointee (nominee under 18)</td><td>Not applicable (the nominee is an adult)</td><td class="k">Section 6, Married Women's Property Act trust</td><td>No</td></tr></table>
<h2>Premium</h2>
<table><tr><th>Item</th><th>Monthly amount</th></tr>
<tr><td>Base cover, 1.5 crore rupees, non-smoker rate</td><td>₹1,050</td></tr>
<tr><td>Riders selected</td><td>None (base cover only)</td></tr>
<tr><td><b>Total monthly premium</b></td><td><b>₹1,050</b></td></tr></table>
<p>GST: exempt on individual life insurance premiums from 22 Sep 2025, so none is added. The premium stays fixed for the thirty-year term. Non-smokers with no tobacco use in the last twelve months receive a twenty percent discount, already included.</p>
<h2>Benefits</h2>
<h3>Death benefit</h3><p>If the life assured dies during the policy term while the policy is in force, the sum assured of 1.5 crore rupees is paid to the nominee, subject to the terms and conditions of this policy.</p>
<h3>No maturity benefit</h3><p>This is a pure term policy. Nothing is paid if the life assured survives the policy term.</p>
<h2>Riders available (not selected on this policy)</h2>
<table><tr><th>Rider</th><th>What it pays</th><th>Cost a month</th></tr>
<tr><td>Critical illness</td><td>Lump sum of 10 lakh, 25 lakh or 50 lakh rupees on diagnosis of a covered critical illness</td><td>₹89 / ₹149 / ₹269</td></tr>
<tr><td>Accidental death and disability</td><td>50 lakh rupees lump sum, or 1 lakh rupees a month for 100 months</td><td>₹79 / ₹129</td></tr>
<tr><td>Waiver of premium</td><td>Future premiums waived on a covered permanent disability</td><td>₹42</td></tr>
<tr><td>Hospital daily cash</td><td>2,000 rupees for each day of hospitalisation</td><td>₹55</td></tr></table>
<p>The critical illness rider carries, in this demo product, a ninety-day waiting period from the start and a fourteen-day survival period after diagnosis before the lump sum is paid. These are NexaSure demo terms, not an IRDAI rule. Riders can be added only before issue.</p>"""
    p3 = """<h2>Terms and conditions (1 of 2)</h2>
<h3>1. Definitions</h3><p>"Policyholder" is the person who owns the policy. "Life assured" is the person whose life is covered. "Nominee" is the person named to receive the sum assured. "Policy year" runs from the commencement date.</p>
<h3>2. Grace period</h3><p>A grace period of thirty days from the premium due date is allowed for quarterly, half-yearly and annual premiums, and fifteen days for monthly premiums. No penalty or late fee is charged and cover continues without a break during the grace period. Single premium policies have no grace period.</p>
<h3>3. Free-look period</h3><p>You have thirty days from receiving this policy document to review it. If you do not agree with any term you may return the policy for cancellation, whatever your reason. The refund is the premium paid minus a proportionate risk premium for the period covered, the cost of any medical examination and the stamp duty. It is not always a full refund.</p>
<h3>4. Lapse and revival</h3><p>If a premium is not paid by the end of the grace period the policy lapses and cover stops. A lapsed policy may be revived within five years from the first unpaid premium, as IRDAI's Regulations 2024 define the revival period for non-linked policies, by paying the unpaid premiums with interest. A health declaration or medical examination may be required. As a NexaSure demo term (IRDAI sets no rule for riders of a term plan), riders lapse when the base policy lapses and are restored with it if the policy is revived within five years of the first unpaid premium, subject to the same health declaration or medical examination. This demo product has no surrender value and no paid-up value.</p>
<h3>5. Nomination</h3><p>You may name one or more nominees and the share each receives, which must total one hundred percent. If a nominee is under eighteen an adult appointee must be named. A policy taken under section 6 of the Married Women's Property Act is held in trust for the wife and children, and its beneficiaries cannot then be changed.</p>
<h3>6. Assignment</h3><p>The policy may be assigned under section 38 of the Insurance Act 1938 by written notice to NexaSure. An assignment replaces any earlier nomination.</p>
<h3>7. Premium notices and updates</h3><p>Please keep your mobile number, address and bank details up to date so premium notices and claim payments are not delayed.</p>"""
    p4 = """<h2>Terms and conditions (2 of 2)</h2>
<h3>8. Suicide</h3><p>If the life assured dies by suicide within twelve months of the date the risk started, or of a revival, the nominee receives at least eighty percent of the premiums paid or the surrender value, whichever is higher, provided the policy is in force. Death by suicide after twelve months is not excluded for this reason.</p>
<h3>9. Section 45 of the Insurance Act 1938</h3><p>After three years from the latest of the date of issue, the date the risk began, the revival date or the rider date, no life insurance policy can be called in question on any ground. Within those three years it can be questioned only for fraud, or for a wrong or hidden fact that matters to the life expectancy, and the insurer must give its grounds in writing. If a claim is rejected for a misstatement the premiums collected are returned within ninety days.</p>
<h3>10. Exclusions</h3><p>Apart from the suicide provision above, this policy has no general exclusion for the death benefit. Rider benefits carry the limits stated on page 2.</p>
<h3>11. Claims procedure</h3><p>The nominee should inform NexaSure as soon as possible through the portal or customer care. Documents usually needed: the claim form, the original policy document, the death certificate, the nominee's identity and bank details, and further papers if the death needs investigation. By rule a death claim must be settled within fifteen days of intimation, or within forty-five days if it needs investigation. NexaSure aims to respond within two hours; this is a demo target, not an audited result.</p>
<h3>12. Tax</h3><p>Under the old tax regime premiums may qualify for a deduction within the overall limit of 1.5 lakh rupees a year under sections 123 and 126 of the Income-tax Act 2025. A death benefit is generally tax free under section 10(10D). This is general information, not tax advice.</p>"""
    p5 = """<h2>Customer Information Sheet (summary)</h2>
<table><tr><th>Item</th><th>What this policy says</th></tr>
<tr><td>Product UIN</td><td>000N001V01 (demo product, not registered with IRDAI)</td></tr>
<tr><td>What it is</td><td>Pure term life cover, no maturity benefit</td></tr>
<tr><td>Sum assured / term</td><td>1.5 crore rupees / 30 years</td></tr>
<tr><td>Premium</td><td>₹1,050 a month, fixed, no GST</td></tr>
<tr><td>If you miss a payment</td><td>15 days of grace (monthly), then the policy lapses; revival within five years of the first unpaid premium</td></tr>
<tr><td>Cancelling</td><td>Thirty days free-look, refund net of risk premium, medical cost and stamp duty</td></tr>
<tr><td>Suicide</td><td>First twelve months: at least 80 percent of premiums or surrender value</td></tr>
<tr><td>Contestability</td><td>Three years under section 45</td></tr></table>
<h2>Grievance redressal</h2>
<ol><li><b>NexaSure grievance officer</b>: write to care@nexasure.example. Your complaint is acknowledged immediately and the insurer must resolve it within fourteen days.</li>
<li><b>IRDAI Bima Bharosa</b>: if you are not satisfied, escalate through IRDAI's grievance portal or its toll-free helpline.</li>
<li><b>Insurance Ombudsman</b>: within one year of the insurer's rejection or reply, free of charge and without a lawyer. An award is capped at fifty lakh rupees and the insurer must comply within thirty days.</li></ol>
<h2>Declaration</h2>
<p>The policyholder has declared that the answers in the proposal form are true and complete and that NexaSure may rely on them. The proposal form forms the basis of this contract. Premium for the first month has been received (demo payment, no money moved).</p>
<div class="sig"><div><div class="hand">A. Menon</div><div>For NexaSure, Authorised Signatory</div><div class="demo">Fictional signatory, demo document</div></div>
<div style="text-align:right">Place: Pune<br>Date: 30 Oct 2026</div></div>"""
    pages = [p1, p2, p3, p4, p5]
    return "".join(page(i + 1, 5, b, first=(i == 0)) for i, b in enumerate(pages))


def issues():
    p1 = f"""{IDENT}<h2>Policyholder</h2>{HOLDER}
<h2>Proposed policy schedule</h2>
<table class="t4">
<tr><td class="k">Policy number</td><td>NXS-DEMO-2026-000123 (proposed)</td><td class="k">Proposal number</td><td>NXP-DEMO-4821</td></tr>
<tr><td class="k">Date of proposal</td><td>29 Oct 2026</td><td class="k">Policy term</td><td>30 years</td></tr>
<tr><td class="k">Sum assured</td><td>1 crore rupees (₹1,00,00,000)</td><td class="k">Premium payment mode</td><td>Monthly</td></tr>
<tr><td class="k">Monthly premium</td><td>₹1,180 (no GST)</td><td class="k">Premium due date</td><td>5th of every month</td></tr>
</table>
<div class="note">This is a proposed policy document prepared before issue. It is not an issued policy and is not proof of insurance. Please read the whole document, including the terms on page 3.</div>"""
    p2 = """<h2>Premium</h2>
<table><tr><th>Item</th><th>Monthly amount</th></tr>
<tr><td>Base cover, 1 crore rupees</td><td>₹1,180</td></tr>
<tr><td>Riders included in this schedule</td><td>None</td></tr>
<tr><td><b>Total monthly premium</b></td><td><b>₹1,180</b></td></tr></table>
<p>GST: exempt on individual life insurance premiums from 22 Sep 2025, so none is added. The premium is fixed for the policy term.</p>
<h2>Benefits</h2>
<h3>Death benefit</h3><p>If the life assured dies during the policy term while the policy is in force, the sum assured of 1 crore rupees is paid, subject to the terms and conditions of this policy.</p>
<h3>No maturity benefit</h3><p>This is a pure term policy. Nothing is paid if the life assured survives the policy term.</p>
<h2>Riders</h2>
<table><tr><th>Rider</th><th>Status in this schedule</th></tr>
<tr><td>Critical illness</td><td>Excluded from this schedule</td></tr>
<tr><td>Accidental death and disability</td><td>Not included</td></tr>
<tr><td>Waiver of premium</td><td>Not included</td></tr>
<tr><td>Hospital daily cash</td><td>Not included</td></tr></table>"""
    p3 = """<h2>Terms and conditions</h2>
<h3>1. Grace period</h3><p>A grace period of ten days from the premium due date is allowed for monthly premiums. During the grace period cover continues.</p>
<h3>2. Lapse and revival</h3><p>If a premium is not paid by the end of the grace period the policy lapses. A lapsed policy may be revived within five years from the first unpaid premium by paying the unpaid premiums with interest, subject to a health declaration. As a NexaSure demo term (IRDAI sets no rule for riders of a term plan), riders lapse when the base policy lapses and are restored with it if the policy is revived within five years of the first unpaid premium, subject to the same health declaration or medical examination. This demo product has no surrender value and no paid-up value.</p>
<h3>3. Free-look period</h3><p>You have thirty days from receiving this policy document to review it and may return it for cancellation. The refund is the premium paid minus a proportionate risk premium, the cost of any medical examination and the stamp duty.</p>
<h3>4. Suicide</h3><p>If the life assured dies by suicide within twenty-four months of the date the risk started or of a revival, the policy ends and no premiums are refunded. Death by suicide after twenty-four months is not excluded for this reason.</p>
<h3>5. Contestability</h3><p>After two years from the date of issue, no life insurance policy can be called in question on any ground. Within those two years it can be questioned for fraud or for a wrong or hidden fact that matters to the life expectancy.</p>
<h3>6. Exclusions</h3><p>Apart from the suicide provision above, this policy has no general exclusion for the death benefit.</p>"""
    p4 = """<h2>Claims and complaints</h2>
<h3>Making a claim</h3><p>Please inform NexaSure as soon as possible through the portal or customer care. Documents usually needed: the claim form, the original policy document, the death certificate, the claimant's identity and bank details, and further papers if the death needs investigation. By rule a death claim must be settled within fifteen days of intimation, or within forty-five days if it needs investigation.</p>
<h3>Complaints</h3><ol><li><b>NexaSure grievance officer</b>: care@nexasure.example. A complaint is acknowledged immediately and resolved within fourteen days.</li>
<li><b>IRDAI Bima Bharosa</b>: escalate through IRDAI's grievance portal or helpline if you are not satisfied.</li>
<li><b>Insurance Ombudsman</b>: within one year, free of charge and without a lawyer; an award is capped at fifty lakh rupees.</li></ol>
<h2>Customer Information Sheet (summary)</h2>
<table><tr><th>Item</th><th>What this document says</th></tr>
<tr><td>Product UIN</td><td>000N001V01 (demo product, not registered with IRDAI)</td></tr>
<tr><td>What it is</td><td>Pure term life cover, no maturity benefit</td></tr>
<tr><td>Sum assured / term</td><td>1 crore rupees / 30 years</td></tr>
<tr><td>Premium</td><td>₹1,180 a month, fixed, no GST</td></tr>
<tr><td>If you miss a payment</td><td>10 days of grace (monthly), then lapse; revival within five years</td></tr>
<tr><td>Cancelling</td><td>Thirty days free-look, refund net of deductions</td></tr></table>
<h2>Declaration</h2>
<p>The proposer has declared that the answers in the proposal form are true and complete. This proposed policy document is issued for review and becomes a policy only after NexaSure issues it.</p>
<div class="sig"><div><div class="hand">A. Menon</div><div>For NexaSure, Authorised Signatory</div><div class="demo">Fictional signatory, demo document</div></div>
<div style="text-align:right">Place: Pune<br>Date: 29 Oct 2026</div></div>"""
    pages = [p1, p2, p3, p4]
    return "".join(page(i + 1, 4, b, first=(i == 0), kind="issues") for i, b in enumerate(pages))


def doc(title, body):
    return f'<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><meta name="author" content="NexaSure (fictional)"><style>{CSS}</style></head><body>{body}</body></html>'


(HERE / "sample-policy.html").write_text(doc("NexaSure Flexi Shield - Policy Document and Schedule (SAMPLE, fictional)", good()))
(HERE / "sample-policy-with-issues.html").write_text(doc("NexaSure Flexi Shield - Proposed Policy Document (SAMPLE, fictional)", issues()))
print("wrote", HERE / "sample-policy.html", HERE / "sample-policy-with-issues.html")
