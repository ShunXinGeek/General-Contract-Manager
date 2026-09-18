const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '../..');
const baselineRevision = '50fd011cc8657b4b06fdea67dfde127b0f2409ad';

function readContracts() {
    const contracts = {};
    for (const type of ['GCC', 'SCC']) {
        const source = fs.readFileSync(path.join(root, 'MD base', `${type}.md`), 'utf8');
        const headings = [...source.matchAll(type === 'GCC' ? /^## (\d+)\.\s*(.+)$/gm : /^## SCC\s*(\d+[A-Z]?)\s+(.+)$/gm)];
        const data = {};
        headings.forEach((heading, i) => {
            // Preserve differing repeated sections rather than silently overwriting source text.
            const body = source.slice(heading.index + heading[0].length, headings[i + 1]?.index || source.length)
                .replace(/^#{2,3} [^\n]+$/gm, '').replace(/^---\s*$/gm, '').trim();
            const id = heading[1];
            if (data[id]) {
                if (data[id].content.replace(/\s/g, '') !== body.replace(/\s/g, '')) {
                    data[id].content += '\n\n[Source repeats this heading; retained verbatim]\n' + body;
                    data[id].repeatedHeading = true;
                }
            } else data[id] = { title: heading[2].trim(), content: body };
        });
        contracts[type] = { title: type === 'GCC' ? 'General Conditions of Contract' : 'Special Conditions of Contract', data };
    }
    return contracts;
}

function context(options = {}) {
    const ctx = { console: { log() {}, warn() {}, error() {} }, URL, DOMException, AbortController, TextDecoder, setTimeout, clearTimeout,
        contracts: options.contracts || readContracts(), chatMessages: options.history || [], isKnowledgeBaseMode: true,
        hasContextBreak: false, contextBreakIndex: 0, isThinkingMode: false, switchContract() {}, showWelcomePage() {},
        document: { getElementById() { return null; } }, escapeHtml: value => value,
        AIClient: { needsReasoningHistory: () => false, request: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '[]' } }] }) }) }
    };
    ctx.window = ctx; vm.createContext(ctx);
    const files = options.baseline ? ['config', 'cross-ref-data', 'cross-ref', 'ai-assistant'] : ['config', 'cross-ref-data', 'retrieval-source', 'ai-retrieval', 'cross-ref', 'ai-assistant'];
    files.forEach(file => {
        const name = `js/${file}.js`;
        const code = options.baseline ? execFileSync('git', ['show', `${baselineRevision}:${name}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, name), 'utf8');
        vm.runInContext(code, ctx, { filename: name });
    });
    ctx.RAG = { findMostRelevant: async () => { throw new Error('offline evaluation: embedding unavailable'); }, rerank: async (_, rows, __, n) => rows.slice(0, n) };
    vm.runInContext('initCrossRefIndex()', ctx);
    return ctx;
}
module.exports = { root, baselineRevision, readContracts, context, evaluate: (ctx, expression) => vm.runInContext(expression, ctx) };
