# 设计文档 · 魔方袖珍

面向维护者的技术说明：为什么这样实现、哪些约束一破就出 bug、契约禁止的"点击时现场搜索"与本仓允许的
做法边界在哪、难度带的四个数字是哪一次实测产出的。玩法规则与关卡清单见 [README.md](README.md)，
真实存在且已验证的东西与改动表见 [deliverable.md](deliverable.md)。

文中每一个数字都是本会话在这台机器上跑出来的（`node tools/bake.mjs`、`node --test test/`、
以及几条一次性的 `node -e` 命令，命令本身写在旁边）；计时量随机器与负载漂移，结构量不会。

---

## 1. 核心决策：整张状态群在**构建期**穷尽走完

`js/core/fullsweep.js:117` 的 `buildGroupTable({metric, nodeCap, deadlineMs, onLevel, force})` 从已解态
出发做一次广度优先扫描，遍历全部 `8! · 3⁷ = 88,179,840` 个可解状态，产出：

| 字段 | 含义 | 谁读它 |
| --- | --- | --- |
| `dist[rank]` | 每个状态到"已解（参考朝向）"的最少季度转，一字节一格，84.1 MB | `groupDistance()` → 面板 `par`、`tools/bake.mjs` 的分档 |
| `hist[d]` | 距离恰好为 `d` 的状态数（逐层计数） | 与 OEIS A080630 对账、难度带的占比 |
| `reached` / `diameter` / `truncated` | 覆盖度与直径 | `reached === GROUP_ORDER` 是构建失败条件；直径实测 14 |
| `routeFromTable(state)` | 从距离 `d` 出发、任一使后继落在 `d−1` 的转 | 每关的认证路线（提示念它） |
| `stoppedAt` / `bytes` / `ms` | 截断发生在哪一层、成本 | 打印进 `js/data/lots.js` 的头注释 |

索引是稠密的：`cube.encode(state) = lehmerRank(perm) · 3⁷ + tritCode(twist[0..6])`，
第八个 trit 不存——它由"扭转之和 ≡ 0 (mod 3)"钉死。**这就是 88,179,840 这个数的来源**：
不是抄来的，是编码空间的长度，而扫描恰好覆盖它（`reached = 88,179,840 = 8!·3⁷`）。

实测（`node tools/bake.mjs` 的 `== sweep ==` 段，本机）：

```
diameter 14, antipodes 6624, wall 5059 ms (transition tables 156 ms), distance array 84.1 MB
all 15 per-distance counts match OEIS A080630, and they sum to 88179840
```

### 1.1 为什么这不违反"禁止点击时无上限现场搜索"

契约那条禁的是**成本上界由玩家输入决定的搜索**。本仓把这条切成三种情形，各自位置不同：

1. **全群扫描**：84.1 MB、约 5 秒 CPU，只在 `tools/bake.mjs` 里跑。`js/main.js` 不 import
   `fullsweep.js`、`bfs.js`、`ida.js`、`pdb.js`、`make.js`（`grep -n "import" js/main.js` 可复现），
   Pages 部署的是文件拷贝，所以这些模块**也不在产物里被加载**。
2. **前端的一次查表**：`js/core/game.js:121` 的 `hint()` 读一张 `routeMap(lot)`（按 `encode(state)`
   索引的 Map，构建一关时最多 `par+1` 个键）。玩家怎么点都不会让搜索变深，因为它不是搜索。
3. **偏离路线时**：`hint()` 返回 `{available: false, reason: 'off-route'}` 并给出一句人话，
   **不去现场求解**。这条是设计意图而不是偷懒：现编一个"最优下一步"就是契约禁止的那种数字。

对照参照：Gridlock 那仓的状态数是"几百到六万"、求解带 `limit`，所以生成只能锁构建期；
本仓即使不带 `limit` 也**必须**锁构建期，因为一次查询的成本上限是"整个群"。
`fullsweep.js` 的 `nodeCap` / `deadlineMs` / `MAX_DEPTH` 三道界都在，
而且**截断是精确的**：广度优先赋值意味着被 cap 截断的表里已写过的格子仍是真距离，
cap 只会把答案变成 `-1`，不会变成错数（`js/core/fullsweep.js:46-49` 注释即此，构建期据此判定）。

