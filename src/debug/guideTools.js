/**
 * Guide and standing-order developer tools (development builds only — see devTools.js / DebugPanel.js).
 * In the browser console:
 *   dev.gd.advice()              what the "What next?" advisor says right now
 *   dev.gd.steps()               the getting-started steps: done, current, locked
 *   dev.gd.done(id)              tick off a step now (with its reward) · dev.gd.reset() starts the guide again
 *   dev.gd.path(id)              follow a path (contractor, transport, landlord, business, founder, craftsman)
 *   dev.gd.orders()              your standing orders and how each is going
 *   dev.gd.order(spec)           a new order, e.g. { kind: 'keep', item: 'wood', from: 'buy', qty: 40 }
 */
export function guideTools(dev) {
  const sim = () => dev.sim;
  return {
    advice: () => {
      const list = sim().guide.advice(10);
      console.table(list.map((a) => ({ id: a.id, prio: a.prio, params: JSON.stringify(a.params), go: JSON.stringify(a.go) })));
      return `${list.length} suggestions`;
    },
    steps: () => {
      const G = sim().guide;
      const cur = G.current();
      console.table(G.steps().map((s) => ({ id: s.id, chapter: s.chapter, done: G.isDone(s.id), now: cur?.step.id === s.id, locked: !G.available(s) })));
      return `${G.progress().done}/${G.progress().total}`;
    },
    done: (id) => {
      const G = sim().guide;
      const s = id ? G.step(id) : G.current()?.step;
      if (!s) return 'no such step';
      G.complete(s);
      return `done: ${s.id}`;
    },
    reset: () => {
      sim().state.guide = { done: {}, path: null, miles: {}, hidden: false };
      return 'guide reset';
    },
    path: (id = 'transport') => (sim().guide.choosePath(id) ? JSON.stringify(sim().guide.pathProgress().next) : 'no such path'),
    orders: () => {
      const W = sim().workers;
      console.table(W.orderList().map((o) => ({ id: o.id, kind: o.kind, item: o.item, from: o.from, to: o.to, qty: o.qty, moved: o.moved, total: o.total, state: W.orderStatus(o).state })));
      return `${W.orderList().length} orders`;
    },
    order: (spec = { kind: 'keep', item: 'wood', from: 'auto', to: 'store', qty: 40 }) => JSON.stringify(sim().workers.addOrder(spec)),
  };
}
