// The shell: hash routes in, canvas out, save file in between. Nothing here knows the rules of
// the cube — that is js/core — and nothing here draws — that is js/view.js.
//
// The one number this file prints that it did not compute is `par`, and it never computes one:
// a lot carries the par tools/bake.mjs measured, and a cube from notation (`#/cube/R U F'`)
// prints 未实测 instead, because measuring it means searching and searching does not happen on
// tap. `window.pocketcube` at the bottom is the test hook the browser suite drives.

import { MOVES, isSolved } from './core/cube.js';
import { createGame, grade, hint, onRoute, overPar, reset, scrambleText, shareCode, turn, undo } from './core/game.js';
import { ALL, TIERS, byId, dailyLot, fromScramble, levelAt, lotsIn, notation, randomLot, stats as poolStats, tierByKey } from './core/library.js';
import { todayKey } from './core/rng.js';
import { store } from './core/storage.js';
import { createView } from './view.js';

const $ = (id) => document.getElementById(id);
const el = {
  modes: $('modes'), totals: $('totals'), crumbs: $('crumbs'), readout: $('readout'),
  shelf: $('shelf'), hintline: $('hintline'), curtain: $('curtain'), stars: $('stars'),
  verdict: $('verdict'), tally: $('tally'), undo: $('undo'), hint: $('hint'),
  restart: $('restart'), share: $('share'), next: $('next'), again: $('again'),
  toast: $('toast'), canvas: $('cube'), wipe: $('wipe'),
};

const LEVELS = ALL.length;
const app = {
  mode: 'campaign',
  index: 1,
  route: null,
  lot: null,
  game: null,
  hints: 0,
  label: '',
  day: null,
  lastMove: null,
};

const clampIndex = (n) => Math.min(LEVELS, Math.max(1, Number(n) || 1));
const token = () => Math.random().toString(36).slice(2, 8);

