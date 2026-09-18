// Dependency-free, source-grounded OFFLINE baseline/candidate evaluation.
const fs = require('fs');
const { context, evaluate, baselineRevision } = require('../tests/helpers/retrieval-context');
const cases = require('../tests/fixtures/retrieval-cases.json');
async function run() {
    const mode = process.argv.includes('--baseline') ? 'baseline' : 'candidate';
    const partition = process.argv.includes('--heldout') ? 'heldout' : 'calibration';
    const ctx = context({ baseline: mode === 'baseline' });
    const report = { mode, partition, baselineRevision, scope: 'offline: real source text; semantic API unavailable; no claim about live model quality', cases: [] };
    for (const [index, item] of cases.entries()) {
        // Alternating within each category, fixed before tuning.
        if (index % 2 !== (partition === 'heldout' ? 1 : 0)) continue;
        ctx.chatMessages = (item.history || []).map(content => ({ role: 'user', content }));
        ctx.chatMessages.push({ role: 'user', content: item.query });
        ctx.query = item.query;
        const start = Date.now();
        const rows = await evaluate(ctx, 'findRelevantClauses(query)');
        const ids = rows.map(row => `${row.type}:${String(row.id).replace(new RegExp('^' + row.type + '\\s*', 'i'), '').toUpperCase()}`);
        const hits = item.required.filter(id => ids.includes(id));
        const forbidden = (item.forbidden || []).filter(id => ids.includes(id));
        report.cases.push({ id: item.id, category: item.category, required: item.required, returned: ids, hits: hits.length,
            passed: hits.length === item.required.length && !forbidden.length && (!item.expectEmpty || !ids.length), forbidden, elapsedMs: Date.now() - start });
    }
    report.requiredHits = report.cases.reduce((n, row) => n + row.hits, 0);
    report.requiredTotal = report.cases.reduce((n, row) => n + row.required.length, 0);
    report.recall = report.requiredHits / report.requiredTotal;
    report.passed = report.cases.filter(row => row.passed).length;
    report.total = report.cases.length;
    const output = process.argv.indexOf('--output');
    // Generated measurement artifact, never modifies runtime code or fixture labels.
    if (output !== -1) fs.writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
