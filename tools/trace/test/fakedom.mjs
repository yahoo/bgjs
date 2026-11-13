// A minimal stand-in for the browser, enough to run the viewer's player.js in Node: it records
// every innerHTML written and the event listeners that are currently attached.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';


export function fakeDom() {
  const written = [];
  const active = [];
  const makeEl = () => {
    const kids = new Map();
    const e = {
      _html: '', textContent: '', hidden: false, value: 'normal', checked: false, max: 0, style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = v; written.push(v); kids.clear(); },
      querySelector(s) { if (!kids.has(s)) kids.set(s, makeEl()); return kids.get(s); },
      querySelectorAll() { return []; },
      setAttribute() {}, scrollIntoView() {}, appendChild() {}, remove() {},
      get parentElement() { return makeEl(); },
      addEventListener: (type, fn, opts) => listen(type, fn, opts),
    };
    return e;
  };
  function listen(type, fn, opts) {
    const rec = { type };
    active.push(rec);
    opts?.signal?.addEventListener('abort', () => active.splice(active.indexOf(rec), 1));
  }
  const root = makeEl();
  class GraphView { constructor() { this.zoom = 1; } setModel() { return Promise.resolve(); } show() {} fit() {} pulse() {} }
  const ctx = {
    document: { addEventListener: listen, removeEventListener() {}, createRange() {} },
    addEventListener: listen, removeEventListener() {},
    matchMedia: () => ({ matches: true }), setTimeout, clearTimeout, getSelection: () => ({}), navigator: {},
    AbortController, console,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const here = new URL('..', import.meta.url);
  const src = (p) => readFileSync(new URL(p, here), 'utf8');
  const asGlobal = (source, name) => {
    const body = source.replace(/^export\s+(?=(function|const|class|let))/gm, '');
    const names = [...source.matchAll(/^export\s+(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
    return `(function(){\n${body}\nwindow.${name} = { ${names.join(', ')} };\n})();`;
  };
  vm.runInContext(asGlobal(src('src/text.js'), 'BGTraceText'), ctx);
  vm.runInContext(asGlobal(src('src/mermaid.js'), 'BGTraceMermaid'), ctx);
  ctx.BGTraceGraphView = GraphView;
  vm.runInContext(src('viewer/player.js'), ctx);
  return {
    mount: (data) => ctx.BGTracePlayer.mount(root, data),
    htmlWritten: () => written,
    listeners: (type) => active.filter(r => r.type === type).length,
  };
}