### 1.2 `par` 与 `q` 不是同一个数（这两个模型必须分清）

`js/core/orbit.js` 扫的是**商群**：把 24 个整体旋转认同（作用自由，`88,179,840 / 24 = 3,674,160` 个轨道），
便宜一个量级（实测 373 ms、3.67 MB）。它的数字是 par 的**下界**，不是 par：
本仓的胜利条件是 `cube.isSolved()` 要求的**参考朝向**，把魔方转回朝向要花转数。

- `js/data/lots.js` 每行的 `q` 就是这个下界，`tools/bake.mjs` 断言 `q ≤ par`，否则拒绝写文件。
- 本批 64 关里 `par − q` 最大 **2**（`cube-02` par 4 / q 2、`cube-09` 5/3、`cube-18` 7/5）。
- 用一字节数组量到的口径：全群直径 14、顶上 6,624 个状态；商群直径 14、顶上 276 个轨道。

要动这张表时先分清在回答哪一个问题：**"玩家最少转几步能赢"用 `par`；"这堆状态有多深"两个都能答，
但只有全群那个能和 A080630 对账**，因为那条序列的模型正是固定朝向的 `8!·3⁷`。

---

## 2. 规则：一个状态、一条判据，写错的三种方式

状态 = `{ perm: [8 个角块 id 按槽位], twist: [8 个 trit 按槽位] }`（`js/core/cube.js:36`）。
一条判据撑起整个主张：

> 可从已解态到达 ⟺ `sum(twist) ≡ 0 (mod 3)`

方向"违反判据 ⇒ **没有**解"不是断言出来的，是查表查出来的：`tools/proof.mjs` 对 12 个转 × 全部
3⁸ = 6,561 个扭转向量穷举，检查每次转的 delta 之和 ≡ 0 (mod 3)（本机实跑：`12 x 6561 twist vectors:
sum(twist) mod 3 unchanged by every turn  0 violations`）；`js/core/fullsweep.js:88-90` 在建转移表时对
每个 trit 码再验一次，破了直接 `throw`。

| 易错点 | 为什么看起来对 | 后果 | 现在的钉 |
| --- | --- | --- | --- |
| 手抄转块表（把某个面的顺/逆时针写反） | 六张 4-循环看起来"背得下来" | **距离分布不变**（生成集里同时含正反向，图同构），所以直径/直方图/外部对账**全都抓不到**；只有"这一转叫什么名字"错了——屏幕说 R 干的是 R' 的活 | `js/core/geom.js` 不从记忆抄：`rotationMatrix(法线, ±1)` 的 Rodrigues 公式推 `to/from/delta`；`test/geom.test.mjs` 用一套**手抄的六行循环表**去比对引擎（U/D/R/F/B 五行通过、**L 那一行方向写反了**，见 §7.4 与 deliverable §2#1） |
| 把整体旋转当成一步（或当成免费） | 2×2×2 拿在手里转一下很自然 | 若把 `isSolved` 放宽成"任意朝向已解"，`par` 立刻变成 `q`，与 A080630 对不上 | `cube.isSolved()` 只认参考朝向；`game.js:71` 的 `view:{yaw,pitch}` 明确写着"观察不是状态"，`view.js` 的空白处拖动不改 `moves`（`@pointer` 有两条专门验：shift 拖之后 `moves === 0` 而画面动了，且转身后的第一拖仍落在它声称的那一面，见 §7.3） |
| 编码/解码不对称（第八个 trit 手算错） | `decode` 里 `(3 − sum%3)%3` 与 `encode` 拒绝非 0 残差，两处分开写 | `parity` 类 bug 会让"随机 rank 生成的合法态"有一多半不可解，bake 表现为接受率塌掉 | `js/core/cube.js:222-242` 一对互逆函数；`tools/proof.mjs` 的 `decode then encode is the identity, first 4000 and last 2186 ranks`（实跑 0 broken）——注意这一项**曾经是这个函数里最后一条被打印出来的**：后半段用到没 import 的 `rankTo8`，`ReferenceError` 把它之后的所有锚点全部变成"没跑"，见 §7.4#2 |

