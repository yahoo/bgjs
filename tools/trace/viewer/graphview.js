// Draws a behavior-graph structure as an SVG: resources (states as boxes, moments as pills),
// behaviors (dark boxes), demand edges into behaviors and supply edges out of them.
// Columns follow the dependency order, so things run roughly left to right.
// Classic script: defines window.BGTraceGraphView.
(function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const RES_W = 104, RES_H = 42, BEH_W = 124, BEH_H = 46;
  const COL_GAP = 30, ROW_GAP = 14, PAD_X = 52, PAD_Y = 22;

  function el(name, attrs, parent) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isStartup = (r) => r && r.name === 'addedToGraph';

  class GraphView {
    constructor(host) {
      this.host = host;
      this.svg = el('svg', { class: 'gv', role: 'img', 'aria-label': 'Behavior graph' }, host);
      const defs = el('defs', {}, this.svg);
      const m = el('marker', { id: 'gv-arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,1 L9,5 L0,9 z', class: 'gv-head' }, m);
      this.gEdges = el('g', {}, this.svg);
      this.gNodes = el('g', {}, this.svg);
      this.gPulse = el('g', {}, this.svg);
      this.nodes = new Map();
      this.edges = [];
      this.zoom = 1;
      this.key = null;
    }

    layout(model) {
      const R = new Map(model.resources.map(r => [r.id, r]));
      const B = model.behaviors;
      const supplier = new Map();
      for (const b of B) for (const s of b.supplies) supplier.set(s, b.id);
      const consumers = new Map();
      for (const b of B) for (const d of b.demands) { if (!consumers.has(d.id)) consumers.set(d.id, []); consumers.get(d.id).push(b.id); }
      const col = new Map();
      for (const r of model.resources) col.set(r.id, 0);
      for (const b of B) col.set(b.id, 1);
      for (let pass = 0; pass < 50; pass++) {
        let changed = false;
        for (const b of B) {
          let c = 1;
          for (const d of b.demands) if (d.type === 'demand' && col.has(d.id)) c = Math.max(c, col.get(d.id) + 1);
          if (col.get(b.id) !== c) { col.set(b.id, c); changed = true; }
          for (const s of b.supplies) if (col.get(s) < c + 1) { col.set(s, c + 1); changed = true; }
        }
        if (!changed) break;
      }
      // inputs sit just left of their first consumer
      for (const r of model.resources) {
        if (supplier.has(r.id)) continue;
        const cs = consumers.get(r.id) || [];
        if (cs.length) col.set(r.id, Math.max(0, Math.min(...cs.map(c => col.get(c))) - 1));
      }
      let maxCol = 0;
      for (const v of col.values()) maxCol = Math.max(maxCol, v);
      const cols = Array.from({ length: maxCol + 1 }, () => []);
      const order = [...model.resources.map(r => r.id), ...B.map(b => b.id)];
      order.sort((a, b) => isStartup(R.get(a)) - isStartup(R.get(b)));
      for (const id of order) cols[col.get(id)].push(id);

      const size = (id) => R.has(id) ? [RES_W, RES_H] : [BEH_W, BEH_H];
      const preds = new Map(), succs = new Map();
      const link = (a, b) => {
        if (!succs.has(a)) succs.set(a, []); succs.get(a).push(b);
        if (!preds.has(b)) preds.set(b, []); preds.get(b).push(a);
      };
      for (const b of B) { for (const d of b.demands) link(d.id, b.id); for (const s of b.supplies) link(b.id, s); }

      const y = new Map();
      for (const list of cols) {
        let cur = PAD_Y;
        for (const id of list) { const h = size(id)[1]; y.set(id, cur + h / 2); cur += h + ROW_GAP; }
      }
      const avg = (ids, fb) => {
        const vs = (ids || []).filter(i => y.has(i)).map(i => y.get(i));
        return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : fb;
      };
      const place = (list, want) => {
        list.sort((a, b) => want(a) - want(b));
        let cur = PAD_Y;
        for (const id of list) {
          const h = size(id)[1];
          const top = Math.max(cur, want(id) - h / 2);
          y.set(id, top + h / 2);
          cur = top + h + ROW_GAP;
        }
      };
      for (let it = 0; it < 3; it++) {
        for (let c = 1; c < cols.length; c++) place(cols[c], id => avg(preds.get(id), y.get(id)));
        for (let c = cols.length - 2; c >= 0; c--) place(cols[c], id => (avg(succs.get(id), y.get(id)) + avg(preds.get(id), y.get(id))) / 2);
      }
      let minY = Infinity;
      for (const [id, v] of y) minY = Math.min(minY, v - size(id)[1] / 2);
      for (const [id, v] of y) y.set(id, v - minY + PAD_Y);
      const colW = cols.map(list => Math.max(60, ...list.map(id => size(id)[0])));
      const colX = [];
      let x = PAD_X;
      for (let c = 0; c < cols.length; c++) { colX.push(x + colW[c] / 2); x += colW[c] + COL_GAP; }
      let height = 0;
      for (const [id, v] of y) height = Math.max(height, v + size(id)[1] / 2);
      const pos = new Map();
      for (const id of order) { const [w, h] = size(id); pos.set(id, { x: colX[col.get(id)], y: y.get(id), w, h }); }
      return { pos, width: x - COL_GAP + 20, height: height + PAD_Y };
    }

    setModel(model, animate) {
      // startup resources nothing listens to are noise
      const demanded = new Set(model.behaviors.flatMap(b => b.demands.map(d => d.id)));
      model = { ...model, resources: model.resources.filter(r => !isStartup(r) || demanded.has(r.id)) };
      const key = JSON.stringify([model.resources.map(r => r.id), model.behaviors.map(b => [b.id, b.demands.map(d => d.id), b.supplies])]);
      this.model = model;
      if (key === this.key) return Promise.resolve();
      this.key = key;
      const prev = new Map([...this.nodes].map(([id, n]) => [id, { x: n.x, y: n.y }]));
      const L = this.layout(model);
      this.size = { w: L.width, h: L.height };
      this.svg.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`);
      this.fit();
      const R = new Map(model.resources.map(r => [r.id, r]));
      const B = new Map(model.behaviors.map(b => [b.id, b]));
      const keep = new Set();
      for (const [id, p] of L.pos) {
        keep.add(id);
        let n = this.nodes.get(id);
        if (!n) { n = this.makeNode(id, R.get(id), B.get(id)); this.nodes.set(id, n); n.fresh = true; }
        Object.assign(n, { tx: p.x, ty: p.y, w: p.w, h: p.h });
      }
      for (const [id, n] of this.nodes) if (!keep.has(id)) { n.g.remove(); this.nodes.delete(id); }
      this.gEdges.innerHTML = '';
      this.edges = [];
      for (const b of model.behaviors) {
        for (const d of b.demands) {
          const muted = isStartup(R.get(d.id));
          const e = { from: d.id, to: b.id, kind: d.type, path: el('path', { class: `gv-edge gv-${d.type}${muted ? ' gv-muted' : ''}`, 'marker-end': 'url(#gv-arr)' }, this.gEdges) };
          this.edges.push(e);
        }
        for (const s of b.supplies) this.edges.push({ from: b.id, to: s, kind: 'supply', path: el('path', { class: 'gv-edge gv-supply', 'marker-end': 'url(#gv-arr)' }, this.gEdges) });
      }
      if (animate && prev.size && !reduceMotion()) {
        const start = performance.now(), dur = 450;
        const from = new Map();
        for (const [id, n] of this.nodes) from.set(id, prev.get(id) || { x: n.tx, y: n.ty });
        const frame = (t) => {
          const k = Math.min(1, (t - start) / dur);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          for (const [id, n] of this.nodes) { const f = from.get(id); n.x = f.x + (n.tx - f.x) * e; n.y = f.y + (n.ty - f.y) * e; this.place(n); }
          this.drawEdges();
          if (k < 1) requestAnimationFrame(frame);
        };
        for (const [, n] of this.nodes) if (n.fresh) { n.g.classList.add('gv-enter'); n.fresh = false; setTimeout(() => n.g.classList.remove('gv-enter'), 20); }
        requestAnimationFrame(frame);
        return new Promise(r => setTimeout(() => { frame(start + dur); r(); }, dur + 20));
      }
      for (const [, n] of this.nodes) { n.x = n.tx; n.y = n.ty; n.fresh = false; this.place(n); }
      this.drawEdges();
      return Promise.resolve();
    }

    fit() {
      if (!this.size) return;
      const aw = (this.host.clientWidth || 600) - 28;
      const ah = (this.host.clientHeight || 400) - 28;
      const scale = Math.min(1.6, Math.max(0.5, Math.min(aw / this.size.w, ah / this.size.h))) * this.zoom;
      this.svg.style.width = (this.size.w * scale) + 'px';
      this.svg.style.height = (this.size.h * scale) + 'px';
    }

    makeNode(id, res, beh) {
      const g = el('g', { class: 'gv-node', 'data-id': id }, this.gNodes);
      const n = { id, g, x: 0, y: 0 };
      if (res) {
        n.kind = res.kind === 'moment' ? 'moment' : 'state';
        g.classList.add('gv-res', 'gv-' + n.kind);
        if (isStartup(res)) g.classList.add('gv-startup');
        el('rect', { class: 'gv-shape', rx: n.kind === 'moment' ? 21 : 6 }, g);
        el('text', { class: 'gv-name', 'text-anchor': 'middle' }, g).textContent = res.label;
        n.valueEl = el('text', { class: 'gv-value', 'text-anchor': 'middle' }, g);
        if (!res.supplied && !isStartup(res)) {
          const tag = el('g', { class: 'gv-input' }, g);
          el('line', {}, tag);
          el('text', { 'text-anchor': 'end', 'dominant-baseline': 'central' }, tag).textContent = 'input';
          n.inputEl = tag;
        }
        n.titleBase = `${res.kind} ${res.label}${res.supplied ? '' : ' (set by actions)'}`;
        n.titleEl = el('title', {}, g);
        n.titleEl.textContent = n.titleBase;
      } else {
        n.kind = 'behavior';
        g.classList.add('gv-beh');
        el('rect', { class: 'gv-shape', rx: 3 }, g);
        n.labelEl = el('text', { class: 'gv-label', 'text-anchor': 'middle' }, g);
        this.wrapLabel(n.labelEl, beh.label);
        const badge = el('g', { class: 'gv-badge' }, g);
        el('circle', { r: 10 }, badge);
        n.badgeText = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, badge);
        n.badge = badge;
        const fx = el('g', { class: 'gv-fx' }, g);
        el('rect', { width: 22, height: 14, rx: 3 }, fx);
        el('text', { x: 11, y: 7, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, fx).textContent = 'fx';
        n.fx = fx;
        el('title', {}, g).textContent = `behavior: ${beh.label}`;
      }
      return n;
    }

    wrapLabel(t, label) {
      t.innerHTML = '';
      const words = String(label).split(' ');
      const lines = [];
      let cur = '';
      for (const w of words) { if ((cur + ' ' + w).trim().length > 17 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
      if (cur) lines.push(cur);
      const shown = lines.slice(0, 2);
      if (lines.length > 2) shown[1] = shown[1].slice(0, 15) + '…';
      shown.forEach((l, i) => { el('tspan', { x: 0, dy: i === 0 ? (shown.length > 1 ? '-0.25em' : '0.35em') : '1.15em' }, t).textContent = l; });
    }

    place(n) {
      n.g.setAttribute('transform', `translate(${n.x},${n.y})`);
      const r = n.g.querySelector('.gv-shape');
      r.setAttribute('x', -n.w / 2); r.setAttribute('y', -n.h / 2); r.setAttribute('width', n.w); r.setAttribute('height', n.h);
      if (n.kind === 'behavior') {
        n.badge.setAttribute('transform', `translate(${n.w / 2 - 2},${-n.h / 2 + 2})`);
        n.fx.setAttribute('transform', `translate(${n.w / 2 - 26},${n.h / 2 - 9})`);
      } else {
        const [name, value] = n.g.querySelectorAll('text');
        name.setAttribute('y', -3); value.setAttribute('y', 13);
        if (n.inputEl) {
          const line = n.inputEl.querySelector('line');
          line.setAttribute('x1', -n.w / 2 - 22); line.setAttribute('x2', -n.w / 2 - 2); line.setAttribute('y1', 0); line.setAttribute('y2', 0);
          const t = n.inputEl.querySelector('text');
          t.setAttribute('x', -n.w / 2 - 25); t.setAttribute('y', 0);
        }
      }
    }

    drawEdges() {
      for (const e of this.edges) {
        const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
        if (!a || !b) continue;
        const x1 = a.x + a.w / 2, y1 = a.y, x2 = b.x - b.w / 2 - 2, y2 = b.y;
        if (x2 < x1) {
          // a link that runs backwards (order or trace demand): loop under the nodes
          const low = Math.max(a.y + a.h / 2, b.y + b.h / 2) + 24;
          e.path.setAttribute('d', `M${x1},${y1} C${x1 + 40},${low} ${x2 - 40},${low} ${x2},${y2}`);
        } else {
          const dx = Math.max(20, (x2 - x1) * 0.5);
          e.path.setAttribute('d', `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
        }
      }
    }

    // ---- state for one step ----
    show(state) {
      for (const [id, n] of this.nodes) {
        const g = n.g;
        g.classList.toggle('is-updated', state.updated.has(id));
        g.classList.toggle('is-queued', state.queued.has(id));
        g.classList.toggle('is-running', state.running === id);
        g.classList.toggle('is-ran', state.ran.has(id) && state.running !== id);
        g.classList.toggle('is-current', state.current === id);
        g.classList.toggle('is-error', state.errors.has(id));
        if (n.valueEl) {
          const v = state.values[id] ?? '';
          n.valueEl.textContent = v.length > 15 ? v.slice(0, 14) + '…' : v;
          n.titleEl.textContent = `${n.titleBase}${v !== '' ? ` = ${v}` : ''}`;
        }
        if (n.badge) {
          const k = state.ran.get(id);
          n.badge.classList.toggle('on', k != null);
          n.badgeText.textContent = k ?? '';
          n.fx.classList.toggle('on', state.fxQueued.has(id));
          n.fx.classList.toggle('run', state.fxRunning === id);
        }
        if (n.inputEl) n.inputEl.classList.toggle('on', state.inputs.has(id));
      }
      for (const e of this.edges) e.path.classList.toggle('hot', state.hotEdges.has(e.from + '>' + e.to));
    }

    pulse(from, to, ms) {
      const e = this.edges.find(x => x.from === from && x.to === to);
      if (!e || reduceMotion() || ms < 60) return;
      const len = e.path.getTotalLength();
      const dot = el('circle', { r: 5, class: 'gv-pulse' }, this.gPulse);
      const start = performance.now();
      const frame = () => {
        const k = Math.min(1, (performance.now() - start) / ms);
        const p = e.path.getPointAtLength(len * k);
        dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
        if (k < 1) requestAnimationFrame(frame); else dot.remove();
      };
      requestAnimationFrame(frame);
      setTimeout(() => dot.remove(), ms + 200);
    }
  }

  window.BGTraceGraphView = GraphView;
})();
