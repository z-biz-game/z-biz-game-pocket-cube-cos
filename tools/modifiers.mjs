// Which bit of CDP's `Input.dispatchMouseEvent.modifiers` becomes `ev.shiftKey` in the page.
// The pointer suite orbits the camera with a held modifier, so getting this wrong silently
// measures nothing: the drag goes down as a plain press and the row either fails for the wrong
// reason or passes because some other repaint happened to move the cube.
//
// Run it against the same lane the gate uses:
//   CDP_PORT=9359 BASE_URL=http://127.0.0.1:5199/ node tools/modifiers.mjs
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.env.CDP_PORT || 9359;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199/';

const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const my = ++id;
  pending.set(my, { res, rej });
  ws.send(JSON.stringify({ id: my, method, params, sessionId }));
});

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((t) => t.type === 'page' && t.url.startsWith(new URL(BASE).origin)) || list.find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id || page.targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
const runJS = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

if (page.url !== BASE) {
  await send('Page.navigate', { url: BASE }, sessionId);
  await sleep(900);
}

await runJS(`window.__seen = [];
for (const type of ['pointerdown', 'pointermove', 'mousedown']) {
  window.addEventListener(type, (ev) => window.__seen.push({
    type, shift: ev.shiftKey, ctrl: ev.ctrlKey, alt: ev.altKey, meta: ev.metaKey, modifiers: type === 'mousedown' ? 1 : 0,
  }), true);
}
'listening'`);

for (const mask of [1, 2, 4, 8, 16]) {
  await runJS('window.__seen = []; "cleared"');
  for (const type of ['mousePressed', 'mouseMoved', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: 300, y: 300, button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: mask,
    }, sessionId);
  }
  await sleep(120);
  const seen = await runJS('window.__seen');
  const on = ['shift', 'ctrl', 'alt', 'meta'].filter((k) => seen.some((e) => e[k]));
  console.log(`mask ${String(mask).padStart(2)} -> ${on.length ? on.join('+') : '(no modifier bits)'}  [${seen.length} events]`);
}
ws.close();