`cube.applyInto`（原地，给搜索器省分配）与 `cube.apply`（纯函数，返回新状态）是**两个**函数，
不是两个名字一个东西：搜索器在 1.3 M 结点级别上跑，分配两次数组的时间都花在 GC 里；
UI 侧要的是"点一下不许改到别人的状态"。这条口径由 `test/geom.test.mjs` 与
`js/core/game.js` 的调用点共同保证。

---

## 3. 难度带的四个数字来自哪一个测量

**一次测量**：全群 par 直方图（§1 的 `hist`）除以 `88,179,840`，就是每档的占比。

```bash
node tools/bake.mjs     # == band shares == 段
node tools/survey.mjs   # 决定边界的那 5000 题量具（分钟级 CPU，不在 CI 里）
```

```
first   par 4-6    0.279% of all cubes  walk 5/6 turns
warm    par 7-9   13.863%               walk 9/10 turns
spin    par 10-11 62.094%               walk 13/14 turns
tangle  par 12-14 23.763%               walk 21/22 turns
```

三条约束是**测量结果**而不是风格：

1. **不能按等分位数切**。九连环那仓的图是一条路径、直方图是平的，所以四分位切得出四段等宽；
   这里的直方图是一座尖峰（10–11 占 62.09%，4–6 只占 0.279%），等分位会得到"三档挤在 10–11 附近"
   的四个数字。所以 `js/core/make.js:44` 的 `BANDS` 写的是**人类看得懂的区间**，
   而它旁边的注释印的是实测占比——这两个必须一起改。
2. **`walk` 必须是一对长度 `[k, k+1]`**。十二转图是**二分图**（每个转都是奇置换），
   走 k 步只能落在与 k 同奇偶的 par 上：固定 `walk: 13` 永远拿不到 12 和 14。
3. **接受率是量出来的，并且它决定策略选择**。均匀撒点（`rank`）在 first 档上的理论接受率就是
   0.279%，即每 358 个候选收 1 个；`walk` 策略实测（本批）22 试 16 收 = 72.73%、
   warm 31/16 = 51.61%、spin 62/16 = 25.81%、tangle 76/16 = 21.05%。
   `js/core/make.js:139` 的 `makeBand` 带 `cap`（`Math.max(4000, count*400)`），
   跑不完预算时 `stats.truncated` 让 `tools/bake.mjs:219` 直接失败，不是打一条日志继续。

**生成包络 vs 已发布落成**是两栏，不是一栏（Gridlock 抄错过的那格）：`TIERS_META.min/max` 是带定义的
4-6 / 7-9 / 10-11 / 12-**14**，`TIERS_META.seen` 与 `library.stats()` 是本批 16 关真实落成的 4-6 / 7-9 /
10-11 / 12-**13**。屏幕上印的是后者；par 14 的 6,624 个状态没有入库（占全群 0.0075%，`walk 21/22` 撒不到）。

---

## 4. 出题：候选、oracle、以及"序列化之后重解一遍"

`js/core/make.js` 的流水线：候选（`walkCandidate` / `rankCandidate`）→ **oracle 量 par** →
带过滤 → `verifyLot` 自洽 → 去重 → 入库。拒绝按原因计数并打印；本批实录
`{"par-out-of-band":127}`（`js/data/lots.js` 头注释的 `Rejections during this run:` 一行）。

oracle 有两种，这是本仓一个真实的设计分层：

- `bfsOracle()`（`make.js:78`）——真的搜。默认值，这样"没有烘焙表"时模块仍然诚实。
- `sweepOracle`（`tools/bake.mjs:91` 注入）——一次数组读，外加 `routeFromTable`。
  它同时返回 `states = cum[par]`：**"这张表要扫到多少个状态才敢给这么深的 par"**，
  每关的 `states` 字段就是这个数（本批 7,590 … 88,173,216），查表本身把这件事藏起来，所以印出来。