// #/c/12 · #/lot/cube-07 · #/daily · #/random/spin/4kq2 · #/cube/R U R' U'
// The cube itself is in the link, so a shared puzzle resolves to the same position on another
// device without needing the sender's save file — and without claiming a par nobody measured.
function parseHash(hash = location.hash) {
  const raw = String(hash).replace(/^#\/?/, '');
  const p = raw.split('/').filter(Boolean);
  if (p[0] === 'daily') return { mode: 'daily' };
  if (p[0] === 'random') return { mode: 'random', tier: p[1] || TIERS[0].key, key: p[2] || null };
  if (p[0] === 'lot') return { mode: 'lot', id: p[1] };
  if (p[0] === 'cube') return { mode: 'cube', scr: decodeURIComponent(p.slice(1).join('/')) };
  const n = p[0] === 'c' || p[0] === 'campaign' ? Number(p[1]) : Number(p[0]);
  return { mode: 'campaign', index: clampIndex(n) };
}

function linkFor(rt) {
  if (rt.mode === 'daily') return '#/daily';
  if (rt.mode === 'random') return `#/random/${rt.tier}/${rt.key}`;
  if (rt.mode === 'lot') return `#/lot/${rt.id}`;
  if (rt.mode === 'cube') return `#/cube/${encodeURIComponent(rt.scr)}`;
  return `#/c/${rt.index}`;
}

function resolve(rt) {
  if (rt.mode === 'daily') {
    const day = todayKey();
    return { lot: dailyLot(day), label: `每日魔方 · ${day}`, note: day, day };
  }
  if (rt.mode === 'random') {
    const tier = tierByKey(rt.tier) || TIERS[0];
    return { lot: randomLot(`${tier.key}|${rt.key}`, tier.key), label: `随机 · ${tier.label}`, note: tier.blurb };
  }
  if (rt.mode === 'lot') {
    const lot = byId(rt.id) || ALL[0];
    return { lot, label: `关卡 ${lot.id}`, note: tierByKey(lot.tier).blurb };
  }
  if (rt.mode === 'cube') {
    const lot = fromScramble(rt.scr);
    if (!lot) return { lot: null, bad: true };
    return { lot, label: '自己打的乱序', note: '这一路的 par 没有测过：前端不搜索' };
  }
  const lot = levelAt(rt.index - 1);
  return { lot, label: `第 ${rt.index} 关`, note: `共 ${LEVELS} 关 · ${tierByKey(lot.tier).label}` };
}

const view = createView(el.canvas, { onCommit: (move) => commit(move) });

function setGame(lot, label) {
  app.lot = lot;
  app.label = label || app.label;
  app.game = createGame(lot);
  app.hints = 0;
  app.lastMove = null;
  el.curtain.hidden = true;
  view.attach(app.game);
  say('');
}

function say(html) {
  el.hintline.innerHTML = html;
}

const starsOf = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

function field(label, value, note, cls = '') {
  return `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd><dt><small>${note}</small></dt></div>`;
}

function renderCrumbs() {
  const lot = app.lot;
  const tier = tierByKey(lot.tier);
  const rec = store.record(lot.id);
  const scr = scrambleText(app.game);
  el.crumbs.innerHTML = `${app.label}<b>${tier ? `${tier.label}<span class="band"> ${tier.blurb}</span>` : '未入册的魔方'}</b>`
    + `<code>${scr}</code>`;
  const par = lot.par === null || lot.par === undefined ? '未实测' : lot.par;
  const over = overPar(app.game);
  el.readout.innerHTML = [
    field('转数', app.game.moves, '本次已用'),
    field('par', par, lot.par == null ? '构建期没测' : '8!·3⁷ 上量出', 'par'),
    field('超出', over === null ? '—' : over, over === null ? '没有 par 可对照' : '离最优', over > 0 ? 'over' : ''),
    field('最佳', rec ? rec.best : '—', rec ? (rec.perfect ? '等于 par' : `${rec.plays} 次尝试`) : '还没有记录', 'best'),
  ].join('');
  el.undo.disabled = !app.game.moves || app.game.done;
  el.hint.disabled = app.game.done || !lot.route;
}

function renderTotals() {
  const s = store.stats;
  const solved = Object.keys(store.records).length;
  el.totals.innerHTML = `已通 <b>${solved}</b>/${LEVELS} · 完美 <b>${s.perfect}</b> · 提示 <b>${s.hints}</b> · 转数 <b>${s.turns}</b>`;
}

function renderShelf() {
  if (app.mode === 'campaign') {
    const unlocked = store.unlocked;
    let html = '';
    for (const tier of TIERS) {
      html += `<p class="tier">${tier.label} · ${tier.blurb}</p>`;
      for (const lot of lotsIn(tier.key)) {
        const n = ALL.indexOf(lot) + 1;
        const rec = store.record(lot.id);
        const cls = [n === app.index ? 'here' : '', rec && rec.perfect ? 'perfect' : rec ? 'done' : ''].filter(Boolean).join(' ');
        html += `<button type="button" data-index="${n}" class="${cls}" ${n > unlocked ? 'disabled' : ''} title="par ${lot.par}">${n}</button>`;
      }
    }
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-index]').forEach((b) => {
      b.addEventListener('click', () => go(`#/c/${b.dataset.index}`));
    });
    return;
  }
  if (app.mode === 'random') {
    let html = '<p class="tier">选一档难度</p>';
    for (const tier of TIERS) {
      const on = tier.key === app.route.tier ? 'here' : '';
      html += `<button type="button" class="${on}" data-tier="${tier.key}">${tier.label}<br><small>par ${tier.min}–${tier.max}</small></button>`;
    }
    html += '<button type="button" class="wide" data-reroll="1">换一个魔方</button>';
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-tier]').forEach((b) => {
      b.addEventListener('click', () => go(`#/random/${b.dataset.tier}/${token()}`));
    });
    const rr = el.shelf.querySelector('[data-reroll]');
    if (rr) rr.addEventListener('click', () => go(`#/random/${app.route.tier}/${token()}`));
    return;
  }
  if (app.mode === 'daily') {
    const done = app.day && store.dailyDone(app.day);
    el.shelf.innerHTML = `<p class="tier">今天这一题对所有人相同${done ? ' · 已通' : ''}</p>`
      + `<button type="button" class="wide" data-back="1">回到战役 第 ${store.unlocked} 关</button>`;
  } else if (app.mode === 'cube') {
    el.shelf.innerHTML = '<p class="tier">手输乱序 · par 未实测</p>';
  } else {
    el.shelf.innerHTML = '<p class="tier">分享的关卡</p>';
  }
  const back = el.shelf.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => go(`#/c/${store.unlocked}`));
}

