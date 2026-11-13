const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE ||
    path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end();
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
});

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKQ0AAAAASUVORK5CYII=';
const reply = `## 1.2.3 合同通知

3. **甲方通知**（主列表从 3 开始）
   5. *送达地址*（二级从 5 开始）。本段用于核对自动折行，收到书面通知后应依次记录通知的发出时间、接收人、送达地址和收件凭证，并在合同要求的时间内回复。若地址发生变更，应将新地址书面告知对方，以便后续通知能够送达。
      此行用于核对手动换行的正文对齐。
      - 收件凭证（三级项目符号）
      - 送达回执（同级项目符号）
   6. 核对时限（二级续号）

      这是同一列表项内的独立续段，正文左边界应与上一段对齐。
4. 乙方回复（回到一级续号）
   1. 登记回复（新子列表从 1 开始）

这里是独立段落，包含代码示例 \`<think>\`。

7. 后续办理（新列表从 7 开始）
8. 完成归档（新列表续号）

<ol type="a" start="2"><li>字母起号</li><li value="6">显式跳号</li><li>跳号后续号</li></ol>

<ul style="padding-left:0;list-style-type:'◇ '"><li>自定义项目符号</li></ul>

> 引用说明与[示例链接](https://example.com/reference)

| 事项 | 状态 |
| --- | ---: |
| 通知 | 已送达 |

\`\`\`text
code
    indented
\`\`\`

<img alt="测试图片" src="data:image/png;base64,${pixel}"><img alt="不可用外链" src="https://example.invalid/missing.png">

（一）保留手写编号。
`;

function unpackDocx(bytes) {
    assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'DOCX must be an actual ZIP package');
    const entries = {};
    let pos = bytes.readUInt32LE(bytes.length - 6);
    while (bytes.readUInt32LE(pos) === 0x02014b50) {
        const filenameLength = bytes.readUInt16LE(pos + 28);
        const name = bytes.subarray(pos + 46, pos + 46 + filenameLength).toString();
        const local = bytes.readUInt32LE(pos + 42);
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        const data = bytes.subarray(start, start + bytes.readUInt32LE(pos + 20));
        entries[name] = bytes.readUInt16LE(pos + 10) === 8 ? inflateRawSync(data) : data;
        pos += 46 + filenameLength + bytes.readUInt16LE(pos + 30) + bytes.readUInt16LE(pos + 32);
    }
    return entries;
}

