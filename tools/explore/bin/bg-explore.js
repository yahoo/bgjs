#!/usr/bin/env node
// Explore a spec, and if a property fails, replay the counterexample with bg-trace and explain it.
//
//   bg-explore <spec.mjs> [--depth N] [--mode bfs|random] [--walks N] [--seed N] [--reduction none|sleep]
//              [--max-states N] [--html cex.html] [--json result.json] [--no-trace] [--quiet]
//
// A spec is an ES module whose default export is explore's options ({ setup, actions, depth,
// checks, ... }), or a function returning them. Exit code: 0 when no violation was found, 1
// when one was, 2 on a usage or setup error, 3 when the search stopped at --max-states before
// finding a violation (not a pass).
import { mkdirSync, writeFileSync as write } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { explore, exploreLateEvents, stepKey } from '../src/explore.js';
import { traceCounterexample } from '../src/replay.js';
import { explain } from '../../trace/src/text.js';
import { toHTML } from '../../trace/src/html.js';

const writeFileSync = (p, text) => { mkdirSync(dirname(resolve(p)), { recursive: true }); write(p, text); };
const usage = 'usage: bg-explore <spec.mjs> [--depth N] [--mode bfs|random] [--walks N] [--seed N] [--reduction none|sleep] [--max-states N] [--html cex.html] [--json result.json] [--no-trace] [--quiet]';
const die = (message) => { console.error(`${message}\n${usage}`); process.exit(2); };

const valued = { '--depth': 'int0', '--walks': 'int1', '--seed': 'int', '--max-states': 'int1', '--mode': ['bfs', 'random'],
  '--reduction': ['none', 'sleep'], '--html': 'path', '--json': 'path' };
const switches = new Set(['--no-trace', '--quiet', '--help', '-h']);
const given = {};
const positional = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (switches.has(a)) { given[a] = true; continue; }
  if (!(a in valued)) {
    if (a.startsWith('-')) die(`unknown option ${a}`);
    positional.push(a);
    continue;
  }
  const v = argv[++i];
  if (v === undefined) die(`${a} must be followed by a value`);
  const kind = valued[a];
  if (Array.isArray(kind)) {
    if (!kind.includes(v)) die(`${a} must be one of ${kind.join(', ')}, not ${JSON.stringify(v)}`);
    given[a] = v;
  } else if (kind === 'path') {
    given[a] = v;
  } else {
    const min = kind === 'int0' ? 0 : kind === 'int1' ? 1 : -Infinity;
    if (!/^-?\d+$/.test(v) || Number(v) < min) die(`${a} must be an integer${min > -Infinity ? ` >= ${min}` : ''}, not ${JSON.stringify(v)}`);
    given[a] = Number(v);
  }
}
if (given['--help'] || given['-h']) { console.log(usage); process.exit(0); }
if (positional.length !== 1) die(positional.length === 0 ? 'no spec given' : `one spec only, got ${positional.join(' ')}`);

const overrides = { depth: given['--depth'], mode: given['--mode'], walks: given['--walks'], seed: given['--seed'],
  reduction: given['--reduction'], maxStates: given['--max-states'] };
const htmlOut = given['--html'] ?? null;
const jsonOut = given['--json'] ?? null;
const noTrace = given['--no-trace'] === true;
const quiet = given['--quiet'] === true;
const file = positional[0];

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
// an async continuation (after an await, in a timer) runs only now, outside the search; a
// violation found is still real, but a pass does not cover that work
exploreLateEvents();
await new Promise((r) => setTimeout(r, 0));
const late = exploreLateEvents();
if (result.ok && late > 0) {
  console.error(`explore stopped: ${late} event(s) ran on explored graphs after their step had returned. A side effect or run ` +
    'continued asynchronously (after an await, or in a timer), so the search never saw that work and its result does not cover ' +
    'it. Steps must be synchronous: model each reply or timer fire as an explicit action that delivers it, as examples/search.mjs does.');
  process.exit(2);
}
const s = result.stats;
const searched = `${s.states} states, ${s.transitions} transitions, depth ${s.depthCompleted} of ${opts.depth} completed${s.slept ? `, ${s.slept} steps skipped by sleep sets` : ''}${s.truncated ? ', TRUNCATED at maxStates' : ''}, ${s.ms} ms`;
const out = { ok: result.ok, stats: s, counterexample: result.counterexample };

if (result.ok && s.truncated) {
  console.log(`No violation found before the search was TRUNCATED at maxStates: ${searched}.`);
  console.log('This is not a pass: states within the depth were not explored. Shrink the input domains or the depth, raise --max-states, or use --mode random.');
} else if (result.ok) {
  console.log(`No violation found (${opts.mode === 'random' ? 'random walks' : 'every input sequence'} up to depth ${opts.depth}): ${searched}.`);
  console.log('Bounded search is not proof: it covers the given inputs up to this depth.');
} else {
  const cex = result.counterexample;
  if (cex.steps.length === 0) console.log(`Violation in the starting state that setup() builds, before any step (${searched}):`);
  else console.log(`Violation after ${cex.steps.length} step(s) (${searched}):`);
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
process.exit(!result.ok ? 1 : s.truncated ? 3 : 0);