function render() {
  el.modes.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.mode === (app.mode === 'lot' || app.mode === 'cube' ? 'campaign' : app.mode)));
  });
  renderCrumbs();
  renderTotals();
  renderShelf();
}

// The one place a turn happens: a drag from the view, a hint follow, and the test rig's
// play() all arrive here, so the counter, the cube and the save line cannot drift apart.
function commit(move) {
  if (!turn(app.game, move)) {
    view.redraw();
    return false;
  }
  app.lastMove = move;
  view.animate(move);
  if (app.game.done) {
    finish();
  } else {
    renderCrumbs();
    say(`转了 <b>${MOVES[move].name}</b> · 已用 ${app.game.moves} 步${app.lot.par == null ? '' : ` · 超出 ${overPar(app.game)}`}`);
  }
  return true;
}

function finish() {
  const lot = app.lot;
  const g = app.game;
  const measured = lot.par !== null && lot.par !== undefined;
  // A cube with no measured par is a solve, not a perfect run: passing the player's own count
  // as the par would make every hand-typed scramble perfect by definition.
  const rec = store.solve(lot.id, { turns: g.moves, par: measured ? lot.par : null, hints: app.hints });
  if (app.day) store.markDaily(app.day, lot.id);
  let nextIndex = 0;
  if (app.mode === 'campaign') {
    store.unlock(Math.max(store.unlocked, app.index + 1));
    nextIndex = app.index < LEVELS ? app.index + 1 : 0;
  }
  const gr = grade(g);
  el.stars.textContent = measured ? starsOf(gr.stars) : '◆';
  el.verdict.textContent = measured ? gr.label : '复原了';
  el.tally.innerHTML = `你的 <b>${g.moves}</b> 转 · par <b>${measured ? lot.par : '未实测'}</b> · 提示 <b>${app.hints}</b>`
    + (rec.best === g.moves ? '<br>这是这一题的最好成绩' : '');
  el.next.hidden = !nextIndex;
  el.curtain.hidden = false;
  view.redraw();
  render();
}

function go(hash) {
  if (location.hash === hash) apply();
  else location.hash = hash;
}

function apply() {
  const rt = parseHash();
  app.route = rt;
  app.mode = rt.mode;
  if (rt.mode === 'random' && !rt.key) {
    // A bare #/random/spin would mean a different cube on every visit and an unreproducible
    // link, so the token is minted once and written back into the URL.
    location.replace(`${location.pathname}${location.search}#/random/${rt.tier}/${token()}`);
    return;
  }
  const r = resolve(rt);
  if (!r.lot) {
    say(r.bad ? '这段乱序我读不懂：只认 U D R L F B 加 \' 和 2' : '这一档还没有烤好的魔方');
    return;
  }
  app.day = r.day || null;
  app.index = rt.mode === 'campaign' ? rt.index : ALL.indexOf(r.lot) + 1;
  setGame(r.lot, r.label);
  render();
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 1800);
}

function shareLink() {
  const hash = app.mode === 'cube' ? `#/cube/${encodeURIComponent(app.lot.scrText)}` : linkFor(app.route);
  const url = `${location.origin}${location.pathname}${hash}`;
  const done = () => toast('链接已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => toast(url));
  else toast(url);
}

el.modes.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-mode]');
  if (!b) return;
  if (b.dataset.mode === 'campaign') go(`#/c/${clampIndex(store.unlocked)}`);
  else if (b.dataset.mode === 'daily') go('#/daily');
  else go(`#/random/${TIERS[0].key}/${token()}`);
});

el.undo.addEventListener('click', () => {
  if (!undo(app.game)) return;
  app.lastMove = null;
  el.curtain.hidden = true;
  view.redraw();
  renderCrumbs();
  say(app.game.moves ? `撤销一步 · 现在 ${app.game.moves} 转` : '回到起点');
});

el.hint.addEventListener('click', () => {
  const h = hint(app.game);
  app.hints++;
  store.countHint();
  if (!h.available) {
    say(h.reason === 'solved' ? '已经复原了，没有下一步可提示' : h.message || '偏离了认证路线');
    renderCrumbs();
    return;
  }
  view.showHint(h.move);
  say(`提示：转 <b>${h.name}</b> —— 之后还需 <b>${h.left}</b> 转${onRoute(app.game) ? '' : '（先撤销回路线上）'}`);
  renderCrumbs();
});

