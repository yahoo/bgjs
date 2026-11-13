// Builds a single, self-contained HTML file that replays traces: the viewer's CSS and scripts
// and the trace data are all inlined, so the file opens from disk with no server or network.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

// text.js and mermaid.js are ES modules; in the page they become globals.
function asGlobal(source, name) {
  const body = source.replace(/^export\s+(?=(function|const|class|let))/gm, '');
  const names = [...source.matchAll(/^export\s+(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  return `(function(){\n${body}\nwindow.${name} = { ${names.join(', ')} };\n})();`;
}

/**
 * @param {object|null} data a tracer's toJSON() (or null for an empty viewer that accepts a dropped file)
 * @param {object} [options]
 * @param {string} [options.title]
 * @returns {string} HTML
 */
export function toHTML(data, { title } = {}) {
  const payload = data ? { ...data, title: title ?? data.title ?? 'Behavior Graph trace' } : null;
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const pageTitle = (payload?.title ?? 'Behavior Graph trace viewer').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<style>
${read('../viewer/viewer.css')}
</style>
</head>
<body>
<div id="app"></div>
<script>
${asGlobal(read('text.js'), 'BGTraceText')}
${asGlobal(read('mermaid.js'), 'BGTraceMermaid')}
${read('../viewer/graphview.js')}
${read('../viewer/player.js')}
</script>
<script id="bg-trace-data" type="application/json">${json}</script>
<script>
BGTracePlayer.mount(document.getElementById('app'), JSON.parse(document.getElementById('bg-trace-data').textContent));
</script>
</body>
</html>
`;
}
