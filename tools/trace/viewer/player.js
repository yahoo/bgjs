// Steps through recorded events. Any step can be shown directly: the state at step k is the
// event's starting snapshot plus steps 0..k, so moving backwards is as cheap as forwards.
// Classic script: needs BGTraceGraphView, BGTraceText (explain, describeModel, modelsByTrace)
// and BGTraceMermaid (toMermaid); defines window.BGTracePlayer.
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const SPEEDS = { slow: 1100, normal: 600, fast: 250 };

  function mount(root, data) {
    if (!data || !Array.isArray(data.traces)) return mountEmpty(root);
    const T = window.BGTraceText, M = window.BGTraceMermaid;
    const models = T.modelsByTrace(data);
    const names = new Map();
    const allModels = [...models, data.model];
    for (const t of data.traces) for (const s of t.steps) if (s.t === 'structure') allModels.push(s.model);
    for (const m of allModels) if (m) { for (const r of m.resources) names.set(r.id, r.label); for (const b of m.behaviors) names.set(b.id, b.label); }
    const N = (id) => names.get(id) ?? id;

    root.innerHTML = `
      <div class="tv">
        <header class="tv-head">
          <div class="tv-title">${esc(data.title ?? 'Behavior Graph trace')}</div>
          <div class="tv-sub">${data.traces.length} events</div>
          <div class="tv-tabs" role="tablist">
            <button role="tab" data-tab="graph" aria-selected="true">Graph</button>
            <button role="tab" data-tab="text" aria-selected="false">Text</button>
            <button role="tab" data-tab="mermaid" aria-selected="false">Mermaid</button>
          </div>
        </header>
        <div class="tv-body">
          <nav class="tv-events" aria-label="Events"><ol></ol></nav>
          <main class="tv-main">
            <div class="tv-caption" aria-live="polite"></div>
            <div class="tv-graph"></div>
            <div class="tv-textview" hidden>
              <div class="tv-textbar"><label><input type="checkbox" class="tv-allevents"> All events</label><button class="tv-btn tv-copy">Copy</button></div>
              <pre class="tv-pre"></pre>
            </div>
            <div class="tv-controls">
              <button class="tv-btn" data-k="prevEvent" title="Previous event (Shift+←)">⏮</button>
              <button class="tv-btn" data-k="prev" title="Previous step (←)">◀</button>
              <button class="tv-btn tv-play" data-k="play" title="Play (Space)">▶ Play</button>
              <button class="tv-btn" data-k="next" title="Next step (→)">▶</button>
              <button class="tv-btn" data-k="nextEvent" title="Next event (Shift+→)">⏭</button>
              <input type="range" class="tv-scrub" min="-1" value="-1" aria-label="Step in this event">
              <select class="tv-speed" aria-label="Speed"><option value="slow">Slow</option><option value="normal" selected>Normal</option><option value="fast">Fast</option></select>
              <span class="tv-zoom"><button class="tv-btn" data-z="out" aria-label="Zoom out">−</button><button class="tv-btn" data-z="in" aria-label="Zoom in">+</button></span>
            </div>
          </main>
          <aside class="tv-steps" aria-label="Steps in this event"><ol></ol></aside>
        </div>
      </div>`;

    const view = new window.BGTraceGraphView($('.tv-graph', root));
    let ev = 0, k = -1, timer = null, tab = 'graph';

    // ---------- state at (event, step) ----------
    function stateAt(i, upto) {
      const t = data.traces[i];
      let model = models[i] ?? data.model;
      const values = Object.assign({}, t.before?.values ?? {});
      const st = { model, values, updated: new Set(), queued: new Set(), ran: new Map(), running: null, current: null,
        inputs: new Set(), fxQueued: new Set(), fxRunning: null, hotEdges: new Set(), errors: new Set(), phase: 'idle', error: null };
      let n = 0;
      for (let j = 0; j <= upto && j < t.steps.length; j++) {
        const s = t.steps[j];
        st.current = null;
        st.hotEdges = new Set();
        switch (s.t) {
          case 'action': st.phase = 'action'; break;
          case 'update':
            values[s.res] = s.value; st.updated.add(s.res); st.current = s.res;
            if (s.by) st.hotEdges.add(s.by + '>' + s.res); else st.inputs.add(s.res);
            break;
          case 'activate': st.queued.add(s.beh); if (s.via) st.hotEdges.add(s.via + '>' + s.beh); st.current = s.beh; break;
          case 'run': st.phase = 'behaviors'; st.queued.delete(s.beh); st.running = s.beh; st.ran.set(s.beh, ++n); st.current = s.beh; break;
          case 'relink': st.current = s.beh; break;
          case 'effect': if (s.beh) st.fxQueued.add(s.beh); break;
          case 'effectRun': st.phase = 'effects'; st.running = null; if (s.beh) { st.fxQueued.delete(s.beh); st.fxRunning = s.beh; st.current = s.beh; } break;
          case 'structure':
            st.model = s.model;
            for (const r of s.model.resources) if (!(r.id in values)) values[r.id] = r.value;
            break;
          case 'error': st.error = s.message; break;
        }
      }
      if (upto >= t.steps.length - 1 && t.steps.length) { st.running = null; st.fxRunning = null; st.phase = 'done'; }
      return st;
    }

    function describe(s) {
      switch (s.t) {
        case 'action': return ['action', `Action: ${s.name}`];
        case 'update':
          if (s.extent) return ['update', `${s.extent} ${s.value === 'true' ? 'added to' : 'removed from'} the graph`];
          return ['update', s.by ? `‘${N(s.by)}’ sets ${s.name} = ${s.value}` : (s.value === '(fired)' ? `${s.name} fires` : `${s.name} = ${s.value}`)];
        case 'activate': return ['activate', s.via ? `${N(s.via)} activates ‘${N(s.beh)}’` : `‘${N(s.beh)}’ is activated`];
        case 'run': return ['run', `‘${N(s.beh)}’ runs`];
        case 'relink': return ['structure', `‘${N(s.beh)}’ gets a new list of demands`];
        case 'effect': return ['effect', `‘${N(s.beh)}’ queues a side effect${s.name ? ` “${s.name}”` : ''}`];
        case 'effectRun': return ['effect', `Side effect${s.name ? ` “${s.name}”` : ''} runs`];
        case 'structure': return ['structure', 'The graph changes shape'];
        case 'error': return ['error', `Error: ${s.message}`];
      }
      return ['', s.t];
    }

    // ---------- rendering ----------
    function renderEvents() {
      $('.tv-events ol', root).innerHTML = data.traces.map((t, i) => {
        const runs = t.steps.filter(s => s.t === 'run').length;
        const err = t.steps.some(s => s.t === 'error');
        return `<li><button data-ev="${i}" class="${i === ev ? 'on' : ''}${err ? ' err' : ''}"><span class="tv-seq">${t.seq ?? '·'}</span><span class="tv-src">${esc(t.source)}</span><span class="tv-n">${runs}</span></button></li>`;
      }).join('');
      root.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => go(+b.dataset.ev, -1));
    }

    function renderSteps() {
      const t = data.traces[ev];
      $('.tv-steps ol', root).innerHTML = `<li><button data-step="-1" class="${k === -1 ? 'on' : ''}"><span class="tv-st tv-st-start">Before the event</span></button></li>` +
        t.steps.map((s, j) => { const [c, text] = describe(s); return `<li><button data-step="${j}" class="${j === k ? 'on' : ''}${j > k ? ' later' : ''}"><span class="tv-st tv-st-${c}">${esc(text)}</span></button></li>`; }).join('');
      root.querySelectorAll('[data-step]').forEach(b => b.onclick = () => go(ev, +b.dataset.step));
      const cur = $('.tv-steps button.on', root);
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    function render(animate) {
      const t = data.traces[ev];
      const st = stateAt(ev, k);
      const s = t.steps[k];
      view.setModel(st.model, animate).then(() => view.show(st));
      view.show(st);
      if (animate && s) {
        const ms = Math.min(500, SPEEDS[$('.tv-speed', root).value] * 0.7);
        if (s.t === 'update' && s.by) view.pulse(s.by, s.res, ms);
        if (s.t === 'activate' && s.via) view.pulse(s.via, s.beh, ms);
      }
      const phase = { idle: 'Before', action: 'Action', behaviors: 'Behaviors', effects: 'Side effects', done: 'Done' }[st.phase];
      const caption = k < 0 ? `Event ${t.seq}: ${esc(t.source)}. Step through to see what it does.` : esc(describe(s)[1]);
      $('.tv-caption', root).innerHTML = `<span class="tv-phase tv-ph-${st.phase}">${phase}</span> ${caption}${st.error ? ` <span class="tv-err">${esc(st.error)}</span>` : ''}`;
      const scrub = $('.tv-scrub', root);
      scrub.max = t.steps.length - 1;
      scrub.value = k;
      renderEvents();
      renderSteps();
      if (tab !== 'graph') renderText();
    }

    function renderText() {
      const t = data.traces[ev];
      let text;
      if (tab === 'text') {
        const all = $('.tv-allevents', root).checked;
        text = all ? T.explain(data) : T.explain(data, { events: [t.seq] });
        text += '\n\n— Structure at the end of this event —\n' + T.describeModel(stateAt(ev, t.steps.length - 1).model);
      } else {
        text = M.toMermaid(stateAt(ev, t.steps.length - 1).model, { trace: t });
      }
      $('.tv-pre', root).textContent = text;
    }

    function go(i, step, animate = false) {
      ev = Math.max(0, Math.min(data.traces.length - 1, i));
      const max = data.traces[ev].steps.length - 1;
      k = Math.max(-1, Math.min(max, step));
      render(animate);
    }

    function next() {
      const max = data.traces[ev].steps.length - 1;
      if (k < max) go(ev, k + 1, true);
      else if (ev < data.traces.length - 1) go(ev + 1, -1, true);
      else stop();
    }
    function prev() {
      if (k > -1) go(ev, k - 1);
      else if (ev > 0) go(ev - 1, data.traces[ev - 1].steps.length - 1);
    }
    function play() {
      if (timer) return stop();
      $('.tv-play', root).textContent = '❚❚ Pause';
      const tick = () => {
        next();
        if (!timer) return;
        const atEnd = k === data.traces[ev].steps.length - 1;
        timer = setTimeout(tick, SPEEDS[$('.tv-speed', root).value] * (atEnd ? 2 : 1));
      };
      timer = setTimeout(tick, 50);
    }
    function stop() {
      clearTimeout(timer);
      timer = null;
      $('.tv-play', root).textContent = '▶ Play';
    }

    root.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const a = b.dataset.k;
      if (a === 'play') return play();
      stop();
      if (a === 'next') next();
      if (a === 'prev') prev();
      if (a === 'nextEvent') go(ev + 1, -1);
      if (a === 'prevEvent') go(ev - 1, -1);
    });
    $('.tv-scrub', root).oninput = (e) => { stop(); go(ev, +e.target.value); };
    root.querySelectorAll('[data-z]').forEach(b => b.onclick = () => {
      view.zoom = Math.max(0.5, Math.min(2.5, view.zoom * (b.dataset.z === 'in' ? 1.2 : 1 / 1.2)));
      view.fit();
    });
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      tab = b.dataset.tab;
      root.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
      $('.tv-graph', root).hidden = tab !== 'graph';
      $('.tv-textview', root).hidden = tab === 'graph';
      $('.tv-allevents', root).parentElement.hidden = tab !== 'text';
      if (tab !== 'graph') renderText();
    });
    $('.tv-allevents', root).onchange = renderText;
    $('.tv-copy', root).onclick = (e) => {
      const text = $('.tv-pre', root).textContent;
      const done = () => { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1200); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => selectPre());
      else selectPre();
    };
    function selectPre() {
      const r = document.createRange();
      r.selectNodeContents($('.tv-pre', root));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, select, textarea')) return;
      if (e.key === 'ArrowRight') { stop(); e.shiftKey ? go(ev + 1, -1) : next(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { stop(); e.shiftKey ? go(ev - 1, -1) : prev(); e.preventDefault(); }
      else if (e.key === ' ') { play(); e.preventDefault(); }
    });
    window.addEventListener('resize', () => view.fit());
    go(0, -1);
  }

  function mountEmpty(root) {
    root.innerHTML = `<div class="tv-empty">
      <h1>Behavior Graph trace viewer</h1>
      <p>Drop a trace file here (the JSON from <code>tracer.toJSON()</code> or <code>bg-trace --json</code>), choose one, or paste it.</p>
      <p><input type="file" accept=".json,application/json" class="tv-file"></p>
      <textarea class="tv-paste" rows="6" placeholder="…or paste trace JSON here" aria-label="Trace JSON"></textarea>
      <p class="tv-err" hidden></p>
    </div>`;
    const load = (text) => {
      try { mount(root, JSON.parse(text)); } catch (e) { const p = $('.tv-err', root); p.hidden = false; p.textContent = 'That is not trace JSON: ' + e.message; }
    };
    $('.tv-file', root).onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then(load); };
    $('.tv-paste', root).oninput = (e) => { if (e.target.value.trim().startsWith('{')) load(e.target.value); };
    root.ondragover = (e) => e.preventDefault();
    root.ondrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) f.text().then(load); };
  }

  window.BGTracePlayer = { mount };
})();
