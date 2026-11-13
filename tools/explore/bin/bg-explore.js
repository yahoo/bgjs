#!/usr/bin/env node
// Explore a spec, and if a property fails, replay the counterexample with bg-trace and explain it.
//
//   bg-explore <spec.mjs> [--depth N] [--mode bfs|random] [--walks N] [--seed N] [--reduction sleep]
//              [--max-states N] [--html cex.html] [--json result.json] [--no-trace] [--quiet]
//
// A spec is an ES module whose default export is explore's options ({ setup, actions, depth,
// checks, ... }), or a function returning them. Exit code: 0 when no violation was found, 1
// when one was, 2 on a usage or setup error.
import { mkdirSync, writeFileSync as write } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { explore, stepKey } from '../src/explore.js';
import { traceCounterexample } from '../src/replay.js';
import { explain } from '../../trace/src/text.js';
import { toHTML } from '../../trace/src/html.js';

const writeFileSync = (p, text) => { mkdirSync(dirname(resolve(p)), { recursive: true }); write(p, text); };
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const usage = 'usage: bg-explore <spec.mjs> [--depth N] [--mode bfs|random] [--walks N] [--seed N] [--reduction sleep] [--max-states N] [--html cex.html] [--json result.json] [--no-trace] [--quiet]';
if (bool('--help') || bool('-h')) { console.log(usage); process.exit(0); }

const num = (name) => { const v = flag(name); return v === null ? undefined : Number(v); };
const overrides = { depth: num('--depth'), mode: flag('--mode') ?? undefined, walks: num('--walks'), seed: num('--seed'),
  reduction: flag('--reduction') ?? undefined, maxStates: num('--max-states') };
const htmlOut = flag('--html');
const jsonOut = flag('--json');
const noTrace = bool('--no-trace');
const quiet = bool('--quiet');
const file = args[0];
if (!file) { console.error(usage); process.exit(2); }

let opts;
try {
  const mod = await import(pathToFileURL(resolve(file)).href);
  const spec = mod.default ?? mod.spec;
  opts = typeof spec === 'function' ? await spec() : spec;
  if (!opts || typeof opts.setup !== 'function' || !Array.isArray(opts.actions)) throw new Error(`${file} must export default { setup, actions, depth, checks? }`);
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) opts[k] = v;
  if (typeof opts.depth !== 'number') throw new Error('no depth: set depth in the spec or pass --depth');
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

let result;
try {
  result = explore(opts);
} catch (e) {
  console.error(`explore stopped: ${e.message}`);
  process.exit(2);
}
const s = result.stats;
const searched = `${s.states} states, ${s.transitions} transitions, depth ${s.depthCompleted} of ${opts.depth} completed${s.slept ? `, ${s.slept} steps skipped by sleep sets` : ''}${s.truncated ? ', TRUNCATED at maxStates' : ''}, ${s.ms} ms`;
const out = { ok: result.ok, stats: s, counterexample: result.counterexample };

if (result.ok) {
  console.log(`No violation found (${opts.mode === 'random' ? 'random walks' : 'every input sequence'} up to depth ${opts.depth}): ${searched}.`);
  console.log('Bounded search is not proof: it covers the given inputs up to this depth.');
} else {
  const cex = result.counterexample;
  console.log(`Violation after ${cex.steps.length} step(s) (${searched}):`);
  cex.steps.forEach((st, i) => console.log(`  ${i + 1}. ${stepKey(st)}`));
  console.log('\n' + cex.violations.map((v) => '  ' + v.replace(/\n/g, '\n  ')).join('\n'));
  if (!noTrace || htmlOut) {
    const replay = traceCounterexample(opts, cex.steps);
    out.traces = replay.traces;
    if (!noTrace && !quiet) {
      console.log('\nTrace of the counterexample (setup, then one or more events per step):\n');
      replay.traces.forEach((data, i) => {
        if (replay.traces.length > 1) console.log(`# graph ${i + 1}\n`);
        console.log(explain(data));
      });
    }
    if (replay.violations.length === 0) console.log('\nWARNING: the replay did not fail; the spec is not deterministic.');
    if (htmlOut) {
      replay.traces.forEach((data, i) => {
        const p = replay.traces.length > 1 ? htmlOut.replace(/(\.\w+)?$/, (ext) => `.${i + 1}${ext || ''}`) : htmlOut;
        writeFileSync(p, toHTML({ ...data, title: `Counterexample: ${file}` }));
        console.error(`wrote ${p}`);
      });
    }
  }
}
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 2)); console.error(`wrote ${jsonOut}`); }
process.exit(result.ok ? 0 : 1);
