// A headless canvas plus just enough DOM for js/view.js to run under plain node.
//
// view.js is the one module in this repo that holds real behaviour (the fixed-step simulation) and
// still needs a browser to be *seen* doing it. This stub is what lets test/sim.test.mjs drive that
// simulation from node: a 2D context that accepts every call and records nothing, a canvas element
// with the two methods view.js touches, an Image that loads when a test says so, and a
// requestAnimationFrame queue the test pumps by hand at whatever rate it is pretending to be.
//
// It is deliberately not a renderer. Comparing pixels through a fake would test the fake; the
// assertions here are about the numbers view.js integrates, which the fake cannot influence.

function makeContext(canvas) {
  // Ops are counted, never interpreted: a test can ask "did the sprite path or the arc path
  // actually run?" without this file pretending to be a rasteriser.
  const ops = { fill: 0, stroke: 0, arc: 0, drawImage: 0, clearRect: 0, paths: 0, text: 0 };
  const noop = () => {};
  return {
    ops,
    canvas,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    setTransform: noop,
    resetTransform: noop,
    clearRect: () => { ops.clearRect++; },
    fillRect: noop,
    strokeRect: noop,
    beginPath: () => { ops.paths++; },
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: () => { ops.arc++; },
    ellipse: noop,
    fill: () => { ops.fill++; },
    stroke: () => { ops.stroke++; },
    drawImage: () => { ops.drawImage++; },
    fillText: () => { ops.text++; },
    strokeText: noop,
    measureText: () => ({ width: 0 }),
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
}

export function createCanvasStub({ width = 320, height = 320 } = {}) {
  const listeners = new Map();
  const canvas = {
    width,
    height,
    style: {},
    nodeType: 1,
    tagName: 'CANVAS',
    parentNode: null,
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height }),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      const list = listeners.get(type) || [];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    getContext: () => canvas.__ctx,
    dispatch(type, ev = {}) {
      for (const fn of listeners.get(type) || []) fn(ev);
    },
    listenerCount: (type) => (listeners.get(type) || []).length,
  };
  canvas.__ctx = makeContext(canvas);
  canvas.__ops = canvas.__ctx.ops;
  canvas.__listeners = listeners;
  return canvas;
}

// Images never load by themselves in node: the test decides when a pending sprite arrives, so
// both branches of view.js's `sprite.complete` check are reachable on purpose.
export function createImageStub() {
  const live = [];
  function ImageStub() {
    this.src = '';
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.onload = null;
    this.onerror = null;
    live.push(this);
  }
  Object.defineProperty(ImageStub, 'loaded', { get: () => live.length });
  return {
    Image: ImageStub,
    live,
    // Every outstanding image arrives, successfully. `naturalWidth` nonzero is what view.js's
    // paint path asks about before it will drawImage instead of falling back to an arc.
    loadAll({ width = 64, height = 64 } = {}) {
      for (const img of live) {
        if (img.complete) continue;
        img.complete = true;
        img.naturalWidth = width;
        img.naturalHeight = height;
        if (typeof img.onload === 'function') img.onload({ type: 'load', target: img });
      }
    },
  };
}

// A frame queue the caller pumps. requestAnimationFrame never runs by itself here, which is the
// whole point: a test gets to be a 30 Hz screen, a 144 Hz screen, or no screen at all.
export function createRafQueue() {
  let pending = new Map();
  let seq = 0;
  return {
    requestAnimationFrame(cb) {
      seq += 1;
      pending.set(seq, cb);
      return seq;
    },
    cancelAnimationFrame(id) {
      pending.delete(id);
    },
    get armed() {
      return pending.size;
    },
    // Run every callback registered *before this pump*, exactly as a browser does: one frame,
    // one timestamp, callbacks re-arming themselves land on the next frame, not this one.
    pump(ts) {
      const batch = pending;
      pending = new Map();
      for (const cb of batch.values()) cb(ts);
      return batch.size;
    },
  };
}
