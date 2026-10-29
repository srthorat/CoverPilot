# Sample policy PDFs

`python3 tools/sample-policy/build.py` writes `sample-policy.html` (5 pages, consistent with the app's default proposal) and `sample-policy-with-issues.html` (4 pages, deliberate problems for Integrity Guardian to find). Render each with the gstack browse binary: `$B goto file://<html>; $B pdf omni_browse/public/samples/<name>.pdf --format a4 --print-background --tagged --outline`. NexaSure and every identifier are fictional and labelled as demo; the personal values are fictional so personal-number masking can be shown.