**最后一道门是"从序列化之后的数据重新解一遍"**，而且它不是某个函数的自述：
`tools/bake.mjs:120` 的 `independentCheck()` 拿着 `row.scr`（也就是 `scrText` 那串记号）重新求解，
`bfs` 与 `ida` 两个都不许看距离数组，两个的 `moves` 都必须等于印着的 `par`、
解串回放都必须 `isSolved`，`truncated` 算失败不算一致。本会话另外**独立**跑过一次（不读 bake 的日志）：

```bash
node -e '…对 js/data/lots.js 的每一行 parseSeq(scrText) → solveBfs + solveIda → 比对 par…'
rows 64 mismatches 0 max bfs nodes 1300224 max ida nodes 334675 total 24763 ms
```

IDA\* 的启发是**三项取 max**（`js/core/ida.js`）：单角块 24 结点表（实测上界 3）、
扭转赤字下界（`TWIST_STEP = 4`，即一转最多还 4 个单位扭转）、以及**五块 pattern database**
（`js/core/pdb.js`：`P(8,5)·3⁵ = 1,632,960` 个抽象状态、1.6 MB、抽象直径 10）。
前两顶不了事：规格写的 h1/h2 在真 par 11–13 的状态上不超过 3，"可采纳但没用"，
这是本仓对规格的一处**明确偏离**（`js/core/ida.js:20-26` 注释里写着，别当成抄漏）。
取 max 保可采纳，投影是图同态所以一致（1-Lipschitz）——两条都在 `tools/proof.mjs` 里穷举重验（实测 `ALL PROOFS PASS`，§7.4）。

---

## 5. 三层不许互相串

| 层 | 文件 | 可以知道 | 不许知道 |
| --- | --- | --- | --- |
| 规则 | `js/core/*.js` | `(perm,twist)`、判据、编码、扫描、存档结构 | `window`、`document`、canvas |
| 画面 | `js/view.js` | 像素、指针坐标、yaw/pitch、动画进度 | 任何合法性判断、任何计数、任何求解 |
| 外壳 | `js/main.js` | 路由、DOM、存档写入、`window.pocketcube` | 规则细节（不碰位、不算 par） |

实测口径：`grep -rn "window\.\|document\." js/core/` → 只有 `js/core/storage.js:30,38` 两行，
且都在 `try { … }` 里，正是契约 §1 点名的唯一豁免（无 `window` 或存储被拒时退化成内存对象）。
`js/core/*` 里出现真 DOM 会让 `node --test` 直接瘫掉，因为 `test/*.test.mjs` 是裸 import。

一处值得单独记的**方向性**约束：`js/main.js` 只 import `cube/game/library/rng/storage/view`。
`fullsweep/ida/pdb/bfs/make/orbit` 是构建期与测试期的东西，被前端 import 就等于把 84 MB 的野心搬进浏览器。
这条现在由 `tools/check.mjs` 的第 4 行守着——它从 `js/main.js` 沿 import 走一遍闭包（实测 9 个文件），
要求落到的每个 `js/core/*` 都在白名单里；闭包是重点，因为搜索器进入玩家设备的方式不是改 `main.js`，
而是往 `library.js` 里加一行"顺手"。变异测试验过它真的会红：给 `library.js` 加一条
`import { groupStats } from './fullsweep.js'` ⇒ `forbidden: [fullsweep, orbit]`，`rows: 4 fail: 1`。

`store`（`js/core/storage.js`）的语义是产品语义：`best` 只降不升、`unlocked` 只升不降、
每个字段过一遍 `blank()` 形状（手改 localStorage 里的数字不会把存档读崩）、
`reset()` 连内存缓存一起换掉。清档做成两次点击，因为它是全仓唯一破坏性操作。

---

## 6. 画面：手势到"哪一面转"只有一个函数

