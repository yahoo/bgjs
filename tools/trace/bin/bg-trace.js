#!/usr/bin/env node
// Run a scenario script and report what its graph did.
//
//   bg-trace <scenario.mjs> [--html out.html] [--json out.json] [--mermaid] [--model] [--quiet]
//   bg-trace --viewer out.html            an empty viewer that opens dropped trace files
//
// A scenario is an ES module whose default export receives { trace } and drives a graph:
//
//   export default function scenario({ trace }) {
//     const graph = new bg.Graph();
//     const tracer = trace(graph);          // start recording before adding extents
//     ...add extents, run actions...
//   }
//
// By default the text explanation of every event is printed to stdout.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { traceGraph } from '../src/tracer.js';
import { explain, describeModel } from '../src/text.js';
import { toMermaid } from '../src/mermaid.js';
import { toHTML } from '../src/html.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };

const usage = 'usage: bg-trace <scenario.mjs> [--html out.html] [--json out.json] [--mermaid] [--model] [--title "..."] [--quiet]\n       bg-trace --viewer out.html';
if (bool('--help') || bool('-h')) { console.log(usage); process.exit(0); }

const viewerOut = flag('--viewer');
if (viewerOut) {
  writeFileSync(viewerOut, toHTML(null));
  console.error(`wrote ${viewerOut} (drop a trace .json on it)`);
  process.exit(0);
}

const htmlOut = flag('--html');
const jsonOut = flag('--json');
const title = flag('--title');
const mermaid = bool('--mermaid');
const showModel = bool('--model');
const quiet = bool('--quiet');
const file = args[0];
if (!file) { console.error(usage); process.exit(2); }

const tracers = [];
const trace = (graph, options) => { const t = traceGraph(graph, options); tracers.push(t); return t; };

let failure = null;
try {
  const mod = await import(pathToFileURL(resolve(file)).href);
  const run = mod.default ?? mod.scenario;
  if (typeof run !== 'function') throw new Error(`${file} must export a default function ({ trace }) => { ... }`);
  await run({ trace });
} catch (e) {
  failure = e;
}

if (!tracers.length) {
  console.error(failure ? `${file} failed before trace(graph) was called: ${failure.message}` : `${file} never called trace(graph); nothing was recorded.`);
  process.exit(1);
}

tracers.forEach((t, i) => {
  const data = { ...t.toJSON(), title: title ?? (tracers.length > 1 ? `${file} (graph ${i + 1})` : file) };
  const suffix = tracers.length > 1 ? `.${i + 1}` : '';
  const withSuffix = (p) => p.replace(/(\.\w+)?$/, (ext) => suffix + (ext || ''));
  if (!quiet) {
    if (tracers.length > 1) console.log(`# graph ${i + 1}\n`);
    console.log(explain(data));
    if (showModel) console.log('\n' + describeModel(data.model));
    if (mermaid) console.log('\n```mermaid\n' + toMermaid(data.model, { trace: data.traces.at(-1) }) + '\n```');
  }
  if (jsonOut) { writeFileSync(withSuffix(jsonOut), JSON.stringify(data, null, 2)); console.error(`wrote ${withSuffix(jsonOut)}`); }
  if (htmlOut) { writeFileSync(withSuffix(htmlOut), toHTML(data)); console.error(`wrote ${withSuffix(htmlOut)}`); }
});

if (failure) {
  console.error(`\nThe scenario threw: ${failure.message}`);
  process.exit(1);
}
