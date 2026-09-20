# Local browser dependencies

These files mirror the scripts previously loaded by `index.html` from CDNs.
They are served with the app and precached by the service worker so the first
completed online installation can subsequently start offline.

| File | Original source | License |
| --- | --- | --- |
| marked.min.js | https://cdn.jsdelivr.net/npm/marked/marked.min.js (previously unpinned; captured version 15.0.12) | MIT |
| purify.min.js | https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js | Apache-2.0 or MPL-2.0 |
| localforage.min.js | https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js | Apache-2.0 |
| html2pdf.bundle.min.js | https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js | MIT (bundled dependencies retain their notices) |
| docx.js | https://unpkg.com/docx@7.8.2/build/index.js | MIT |
| pdf.mjs, pdf.worker.mjs | pdfjs-dist@5.6.205 prebuilt build, matched main/worker pair | Apache-2.0 |
| mammoth.browser.min.js | mammoth@1.12.3 browser build | BSD-2-Clause |
| firebase-app-compat.js | https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js | Apache-2.0 |
| firebase-auth-compat.js | https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js | Apache-2.0 |
| firebase-firestore-compat.js | https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js | Apache-2.0 |

Existing pinned versions are unchanged. This is not a dependency upgrade.
Retain upstream copyright/license headers when replacing these files.
Full notices are included in the adjacent `*.LICENSE.txt` files (DOMPurify's
file includes both license alternatives; html2pdf's file includes bundled notices).
Mammoth was verified from npm integrity `sha512-kkv2MrSFk3f/w3uLsz4FG/91LdWp2j+qmp7AjG2v7w2xgX5YDxiaFlaWourXrXtyUR6335+9guyIlPBnhHLvKw==`.
AI API calls, cloud authentication/sync, and query embedding still need a network.
`js/vectors-data.js` remains optional and lazily loaded; it is cached only after use.