`js/view.js` 的语义核心是 `dragTurn(slot, n, u)`（`:68`）：按住的贴纸法线 `n`、拖动切线 `u`，
转轴 `a = cross(n, u)`（**顺序就是这个**：`a` 是右手系下把 `n` 带到 `u` 的那个轴，
`rotationMatrix(a, +1) n = a x n = u`）；再取该角块在 `a` 轴上的符号 `e`，
`a[i] === e` 就是这层面朝外那一侧 ⇒ 用 `cwTurnOf(m) ^ 1`，否则用 `cwTurnOf(m)`。
符号错一个，画面照常动、计数照常加，**但玩家拖的和屏幕转的不是同一件事**，
而屏幕上看不出来——所以文件头点名它必须在 node 层被测。

`test/view.test.mjs` 就是那条断言，锚是 geom.js 的**物理贴纸模型**（它不读上面任何一张表）：
96 个 (角块, 面, 拖动方向) 三元组逐个验"手指把哪个贴纸往哪儿推，最后那个贴纸就朝哪儿"，
外加 48 组"反着拖 = 逆着转"、"一个贴纸的四拖 = 相邻两面的正反"、
"转的是脚下那层，不是背后那层"。变异测试做过：把 `cw ^ 1 : cw` 那一行的分支抹平成 `return cw`，
5 行里红 3 行（48/48 三元组的落点错、48 组正反拖全等）。浏览器层 `@pointer` 再验一次真实像素上的同一件事，
包括"这一拖按下去之前，命中测试读到的是不是同一个贴纸"（`pressable`）。

其余几条不是风格：

- `DRAG_THRESHOLD = 16` css px（`:35`）：**越过阈值只提交一次**，不许连转；反向拖 = 反向转。
  台架里必须有一条"小拖动不提交"，否则一次滑动 = 三次转会静默毁掉 par 的意义。
- 拖空白处改 `game.view.yaw/pitch`，**不产生 `moves`**。这是 §2 第二条易错点的画面侧。
- 提交顺序：状态**只**在 `game.turn()` 里变一次，动画是把被转的那层按 `(1 − progress)` 的**逆旋转**画出来，
  所以第一帧等于转之前的图、最后一帧精确等于核心已经持有的态。动画永远不会是"计数和魔方不一致"的原因。
- 颜色来自 `geom.stickersOf(state)`，与扭转记账读同一张表：屏幕不能对模型撒谎说哪张贴纸在哪。
- `canvas.getContext('2d', { willReadFrequently: true })`：台架要用 `getImageData` 回读像素证明
  "合法拖动改变画面、小拖动不改变"，没这个标志 Chrome 每次回读打一条 warning，会淹没"console 干净"那条断言。
- 给台架用的坐标原语：`stickerPoint(slot,k)` / `dragsFor(slot,k)` / `pointAt(slot)` / `cellPoint(x,y)`
  （`:472-492`）。CDP 派真实鼠标事件只能靠它们拿到像素坐标。

---

## 7. 验证台架

### 7.1 为什么是 CDP 而不是 Playwright

`package.json` 的 `dependencies` 与 `devDependencies` 都是 `{}`（实测 `node -e` 读出 `{} {}`），
仓里没有 `node_modules`。Node 21+ 自带全局 `fetch` 与 `WebSocket`，`tools/playtest.mjs` 用它们直讲 CDP
（`open|nav|eval|tap|shot|logs`）就够覆盖注入、真实输入、截图、抓 console。多一个依赖就多一条供应链。

### 7.2 台架必须存在的原因：注入 JS 证明不了手指点得着

页面内 `eval` 能证明 `turn()`、`grade()`、`commit()` 对，证明不了"那个贴纸在屏幕上真的拖得动"。
所以契约要求有一段真实输入事件（九连环那仓是 `@pointer` 24 条），坐标必须从页面里的
`stickerPoint()/pointAt()` 取，事件必须是 Node 侧 `Input.dispatchMouseEvent` 的 press/release，
并且至少断言：整条认证解真实拖完、小拖动不提交、反向拖反向转、视角拖动不加步数、解完出完成态。

