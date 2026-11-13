// A search box with a planted stale-reply bug. Each query starts a request; replies can arrive
// in any order. The results shown must belong to the current query once nothing is pending.
//
//   node bin/bg-explore.js examples/search.mjs              finds the bug and explains it
//   node bin/bg-explore.js examples/search.mjs --html cex.html
//
// Set FIXED=1 to check the version that ignores replies to old requests.
import * as bg from 'behavior-graph';

const fixed = process.env.FIXED === '1';

class Search extends bg.Extent {
  constructor(graph, server) {
    super(graph);
    this.server = server;               // the outside world: requests in flight
    this.query = this.state('');
    this.reply = this.moment();         // { id, query, results }
    this.requestId = this.state(0);
    this.results = this.state([]);

    // Start a request whenever the query changes.
    this.behavior().demands(this.query).supplies(this.requestId).runs((ext) => {
      if (ext.query.value === '') return;
      const id = ext.requestId.value + 1;
      ext.requestId.update(id);
      const q = ext.query.value;
      ext.sideEffect(() => ext.server.pending.push({ id, query: q }));
    });

    // Show a reply's results.
    this.behavior().demands(this.reply, this.requestId).supplies(this.results).runs((ext) => {
      if (!ext.reply.justUpdated) return;
      const r = ext.reply.value;
      if (fixed && r.id !== ext.requestId.value) return;   // the fix: ignore replies to old requests
      ext.results.update(r.results);
    });
  }
}

const resultsFor = (q) => [`${q}-1`, `${q}-2`];

export default {
  bg,
  setup: () => {
    const server = { pending: [] };
    const s = new Search(new bg.Graph(), server);
    s.addToGraphWithAction('start');
    return s;
  },
  actions: [
    { name: 'type', inputs: ['ca', 'cat'], enabled: (s, q) => s.query.value !== q,
      run: (s, q) => s.query.updateWithAction(q, `type "${q}"`) },
    { name: 'reply', inputs: ['oldest', 'newest'], enabled: (s) => s.server.pending.length > 0,
      run: (s, which) => {
        const req = which === 'oldest' ? s.server.pending.shift() : s.server.pending.pop();
        s.reply.updateWithAction({ id: req.id, query: req.query, results: resultsFor(req.query) }, `reply to "${req.query}"`);
      } },
  ],
  envKey: (s) => s.server.pending,
  opaque: (v) => 'pending' in v,
  checks: [
    (s) => {
      if (s.server.pending.length > 0 || s.query.value === '') return;
      const want = resultsFor(s.query.value);
      if (JSON.stringify(s.results.value) !== JSON.stringify(want)) {
        return `nothing pending, query is "${s.query.value}", but results are ${JSON.stringify(s.results.value)}`;
      }
    },
  ],
  depth: 6,
};
