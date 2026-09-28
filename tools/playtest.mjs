// Minimal CDP driver for headless playtesting (Node 21+ global WebSocket/fetch).
// env: CDP_PORT (devtools port, default 9359), BASE_URL (page to attach to, default
//      http://127.0.0.1:5199/)
// usage:
//   node playtest.mjs open  <url>          # reuse-or-create our page and navigate
//   node playtest.mjs nav   <url>
//   node playtest.mjs eval  '<js expression>'   # pass `nonav` to skip the reload
//   node playtest.mjs eval  '@boot'         # | @play | @routes | @save | @pointer
//   node playtest.mjs shot  <path.png>
//   node playtest.mjs logs
//
// Every scenario reports { rows, fail } in the same shape as tools/harness.mjs, so
// tools/verify.sh aggregates node suites and browser suites on one line.
//
// The hook this drives is `window.pocketcube` (js/main.js:356). It used to be a copy of the
// slide-parking repo's driver, still poking at `window.gridlock` — a global that this game never
// defines, so every row was asserting the behaviour of a page that did not exist here.
const PORT = process.env.CDP_PORT || 9359;
// Which page to attach to. Hard-coding the dev-server port silently evaluates
// against a fresh about:blank tab when pointed at any other origin.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone already */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Wait on the shell, not on a timer. The page is a module graph fetched over the network:
  // a fixed sleep is long enough for a localhost server and too short for GitHub Pages, where
  // it made an innocent deployment look broken (the hook still undefined, canvas still
  // the unstyled 300x150 default). The floor keeps the local case as fast as it was.
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.pocketcube && window.pocketcube.state && window.pocketcube.state.id)');
      } catch { ready = false; }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      if (name === 'pointer') {
        value = await pointerScenario(cdp, sessionId, runJS);
      } else if (SCENARIOS[name]) {
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// The one suite a page-side script cannot run: real input. Everything below goes through
// Chrome's own mouse and keyboard over CDP, so what gets asserted is the finger-to-turn wiring
// in js/view.js rather than the rules behind it.
//
// A drag is asked for at the pose it will be performed at: `dragsFor(slot, k)` reads the quads
// the view last drew, so the coordinate pair comes from the same projection the player's finger
// would hit. Between two drags the suite waits out ANIM_MS (js/view.js:36, 170 ms) — a drag
// issued into a still-turning cube would be aiming at a face that is on its way somewhere else.
async function pointerScenario(cdp, sessionId, runJS) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });
  const mouse = (type, x, y, buttons, modifiers = 0) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0, modifiers,
  }, sessionId);
  const key = (k) => cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', text: k, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
  }, sessionId);

  const SETTLE = Number(process.env.ANIM_WAIT || 260);
  const MOUSE_SHIFT = Number(process.env.MOUSE_SHIFT || 8);

  async function drag(from, to) {
    const steps = 6;
    await mouse('mousePressed', from.x, from.y, 1);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved',
        Math.round(from.x + ((to.x - from.x) * i) / steps),
        Math.round(from.y + ((to.y - from.y) * i) / steps), 1);
    }
    await mouse('mouseReleased', to.x, to.y, 0);
    await sleep(SETTLE);
  }

  // The drag the view itself would read as `want`, at the pose the cube is in right now.
  // `pressable` is not decoration: the same turn has eight candidate drags on this cube, and a
  // press on one whose centre is painted over by a nearer cubie commits *that* cubie's turn. The
  // row below asserts the committed name, so a model that lied about its own pick shows up there.
  const askFor = (want) => runJS(`(() => {
    const g = window.pocketcube;
    for (let slot = 0; slot < 8; slot++) {
      for (let k = 0; k < 3; k++) {
        for (const d of g.dragsFor(slot, k)) {
          if (d.move === ${want} && d.projected > 6 && d.pressable) return d;
        }
      }
    }
    return null;
  })()`);

  await runJS(`window.pocketcube.load('#/c/1'); 'ok'`);
  await sleep(SETTLE);

  const ids = await runJS(`['cube','undo','hint','restart','share','curtain','stars','verdict','tally','shelf','wipe','readout','hintline','next','again','modes','totals','crumbs'].map((i) => [i, !!document.getElementById(i)])`);
  rec('every control the shell reaches for exists', ids.every(([, on]) => on), Object.fromEntries(ids));

  const opened = await runJS(`(() => {
    const g = window.pocketcube;
    return { state: g.state, route: g.route(), par: g.state.par, scr: g.scramble() };
  })()`);
  rec('一关加载出来的是带实测 par 的题', opened.state.mode === 'campaign' && opened.par >= 4 && opened.route.length === opened.par,
    { id: opened.state.id, par: opened.par, route: opened.route.length });

  const pts = await runJS(`(() => {
    const g = window.pocketcube;
    const out = [];
    for (let slot = 0; slot < 8; slot++) {
      const p = g.stickerPoint(slot, 0);
      if (p) out.push({ slot, x: p.x, y: p.y, face: p.face });
    }
    return out;
  })()`);
  rec('八个角块在屏幕上都有落点', pts.length === 8 && pts.every((p) => p.x > 0 && p.y > 0 && p.face), pts);

  const four = await runJS(`(() => {
    const g = window.pocketcube;
    const d = g.dragsFor(0, 0);
    return { n: d.length, moves: d.map((x) => x.move), names: d.map((x) => x.name), lens: d.map((x) => Math.round(Math.hypot(x.to.x - x.from.x, x.to.y - x.from.y))) };
  })()`);
  rec('一个贴纸给出四个方向的转法，长度都是能过阈值的', four.n === 4 && new Set(four.moves).size === 4 && four.lens.every((l) => l >= 40), four);

  // `pressable` has to be the pointer's verdict, not the model's opinion of itself: re-run the
  // hit-test at the exact client point the drag advertises. `under` is the sticker that really
  // covers that point, so a false row says which one was painted over it.
  const claim = await runJS(`(() => {
    const g = window.pocketcube;
    const rows = [];
    let pressable = 0;
    for (let slot = 0; slot < 8; slot++) {
      for (let k = 0; k < 3; k++) {
        for (const d of g.dragsFor(slot, k)) {
          if (!d.pressable) continue;
          pressable++;
          const hit = g.pickAt(d.from.x, d.from.y);
          rows.push({ ok: !!hit && hit.slot === d.slot && hit.k === d.k, got: hit && [hit.slot, hit.k] , want: [d.slot, d.k] });
        }
      }
    }
    return { total: rows.length, bad: rows.filter((r) => !r.ok).slice(0, 3), pressable };
  })()`);
  rec('它说是能按下去的拖法，指针落在那一点上读到的就是同一个贴纸', claim.total === claim.pressable && claim.bad.length === 0, claim);

  // The certified route, played with the mouse, one committed turn per drag.
  const plan = opened.route;
  const played = [];
  for (let i = 0; i < plan.length; i++) {
    const want = plan[i];
    const d = await askFor(want);
    if (!d) { rec(`第 ${i + 1} 转在屏幕上有可读的拖法`, false, { want, names: await runJS('window.pocketcube.tiers.length') }); break; }
    const before = await runJS('window.pocketcube.state.moves');
    await drag(d.from, d.to);
    // state.lastMove is the *notation* of the turn (js/main.js:375 prints MOVES[i].name), which
    // is what a player reads; the index only lives inside the game.
    const after = await runJS(`(() => { const g = window.pocketcube; return { moves: g.state.moves, last: g.state.lastMove, done: g.state.done }; })()`);
    played.push({ want, name: d.name, ...after });
    if (after.moves !== before + 1 || after.last !== d.name) break;
  }
  rec('鼠标一拖一转，整条认证路线拖得完', played.length === plan.length && played.every((p, i) => p.moves === i + 1 && p.last === p.name), played.slice(-3));

  const solved = await runJS(`(() => {
    const g = window.pocketcube;
    return {
      state: g.state,
      solved: g.cube().solved,
      stars: document.getElementById('stars').textContent,
      verdict: document.getElementById('verdict').textContent,
      tally: document.getElementById('tally').textContent,
      curtain: !document.getElementById('curtain').hidden,
      over: g.state.over,
    };
  })()`);
  rec('拖到复原：判定完成、卡片升起、三星印出来',
    solved.state.done && solved.solved && solved.curtain && solved.stars === '★★★' && solved.verdict === '一手不差', solved);
  rec('按 par 拖完就没有超出', solved.over === 0 && new RegExp('par ' + solved.state.par).test(solved.tally), { over: solved.over, tally: solved.tally });

  const recd = await runJS(`(() => { const g = window.pocketcube; return g.store.record(g.state.id); })()`);
  rec('鼠标打出来的成绩进了存档，而且是完美', recd && recd.best === solved.state.par && recd.perfect === true, recd);

  // The view's gesture floor (js/view.js:35 DRAG_THRESHOLD = 16).
  await runJS(`document.getElementById('again').click(); 'ok'`);
  await sleep(SETTLE);
  const zero = await runJS(`window.pocketcube.stickerPoint(2, 1)`);
  await drag(zero, { x: zero.x, y: zero.y });
  rec('按下就松开、不走距离，不算一转', (await runJS('window.pocketcube.state.moves')) === 0, await runJS('window.pocketcube.state'));

  const short = await runJS(`window.pocketcube.stickerPoint(2, 1)`);
  await drag(short, { x: short.x + 8, y: short.y });
  rec('八像素的抖动在阈值之下，照样不算一转', (await runJS('window.pocketcube.state.moves')) === 0, { moves: await runJS('window.pocketcube.state.moves'), threshold: 16 });

  // Shift-drag is the orbit gesture (js/view.js:377): it turns the camera, never the cube.
  // MOUSE_SHIFT is the CDP bit Chrome delivers as `ev.shiftKey` — measured with
  // tools/modifiers.mjs (1=alt, 2=ctrl, 4=meta, 8=shift), because a wrong mask makes this row
  // a plain drag that commits a turn, i.e. it would fail for a reason that is not in the code.
  const camBefore = await runJS(`window.pocketcube.stickerPoint(0, 0)`);
  // Ask the page what it saw rather than trusting the mask: with the wrong bit this press is an
  // ordinary drag, and the row below would be measuring a turn of the cube, not a camera.
  await runJS(`window.__mod = null;
    document.getElementById('cube').addEventListener('pointerdown', (e) => {
      window.__mod = { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
    }, { once: true }); 'armed'`);
  await mouse('mousePressed', camBefore.x, camBefore.y, 1, MOUSE_SHIFT);
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', camBefore.x + i * 12, camBefore.y - i * 6, 1, MOUSE_SHIFT);
  await mouse('mouseReleased', camBefore.x + 72, camBefore.y - 36, 0, MOUSE_SHIFT);
  await sleep(SETTLE);
  const camAfter = await runJS(`(() => { const g = window.pocketcube; return { p: g.stickerPoint(0, 0), moves: g.state.moves }; })()`);
  const modSeen = await runJS('window.__mod');
  rec('这一按在页面里确实是 shift 键按下', modSeen && modSeen.shift === true && modSeen.ctrl === false && modSeen.alt === false && modSeen.meta === false, modSeen);
  rec('按住 shift 拖是转身看向魔方：画面动了，转数没动',
    camAfter.moves === 0 && (Math.abs(camAfter.p.x - camBefore.x) > 4 || Math.abs(camAfter.p.y - camBefore.y) > 4),
    { before: camBefore, after: camAfter });

  // And the camera drag has to leave the *next* press aimed correctly: `picked` is rebuilt in
  // draw(), so an orbit that never repainted would hit-test against the pre-orbit geometry.
  const nextDrag = await askFor(plan[0]);
  let afterOrbit = null;
  if (nextDrag) {
    const beforeMoves = await runJS('window.pocketcube.state.moves');
    await drag(nextDrag.from, nextDrag.to);
    afterOrbit = await runJS(`(() => { const g = window.pocketcube; return { moves: g.state.moves, last: g.state.lastMove }; })()`);
    afterOrbit.want = nextDrag.name;
    afterOrbit.added = afterOrbit.moves - beforeMoves;
  }
  rec('转身之后第一下拖仍然落在它声称的那一面',
    !!afterOrbit && afterOrbit.added === 1 && afterOrbit.last === afterOrbit.want, afterOrbit);

  // The panel's own pick agrees with the drag the suite found, for the first step of the route.
  const best = await runJS(`(() => {
    const g = window.pocketcube;
    const b = g.bestDrag(3);
    return b && { move: b.move, len: Math.round(b.len), name: b.name };
  })()`);
  rec('bestDrag 给的是能过阈值的拖法，不是随便一条', best && best.len >= 4 && typeof best.move === 'number', best);

  // Keyboard shortcuts the panel advertises (js/main.js:338-345).
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(SETTLE);
  await runJS(`window.pocketcube.play(window.pocketcube.route().slice(0, 1)); 'ok'`);
  const kMoves = await runJS('window.pocketcube.state.moves');
  await key('u');
  await sleep(160);
  rec('u 键撤销一步', (await runJS('window.pocketcube.state.moves')) === kMoves - 1, { before: kMoves, after: await runJS('window.pocketcube.state.moves') });
  await key('h');
  await sleep(160);
  rec('h 键要一个提示', (await runJS('window.pocketcube.state.hints')) === 1, await runJS('window.pocketcube.state.hints'));
  await key('r');
  await sleep(160);
  rec('r 键重开', (await runJS('window.pocketcube.state.moves')) === 0, await runJS('window.pocketcube.state'));

  // The last honest thing a pointer suite can check: nothing above put a byte on the console.
  rec('拖完之后棋盘还是复原态以外的题（没有把上一段的终态当起点）',
    (await runJS('window.pocketcube.state.done')) === false && (await runJS('window.pocketcube.state.moves')) === 0,
    await runJS('window.pocketcube.state'));

  return { rows };
}

