// Render completed Mermaid code blocks in chat. The original Markdown stays in the message.
(function () {
    const scriptUrl = './vendor/mermaid-tiny-12.3.0.js';
    let rendererPromise;
    let diagramId = 0;

    function loadRenderer() {
        if (rendererPromise) return rendererPromise;
        rendererPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scriptUrl;
            script.onload = () => {
                try {
                    const renderer = window.mermaid;
                    renderer.initialize({
                        startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
                        layout: 'dagre', theme: 'neutral', suppressErrorRendering: true
                    });
                    resolve(renderer);
                } catch (error) {
                    reject(error);
                }
            };
            script.onerror = () => {
                script.remove();
                reject(new Error('Mermaid Tiny 加载失败'));
            };
            document.head.appendChild(script);
        }).catch(error => {
            rendererPromise = undefined;
            throw error;
        });
        return rendererPromise;
    }

    async function draw(figure, preview, status, source) {
        try {
            const renderer = await loadRenderer();
            if (!figure.isConnected) return;
            const { svg } = await renderer.render('assistant-diagram-' + ++diagramId, source);
            // Display SVG as an image so its styles and elements stay out of the chat DOM.
            const image = document.createElement('img');
            image.alt = 'Mermaid 流程图';
            image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            await image.decode();
            if (!figure.isConnected) return;
            const chat = figure.closest('#chatMessages');
            const follow = chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60;
            preview.hidden = true;
            figure.appendChild(image);
            if (follow) chat.scrollTop = chat.scrollHeight;
            status.textContent = '';
        } catch (_) {
            status.textContent = '无法显示流程图，可复制源码。';
        }
    }

    function render(message) {
        for (const code of message.querySelectorAll('.message-content pre > code.language-mermaid')) {
            const preview = code.parentElement;
            if (preview.parentElement.classList.contains('assistant-diagram')) continue;
            const source = code.textContent;
            const figure = document.createElement('figure');
            figure.className = 'assistant-diagram';
            const toolbar = document.createElement('div');
            toolbar.className = 'assistant-diagram-toolbar';
            const copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'assistant-btn';
            copy.textContent = '复制源码';
            const status = document.createElement('span');
            status.setAttribute('role', 'status');
            status.textContent = '正在绘制流程图…';
            copy.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(source);
                    copy.textContent = '已复制';
                    setTimeout(() => { copy.textContent = '复制源码'; }, 1500);
                } catch (_) {
                    preview.hidden = false;
                    status.textContent = '复制失败，请手动选取源码。';
                }
            });
            toolbar.append(copy, status);
            preview.replaceWith(figure);
            figure.append(toolbar, preview);
            draw(figure, preview, status, source);
        }
    }

    window.AssistantDiagrams = Object.freeze({ render });
})();