async function verifyLists(page, entries) {
    const lists = await page.evaluate(({ documentXml, numberingXml }) => {
        const parser = new DOMParser();
        const body = parser.parseFromString(documentXml, 'application/xml');
        const definitions = parser.parseFromString(numberingXml, 'application/xml');
        const tags = (element, tag) => [...element.getElementsByTagName('w:' + tag)];
        const val = (element, attr = 'val') => element?.getAttribute('w:' + attr);
        return tags(body, 'p').filter(p => tags(p, 'numPr').length).map(p => {
            const id = val(tags(p, 'numId')[0]);
            const level = Number(val(tags(p, 'ilvl')[0]));
            const num = tags(definitions, 'num').find(n => val(n, 'numId') === id);
            const absId = val(tags(num, 'abstractNumId')[0]);
            const abs = tags(definitions, 'abstractNum').find(n => val(n, 'abstractNumId') === absId);
            const def = tags(abs, 'lvl').find(n => Number(val(n, 'ilvl')) === level);
            const indent = tags(p, 'ind')[0];
            return {
                id, level,
                start: Number(val(tags(def, 'start')[0])),
                mark: val(tags(def, 'lvlText')[0]),
                format: val(tags(def, 'numFmt')[0]),
                left: Number(val(indent, 'left')),
                hanging: Number(val(indent, 'hanging'))
            };
        });
    }, { documentXml: entries['word/document.xml'].toString(), numberingXml: entries['word/numbering.xml'].toString() });
    assert.deepEqual(lists.map(l => l.level), [0, 1, 2, 2, 1, 0, 1, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(lists.map(l => l.left), [300, 600, 900, 900, 600, 300, 600, 300, 300, 300, 300, 300, 0]);
    assert.ok(lists.every(l => l.hanging > 0));
    assert.deepEqual(lists.map(l => l.start), [3, 5, 1, 1, 5, 3, 1, 7, 7, 2, 6, 6, 1]);
    assert.equal(lists[0].id, lists[5].id, 'parent resumes after its sublist');
    assert.equal(lists[1].id, lists[4].id, 'second level resumes after its bullets');
    assert.notEqual(lists[1].id, lists[6].id, 'new sublist has its own counter');
    assert.notEqual(lists[0].id, lists[7].id, 'new top-level list has its own counter');
    assert.equal(lists[7].id, lists[8].id);
    assert.equal(lists[2].format, 'bullet');
    assert.equal(lists[2].mark, '▪');
    assert.equal(lists[9].format, 'lowerLetter');
    assert.notEqual(lists[9].id, lists[10].id, 'explicit value restarts the counter');
    assert.equal(lists[10].id, lists[11].id, 'numbering continues from the explicit value');
    assert.equal(lists[12].mark.trimEnd(), '◇');
}

(async () => {
    const executablePath = [
        process.env.GCM_BROWSER_EXECUTABLE,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        chromium.executablePath()
    ].find(file => file && fs.existsSync(file));
    const browser = await chromium.launch({ headless: true, executablePath });
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1300, height: 900 } });
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin);
        await page.evaluate(() => window.contractAppReady);
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await page.locator('#tab-Assistant').click();
        await page.evaluate(markdown => {
            chatMessages = [
                { role: 'user', content: '这个问题不应进入导出文件。' },
                { role: 'assistant', content: '<think>正文内残留的思考内容。\n\n同一思考区块的第二段。</think>\n\n' + markdown, reasoning: '独立思考区块的内容。' },
                { role: 'assistant', content: '其他回复不应进入导出文件。' }
            ];
            renderChatMessages();
        }, reply);

        const messages = page.locator('#chatMessages .chat-message.assistant');
        const message = messages.first();
        assert.deepEqual(await message.locator('.msg-actions button').evaluateAll(buttons => buttons.map(button => button.title)),
            ['复制', '重新生成', '分支', '收藏', '导出 Word', '删除']);
        assert.equal(await message.locator('.thinking-body-inner').textContent(), '独立思考区块的内容。');
        assert.equal(await page.locator('.chat-message.user button[title="导出 Word"]').count(), 0);
        assert.equal(await page.evaluate(() => performance.getEntriesByName(location.origin + '/js/assistant-docx.mjs').length), 0);
        await context.setOffline(true);
        const button = message.getByRole('button', { name: '导出回复为 Word' });
        await button.scrollIntoViewIfNeeded();
        await button.hover();
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.chat-message.assistant .msg-actions')).opacity) > 0);
        const downloadEvent = page.waitForEvent('download');
        await button.click();
        const download = await downloadEvent;
        assert.equal(download.suggestedFilename(), '管理助手回复-2.docx');
        assert.equal(await download.failure(), null);
        const entries = unpackDocx(fs.readFileSync(await download.path()));
        assert.match(entries['[Content_Types].xml'].toString(), /wordprocessingml.document.main\+xml/);
        await verifyLists(page, entries);

        const xml = entries['word/document.xml'].toString();
        assert.match(xml, /<w:br\/>[\s\S]*?此行用于核对手动换行的正文对齐/);
        const continuation = xml.match(/<w:p>[\s\S]*?<\/w:p>/g).find(p => p.includes('这是同一列表项内的独立续段'));
        assert.match(continuation, /<w:ind w:left="600"\/>/);
        assert.ok(!continuation.includes('<w:numPr>'));
        for (const text of ['1.2.3 合同通知', '（一）保留手写编号', '不可用外链', '    indented', '&lt;think&gt;']) assert.ok(xml.includes(text), text);
        assert.doesNotMatch(xml, /思考过程|独立思考区块的内容|正文内残留的思考内容|同一思考区块的第二段|不应进入导出文件/);
        for (const tag of ['w:b', 'w:i', 'w:tbl', 'w:hyperlink', 'w:drawing']) assert.ok(xml.includes('<' + tag), tag);
        assert.ok(Object.keys(entries).some(name => /^word\/media\/.+\.png$/.test(name)));
        assert.match(entries['word/_rels/document.xml.rels'].toString(), /example\.invalid\/missing\.png/);
        await page.waitForFunction(() => StatusCenter.snapshot().some(item => item.message.includes('有 1 张图片无法嵌入')));
        assert.equal(await message.locator('.message-content').count(), 1);
        if (process.env.GCM_DOCX_SAMPLE_PATH) await download.saveAs(process.env.GCM_DOCX_SAMPLE_PATH);

        await page.evaluate(() => { assistantReadOnly = true; renderChatMessages(); });
        assert.deepEqual(await message.locator('.msg-actions button').evaluateAll(buttons => buttons.map(button => button.title)),
            ['复制', '收藏', '导出 Word']);
        const plainButton = messages.last().getByRole('button', { name: '导出回复为 Word' });
        const [plainDownload] = await Promise.all([page.waitForEvent('download'), plainButton.click()]);
        assert.equal(plainDownload.suggestedFilename(), '管理助手回复-3.docx');
        const plainEntries = unpackDocx(fs.readFileSync(await plainDownload.path()));
        assert.match(plainEntries['word/document.xml'].toString(), /其他回复不应进入导出文件/);
        assert.deepEqual(errors, []);
        console.log('Assistant DOCX browser test passed: offline download, reply-only content, native lists, rich formatting and image fallback.');
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
