// Print fingerprints of the checked-in reference corpus; caller installs via apply_patch.
const fs = require('fs');
const vm = require('vm');
const { readContracts } = require('../tests/helpers/retrieval-context');
const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync('js/ai-retrieval.js', 'utf8'), ctx);
const hashes = {};
ctx.AIRetrieval.rows(readContracts()).forEach(row => { hashes[ctx.AIRetrieval.identity(row)] = row.sourceHash; });
console.log('// Checked-in MD base corpus fingerprints; freshness checks, not authentication.\n' +
    'globalThis.RETRIEVAL_SOURCE_HASHES = Object.freeze(' + JSON.stringify(hashes, null, 2) + ');');