function restart() {
  reset(app.game);
  app.hints = 0;
  app.lastMove = null;
  el.curtain.hidden = true;
  view.attach(app.game);
  render();
  say('回到起点');
}

el.restart.addEventListener('click', restart);
el.share.addEventListener('click', shareLink);
el.again.addEventListener('click', restart);
el.next.addEventListener('click', () => go(`#/c/${Math.min(LEVELS, app.index + 1)}`));

// Wiping the save is the one destructive thing this game can do, so it asks twice rather than
// firing on a stray click.
let wipeArmed = false;
el.wipe.addEventListener('click', () => {
  if (!wipeArmed) {
    wipeArmed = true;
    toast('再点一次会清空本机全部成绩');
    setTimeout(() => {
      wipeArmed = false;
    }, 4000);
    return;
  }
  store.wipe();
  wipeArmed = false;
  toast('存档已清空');
  apply();
});

window.addEventListener('hashchange', apply);
window.addEventListener('resize', () => view.measure());
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 'escape' && !el.curtain.hidden) el.curtain.hidden = true;
  else if (k === 'u') el.undo.click();
  else if (k === 'h') el.hint.click();
  else if (k === 'r') el.restart.click();
});

view.start();
// Deliberately not paused on visibilitychange: the turn animation and the win card are driven
// from the same loop, and a tab that reports itself hidden (headless Chrome does) must still be
// able to finish a cube.
apply();

// ---- the test hook -------------------------------------------------------------------
// Everything tools/playtest.mjs asserts, in one place. `play` and `drag` go through the same
// commit() a finger reaches, so passing here means passing for the player.
window.pocketcube = {
  version: 1,
  get state() {
    const g = app.game;
    return {
      mode: app.mode,
      label: app.label,
      id: app.lot && app.lot.id,
      tier: app.lot && app.lot.tier,
      index: app.index,
      moves: g && g.moves,
      par: app.lot ? app.lot.par : null,
      over: g ? overPar(g) : null,
      hints: app.hints,
      done: !!(g && g.done),
      onRoute: g && g.lot.route ? onRoute(g) : null,
      unlocked: store.unlocked,
      solved: Object.keys(store.records).length,
      curtain: !el.curtain.hidden,
      lastMove: app.lastMove === null ? null : MOVES[app.lastMove].name,
      hash: location.hash,
      frames: view.frames(),
      total: LEVELS,
    };
  },
  get pool() {
    return poolStats();
  },
  get tiers() {
    return TIERS;
  },
  cube() {
    const g = app.game;
    return g ? { perm: g.state.perm.slice(), twist: g.state.twist.slice(), solved: isSolved(g.state) } : null;
  },
  route() {
    return app.lot && app.lot.route ? app.lot.route.slice() : null;
  },
  scramble() {
    return app.lot ? app.lot.scr.slice() : null;
  },
  notation() {
    return app.lot ? notation(app.lot) : null;
  },
  shareCode() {
    return app.lot ? shareCode(app.lot) : null;
  },
  load(hash) {
    go(hash);
    return app.lot && app.lot.id;
  },
  // One turn through the panel's own commit path.
  play(moves) {
    const list = moves || (app.lot.route ? app.lot.route.slice() : []);
    for (const m of list) commit(m);
    return app.game.moves;
  },
  // The same, from notation: "R U R' U'" costs four.
  playText(text) {
    const seq = [];
    const p = String(text).toUpperCase().replace(/\s+/g, '');
    for (let i = 0; i < p.length; i++) {
      const idx = MOVES.findIndex((m) => m.face === p[i]);
      if (idx < 0) return { ok: false, error: `unknown face ${p[i]}` };
      seq.push(idx);
      if (p[i + 1] === "'") {
        seq[seq.length - 1] = idx ^ 1;
        i++;
      }
    }
    return { ok: true, moves: this.play(seq) };
  },
  undo() {
    el.undo.click();
    return app.game.moves;
  },
  hintOnce() {
    el.hint.click();
    return { hints: app.hints, line: el.hintline.textContent };
  },
  restart() {
    el.restart.click();
    return app.game.moves;
  },
  // Where an automated finger should press, and which turn that press will commit: the view's
  // own pick, so the browser suite drags the shipped gesture maths.
  stickerPoint(slot, k) {
    return view.stickerPoint(slot, k);
  },
  dragsFor(slot, k) {
    return view.dragsFor(slot, k);
  },
  // Which sticker the pointer would really read at a client point — the same pick the drag uses,
  // so a suite can prove a press lands where the model says it does.
  pickAt(clientX, clientY) {
    const box = el.canvas.getBoundingClientRect();
    const hit = view.stickerAt(clientX - box.left, clientY - box.top);
    return hit ? { slot: hit.slot, k: hit.k, face: hit.face } : null;
  },
  bestDrag(slot) {
    return view.bestDragFor(slot);
  },
  // A whole certified route, turned into client-space drags.
  dragRoute() {
    const out = [];
    for (let i = 0; i < 40 && app.game && !app.game.done; i++) {
      const h = hint(app.game);
      if (!h.available) break;
      const want = h.move;
      let found = null;
      for (let slot = 0; slot < 8 && !found; slot++) {
        for (let k = 0; k < 3 && !found; k++) {
          for (const d of view.dragsFor(slot, k)) {
            if (d.move === want && d.projected > 6 && d.pressable) {
              found = d;
              break;
            }
          }
        }
      }
      if (!found) break;
      out.push({ step: i, move: want, name: MOVES[want].name, from: found.from, to: found.to });
      app.hints = 0; // a route lookup is not a player asking for help
      turn(app.game, want);
      app.lastMove = want;
      view.animate(want);
      if (app.game.done) finish();
      else renderCrumbs();
    }
    return out;
  },
  store,
};