### 7.3 浏览器层：接线之后红在哪儿（本次实测）

上一版的这一节写的是"还没接线"——`playtest.mjs` 与 `verify.sh` 带着上一仓的 `window.gridlock`
（27 处）与 `carPoint / g.pos()` 那套原语，`verify.sh` 会在 boot 轮询处 `exit 5`。那句话当时是真的，
本文件也不印没跑出来的数。现在台架已经改写到本仓钩子上（`state / pool / tiers / cube() / route() /
scramble() / notation() / play / dragsFor / stickerPoint / pickAt / load / restart / hintOnce …`），
实测：

```
SKIP_UNIT=1 bash tools/verify.sh     → 16.8 s
  @boot 17/0   @play 17/0   @routes 23/0   @save 14/0   @pointer 19/0   = 90 行, 0 失败
  console 空、Chrome 自行退出、末行 === ALL GREEN ===
```

它接上之后**第一次跑是五条红的**，而且红的一侧是产品，不是台架——这才是"必须有真实输入事件"的理由：

1. **`#/cube/<转记法>` 直接崩壳**。`createGame()` 对 `lot.route.slice()`，而手输乱序的 lot 按
   README:29 的契约就没有 route。三段 `@routes` 场景读到的是**上一局的 DOM**，所以它们在崩溃之前也是"绿的"。
2. **未实测的题也印"超出"**。`moves - null === moves`，于是面板把一个真实数字当成"离最优几步"。
   `overPar()` 现在对 `par == null` 返回 `null`，面板印 `—`，并注明"没有 par 可对照"。
3. **转镜头之后画面不重绘**。`picked`（下一次按下的命中测试用的那些四边形）只在 `draw()` 里重建，
   而 `frame()` 从不为纯相机变化画一帧 ⇒ 拖完之后手指仍然瞄准转身**之前**的贴纸。加了 `dirty` 标志。
4. **未实测的题能拿到 `perfect: true`**：`finish()` 当时传的是 `par: g.moves`，等于自己给自己定标尺。
5. **`turns: null` 能写进存档**：`uint(null, -1) === 0`，于是 0 转"击败"了所有真实成绩。

还有一条只在真实指针下才现形：**几何算出来的拖法不一定按得下去**。`dragFor()` 逐个贴纸给四个方向，
但按下是对**画出来的那一帧**做命中测试，前面角块的贴纸可以盖住后面那个的中心——第一拖因此提交了 `L'`
而不是模型声称的 `F`。现在 `dragFor()` 用指针自己的 `stickerAt()` 回读那一点，给出
`pressable` 与 `under`，`@pointer` 有两行分别验"回读一致"和"整条认证路线一拖一转拖得完"。
这一条与九连环那种"点击不许现场搜索"无关，是投影 + painter 顺序的固有性质，写进 §9 的边界里。

### 7.4 node 层与 proof.mjs 的实测状态（本次跑出来的）

```
npm run check                → OK, rc=0
node test/geom.test.mjs      → rows: 18 fail: 0    (0.05 s)
node test/library.test.mjs   → rows:  9 fail: 0    (7.6 s，64 关全部用两个求解器重解)
node test/game.test.mjs      → rows: 10 fail: 0    (0.03 s)
node test/storage.test.mjs   → rows: 14 fail: 0    (0.03 s)
node test/view.test.mjs      → rows:  5 fail: 0    (0.03 s，96 个手势三元组对物理贴纸模型)
node tools/check.mjs         → rows:  4 fail: 0    (import 落盘 / core 不碰 DOM / core 不 import 壳 / 页面闭包不含构建期层)
node tools/proof.mjs         → ALL PROOFS PASS     (35 行 ok / 0 FAIL；214–233 s, 峰值 410 MB) ⇒ CI 里独立一个 proof job
bash tools/verify.sh         → 60 + 90 行, 0 失败, 25.0–28.3 s, console 空, === ALL GREEN ===
```

三条历史故障要写清"错在哪一侧"，因为把它们读成"引擎有 bug"会误导下一位：

