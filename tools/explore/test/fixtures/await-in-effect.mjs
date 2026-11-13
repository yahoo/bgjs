// A side effect that starts an action after an await: explore never runs it, and must say so.
import * as bg from 'behavior-graph';

class Loader extends bg.Extent {
  constructor(g) {
    super(g);
    this.go = this.moment();
    this.loaded = this.state(false);
    this.behavior().demands(this.go).runs((ext) => ext.sideEffect(() => {
      (async () => { await null; ext.loaded.updateWithAction(true); })();
    }));
  }
}

export default {
  bg,
  setup: () => { const l = new Loader(new bg.Graph()); l.addToGraphWithAction(); return l; },
  actions: [{ name: 'go', run: (l) => l.go.updateWithAction() }],
  checks: [(l) => (l.loaded.value ? 'loaded' : undefined)],
  depth: 2,
};
