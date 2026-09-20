/* Worker boundary for DOCX parsing.  The original file bytes never leave this browser. */
self.importScripts('../vendor/mammoth.browser.min.js');

self.onmessage = async event => {
    const { id, buffer } = event.data || {};
    try {
        const result = await self.mammoth.convertToHtml(
            { arrayBuffer: buffer },
            { externalFileAccess: false, convertImage: self.mammoth.images.imgElement(() => Promise.resolve({ src: '' })) }
        );
        self.postMessage({ id, ok: true, html: result.value || '', warnings: (result.messages || []).map(item => item.message) });
    } catch (error) {
        self.postMessage({ id, ok: false, error: error?.message || 'DOCX 解析失败' });
    }
};