1. **`test/geom.test.mjs` 当初唯一失败的是测试自己手抄的表。** 断言 `L: 2 -> 0`（引擎给 6）。
   同一套件里通过的五行（U/D/R/F/B）与"顺转 = 右手法线方向 −90°"这条定义一致，L 那一行是反的；
   对 `rotationMatrix(L 法线, −1)` 逐点验：`2 → 6, 6 → 4, 4 → 0, 0 → 2`，即引擎的 L 与矩阵、
   与"从左面外面看顺时针"都一致。改的是那行手抄表（`test/geom.test.mjs:300` 现在是 `L: [2, 6, 4, 0]`），
   不是 `geom.js`。
2. **`tools/proof.mjs` 曾在 `checkEncoding()` 里用了没 import 的 `rankTo8`**（`js/core/cube.js` 有导出）
   ⇒ `ReferenceError` 退出，后面的启发可采纳性与群论对账**根本没跑**。这类故障的方向值得记一笔：
   崩在中间的那一项，把**它之后的所有锚点**都变成"没跑"，而输出上看着像"前面都 ok"。
3. **同文件那条 `x x' y y'` 断言当时构造的是换位子。** 代码写的是 `[a, b, a^1, b^1]`，名字与注释要的是
   `x x' y y'`。本机实测：`[a,b,a⁻¹,b⁻¹]` 有 **96/144 个不回已解态**、`[a,a⁻¹,b,b⁻¹]` 有 **0/144**——
   非交换群的正确行为被写成了一条永远不可能满足的断言。现在两套模型（表 / 物理贴纸）各验一遍，
   失败数分开打印（复现命令在 deliverable §5.4）。

以上三条都是**改掉断言/导入的一侧**之后绿的，没有放宽任何一条期望值：`geom` 的 L 行按矩阵重写、
`proof` 的锚点补 import 并把断言改成"确实会抵消的那一族"、`@play` 的"绕两转"补成**真正一对**正反
（少一个就是一条 par+1 且压根不解开的序列，读的会是上一局留在 DOM 里的星数）。

### 7.5 家族教训（写在这里是因为台架改写时要照做）

- `Page.navigate` 之后轮询 shell（`waitShell()` 读 `window.pocketcube.state.id`），不要 `sleep()`；
  固定 sleep 在 localhost 够用、打线上就是三条假故障（canvas 停在未样式的 300×150）。
- `verify.sh`：Chrome 用 `mktemp -d` 独立 profile；轮询 `/json/version` **和** web 根目录都活才开始；
  `trap cleanup EXIT` 里对后台 PID 都 `wait` 掉；支持 `SKIP_UNIT=1`；**开机先探测两个端口是否已有人监听**，
  有就 `exit 6` 并打印归属（撞上别人的 Chrome = 读一个不是这个 checkout 的页面 = 一次假绿）。
  结果 JSON 用 `json.JSONDecoder().raw_decode` 从 console 里截，**不要**自己数花括号：行里带中文、
  带嵌套 detail，一个含 `{` 的文本会让计数永远回不了零，聚合器死在 NameError 上、连 verdict都不印。
  这几条本仓已经落地，台架也从 gridlock 改写到了 `window.pocketcube`（§7.3 记了改写之后红的那五条）。
- `<link rel="icon" href="data:,">` 在 `index.html:8`，防 favicon 404 污染 console 断言。
- 场景体（写在模板字面量里的页面源码）里不写反引号、不写单反斜杠斜杠；每段执行前清掉
  `window.__lastRows`，否则上一段的行缓冲会被当成本段成绩——坏掉的台架看起来是绿的。

---

## 8. 刻意不做的东西

- **不做 3×3×3**：`3^7·8!·12!/2` 级别的状态群，"par 是定理"这个主张直接失效；
  二阶是这条主张**能成立的最大魔方**，本仓的全部结构（一字节距离数组 + 外部直方图对账）都依赖这一点。
