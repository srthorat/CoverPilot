# Sources for the co-browsing agent's own knowledge (cobrowse-*.md). Every line starts with "# ", so the loader skips this file.
# Insurance Act 1938 section 39 (nomination, appointee for a minor, beneficial title for parents, spouse and children): https://lawgist.in/insurance-act/39 and https://indiankanoon.org/doc/610691/ (consolidated text on secondary hosts; the Gazette text governs)
# Insurance Act 1938 section 45 and the IRDAI Master Circular on Life Insurance Products, 12 Jun 2024, para 6 (three-year rule), para 5 (free look), para 8 (grace period), para 21 (suicide): https://irdai.gov.in
# IRDAI Master Circular on Protection of Policyholders' Interests 2024, 5 Sep 2024: https://www.caalley.com/irdai_mc/MC_Protection_of_Policyholders_interests_2024.pdf
# IRDAI Master Guidelines on Anti Money Laundering and Counter Financing of Terrorism, 1 Aug 2022: https://irdai.gov.in
# GST Council 56th meeting press release, 3 Sep 2025 (individual life insurance exempt from 22 Sep 2025): https://gstcouncil.gov.in
# Income-tax Rule 114B, life insurance premium above 50,000 rupees in a financial year requires PAN, otherwise Form 60: https://www.incometaxindia.gov.in
# Married Women's Property Act 1874 section 6 (secondary summary on taxguru.in)
# Controller of Certifying Authorities, eSign: https://cca.gov.in/eSign.html
# Insurer guidance on income proof and age proof (practice varies by insurer): HDFC Life https://www.hdfclife.com/term-insurance-plans/documents-required-for-term-insurance , Axis Max Life https://www.axismaxlife.com/blog/term-insurance/what-are-the-documents-required-for-term-plan
# Insurer guidance on tobacco look-back periods (12 to 24 months, varies by insurer): Aditya Birla Sun Life Insurance https://lifeinsurance.adityabirlacapital.com/articles/term-insurance/term-life-insurance-plan-for-smokers-vs-non-smokers/ , HDFC Life term insurance pages
# App behaviour (fields, formats, step-gate messages, Confirm and Undo, discrepancy card, pause and resume, e-sign, draft proposed policy): read from omni_browse/src/app/InsuranceApp.tsx and cited as "NexaSure app behaviour (not a regulation)"
# NexaSure demo product terms (prices 790 / 1050 / 1380 a month, rider prices, waiting 90 days, survival 14 days, age 18 to 65, 12-month tobacco period): not regulations, consistent with benefit-ladders-tax-underwriting.md and policy-terms.md
# Hindi and Marathi glossary: everyday spoken forms written for this demo, not official translations; have a native speaker read them before relying on them
# UNVERIFIED (not confirmed from a primary source; the passages say to check with the insurer):
# UNVERIFIED: list of officially valid documents for KYC. Search results gave only secondary pages (PMLA rules summaries, bank pages); the IRDAI circular text was not read. The glossary and fields passages therefore name Aadhaar and PAN only as examples and say to check with the insurer.
# UNVERIFIED: income-tax rules renumbered from 1 April 2026 (seen in one blog); the PAN passage tells the customer to confirm the current rule.
# UNVERIFIED: how Section 39(7) beneficial title treats nominees outside parents, spouse and children (a general reading of secondary text); the passage says to ask the insurer or a lawyer.
# UNVERIFIED: no single IRDAI definition of smoker or non-smoker and no IRDAI list of income proof were found; the passages present them as insurer practice.
# DISCREPANCY TO RESOLVE (app versus knowledge): the app's hospital daily cash card says "Fixed 5,000 rupees per 24 hours, up to 60 days annually" while benefit-ladders-tax-underwriting.md, the prompt and the sample policy say 2,000 rupees a day. The hospital-cash passage uses 2,000 and tells the customer that the amount on the card on screen applies if it differs.
