const blockContainers = new Set(['ARTICLE', 'ASIDE', 'DIV', 'DL', 'DT', 'DD', 'FIGCAPTION', 'FIGURE', 'SECTION']);
const ignoredElements = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
const bulletMarks = { disc: '•', circle: '◦', square: '▪' };
const orderedFormats = {
    'decimal-leading-zero': 'decimalZero',
    'lower-alpha': 'lowerLetter', 'lower-latin': 'lowerLetter',
    'upper-alpha': 'upperLetter', 'upper-latin': 'upperLetter',
    'lower-roman': 'lowerRoman', 'upper-roman': 'upperRoman'
};
const twipsPerPixel = 15;
const markerGap = 100;

function resolveUrl(value, protocols) {
    if (!value) return null;
    try {
        const url = new URL(value, document.baseURI);
        return protocols.includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

async function readImage(source, displayedWidth, displayedHeight) {
    if (!source) throw new Error('图片地址不可用');
    const response = await fetch(source, { signal: AbortSignal.timeout(12000), referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('图片读取失败');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        const width = displayedWidth || image.naturalWidth;
        const height = displayedHeight || image.naturalHeight * width / image.naturalWidth;
        const scale = Math.min(1, 560 / width, 740 / height);
        const transformation = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
        const type = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' }[blob.type];
        if (type) return { type, data: await blob.arrayBuffer(), transformation };

        const canvas = document.createElement('canvas');
        canvas.width = transformation.width;
        canvas.height = transformation.height;
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        return { type: 'png', data: await png.arrayBuffer(), transformation };
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function convertReply(content, reasoning, word) {
    const {
        Paragraph, TextRun, Tab, HeadingLevel, ExternalHyperlink, ImageRun, BorderStyle,
        AlignmentType, LevelSuffix, TabStopType, Table, TableRow, TableCell, WidthType
    } = word;
    const root = content.cloneNode(true);
    const selector = 'ol, ul, li, img, td, th';
    const originals = content.querySelectorAll(selector);
    const styles = new Map();
    const images = new Map();
    const imageLoads = [];
    let missingImages = 0;
    const numbering = [];

    root.querySelectorAll(selector).forEach((node, index) => {
        const original = originals[index];
        const style = getComputedStyle(original);
        if (node.tagName === 'IMG') {
            const source = resolveUrl(original.currentSrc || node.getAttribute('src'), ['http:', 'https:', 'data:', 'blob:']);
            const alt = node.getAttribute('alt') || node.title || '';
            const bounds = original.getBoundingClientRect();
            imageLoads.push(readImage(source, bounds.width, bounds.height).then(
                data => images.set(node, { data, alt }),
                () => {
                    missingImages++;
                    images.set(node, { source, alt });
                }
            ));
        } else {
            styles.set(node, {
                padding: parseFloat(style.paddingLeft),
                type: style.listStyleType,
                marker: node.tagName === 'LI' ? getComputedStyle(original, '::marker').content : '',
                alignment: style.textAlign
            });
        }
    });
    await Promise.all(imageLoads);

    function linkTo(url, runs) {
        return new ExternalHyperlink({ link: url, children: runs });
    }

    function inlineRuns(nodes, baseStyle) {
        let hasText = false;
        let space = false;

        function addText(text, style) {
            const normalized = text.replace(/[ \t\r\n\f]+/g, ' ');
            const trimmed = normalized.replace(/^ | $/g, '');
            if (!trimmed) {
                space ||= hasText && normalized === ' ';
                return [];
            }
            const prefix = hasText && (space || normalized.startsWith(' ')) ? ' ' : '';
            hasText = true;
            space = normalized.endsWith(' ');
            return [new TextRun({ ...style, text: prefix + trimmed })];
        }

        function addObject(run) {
            const runs = space ? [new TextRun(' '), run] : [run];
            space = false;
            hasText = true;
            return runs;
        }

        function walk(node, style) {
            if (node.nodeType === Node.TEXT_NODE) return addText(node.nodeValue, style);
            if (node.nodeType !== Node.ELEMENT_NODE || node.hidden || ignoredElements.has(node.tagName)) return [];
            switch (node.tagName) {
                case 'BR':
                    hasText = space = false;
                    return [new TextRun({ break: 1 })];
                case 'STRONG': case 'B': style = { ...style, bold: true }; break;
                case 'EM': case 'I': style = { ...style, italics: true }; break;
                case 'S': case 'DEL': case 'STRIKE': style = { ...style, strike: true }; break;
                case 'U': case 'INS': style = { ...style, underline: {} }; break;
                case 'SUP': style = { ...style, superScript: true }; break;
                case 'SUB': style = { ...style, subScript: true }; break;
                case 'MARK': style = { ...style, highlight: 'yellow' }; break;
                case 'CODE': case 'KBD': case 'SAMP': style = { ...style, font: 'Consolas' }; break;
                case 'A': {
                    const url = resolveUrl(node.getAttribute('href'), ['http:', 'https:', 'mailto:', 'tel:']);
                    const runs = Array.from(node.childNodes).flatMap(child => walk(child, url ? { ...style, style: 'Hyperlink' } : style));
                    return url && runs.length ? [linkTo(url, runs)] : runs;
                }
                case 'IMG': {
                    const image = images.get(node);
                    if (!image) return addText(node.getAttribute('alt') || '', style);
                    if (image.data) {
                        return addObject(new ImageRun({ ...image.data, altText: { name: image.alt, title: image.alt, description: image.alt } }));
                    }
                    const label = image.alt || '图片';
                    const runs = addText(`[${label}（无法嵌入）]`, image.source ? { ...style, style: 'Hyperlink' } : style);
                    return image.source && /^https?:/.test(image.source) ? [linkTo(image.source, runs)] : runs;
                }
                case 'INPUT':
                    return node.type === 'checkbox' ? addText(node.checked ? '☑ ' : '☐ ', style) : [];
            }
            return Array.from(node.childNodes).flatMap(child => walk(child, style));
        }

        return Array.from(nodes).flatMap(node => walk(node, baseStyle));
    }

    function literalRuns(text, style) {
        return text.split(/(\r\n|\r|\n|\t)/).filter(Boolean).map(part => {
            if (part === '\t') return new TextRun({ ...style, children: [new Tab()] });
            if (/^[\r\n]/.test(part)) return new TextRun({ ...style, break: 1 });
            return new TextRun({ ...style, text: part });
        });
    }

    function listBlocks(list, context) {
        const ordered = list.tagName === 'OL';
        const items = Array.from(list.children).filter(child => child.tagName === 'LI' && !child.hidden);
        const reversed = ordered && list.reversed;
        const indent = context.indent + Math.round((styles.get(list)?.padding ?? 20) * twipsPerPixel);
        const level = Math.min(context.depth, 8);
        let current = reversed && !list.hasAttribute('start') ? items.length : (ordered ? list.start : 1);
        let previousType;
        let reference;

        return items.flatMap(item => {
            const appearance = styles.get(item);
            const type = appearance?.type || (ordered ? 'decimal' : 'disc');
            const customMarker = /^"(.*)"$/.exec(appearance?.marker)?.[1] ?? /^"(.*)"$/.exec(type)?.[1];
            const bullet = customMarker ?? (Object.hasOwn(bulletMarks, type) ? bulletMarks[type] : (ordered ? undefined : '•'));
            const value = Number.parseInt(item.getAttribute('value'), 10);
            if (ordered && Number.isFinite(value)) current = value;
            const signature = bullet ?? type;
            if (type !== 'none' || customMarker) {
                // Each source list gets its own counter, including separate sublists at the same depth.
                if (!reference || signature !== previousType || (bullet === undefined && (reversed || Number.isFinite(value)))) {
                    reference = `reply-list-${numbering.length}`;
                    numbering.push({
                        reference,
                        levels: [{
                            level,
                            start: current,
                            format: bullet !== undefined ? 'bullet' : (Object.hasOwn(orderedFormats, type) ? orderedFormats[type] : 'decimal'),
                            text: bullet ?? `%${level + 1}.`,
                            alignment: AlignmentType.RIGHT,
                            suffix: LevelSuffix.TAB,
                            style: { paragraph: { indent: { left: indent, hanging: markerGap } } }
                        }]
                    });
                }
            } else {
                reference = undefined;
            }
            previousType = signature;
            current += reversed ? -1 : 1;
            return blocks(item, {
                ...context, indent, depth: context.depth + 1,
                first: reference ? { reference, level } : null
            });
        });
    }

    function tableBlock(table) {
        const rows = Array.from(table.rows).map(row => new TableRow({
            tableHeader: row.parentElement.tagName === 'THEAD',
            children: Array.from(row.cells).map(cell => {
                const header = cell.tagName === 'TH';
                const align = styles.get(cell)?.alignment;
                const alignment = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[align];
                const children = blocks(cell, { alignment, inlineStyle: header ? { bold: true } : undefined });
                if (!(children.at(-1) instanceof Paragraph)) children.push(new Paragraph(''));
                return new TableCell({
                    children,
                    columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
                    rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
                    shading: header ? { fill: 'E8EDF5' } : undefined
                });
            })
        }));
        return rows.length ? new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }) : null;
    }

    function blocks(parent, { indent = 0, depth = 0, first, quote = false, alignment, inlineStyle } = {}) {
        const output = [];
        let pendingNumber = first;
        let pendingInline = [];
        const context = { indent, depth, quote, alignment, inlineStyle };

        function paragraph(children, properties = {}) {
            const numbering = pendingNumber;
            pendingNumber = null;
            output.push(new Paragraph({
                children, alignment,
                spacing: { after: depth ? 60 : 100 },
                indent: indent || numbering ? { left: indent, ...(numbering ? { hanging: markerGap } : {}) } : undefined,
                tabStops: numbering ? [{ type: TabStopType.LEFT, position: indent }] : undefined,
                numbering,
                border: quote ? { left: { style: BorderStyle.SINGLE, size: 12, color: 'B7C3D1', space: 8 } } : undefined,
                ...properties
            }));
        }

        function flush() {
            const runs = inlineRuns(pendingInline, inlineStyle);
            pendingInline = [];
            if (runs.length) paragraph(runs);
        }

        function visit(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) {
                pendingInline.push(node);
                return;
            }
            if (node.hidden || ignoredElements.has(node.tagName)) return;
            const tag = node.tagName;
            if (tag === 'P' || /^H[1-6]$/.test(tag)) {
                flush();
                paragraph(inlineRuns(node.childNodes, inlineStyle), { heading: HeadingLevel[`HEADING_${tag[1]}`] });
            } else if (tag === 'PRE') {
                flush();
                const text = node.textContent.replace(/\r?\n$/, '');
                paragraph(literalRuns(text, { font: 'Consolas' }), { shading: { fill: 'F1F3F5' } });
            } else if (tag === 'HR') {
                flush();
                paragraph([], { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B7C3D1' } } });
            } else if (tag === 'UL' || tag === 'OL' || tag === 'TABLE' || tag === 'BLOCKQUOTE') {
                flush();
                if (pendingNumber) paragraph([]);
                if (tag === 'UL' || tag === 'OL') output.push(...listBlocks(node, context));
                else if (tag === 'BLOCKQUOTE') output.push(...blocks(node, { ...context, indent: indent + 240, quote: true }));
                else {
                    const table = tableBlock(node);
                    if (node.caption) paragraph(inlineRuns(node.caption.childNodes, inlineStyle), { keepNext: true });
                    if (table) output.push(table);
                }
            } else if (blockContainers.has(tag)) {
                flush();
                node.childNodes.forEach(visit);
                flush();
            } else {
                pendingInline.push(node);
            }
        }

        parent.childNodes.forEach(visit);
        flush();
        if (pendingNumber) paragraph([]);
        return output;
    }

    const children = [];
    if (reasoning.trim()) {
        children.push(new Paragraph({ text: '思考过程', heading: HeadingLevel.HEADING_2 }));
        for (const text of reasoning.split(/\r?\n\r?\n/)) {
            children.push(new Paragraph({ children: literalRuns(text), spacing: { after: 100 } }));
        }
    }
    children.push(...blocks(root));
    return {
        missingImages,
        document: new word.Document({
            numbering: { config: numbering },
            sections: [{ children }]
        })
    };
}

export async function exportReplyToDocx(content, reasoning, filename) {
    const word = window.docx;
    if (!word?.Packer) throw new Error('Word 导出引擎未加载');
    const result = await convertReply(content, reasoning, word);
    const blob = await word.Packer.toBlob(result.document);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    try {
        link.click();
    } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    return result.missingImages;
}