- **不做多层、斜转、盲拧计时**（规格 §7 的已知不做）。计时会把"星级"变成速度，而这里的星级
  定义是 `moves ≤ par`（`js/core/game.js:145`），与手速无关。
- **不做浏览器内重烤池子**：`tools/bake.mjs`/`survey.mjs` 是构建期工具，shipped 代码不 import。
- **不做成就 / 排行榜 / 签到 / 云存档 / 分享战绩**（组织 E 组禁令）。分享只有 `#/lot/<id>` 与
  `#/cube/<打乱公式>`，分享的是谜题本身，不含分数；后者**故意不携带 par**（`library.js:87-105`）。
- **无图片 / 音频 / 字体 / 打包器 / npm 依赖**：八个立方体由 `js/view.js` 程序绘制，二进制资产 0 个。
- **不为了"绿"去改期望值**。§7.4 那三条现在都是红的/崩的，本仓的处理方式是**登记**，
  不是放宽断言，也不是顺手把 `geom.js` 改成迎合手抄表。

## 9. 实测出的边界

- **每日题/随机题的确定性来自 `hashSeed`，而它不是教科书 FNV-1a。**
  `js/core/rng.js:4` 的实现是 **FNV-1a 派生的两轮混合**：每个 UTF-16 code unit 先把低字节异或进
  `h` 再乘 FNV prime，然后把高字节异或进 `h` **再乘一次**（`hashSeed` 里 4 行、两个 `Math.imul`）。
  所以 ASCII 种子**不等于**公开向量：实测 `hashSeed('a') = 723832900`，教科书 FNV-1a 是 `3826002220`。
  能断言的是自洽性质：同输入两次相等、输出恒在 `0 … 2³²−1`、不同种子分散（500 个 `"k"+i` 命中 64 个桶里的 64 个）。
  **不要**在任何测试里写"应等于 3826002220"。选择它、以及 `mulberry32`，都是与 gridlock 同一份，
  为的是同一个种子串在不同仓/不同设备上落到同一个谜题：`dailyLot('2026-09-27') → cube-35`（两次调用相等）、
  `randomLot('4kq2','spin') → cube-39`，实跑复现见上。
- **一关的 `states` 字段最大 88,173,216**（par 13 那关）：它说的是"表要扫到这么深才敢印这个数"，
  不是玩家会看到的搜索量；玩家侧永远是数组一次读。
- **搜索成本随 par 指数上升**：双向 BFS 在 par 10/11/12/13 上分别约 94k / 294k / 494k / 1,300,224 结点，
  最贵的一次 IDA\* 重解 2,460 ms（本批 64 关共 24.8 s 跑完两层重解）。这就是"生成/求解放构建期"的量化理由。
- **BFS 用 `encode8`（全抽象空间 `8!·3⁸ = 264,539,520`）而不是可达子群索引**：
  这样求解器可以被**问**一个不可解的魔方，两个前沿永不相遇 ⇒ 答案是"无解"，而不是崩溃或假解
  （`js/core/bfs.js:11-16`）。全群扫描那侧不需要这个能力，所以它用稠密的 `8!·3⁷` 索引，一字节一格。
- **计时数字不逐位可复现**：`sweep 5059 ms`、`total 24763 ms`、每次 re-solve 的 ms 都随负载漂移；
  结构量（88,179,840 / 14 / 6,624 / 15 行直方图 / 四档区间 / 接受率计数）才是可复现的那一类。
- **端口三处一致，实测过**：`server.cjs` 默认 **5199**（`Number(argv[2]) || env.PORT || 5199`）、
  `verify.sh` 的 `WEB_PORT` 默认 **5199**、`playtest.mjs` 的 `BASE_URL` 默认 `http://127.0.0.1:5199/`、
  `package.json` 的 `dev` 显式 `node server.cjs 5199`。上一版这里登记的故障（"dev 起 5190、门指 5180"）
  已经不存在，`npm run dev` + `bash tools/verify.sh` 现在指同一个页面；devtools 侧是 9359，
  与同系列其它仓（gridlock 5180/9340、批量 5185–5197/9345–9357）错开。
