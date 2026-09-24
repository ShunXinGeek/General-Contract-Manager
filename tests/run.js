const path = require('path');
const { spawnSync } = require('child_process');

for (const file of ['cloud-sync.test.js', 'state-recovery.test.js', 'panel-state.test.js', 'assistant-topics.test.js', 'assistant-notebook.test.js', 'offline-shell.test.js', 'ai-transport.test.js', 'retrieval.test.js']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