// ---- 全屏开关（#btn-fullscreen）----
// 绑的是本页 HUD 上真实存在的那个按钮。全屏最常见的假实现就是引用一个并不存在的
// id：点下去什么也不会发生，量具却算它"已实现"。所以这里找不到按钮就直接不装。
(function bindFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  const root = document.documentElement;
  // 只做特性检测，不嗅探 UA：iOS Safari 是 webkitRequestFullscreen，老 Edge 是 ms 前缀，
  // 而 UA 字符串随时会改。"有没有这个能力"是查出来的，不是猜出来的。
  const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  const current = () => document.fullscreenElement || document.webkitFullscreenElement
    || document.msFullscreenElement || null;

  // 不支持也要给个说法：只把按钮灰掉而不解释，玩家会以为这功能没做完。
  // supported 这枚标记不能省：下面 sync() 每次都会重写 title，不挡住的话，装的时候刚写
  // 进去的人话原因会被随后的 sync() 立刻抹成"全屏 (F)"——禁用就变成一句没有理由的禁用。
  let supported = !!req;
  const unsupported = () => {
    supported = false;
    btn.disabled = true;
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」独立打开）';
  };
  if (!req) unsupported();

  // fullscreen 返回 Promise，被拒时必须吃掉：iOS Safari 对多数非 video 元素直接拒绝，
  // 让这个 rejection 冒泡出去会变成一条未捕获错误，整局游戏跟着挂。
  const settle = (p) => { if (p && p.catch) p.catch(unsupported); };

  // 进出都能走：已经全屏时这次调用是退出，不是"再进一次"。
  function toggle() {
    try {
      if (current()) {
        if (exit) settle(exit.call(document));
      } else if (req) {
        settle(req.call(root));
      } else {
        unsupported();
      }
    } catch (e) {
      unsupported();
    }
  }

  // Esc 和系统手势退出都不经过我们的代码，按钮状态只能靠 fullscreenchange 回写，
  // 否则用户已经退出、HUD 还停在"退出全屏"，下一次点击反而会重新进全屏。
  function sync() {
    const on = !!current();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    if (supported) btn.title = "全屏" + '（F）';
    const body = document.body;
    if (body && body.classList) body.classList.toggle('fullscreen', on);
  }

  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'f' && ev.key !== 'F') return;
    const t = ev.target;
    // 盘号 / 种子这类输入框里打字不能触发全屏，否则玩家输 seed 输到一半屏幕没了。
    if (t && /input|textarea|select/i.test(t.tagName || '')) return;
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    toggle();
  });
  window.addEventListener('fullscreenchange', sync);
  window.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('MSFullscreenChange', sync);
  sync();
})();