// In-page suites. Each returns { rows: [{ test, pass, detail }] }.
const SCENARIOS = {
  boot: `(async () => {
    const g = window.pocketcube;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const D = (id) => document.getElementById(id);

    rec('外壳起来就在打战役第一关', g.version === 1 && g.state.mode === 'campaign' && g.state.index === 1, g.state);
    const c = D('cube');
    rec('画布有真实像素', c.width > 0 && c.height > 0 && !!c.getContext('2d'), { w: c.width, h: c.height });
    const lit = (() => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    })();
    rec('魔方真的被画出来了', lit > 50, { litSamples: lit });
    const f0 = g.state.frames;
    const twoFrames = await Promise.race([
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
      new Promise((r) => setTimeout(() => r(false), 2000)),
    ]);
    rec('rAF 在推进：headless 里画面循环是活的', twoFrames === true, { f0 });
    // draw() is the only thing that counts a frame, and an idle cube deliberately does not
    // repaint (js/view.js:435 only draws for an animation, a hint or a moved camera) — so the
    // loop being alive is proven above and the counter is proven by asking for a repaint.
    g.restart();
    rec('一次重画把 frames 推上去', g.state.frames > f0, { f0, f1: g.state.frames });

    const pool = g.pool;
    rec('随包发布的 64 关都加载了', pool.lots === 64, { lots: pool.lots, total: g.state.total });
    rec('四档各有实测区间', Object.values(pool.byTier).every((t) => t.n > 0 && t.min <= t.max && t.statesMin <= t.statesMax), pool.byTier);
    rec('四档关数加起来是 64', Object.values(pool.byTier).reduce((a, t) => a + t.n, 0) === 64, Object.values(pool.byTier).map((t) => t.n));
    rec('屏上的 total 与池子一致', g.state.total === pool.lots, { total: g.state.total });
    rec('档位表里每档都写了 par 区间与占比', g.tiers.length === 4 && g.tiers.every((t) => t.min <= t.max && t.n > 0), g.tiers.map((t) => [t.key, t.min, t.max, t.n]));

    const par = g.state.par;
    rec('面板印的 par 等于这一关的认证路线长度', g.route().length === par && par >= 4, { par, route: g.route().length });
    const readout = D('readout').textContent;
    rec('面板实时印 转数 / par / 超出 / 最佳', ['转数', 'par', '超出', '最佳'].every((k) => readout.includes(k)), readout);
    rec('打乱串与记数法同源', g.notation().faces.length === g.scramble().length && typeof g.notation().route === 'string', g.notation());
    rec('开局不是已解态，也没有卡片', g.cube().solved === false && g.state.done === false && g.state.curtain === false, g.state);
    rec('分享码是一段能读回去的转记法', /^[UDRLFB]'?\\d?( [UDRLFB]'?\\d?)*$/.test(g.shareCode()), g.shareCode());
    rec('未转之前 lastMove 是空的', g.state.lastMove === null, g.state.lastMove);
    rec('外壳是被直接打开的（地址栏没有 hash），题照样是第 1 关',
      g.state.hash === location.hash && g.state.index === 1 && !!g.state.id, { hash: g.state.hash, index: g.state.index });
    return { rows };
  })()`,

  play: `(async () => {
    const g = window.pocketcube;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const dd = (label) => {
      const dt = [...D('readout').querySelectorAll('dt')].find((x) => x.textContent === label);
      return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent : null;
    };

    g.store.reset();
    g.load('#/c/1'); await sleep(180);
    const par = g.state.par;
    const route = g.route();

    // A wasted round trip first: every turn is reversible, so this is legal and stupid.
    const home = g.cube().perm.join(',');
    g.play([route[0]]);
    const turned = g.cube().perm.join(',');
    g.play([route[0] ^ 1]);
    rec('转过去再转回来：两转的账，一格的差都没有',
      g.state.moves === 2 && turned !== home && g.cube().perm.join(',') === home,
      { moves: g.state.moves, changed: turned !== home, back: g.cube().perm.join(',') === home });

    g.restart();
    g.play(route);
    rec('按认证路线走完就是复原，转数等于 par', g.state.done && g.state.moves === par, { moves: g.state.moves, par });
    rec('打平 par 印三星「一手不差」', D('stars').textContent === '★★★' && D('verdict').textContent === '一手不差', { stars: D('stars').textContent, verdict: D('verdict').textContent });
    rec('卡片升起，下一关的按钮在', !D('curtain').hidden && !D('next').hidden, { nextHidden: D('next').hidden });
    const perfect = g.store.record(g.state.id);
    rec('完美成绩进了记录', perfect.best === par && perfect.perfect === true && perfect.plays === 1, perfect);

    D('restart').click(); await sleep(150);
    const extra = route[0] ^ 1;
    // A there-and-back *pair* in front of the whole route: the pair nets to the start state, so
    // what follows has to be all par turns again and the finish is par + 2. Playing only the
    // inverse turn and then the route makes the first two turns cancel each other, which leaves a
    // par + 1 sequence that stops one turn short — the row would then read the stars the *previous*
    // finish left in the DOM and call an unsolved cube a two-star run.
    g.play([extra, route[0], ...route]);
    rec('多绕两转也能复原，但只给两星「干净收口」',
      g.state.done && g.state.moves === par + 2 && D('stars').textContent === '★★☆' && D('verdict').textContent === '干净收口',
      { moves: g.state.moves, par, stars: D('stars').textContent, verdict: D('verdict').textContent, over: g.state.over });
    rec('超出两个印在面板上', g.state.over === 2 && dd('超出') === '2', { over: g.state.over, 面板: dd('超出') });
    const sloppy = g.store.record(g.state.id);
    rec('绕远的一次不会把最好的那次抹掉', sloppy.best === par && sloppy.perfect === true && sloppy.plays === 2, sloppy);

    // The turn alphabet is twelve quarter turns; anything else is refused and costs nothing.
    D('restart').click(); await sleep(150);
    const beforeBad = g.state.moves;
    const badReturn = await new Promise((r) => setTimeout(() => r(g.play([99])), 30));
    const afterBad = g.state.moves;
    rec('不存在的转数被拒绝，而且不记账', beforeBad === 0 && afterBad === 0 && badReturn === 0, { beforeBad, afterBad, ret: badReturn });
    const sameFace = g.play([route[0], route[0] ^ 1]);
    rec('同一面正反两转是两笔账', sameFace === 2, { moves: sameFace });

    rec('撤销一步退一笔账', g.undo() === 1 && g.state.moves === 1, { afterUndo: g.state.moves });
    g.undo();
    const emptyUndo = await new Promise((r) => setTimeout(() => r(g.state.moves), 30));
    rec('在起点上撤销不产生负数', emptyUndo === 0 && D('undo').disabled === true, { moves: emptyUndo, disabled: D('undo').disabled });

    // Hints are lookups into the baked route, not a search, and they never touch the board.
    const snap = g.cube().perm.join(',');
    const h = g.hintOnce();
    rec('提示说出转哪一面，并给出之后还差几转', h.hints === 1 && /提示：转/.test(h.line) && /之后还需/.test(h.line), h);
    rec('提示不动棋盘，也不加转数', g.cube().perm.join(',') === snap && g.state.moves === 0, { moves: g.state.moves });
    g.play([route[0] ^ 1]);
    const off = g.hintOnce();
    rec('偏离认证路线时提示明说，并继续计费', off.hints === 2 && /已偏离认证路线/.test(off.line) && g.state.onRoute === false, off);
    D('restart').click(); await sleep(150);
    rec('重开清零：转数、提示、卡片都归位', g.state.moves === 0 && g.state.hints === 0 && g.state.curtain === false && D('curtain').hidden, g.state);

    // 下一关 walks the campaign; the parity of the route is what the twelve-turn graph forces.
    g.load('#/c/2'); await sleep(150);
    const second = g.state.id;
    g.load('#/c/1'); await sleep(150);
    g.play(g.route());
    await sleep(120);
    D('next').click(); await sleep(180);
    rec('通关后点「下一关」真的换题', g.state.id === second && g.state.index === 2 && g.state.moves === 0, { id: g.state.id, index: g.state.index });
    return { rows };
  })()`,

  routes: `(async () => {
    const g = window.pocketcube;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const line = () => document.getElementById('hintline').textContent;
    const dd = (label) => {
      const dt = [...document.querySelectorAll('#readout dt')].find((x) => x.textContent === label);
      return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent : null;
    };

    g.load('#/c/7'); await sleep(160);
    rec('#/c/7 就是第七关', g.state.index === 7 && g.state.mode === 'campaign' && g.state.hash === '#/c/7', g.state);
    g.load('#/campaign/12'); await sleep(160);
    rec('#/campaign/<N> 与 #/c/<N> 是同一个门', g.state.index === 12, g.state.index);
    g.load('#/c/99999'); await sleep(160);
    rec('过大的关号夹到最后一关', g.state.index === g.pool.lots, { index: g.state.index, lots: g.pool.lots });
    g.load('#/c/0'); await sleep(160);
    rec('0 夹成一，而不是空白', g.state.index === 1 && !!g.state.id, g.state.index);

    g.load('#/daily'); await sleep(180);
    const daily = g.state.id;
    rec('#/daily 是每日一题，标签带日期', g.state.mode === 'daily' && /^每日魔方 · \\d{4}-\\d{2}-\\d{2}$/.test(g.state.label), g.state.label);
    g.load('#/c/1'); await sleep(160);
    g.load('#/daily'); await sleep(180);
    rec('同一天两次进来是同一个魔方', g.state.id === daily, { first: daily, again: g.state.id });

    for (const tier of Object.keys(g.pool.byTier)) {
      g.load('#/random/' + tier + '/fixedseed'); await sleep(160);
      const first = g.state.id;
      const par = g.state.par;
      const band = g.pool.byTier[tier];
      g.load('#/c/1'); await sleep(140);
      g.load('#/random/' + tier + '/fixedseed'); await sleep(160);
      rec('#/random/' + tier + '/同一串种子给同一个魔方，且落在本档区间',
        g.state.tier === tier && g.state.id === first && par >= band.min && par <= band.max,
        { tier: g.state.tier, id: g.state.id, first, par, band: [band.min, band.max] });
    }
    g.load('#/random/spin/otherseed'); await sleep(160);
    rec('换一个种子就是另一个魔方', g.state.id !== null, { id: g.state.id });

    g.load('#/random/spin'); await sleep(240);
    rec('裸 #/random 会把新铸的令牌写回地址栏', /^#\\/random\\/[a-z]+\\/[a-z0-9]+$/.test(location.hash), location.hash);

    g.load('#/c/5'); await sleep(160);
    const sample = g.state.id;
    g.load('#/c/1'); await sleep(140);
    g.load('#/lot/' + sample); await sleep(160);
    rec('#/lot/<id> 打开那一关', g.state.id === sample && g.state.mode === 'lot', { want: sample, got: g.state.id });
    g.load('#/lot/not-a-real-cube'); await sleep(160);
    rec('不存在的 id 不会把棋盘抹白', !!g.state.id && g.state.par >= 1, g.state);

    // 手输乱序：没有实测 par，所以也不许出现"超出"这种带最优含义的数。
    g.load('#/cube/R U R\\' U\\''); await sleep(160);
    rec('#/cube/<转记法> 开出自定义魔方：par 是空的', g.state.mode === 'cube' && g.state.par === null && g.route() === null, { mode: g.state.mode, par: g.state.par });
    rec('自定义魔方面板把 par 印成「未实测」', /未实测/.test(document.getElementById('readout').textContent), document.getElementById('readout').textContent);
    // moves - null is moves, so a naive 超出 field on an unmeasured lot prints the whole turn
    // count under the word "over par". README:29 promises 未实测 instead.
    g.play([0]); await sleep(120);
    rec('没有实测 par 就没有「超出」这个数：面板只会说没有可对照',
      dd('转数') === '1' && dd('超出') === '—' && dd('par') === '未实测' && !/超出 1/.test(line()),
      { 转数: dd('转数'), 超出: dd('超出'), par: dd('par'), hintline: line() });
    g.restart(); await sleep(120);
    const scr = g.scramble();
    g.play(scr.map((m) => m ^ 1).reverse());
    await sleep(160);
    rec('把打乱反着打回去就复原', g.state.done === true && g.state.moves === scr.length, { moves: g.state.moves, want: scr.length, done: g.state.done });
    rec('未实测的题不印星，只印「复原了」', document.getElementById('stars').textContent === '◆' && document.getElementById('verdict').textContent === '复原了',
      { stars: document.getElementById('stars').textContent, verdict: document.getElementById('verdict').textContent });

    g.load('#/c/5'); await sleep(160);
    const idAt5 = g.state.id;
    const scr5 = g.scramble().join(',');
    const code = g.shareCode();
    g.load('#/c/1'); await sleep(140);
    g.load('#/cube/' + encodeURIComponent(code)); await sleep(160);
    rec('分享码能被 #/cube/ 原样读回同一串打乱',
      g.state.mode === 'cube' && g.scramble().join(',') === scr5, { code, want: scr5, got: g.scramble().join(',') });
    g.load('#/lot/' + idAt5); await sleep(140);
    rec('#/lot/ 与 #/cube/ 指向同一题时，par 只有前者有', g.state.par >= 4, g.state.par);

    g.load('#/cube/Q W E'); await sleep(160);
    rec('读不懂的乱序会明说，并且不换题', /读不懂/.test(line()) && !!g.state.id, { line: line(), id: g.state.id });

    const pt = g.playText('R U F2');
    rec('playText 只认一面一加撇：出现 2 就明说而不是假装读了', pt.ok === false && /unknown face 2/.test(pt.error || ''), pt);
    return { rows };
  })()`,

  save: `(async () => {
    const g = window.pocketcube;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const KEY = 'pocketcube.save.v1';

    g.store.reset();
    g.load('#/c/1'); await sleep(160);
    rec('清过的存档是空的，且只有第一关可进', Object.keys(g.store.records).length === 0 && g.store.unlocked === 1, g.store.snapshot && g.store.snapshot());

    g.play(g.route());
    await sleep(180);
    const id = g.state.id;
    const raw = JSON.parse(localStorage.getItem(KEY));
    rec('通关落到 localStorage，而不只在内存里', !!(raw && raw.records[id] && raw.records[id].best === g.state.par), raw && Object.keys(raw.records || {}));
    rec('过了第一关就解锁第二关', g.store.unlocked === 2 && raw.unlocked === 2, { unlocked: g.store.unlocked, raw: raw.unlocked });
    const shelf2 = document.querySelector("#shelf button[data-index='2']");
    rec('货架上第二关的按钮能点，点了就真的过去', shelf2 && !shelf2.disabled, shelf2 && shelf2.outerHTML.slice(0, 120));
    if (shelf2) { shelf2.click(); await sleep(180); }
    rec('从货架进去的那一关是第二关', g.state.index === 2, { index: g.state.index, id: g.state.id });

    const third = document.querySelector("#shelf button[data-index='3']");
    rec('没解锁的第三关在货架上是禁用的', !third || third.disabled === true, third && { disabled: third.disabled });

    g.load('#/c/1'); await sleep(160);
    g.hintOnce();
    g.play(g.route());
    await sleep(160);
    const stats = g.store.stats;
    rec('提示有独立的账，不影响那一题的完美判定', stats.hints >= 1 && g.store.record(g.state.id).perfect === true, stats);
    rec('转数累计进了总账', stats.turns >= g.state.par, stats);

    g.load('#/daily'); await sleep(180);
    const day = g.state.label.split(' · ')[1];
    g.play(g.route());
    await sleep(180);
    const mark = g.store.dailyDone(day);
    rec('今天的题打完记一次', !!mark && mark.id === g.state.id, { day, mark });
    rec('货架上写着今天已通', /已通/.test(D('shelf').textContent), D('shelf').textContent);

    // The wipe is the only destructive control, so it arms on the first click.
    D('wipe').click(); await sleep(80);
    const armed = Object.keys(g.store.records).length;
    rec('第一次点只是武装，什么都没删', armed > 0 && /再点一次/.test(D('toast').textContent), { armed, toast: D('toast').textContent });
    D('wipe').click(); await sleep(200);
    const after = JSON.parse(localStorage.getItem(KEY));
    rec('清空存档要两次点击，点完成绩归零',
      Object.keys(g.store.records).length === 0 && g.store.unlocked === 1 && after && Object.keys(after.records).length === 0,
      { records: Object.keys(g.store.records), unlocked: g.store.unlocked, raw: after });
    rec('清空后存档键还在，写的是空表（不是把键删掉）', localStorage.getItem(KEY) !== null && after.records && after.stats, localStorage.getItem(KEY) && JSON.stringify(after));
    rec('清过的账本上总览归零：已通 0 / 64', /已通/.test(D('totals').textContent) && /0/.test(D('totals').textContent) && /64/.test(D('totals').textContent), D('totals').textContent);
    return { rows };
  })()`,
};

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
