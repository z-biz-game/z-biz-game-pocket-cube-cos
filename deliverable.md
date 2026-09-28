# 魔方袖珍 - 交付报告

读者：接手的维护者代理。本文件只登记**磁盘上真实存在、且在本次会话里被命令跑过**的东西。
每条声称都指到一个具体文件与一条能跑的命令；所有输出行都是本机实跑后原样粘贴，
不是从 README.md / DESIGN.md 里抄的文字。

本文件由两轮会话合成，两轮的权限不同，读法也不同：

- **第一轮（2026-09-27）**是只读核查：那个会话被禁止改既有文件，所以它把 11 条问题登记在 §2
  后就结束。其中 3 条（#1 手抄表方向、#2 缺 `rankTo8`、#11 台架轮询错钩子）当时就是**红灯的成因**。
- **第二轮（2026-09-28，本次）**把它查出来的问题全部改掉，并补齐它写明"不存在"的那些门禁。
  本文件现在引的数字，除 §4.1 的 bake 实录（产物自带的 09-27 那一次）之外，**全部是 09-28 本机重跑的**。

本次改过的既有文件：`js/main.js`、`js/view.js`、`js/core/game.js`、`js/core/library.js`、
`js/core/storage.js`、`tools/verify.sh`、`tools/proof.mjs`、`tools/playtest.mjs`、
`test/geom.test.mjs`、`.github/workflows/ci.yml`、`README.md`、`DESIGN.md`。
本次新增：`tools/check.mjs`、`tools/modifiers.mjs`、`test/view.test.mjs`、`test/game.test.mjs`、
`test/library.test.mjs`、`test/storage.test.mjs`。git 侧本次做的是：`git init -b main` + **一次**提交
（author 与 committer 都是 `z-biz-game <bot@z-biz-game.dev>`，per-repo 配置）+ 建远端 + 开 Pages
（`build_type: workflow`）+ 推送 + 三层复验，全部记在 §5.7；没有新增任何运营功能（契约 §5 的禁令照守）。

**并发写入**：本次工作期间本目录没有其他 agent 在写。查法：`ps` + `lsof`——9373 端口的 headless
Chrome 属于 `/tmp/sky-chrome-profile`（兄弟仓的车道），9358 属于另一个临时 profile；本仓门禁用
web **5199** / devtools **9359**，且 `tools/verify.sh:54-63` 在起跑前对任何已占用的端口直接
`exit 6` 并打印 owner（"透过别人的服务器测本仓"会得到一条明确拒绝，而不是一个假绿）。

---

## 摘要

| 项 | 值 | 复现命令 |
|---|---|---|
| **App 名称** | 魔方袖珍 | `head -1 README.md` → `# 魔方袖珍 · POCKET CUBE`；与 `index.html:9` 的 `<title>` 一致 |
| 仓 | `/Users/zifang/workplace/ceo_workplace/z-biz-game/z-biz-game-pocket-cube-cos` | — |
| 玩法一句话 | 2×2×2 魔方，用尽量少的**季度转**把六个面收回单一颜色 | `js/core/cube.js`（`isSolved`）、`js/core/game.js:159`（`grade`） |
| 路由 | `#/c/<n>`、`#/campaign/<n>`、`#<n>`、`#/daily`、`#/random/<档>[/<种子>]`、`#/lot/<id>`、`#/cube/<打乱公式>` | `js/main.js` 的 `parseHash`；浏览器侧由 `@routes` 的 23 行断言（§5.5） |
| 测试钩子 | `window.pocketcube`，定义在 `js/main.js:359` | `tools/playtest.mjs` 与 `tools/verify.sh` 驱动的就是它（第一轮时它们还在驱动上一仓的 `window.gridlock`） |
| 主张：`par` 从哪来 | 全群 `8!·3⁷ = 88,179,840` 个状态的穷尽 BFS 距离（一字节一格），逐层直方图与 **OEIS A080630** 逐行相同，直径 **14**、顶上 **6,624** 个状态 | `node tools/bake.mjs`（§4.1）、`node tools/proof.mjs` 的枚举段（§5.4） |
| 第二证据（防自证） | 每关从**序列化之后的 `scrText`** 再独立解一遍：双向 BFS + IDA\*（五块 PDB），两个都必须等于印着的 `par`，解串回放必须回到已解态 | **`node test/library.test.mjs`** 的第 3 行 `every shipped par survives a re-solve by the reference solver`（§5.2，7.6 s，**在 CI 里**） |
| 难度带是量出来的 | `4-6 / 7-9 / 10-11 / 12-14` = 全群 par 直方图的四段，占群 `0.279% / 13.863% / 62.094% / 23.763%`；本批**落成**是 `4-6 / 7-9 / 10-11 / 12-13` | `js/data/lots.js` 的 `TIERS_META`（`max` 与 `seen` 两栏并排）；`node -e 'import("./js/core/library.js").then(m=>console.log(m.stats()))'` |
| 契约 §3 的"唯一解/线索删除"那类证明 | **不适用**：二阶没有线索可拆，本仓用的是"穷尽 + 外部对账 + 双求解器"。没有伪装成适用 | 见 `README.md` 已知边界、`DESIGN.md` §1–§2 |
| node 断言 | **5 个套件 56 行 + 分层门 4 行 = 60 行，`fail: 0`**（第一轮：1 个套件 18 行、1 行红） | `bash tools/verify.sh` 前半（§5.2、§5.3） |
| 数学断言 | `node tools/proof.mjs` → `ALL PROOFS PASS`：**35 行 ok / 0 FAIL**，本次 233 s（同日另一次 214 s、峰值 410 MB） | §5.4；CI 里是独立的 `proof` job（第一轮它哪儿都没跑） |
| 浏览器断言 | **5 个场景 90 行，`fail: 0`**（`@boot 17` / `@play 17` / `@routes 23` / `@save 14` / `@pointer 19`），console 干净，Chrome 自行退出 | `SKIP_UNIT=1 bash tools/verify.sh`（§5.5） |
| 整条门 | `bash tools/verify.sh` → `=== ALL GREEN ===`，rc=0，**25.7 s** | §5.5 原文 |
| 语法门禁 | `npm run check` → `OK`，rc=0 | §5.1 |
| npm 依赖 | `dependencies = {}`、`devDependencies = {}`，无 `node_modules` | `node -e 'const p=require("./package.json");console.log(p.dependencies,p.devDependencies)'` → `{} {}` |
| 二进制资产 | 0（无 png/mp3/字体；八个立方体由 canvas 2D 程序绘制，自写投影） | §3 的白名单 `find` |
| 磁盘文件 | 40 个，其中 js/mjs/cjs/css/html 31 个 | `find . -type f -not -path './.git/*' \| wc -l` |
| 未实现清单 | **9 条**，全是边界或"未执行过的事"，**没有一条阻断门禁** | 见 §6 |

---

## 1. 文件清单 —— 每个文件由谁验证

"由谁验证"指**具体测试文件或具体命令**；没有门禁的文件明确写"无门禁"，不假称有。

### 壳与画面

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `index.html` | 壳：顶栏 / `#cube` 画布 / 右侧面板 / 通关卡；`<link rel="icon" href="data:,">`（`:8`） | `@boot` 的 6 行（控件齐、画布不是未样式的 300×150、魔方真被画出来、rAF 在推进、一次重画推得动 frames、地址栏无 hash 也出第 1 关）＋ `@play` 的"卡片升起"（§5.5）。favicon 那条是给"console 干净"用的，现在确实有那条断言 |
| `css/game.css` | 全部样式，单文件 | `@boot`（`#cube` 有真实像素）、`@pointer` 的坐标断言（样式把画布摆到哪儿，命中测试就得算到哪儿：`dragFor` 给的是 client 坐标，`box.left/top` 加了才发给 CDP） |
| `js/view.js` | canvas 2D 自写投影、手势（拖面 = 转、拖空白 = 看）、`stickerPoint/dragsFor/pointAt/cellPoint`（`:486-505`）、`dirty` 重绘标志（`:108,:417,:451`）、`dragFor` 的 `pressable/under`（`:324-340`） | **`test/view.test.mjs`**（5 行，node 层）：`dragTurn()` 对 96 个 (角块, 面, 拖动方向) 三元组逐个对**物理贴纸模型**，48 组反拖 = 逆转，一个贴纸恰好四拖 = 相邻两面的正反，转的是脚下那层。＋ `@pointer` 19 行（真鼠标事件，含 `pressable` 的往返断言，§2#16） |
| `js/main.js` | 路由、DOM、存档写入、`window.pocketcube`（`:359`）、`pickAt`（`:453`）、只接受 `pressable` 的 `dragRoute`（`:472`） | `@boot/@play/@routes/@save/@pointer` 全部 90 行；分层侧由 `tools/check.mjs` 第 4 行钉住"页面的模块闭包不许碰构建期层" |

### js/core/*（纯函数层，`node` 直接 import）

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `js/core/cube.js` | `(perm,twist)` 模型、扭转判据、`apply/applySeq`、Lehmer 编码 `encode/decode` 与全抽象空间 `encode8/decode8`、记号 `parseSeq/compactSeq/qtmCost` | `test/geom.test.mjs` 18/0（含 `a half turn never twists…`、`the invariant survives…`、`a turn conserves the twist sum…`）；`tools/proof.mjs` 的编码互逆 4 行 + 判据穷举 2 行（§5.4）。记号往返这一侧：`test/library.test.mjs` 每行从 `parseSeq(scrText)` 重解 == `par`，不闭合就红 |
| `js/core/geom.js` | 由 3×3 整数旋转矩阵**推出**十二个转的 `to/from/delta`；贴纸模型；`project/physicalTurn/stickerCensus` | `test/geom.test.mjs`(18/0) + `proof.mjs` 的 `every turn is a bijection…`、`single 4-cycle`、`deltas sum to 0 (mod 3)`、`300 random words: (perm, twist) equals the physical projection`；`test/view.test.mjs` 也拿它当独立锚 |
| `js/core/fullsweep.js` | 全群穷尽 BFS：`dist` 数组、`hist`、`routeFromTable`、`groupStats` | **无独立测试文件**（注释点名的 `test/fullsweep.test.mjs` 仍不存在，§6-2）。间接门禁：`bake.mjs` 的三条硬条件（`reached === 88,179,840`、15 行直方图 === A080630、`sum(hist) === GROUP_ORDER`）不满足就 `exit 1`；`proof.mjs` 另用**枚举** 40320×6561 独立数出 88,179,840（§5.4 的 `group order, by enumeration` 段——第一轮跑不到，本次跑到了） |
| `js/core/orbit.js` | 24 个整体旋转的商群扫描（`3,674,160` 轨道、直径 14、276 个最深轨道）：par 的**下界** | **无门禁**（`test/orbit.test.mjs` 不存在，§6-2）。被 `bake.mjs` 用了两件事：印 `q`、断言 `q ≤ par`（本批最大 `par − q = 2`，§4.3） |
| `js/core/bfs.js` | 参考求解器：双向 BFS，键 `encode8`（能被问不可解的魔方） | `test/library.test.mjs`（64 关逐关重解 == `par`）＋ `proof.mjs` 的 `bfs par === ida par on every one  0 disagreements` 与 `<U,U'>` 分量的两条（§5.2、§5.4）。产物每行另带 `check[{solver:'bfs'}]` 实录 |
| `js/core/ida.js` | 第二个求解器：IDA\*，`h = max(单角块 24 结点表, 扭转赤字下界, 五块 PDB)` | 同上两条：`test/library.test.mjs`、`proof.mjs` 的 `deepest par in the sample 13; … ida 325ms mean` 与 `h <= BFS par on every sampled cube  0 of 120 overestimated` |
| `js/core/pdb.js` | 五块 pattern database：`P(8,5)·3⁵ = 1,632,960` 抽象状态、1.6 MB | `proof.mjs` 的两条：`every abstract state is reachable in the pattern  0 holes`、`1-Lipschitz along all 19595520 abstract edges  0 violations`——**本次真的跑到了**（第一轮在 `checkEncoding` 就崩，§2#2） |
| `js/core/make.js` | 候选生成（`walk`/`rank`）、`measure`、`makeBand`、`verifyLot` | **无门禁**（无 `test/make.test.mjs`，§6-2）。它自己的自洽门在 bake 里逐条生效：`verifyLot` + 去重 + `cap` + `stats.truncated → 构建失败` |
| `js/core/library.js` | 64 关 / 每日 / 随机 / id / 打乱串 的查表 + 加载期结构复验 + `stats()`；`fromScramble`（`:89-105`）是**唯一**允许离开池子的入口，它给的是 `par: null, route: null, custom: true` | **`test/library.test.mjs`** 9 行：加载期守卫（`the load-time guard is real: a lot that lies about its par would stop the import`）、逐行复算、四档区间、战役阶梯、`dailyLot` 同日幂等、`randomLot` 同种子同题、`fromScramble` 不替未实测的题编 par（§5.2）。浏览器侧 `@routes` 再验 `#/cube/` 真能开出来 |
| `js/core/storage.js` | localStorage 存档；无 `window` / 存储被拒时退化内存；`solve()` 的 `turns`/`par` 两条守卫（`:111-117`） | **`test/storage.test.mjs`** 14 行（A/B/C/D 四组）：无 `window` 能跑、最佳纪录只降不升、未实测 par 不能把这次算成完美、坏文件读成空表而不是崩、`reset()` 同时换掉 `memory` 与 `cache`（第一轮 §2#10 说的"没有测试覆盖"现在覆盖了） |
| `js/core/rng.js` | `hashSeed`（**FNV-1a 派生的两轮混合，不是教科书 FNV-1a**）+ `mulberry32` + `rngFrom` | **无独立测试文件**（§6-2）。间接门禁：`test/library.test.mjs` 的 `daily and random pick from the table by seed alone, so a link is reproducible`。公开向量那件事见 §4.3 末的诚实说明 |

### 数据产物 / 服务器 / 桌面壳

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `js/data/lots.js` | 构建期产物（25,540 B）：`BAKE` 实录、`TIERS_META` 四档、64 行 `par/q/states/check` | `node tools/bake.mjs`（写它之前逐关重解 + A080630 对账，§4.1）；再由 `test/library.test.mjs` 从 `scrText` 逐行重解（**这条在 CI 里**）；再由 `library.js` 在加载期复验结构。**行数的两种数法**：`grep -c '^  {"id":"cube-'` → 64（关卡），`grep -c '^  {'` → 68（多 4 行 `TIERS_META`）——第一轮引的是后者却写 64，见 §2#20 |
| `server.cjs` | 零依赖静态服务器，默认端口 **5199** | `@*` 全部 90 行都是透过它跑的（`verify.sh:77` 起它、`:102-107` 轮询它）；`npm run check` 过语法。第一轮写的"默认 5180"是错的（§2#19） |
| `electron/main.cjs` | 桌面壳，复用 `server.cjs` 且 `port: 0` | **只有语法门禁**；**未真实启动过**（仓内不装 electron），见 §6-3 |

### tools/ 与 test/

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `tools/bake.mjs` | 扫描 → 量带占比 → 填带 → 逐关独立重解 → 结构复验 → 写 `js/data/lots.js` | 09-27 实跑（§4.1）；它的每条 `fail()` 都在同一条命令里生效。本次**没有重烘**（产物侧结构量由 `test/library.test.mjs` 逐行复算覆盖） |
| `tools/survey.mjs` | 决定四档边界的量具：5000 题均匀 par 直方图 + walk 直方图 + 各带接受率（分钟级 CPU） | **未跑**（成本：5000 次双向 BFS）。它要独立看的那件事，本仓是从**穷尽扫描**看到的（§4.1 的 `== band shares ==`），所以不引它的抽样数字。不进 CI |
| `tools/proof.mjs` | 对外锚点集合：转表双射、判据穷举、编码互逆、群阶枚举、双求解器 300 题对账、不可解态判定、PDB 空洞与 1-Lipschitz、启发可采纳、`FULL=1` 全群直径 | 本机实跑 → **35 行 ok / 0 FAIL / `ALL PROOFS PASS`**（§5.4）。第一轮的 `rankTo8` 崩溃与换位子断言都修了（§2#2、#3），且它现在在 CI 里有自己的 job |
| `tools/check.mjs` | **本次新增**的分层门，4 行：27 个 source 的相对 import 全部落盘、`js/core` 不碰 DOM（`storage.js` 只豁免 `window.localStorage`）、core 不 import `main/view`、`js/main.js` 的**传递模块闭包**（9 个文件）不许出现构建期模块 | `node tools/check.mjs` → `rows: 4 fail: 0`（§5.3）。四条都做过变异验证（每条各造一次违规，全部红）。CI：`unit` job 的 `Layering` step ＋ `verify.sh` 里无条件执行 |
| `tools/harness.mjs` | 微型框架 `test/ok/eq/run`；每个套件打一行 `rows: N fail: M` | 本次所有 `rows:` 行都是它打的（§5.2、§5.5） |
| `tools/playtest.mjs` | 零依赖 CDP 驱动（`open/nav/eval/tap/shot/logs` + 真鼠标 `@pointer`），五个场景体驱动 `window.pocketcube` | `bash tools/verify.sh` 的浏览器层 90 行（§5.5）。第一轮它用的是上一仓的原语，本次整体重写 |
| `tools/modifiers.mjs` | **本次新增**的一次性量具：把 CDP `Input.dispatchMouseEvent` 的 modifier 位在本机 Chrome 上实测一遍（alt=1、ctrl=2、meta=4、shift=8、16=无） | `node tools/modifiers.mjs`。它的产物是 `@pointer` 里"这一按在页面里确实是 shift 键按下"那条断言的锚——位不猜，量 |
| `tools/verify.sh` | 一次性验收门（端口占用即拒 `exit 6`、独立 profile、双端点轮询、`trap cleanup EXIT`、`raw_decode` 截 JSON、`SKIP_UNIT`、结尾确认 Chrome 真的退了） | 本机实跑 rc=0（§5.5）。`:119-125` 现在**无条件**跑 `tools/check.mjs`——第一轮那里是 `if [ -f tools/check.mjs ]`，而当时那个文件**不存在**（§2#17） |
| `test/geom.test.mjs` | 几何层 18 项：字母表、顺转的矩阵含义、半转不扭转、4-循环、双射、delta 守恒、判据穷举、贴纸模型 300 词对账、`cwTurnOf`、手抄面循环表 | `node test/geom.test.mjs` → `rows: 18 fail: 0`（§5.2）。第一轮那 1 行红是手抄的 L 循环表方向反了，改的是那一行（§2#1） |
| `test/view.test.mjs`、`test/game.test.mjs`、`test/library.test.mjs`、`test/storage.test.mjs` | **本次新增**，共 34 行 | §5.2 的实跑输出；`game.test.mjs` 覆盖 `hint` 的 off-route 口径与"没有认证路线的题不许抛"，`view.test.mjs` 覆盖 `dragTurn()` 的符号 |

### 其它

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `package.json` | `"type":"module"`、零依赖、`check/unit/test/bake/survey/proof/verify/dev/start/electron` 脚本；`dev` 是 `node server.cjs 5199` | `npm run check` rc=0（§5.1）；`npm run unit` 就是 §5.2 那五条命令（不含 `check.mjs`，那条在 CI 的 `Layering` step 与 `verify.sh` 里）。第一轮的"端口口径不一致"已统一（§2#19） |
| `.github/workflows/ci.yml` | **三个** job：`unit`（`node --check` 全量 + 5 套件 + `Layering`）、`proof`（`node tools/proof.mjs`）、`browser`（`SKIP_UNIT=1 bash tools/verify.sh`） | **本机未执行 Actions**；三条命令本机全部实跑且 rc=0（§5.2–§5.5）。第一轮"照现状推上去 unit 会红、browser 会红"的两条成因都已消除 |
| `.github/workflows/pages.yml` | 文件拷贝式部署：只 `cp index.html` + `cp -r css js`；`configure-pages@v5` + `deploy-pages@v4` | **本机未执行**。被拷的 `css/js` 由 `npm run check` 过语法、由 `@boot` 在真实页面里验过；线上复验步骤写在 §6-7 |
| `README.md` / `DESIGN.md` | 玩法与面向维护者的约束/踩坑说明 | **无自动门禁**。两份文档的数字本次全部换成 §4/§5 的实测值（三处更正：`每关重解一次要花 30 秒` → 64 关实测 7.6 s；`server 默认 5180` → 5199；`整条门 24.4 s` → 25.7 s） |
| `.gitignore` / `LICENSE` | 忽略物；MIT，`Copyright (c) 2026 z-biz-game` | `head -4 LICENSE` |
| `deliverable.md` | 本文件 | 自身无门禁；内容指向 §4/§5 的实跑输出 |

---

## 2. 改动表（先写错在哪 → 为什么对）

来源标法：**[已修]** = 本次改掉并重新跑绿；**[本仓真踩过的]** = 这份代码里确实写过、注释或实跑记录了；
**[风险类]** = 容易错且已有对应的钉，本仓没提交过那种错。
"现在的钉"必须是能跑的命令或磁盘上的断言名，不是叙述。

| # | 当时错在哪 | 为什么这样才对 | 现在的钉 |
|---|---|---|---|
| 1 | **[已修]** `test/geom.test.mjs` 手抄的六行面循环表里，`L: [2, 0, 4, 6]` 方向写反 | `geom.js` 的定义是"顺转 = 沿外法线右手 −90°"。逐点算 `rotationMatrix([-1,0,0], -1)` 作用在 L 层四角：`2→6, 6→4, 4→0, 0→2`，即引擎的 L 与矩阵、与"站在左面外面看顺时针"都一致；同一套件里通过的 U/D/R/F/B 五行也都是这个约定，只有 L 那行是它的逆循环。改的应该是那行手抄表，**不是 `geom.js`** | `test/geom.test.mjs:300` 现为 `L: [2, 6, 4, 0]`；`node test/geom.test.mjs` → `rows: 18 fail: 0`（§5.2）。矩阵侧逐点复现：§5.6 命令 1。讽刺点正是 `js/core/geom.js:3-6` 的警告：手抄表会让 `par` 变成"关于抄表人的声称" |
| 2 | **[已修]** `tools/proof.mjs` 在 `checkEncoding()` 里用了没 import 的 `rankTo8` | `js/core/cube.js` 确实导出了它，补进 import 列表即可。当时的后果值得记一笔：`ReferenceError` 退出，于是**它之后所有**对外锚点（编码互逆后半、群阶枚举、不可解态判定、启发可采纳、PDB 一致性）一条都没跑，而输出上看着像"前面都 ok" | `node tools/proof.mjs` → 35 行 ok / `ALL PROOFS PASS`（§5.4 原文里那四段现在都打了）。CI 里它有独立的 `proof` job——第一轮它哪儿都没跑 |
| 3 | **[已修]** `tools/proof.mjs` 的断言名叫 `all 144 words x x' y y' reduce to the solved cube`，代码构造的却是**换位子** `[a, b, a^1, b^1]` | 换位子在非交换群里一般不是单位元——本仓当时的 96/144 失败**正是**正确行为；`[a, a^1, b, b^1]`（注释与名字要的那个）实测 0/144 失败。该改的是那行的算式，不是引擎 | 现在表模型与物理模型各验一遍：`ok   all 144 words x x' y y' reduce to the solved cube  0 abstract / 0 physical failures`（§5.4）。两条对照命令留在 §5.6 命令 2。同类教训见 #1：**断言写错时红的是测试** |
| 4 | **[本仓真踩过的]** 09-27 第一次 bake：每带都有 `verify:scramble notation is not the scramble` 拒绝（`first` 2、`warm` 5、`spin` 6、`tangle` 22，共 35） | `make.js` 要求 `parseSeq(compactSeq(scr))` 逐索引等于 `scr`。`compactSeq` 只在**两个完全相同的转**相邻时折叠成 `F2`，而 `R2` 会被 `parseSeq` 读回成两个**顺时针** `R`——所以打乱串里出现 `R' R'` 时记号往返不再等于原串。正确做法是要么不折叠逆序对、要么在记号里写 `R'2`；修在生成侧 | 当前产物头注释的 `Rejections during this run: {"par-out-of-band":127}` 里**已经没有** verify 这一类；且 `test/library.test.mjs` 每行从 `parseSeq(scrText)` 重解（§5.2），记号一旦不闭合就红 |
| 5 | **[本仓真踩过的]** `js/data/` 在 09-27 核查时是**空目录**，`library.js:11` 因此解析失败 | `lots.js` 是**产物**且该入库（`.gitignore` 没排除它）。跑一次 `node tools/bake.mjs` 就补上，64 行齐、可 diff | 磁盘上 25,540 B / 64 行（§3）；`library.js` 的加载期结构复验在 node（`test/library.test.mjs` 第 9 行）与浏览器（`@boot`）两侧都跑 |
| 6 | **[风险类]** 把"生成包络"（带定义 4-6/7-9/10-11/**12-14**）与"本批落成"（`seen` 4-6/7-9/10-11/**12-13**）当同一个数 | 前者是允许范围、后者是 16 关实际量到什么；UI 与文档印的必须是后者，否则会出现"宣传 12-14、池子里没有 14"。par 14 的 6,624 个状态占全群 0.0075%，`walk 21/22` 撒不到是**预期**而不是 bug | `js/data/lots.js` 的 `TIERS_META` 两栏并排存着（`max` 与 `seen`）；`m.stats()` 打 `min/max/parMed`（§3）；`@boot` 有"四档关数加起来是 64"与"档位表里每档都写了 par 区间与占比"两行 |
| 7 | **[风险类]** 用商群距离 `q` 当 `par`（`orbit.js` 便宜一个量级：373 ms / 3.67 MB 对比 5,059 ms / 84.1 MB） | 本仓的胜利条件是**参考朝向**（`cube.isSolved`），把魔方转回去要花钱；`q` 只是下界。真拿 `q` 当 `par`，屏幕上会出现"3 步收回去"而玩家做不到 | `bake.mjs` 断言 `q ≤ par` 否则拒绝写；本批最大 `par − q = 2`（§4.3）；`@play` 的"按认证路线走完就是复原，转数等于 par"是玩家侧的同一件事 |
| 8 | **[风险类]** 把 IDA\* 的启发做成规格写的 h1+h2（单角块表 + 扭转赤字） | 实测它们分别 ≤ 3 与 ≤ 1..2，对真 par 11–13 的状态"可采纳但没用"，IDA\* 会漫游。本仓加第三项（五块 PDB，直径 10）并取 max，这是对规格的**明确偏离**而非漏抄 | `js/core/ida.js:20-26` 注释即此；`proof.mjs` 把它变成了实测：`measured: h1 never exceeds 3, h2 never exceeds 2, TWIST_STEP = 4`、`the pattern database's own diameter is 10 over 1632960 abstract states`、`h <= BFS par on every sampled cube  0 of 120 overestimated`（§5.4） |
| 9 | **[风险类]** 让玩家点击时现场求解（"这样偏离路线也能给数"） | 一次 par 13 的重解实测 1,441 ms（BFS，1.3 M 结点）/ 2,460 ms（IDA\*，334,675 结点）；无上限搜索放进前端就是契约 §5 禁的那件事 | `js/core/game.js:139` 偏离时返回 `off-route` 并拒绝给数（`@play`："偏离认证路线时提示明说，并继续计费"）；`js/main.js` 不 import `bfs/ida/fullsweep/pdb/make`——本次这条从"grep + 注释"升级成了**门禁**：`tools/check.mjs` 第 4 行算的是传递闭包（§5.3） |
| 10 | **[已修]** `store.reset()` 只清 localStorage、留内存缓存这件事当时**只有实现没有断言** | 陈旧缓存比不清档更糟：屏幕说清了、纪录还会回来。`js/core/storage.js` 的 `memory`/`cache` 必须一起换 | `test/storage.test.mjs` 的 D 组；`@save` 的"清空存档要两次点击，点完成绩归零"与"清空后存档键还在，写的是空表（不是把键删掉）"（§5.5） |
| 11 | **[已修]** 台架 `Page.navigate` 后固定 `sleep()`、结果 JSON `JSON.parse(整行)`，且轮询的钩子名是上一仓的 `window.gridlock` | 本地够用、线上不够：canvas 停在未样式的 300×150 会被读成三条假故障；headless 会在同一行后面追加文本；轮询错钩子则永远 `exit 5`。`verify.sh:94-107,:136-141` 改成双端点轮询 + `window.pocketcube`；`playtest.mjs` 的五个场景体整体重写成本仓原语；截 JSON 用 `raw_decode` 而不是手的花括号计数 | `bash tools/verify.sh` 的 90 行（§5.5）。第一轮的"截图与日志路径仍叫 `/tmp/gridlock-*`"也改掉（`TAG=pocketcube`，`verify.sh:25`） |
| 12 | **[已修，本次]** `#/cube/<公式>` 直接把壳弄崩 | `game.js` 无条件给 lot 建 `rank → 下一步` 的路线索引；自定义题没有 `route`，于是崩在解析路由那一步。`routeMap()` 现在**返回 null** 而不是造一个空 Map——空 Map 会被读成"在认证路线的终点"（`js/core/game.js:25-30`） | `@routes`："#/cube/<转记法> 开出自定义魔方：par 是空的"、"自定义魔方面板把 par 印成「未实测」"、"读不懂的乱序会明说，并且不换题"；node 侧 `fromScramble`（`library.js:89-105`）由 `test/library.test.mjs` 第 8 行验 |
| 13 | **[已修，本次]** `超出` 给**没有实测 par** 的题印一个真数 | `moves - null` 在 JS 里是 `moves`（`Number(null) === 0`），所以手打公式的题会得到"超出 6"这种凭空捏出来的数。`grade()`/`overPar()` 现在先看 `par == null`，返回 `unmeasured` 而不是数字（`js/core/game.js:156-168`） | `@routes`："没有实测 par 就没有「超出」这个数：面板只会说没有可对照"、"未实测的题不印星，只印「复原了」"；node 侧 `test/storage.test.mjs` 的 D5 行 |
| 14 | **[已修，本次]** 拖空白转镜头之后，画面不动 | 帧循环只在"有动画"时才重画，纯视角改动没有动画。`js/view.js` 的 `dirty` 标志（`:108`）由视角改动置位（`:417`），帧循环 `anim \|\| dirty \|\| hint` 才画（`:451`）。这条不只是好不好看：`picked`（下一次按下要命中测试的那组四边形）是在 `draw()` 里生成的，不重画就意味着**画面和命中区域分家** | `@pointer` 的"按住 shift 拖是转身看向魔方：画面动了，转数没动"与"转身之后第一下拖仍然落在它声称的那一面"；`@boot` 的"一次重画把 frames 推上去" |
| 15 | **[已修，本次]** 未实测的题能拿到 `perfect`，`turns: null` 能写进存档 | 两处都是 `Number(null) === 0`：`par == null` 的题会把自己判成完美（`0 <= 0`），`turns: null` 会变成 0 转的"成绩"并打败榜上所有纪录。`storage.js:111-117` 两条守卫分开写，`turns` 必须是**一个计数**而不是"恰好不是负数" | `test/storage.test.mjs` 的 B/C 组（`uint(null)` 那类边界）＋ D5；`@save` 的"提示有独立的账，不影响那一题的完美判定" |
| 16 | **[已修，本次]** `dragsFor()` 承诺"这四个方向都能按下去"，其中有些**按不下去** | `slideVector` 按贴纸算，但一次按下走的是命中测试：painter 顺序下 `picked` 从远到近生成、`stickerAt` 从后往前扫，于是**更近的贴纸可以盖住更远那个贴纸的质心**。台架照着承诺拖，页面提交的是另一个转——第一次复现是"提示 F、实际转了 L'"。修在产品侧：`dragFor()` 用指针自己那套 `stickerAt` 回读一次，给出 `pressable`/`under` 两个字段（`js/view.js:324-340`）；台架与 `dragRoute()` 都只接受 `pressable` 的拖法（`js/main.js:472`） | `@pointer`："它说是能按下去的拖法，指针落在那一点上读到的就是同一个贴纸"（对每个 `pressable` 拖法比 `pickAt(d.from.x, d.from.y)`）；node 侧 `test/view.test.mjs` 的 96 三元组落点行。实测：路线每一步都有 8 个候选、其中 ≥1 个 `pressable`，整条认证路线可拖完（"鼠标一拖一转，整条认证路线拖得完"） |
| 17 | **[已修，本次]** `tools/verify.sh` 引用了一个**磁盘上不存在**的门禁 `tools/check.mjs`，而且是 `if [ -f … ]` | 缺文件的门禁用 `if [ -f ]` 包起来，等于"这条永远通过"——它报绿的同时把仓里唯一那条硬架构规则（生成层不许进浏览器）说成有人守。**门禁存在性本身要红**：现在无条件执行（`verify.sh:119-125`），文件真没了就是 rc≠0 | `node tools/check.mjs` → `rows: 4 fail: 0`（§5.3）；CI `unit` job 的 `Layering` step；变异验证：给 `js/main.js` 加一行 `import './core/fullsweep.js'`，第 4 行立刻红 |
| 18 | **[风险类，本次]** 用 Node ESM 的 query 尾巴做 cache-busting（`import('../js/core/storage.js?fresh=A')`），一个"检查 import 是否落盘"的门禁会把它读成缺文件 | 那是同一份文件的第二个实例，测试要的就是"两次 import 互不串味"。`check.mjs` 解析 specifier 时先 `spec.split('?')[0]` 再 `resolve`，并把这条写进注释 | `tools/check.mjs` 第 1 行现在报 `27 sources: every relative import names a file that exists`（§5.3）。哪天有人"顺手"去掉那行 `split('?')`，这条立刻红 |
| 19 | **[已修，本次]** 端口与耗时两处**文档口径**：README 写"server 默认 5180""每关重解一次要花 30 秒"，`package.json` 的 `dev` 是 5190，`verify.sh`/`playtest.mjs` 又是 5180 | `server.cjs` 的默认值才是门禁值。实跑：默认端口 **5199**（`verify.sh:23`、`playtest.mjs:17`、`package.json` 的 `dev` 三处统一）；64 关全部用两个求解器重解实测 **7.6 s**（`test/library.test.mjs`），不是 30 s。同类的还有第一轮那句"浏览器断言 ≥ 35 未达成"——现在 90 条 | 端口有硬钉：`verify.sh:54-63` 端口被占就 `exit 6` 并打印 owner。耗时的钉就是 §5.2 那行 `rows: 9 fail: 0 (7.6 s)` |
| 20 | **[已修，本次]** 第一轮 §3 用 `grep -c '^  {' js/data/lots.js` 得到 64，并把它当"64 关"的证据 | 现在同一命令给 **68**：产物格式里 `TIERS_META` 的四行也是两个空格开头的 `{`。数量没错（关卡一直是 64），错的是**那条命令量的不是"关"** | 正确的两条：`grep -c '^  {"id":"cube-' js/data/lots.js` → `64`；`node -e 'import("./js/core/library.js").then(m=>console.log(m.ALL.length))'` → `64`（§3） |

---

## 3. 磁盘事实（本次核查，命令与输出对应）

| 声称 | 命令 | 实测 |
|---|---|---|
| `js/core/*` 不碰 DOM，故 `node` 能直接 import | `grep -rn "window\.\|document\." js/core/` | 3 行命中，全是 `js/core/storage.js:30,38,174` 的 `window.localStorage`，且都包在 `try {}` 里——契约 §1 明示的唯一豁免。这条现在是门禁：`tools/check.mjs` 第 2 行，`document.` / `getElementById` / `requestAnimationFrame` 在 core 里一律红 |
| 零依赖 | `node -e` 读 `package.json` | `dependencies {}`、`devDependencies {}` |
| 无 `node_modules` | `ls node_modules` | `No such file or directory` |
| 无二进制资产 | `find . -type f -not -name '*.md' -not -name '*.js' -not -name '*.mjs' -not -name '*.cjs' -not -name '*.css' -not -name '*.html' -not -name '*.json' -not -name '*.sh' -not -name '*.yml'` | 只剩 `./LICENSE`、`./.gitignore` |
| 前端不加载任何搜索器（含传递闭包） | `node tools/check.mjs` 第 4 行 | `ok   the page's own module graph (9 files) stays out of the build-time layer`；`grep -n "^import" js/main.js` → 6 条（`:9-14`：`core/cube`、`core/game`、`core/library`、`core/rng`、`core/storage`、`view`） |
| 关卡数据确实是产物 | `grep -c '^  {"id":"cube-' js/data/lots.js` | `64`（`grep -c '^  {'` 是 `68`，多 4 行 `TIERS_META`，见 §2#20） |
| 64 关的 id 连续且按档排序 | `node -e 'import("./js/core/library.js").then(m=>console.log(m.ALL.map(l=>l.par).join(",")))'` | `cube-01…cube-64`；par 序列 `6,4,6,4,5,…,12,12`（档内 4-6 / 7-9 / 10-11 / **12-13**） |
| `stats()` 打的是实测区间 | 同上的 `m.stats()` | `lots: 64`；`first 4-6 (parMed 5)`、`warm 7-9 (8)`、`spin 10-11 (10)`、`tangle 12-13 (12)` |
| `js/core` 里没有 `difficulty:'hard'` 这类字符串标签 | `grep -rn "'easy'\|'hard'\|difficulty" js/core` | 无命中；难度只有 `par` 数字与 `TIERS_META` 的实测 `min/max/med/share/rate` |
| 本仓当前不是 git 仓库（本报告写完后才 init） | `ls -d .git` | `No such file or directory` |
| 磁盘文件总数 | `find . -type f -not -path './.git/*' \| wc -l` | `40`（其中 js/mjs/cjs/css/html `31`） |

---

## 4. 数字从哪来（一条命令复现那张表）

### 4.1 `node tools/bake.mjs` —— 09-27 实跑，原样粘贴

本文件引 bake 时引的是**09-27 那一次的实录**（产物 09-27 17:32 落盘，本次没有重烘）；
产物侧的结构量在本次由 `test/library.test.mjs` 逐行复算过（§5.2），那才是本次的数字。

**09-27 第一次**（当时 `js/data/lots.js` 不存在；此后 `make.js`/`bake.mjs` 被并发改写）：

```
$ node tools/bake.mjs
  diameter 14, antipodes 6624, wall 4906 ms (transition tables 155 ms), distance array 84.1 MB, rss now 139 MB
  all 15 per-distance counts match OEIS A080630, and they sum to 88179840
  quotient sweep for comparison: 3674160 orbits, diameter 14, 368 ms, 4 MB (a lower bound on par…)
  first   par 4-6  0.279% of all cubes  walk 5/6 turns
  warm    par 7-9  13.863% of all cubes  walk 9/10 turns
  spin    par 10-11 62.094% of all cubes  walk 13/14 turns
  tangle  par 12-14 23.763% of all cubes  walk 21/22 turns
  tried 24  accepted 16  rate 66.667% … rejections: {"par-out-of-band":6,"verify:scramble notation is not the scramble":2}
  tried 40  accepted 16  rate 40.000% … rejections: {"par-out-of-band":19,"verify:scramble notation is not the scramble":5}
  tried 77  accepted 16  rate 20.779% … rejections: {"par-out-of-band":55,"verify:scramble notation is not the scramble":6}
  tried 240 accepted 16  rate  6.667% … rejections: {"par-out-of-band":202,"verify:scramble notation is not the scramble":22}
  all 64 cubes confirmed by searches that never read the table
wrote …/js/data/lots.js (25246 bytes, 64 cubes) in 28280 ms, rss 312 MB
  rejections across the run: {"par-out-of-band":282,"verify:scramble notation is not the scramble":35}
```

**磁盘上现在那份产物**自带的实录（`head -30 js/data/lots.js`）：

```
// Diameter 14 in QTM, with 6624 cubes at the very top. Sweep cost 5059 ms
// and 84.1 MB of distance array; the whole bake took 29602 ms.
Rejections during this run: {"par-out-of-band":127}
```

逐项读出交付要求的那几栏（两栏都读，因为它们是两次运行）：

| 要报的 | 第一次（09-27 上午那次） | 磁盘产物（当前） | 出处 |
|---|---|---|---|
| 题数 | 64（四档各 16） | 64 | `wrote … (…, 64 cubes)` / `grep -c '^  {"id":"cube-'` |
| 全群规模与直径 | `88,179,840`；直径 14；antipodes 6,624 | 同 | `diameter 14, antipodes 6624` 行 + `BAKE.order/diameter/antipodes` |
| 外部对账 | 15 行逐距离计数 === A080630，合计 88,179,840 | 同 | `all 15 per-distance counts match…`（对不上则 `exit 1`） |
| 每档 par 范围（带定义） | 4-6 / 7-9 / 10-11 / 12-14 | 同 | `== band shares ==` 段 |
| 每档 par 范围（本批落成） | 4-6 / 7-9 / 10-11 / 12-13 | 同 | `TIERS_META.seen`、`library.stats()` |
| 每档占全群 | 0.279% / 13.863% / 62.094% / 23.763% | 同 | `== band shares ==` |
| 接受率与尝试数 | 66.667%(24) / 40.000%(40) / 20.779%(77) / 6.667%(240) | **72.73%(22) / 51.61%(31) / 25.81%(62) / 21.05%(76)** | 各带 `tried/accepted/rate` 行、`TIERS_META.tried/rate` |
| 拒绝原因计数 | `{par-out-of-band:282, verify:scramble…:35}` | `{par-out-of-band:127}` | `rejections across the run:` 行、`BAKE.rejected` |
| 出题耗时（oracle 查表） | mean 0.000–0.125 ms/候选 | `meanOracleMs` 0.1818 / 0.0323 / 0.0161 / 0.0263 | 各带 `oracle ms mean`、`TIERS_META.meanOracleMs` |
| 每关重解耗时 | 中位 0/3/50/427 ms，最慢 1,924 ms | `checkMedMs` 0/3/50/**419**，`checkMaxMs` 2/29/217/**2460** | 每行 `check[].ms`；本次独立复算：64 关合计 7.6 s（§5.2） |
| 最大搜索状态数（重解侧） | BFS 1,300,224（par 13） | BFS 1,300,224 / IDA 334,675 | 每行 `check[].states`；`proof.mjs` 的 300 题段同数量级（§5.4） |
| 全群扫描内存 | 84.1 MB 距离数组 + 转移表，peak rss 312 MB | 84.1 MB | `distance array 84.1 MB`、`rss` 行 |
| 复现命令 | `node tools/bake.mjs`（可选 `--per= --only= --strategy= --dry-run`） | — | — |

**这条命令会写文件，所以必须验幂等**：09-27 那两次（第一轮会话一次 + 并发进程一次）的结构量逐位相同
（88,179,840 / 14 / 6,624 / 15 行直方图 / 四档区间 / 四个占比），变的只有 `built/ms/rate/tried`——
因为那一次的 `make.js` 已修掉 #4 那条往返不匹配，接受率因此上升。
所以本文件引结构量时它们是**逐位可复现**的，引 `ms/rate/tried` 时它们是**一次运行的观察**，
两种口径在上表里分行写着，没有并列成同一栏。

### 4.2 `tools/survey.mjs` —— **未跑**，因此本文件不引它的抽样数字

四档边界的四个占比是从**穷尽扫描**读到的（`== band shares ==`），不是从 5000 题样本估计的；
`survey.mjs` 的作用是在烘焙之前独立地看到同一件事（成本：5000 次双向 BFS，分钟级 CPU，`--workers=4` 可分片）。
它不进 CI（`DESIGN.md` §3 引用的是 bake 的实扫段）。

### 4.3 本次独立跑的复算

契约 §3 要的"从序列化之后的数据重新解一遍，必须复现印着的数字"，本次**不是一次性 `node -e`**，
而是套件里的一行（所以它在 CI 里）：

```
$ node test/library.test.mjs
  ok   the pool that imports is the pool the shell plays
  ok   the four bands are the printed bands, and every cube sits inside its own
  ok   every shipped par survives a re-solve by the reference solver
  …
rows: 9 fail: 0        # 7.6 s
```

输入只是那串打乱记号（`"L' D2 R' U F'"` 这种），不是 `par` 字段本身；两个求解器（双向 BFS、IDA\*+PDB）
都要等于印着的 `par`，解串回放必须回到已解态。

第一轮用一次性 `node -e` 读到、本次由 `proof.mjs` 以**在 CI 里的形式**重新量到的三件（§5.4 原文）：

```
  ok   8! x 3^7 = 88,179,840  88179840
  ok   descriptions = 8! x 3^8 = 264,539,520  264539520      # 枚举 40320 x 6561，0.2 s
  ok   satisfying the invariant = 8! x 3^7 = 88,179,840  88179840
  ok   2000 sampled ranks all decode to admitted cubes  2000
  ok   2000 deliberately twisted cubes all fail the criterion  2000
```

本次仍是**一次性观察**、没有进任何套件的三件（引的时候请按"一次运行的观察"读）：

```
groupStats: reached 88179840, diameter 14, antipodes 6624, ms 4982, bytes 88179840   # 09-27
orbitStats: orbits 3674160, diameter 14, antipodes 276, ms 372, bytes 3674160        # 09-27
max(par - q) over the 64 shipped rows = 2   (cube-02 4/2, cube-09 5/3, cube-18 7/5)
pool par histogram {4:6, 5:5, 6:5, 7:7, 8:7, 9:2, 10:14, 11:2, 12:15, 13:1}
```

确定性那件本次由套件覆盖（`test/library.test.mjs` 的 `daily and random pick from the table by seed
alone, so a link is reproducible`）。还有一句关于 `hashSeed` 的**诚实**描述值得留着：它是
**FNV-1a 派生的两轮混合**（每个 UTF-16 code unit 先异或低字节、乘 prime，再异或高字节、再乘一次，
`js/core/rng.js:4-13`），实测 `hashSeed('a') = 723832900`，而教科书 FNV-1a 是 `3826002220`——
两者**应当**不等，"应等于 3826002220"从来不是本仓的断言，`DESIGN.md` §9 同口径。

---

## 5. 验收结论（真跑出来的输出行）

本机：arm64 / macOS 25.6.0 / Chrome 154。以下每一条都是 **2026-09-28 实跑**后原样粘贴。

### 5.1 `npm run check`

```
$ npm run check

> pocket-cube@1.0.0 check
> for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" || exit 1; done && echo OK

OK
rc=0
```

### 5.2 `bash tools/verify.sh` 的前半：5 个 node 套件，56 行

```
=== node suites ===
--- test/game.test.mjs
rows: 10 fail: 0
--- test/geom.test.mjs
rows: 18 fail: 0
--- test/library.test.mjs
rows: 9 fail: 0            # 7.6 s：64 关全部用两个求解器从 scrText 重解
--- test/storage.test.mjs
rows: 14 fail: 0
--- test/view.test.mjs
rows: 5 fail: 0
--- tools/check.mjs
rows: 4 fail: 0
```

（`npm run unit` 是同一个循环**减去** `tools/check.mjs`，rc=0；那条在 §5.3 单列。）
`rows: N` 是 `tools/harness.mjs` 的**断言组**数（一组内第一条 `eq` 失败即整组红并停止）；
`node --test` 的 `ℹ tests` 数的是**文件**。第一轮把这两个口径混过一次，本文件只用前者。
按"5 个套件 56 行 + 4 行分层门"这一事实，**契约 §3 的 node 层 ≥ 35 条达成**（第一轮是 18 条且 1 条红）。

### 5.3 `node tools/check.mjs` —— 本次新增的分层门

```
  ok   27 sources: every relative import names a file that exists
  ok   no js/core module reaches for the DOM (js/core/storage.js excepted, and only for localStorage)
  ok   nothing in js/core imports js/main.js or js/view.js
  ok   the page's own module graph (9 files) stays out of the build-time layer
rows: 4 fail: 0
```

四条都做过**变异验证**（否则"绿"只是"还没试过"）：

| 钉 | 怎么把它弄红 | 结果 |
|---|---|---|
| 1 | 把一个被 import 的文件改名 | 第 1 行列出该 specifier 并红 |
| 2 | 往 `js/core/game.js` 里写 `document.body` | 第 2 行红（`requestAnimationFrame`/`getElementById` 同样拒） |
| 3 | 让 `js/core/library.js` import `../view.js` | 第 3 行红 |
| 4 | 往 `js/main.js` 加 `import './core/fullsweep.js'` | 第 4 行红（闭包算出来的，绕开直接 import 也躲不掉） |

第 4 条值得单说：第一版写的是"grep 壳文件里有没有 `bfs.js`/`ida.js` 这类字样"，那基本是**重言式**
（而且被文件名的子串骗过一次——`lots` 里有 `ots`）。现在的写法是从 `js/main.js` 出发算**传递闭包**，
落在白名单 `{cube, game, library, rng, storage, geom, data/lots, main, view}` 之外的一律红。

### 5.4 `node tools/proof.mjs` —— 数学层，本次实跑（35 行 ok / 0 FAIL）

```
== move tables (12 quarter turns, derived in js/core/geom.js) ==
  ok   twelve moves, U U' D D' R R' L L' F F' B B'  U U' D D' R R' L L' F F' B B'
  ok   every turn is a bijection on the eight slots
  ok   every turn is a single 4-cycle of the layer it moves
  ok   every turn's twist deltas sum to 0 (mod 3)
  ok   inverse is an involution and matches the face convention  U->1 U'->0
  ok   cube.js and geom.js read the same table object

== the twist invariant, exhaustively ==
  ok   12 x 6561 twist vectors: sum(twist) mod 3 unchanged by every turn  0 violations
  ok   400 x 20-turn walks stay legal cubes  0 broken

== table model vs physical sticker model ==
  ok   300 random words: (perm, twist) equals the physical projection  0 mismatches
  ok   every cube shows exactly four stickers of each face
  ok   all 144 words x x' y y' reduce to the solved cube  0 abstract / 0 physical failures

== encode / decode ==
  ok   decode then encode is the identity, first 4000 and last 2186 ranks  0 broken
  ok   4000 uniform cubes round-trip through both codes  0 broken
  ok   rank 0 is the solved cube
  ok   8! x 3^7 = 88,179,840  88179840
  ok   the abstract space is exactly three times as big  264539520
  ok   permRank/permUnrank on a fixed example
  ok   a twist pair summing to 3 encodes and decodes  1

== group order, by enumeration ==
  enumerated 40320 x 6561 = 264539520 descriptions in 0.2s
  ok   descriptions = 8! x 3^8 = 264,539,520  264539520
  ok   admitted twist vectors = 3^7 = 2187 per permutation  2187
  ok   satisfying the invariant = 8! x 3^7 = 88,179,840  88179840
  ok   2000 sampled ranks all decode to admitted cubes  2000
  ok   2000 deliberately twisted cubes all fail the criterion  2000

== the two solvers, on 300 uniform cubes ==
  ok   both solvers answered all 300  300 answered
  ok   bfs par === ida par on every one  0 disagreements
  ok   both solutions replay to the solved cube  0 broken
  deepest par in the sample 13; max BFS search states 1300224; bfs 215ms mean, ida 325ms mean; total 162.1s

== cubes that cannot be solved ==
  ok   200 invariant-breaking cubes: neither solver returns a solution  0 false solutions
  ok   and IDA* names the reason (twist invariant)  200 refusals
  ok   <U,U'> component: a cube inside it is found  {"ok":true,"moves":1,"path":[1],"explored":4,"exhausted":false,"truncated":false}
  ok   <U,U'> component: a cube outside it exhausts both frontiers  {"ok":false,"moves":-1,"path":[],"explored":8,"exhausted":true,"truncated":false}

== the IDA* heuristic, against the reference solver ==
  measured: h1 never exceeds 3, h2 never exceeds 2, TWIST_STEP = 4
  measured: the pattern database's own diameter is 10 over 1632960 abstract states
  ok   h1 and h2 alone cannot guide a 2x2x2 search (both bound below 5)
  ok   the pattern database is what makes IDA* usable
  ok   every abstract state is reachable in the pattern  0 holes
  ok   1-Lipschitz along all 19595520 abstract edges (consistency)  0 violations
  abstract sweep 0.8s
  ok   h <= BFS par on every sampled cube  0 of 120 overestimated
  admissibility sweep on 120 cubes 27.4s

ALL PROOFS PASS
diameter: 未实测 — run `FULL=1 node tools/proof.mjs` to measure it
real 233.27
user 233.03
sys 3.22
rc=0
```

耗时**本次 233 s**（同日另一次 214 s、`/usr/bin/time -l` 量到峰值 410 MB）；中间那段 300 题双求解器
自己报了 `total 162.1s`，所以这条命令的成本几乎全在搜索上，随负载浮动是正常的——引它时给区间，
不要给一个"标准值"。

第一轮这份输出是 `11 ok / 1 FAIL / ReferenceError`，`FAIL` 与崩溃**都在 harness 一侧**（§2#2、#3），
它后面那五段一条都没跑到，所以第一轮的 §6 才能写出"这些数字本文件不引用"。现在都能引用了。

### 5.5 `bash tools/verify.sh` —— 整条门，本次实跑 rc=0

```
=== node suites ===
--- test/game.test.mjs … rows: 10 fail: 0
--- test/geom.test.mjs … rows: 18 fail: 0
--- test/library.test.mjs … rows: 9 fail: 0
--- test/storage.test.mjs … rows: 14 fail: 0
--- test/view.test.mjs … rows: 5 fail: 0
--- tools/check.mjs … rows: 4 fail: 0
opened http://127.0.0.1:5199/
(no console output)
boot lot: cube-01
=== @boot ===
rows: 17 fail: 0
=== @play ===
rows: 17 fail: 0
=== @routes ===
rows: 23 fail: 0
=== @save ===
rows: 14 fail: 0
=== @pointer ===
rows: 19 fail: 0
=== console (must be empty of errors) ===
(none)
chrome exited
=== ALL GREEN ===
real 25.74
rc=0
```

同一台机器、同一份代码重复跑，**node 层 60 行 + 浏览器层 90 行 = 150 行、0 失败每一次都成立**；
墙钟在 **25–29 s** 之间（逐次记过 `25.74` / `25.03` / `26.35` / `27.01` / `28.27` / `28.83`——
给范围而不是给次数，因为再多跑一次只会多一个数，而"跑一次大概多久"这件事靠范围才站得住）。
其中 `26.35` 与 `27.01` 两次是在 commit 之后、push 之前对着**入库的那棵树**跑的，
分别属于 `a3f3e27` 与 `5b43c6b`（§5.7），其余是改文档过程中在工作树上跑的；
浏览器层单独跑（`SKIP_UNIT=1 bash tools/verify.sh`，也就是 CI `browser` job 的命令）
本机 `real 16.81` 与 `17.39`，两次都是 `rc=0`、90 行 0 失败。

这一层在本次之前**是红的，而且红在产品代码上**，不是红在台架上：§2#12–#16 那五条
（`#/cube/` 崩壳、`超出` 给未实测的题印真数、转镜头不重绘、未实测题能拿 `perfect`／`turns: null` 能入库、
`dragsFor` 承诺了按不下去的拖法）修完之前，`@play`/`@pointer`/`@routes` 都过不去。
本次**没有放宽、跳过或"重设期望值"任何一条断言**：每条红都是先复现、再判责在哪一侧、然后改那一侧。

`@pointer` 的 19 行为什么必须用真鼠标（而不是直接调函数）：命中测试、`DRAG_THRESHOLD = 16`、
动画终帧、`localStorage` 全都躲在 `window.pocketcube` 后面。其中
"按下就松开、不走距离，不算一转"与"八像素的抖动在阈值之下，照样不算一转"两条是 par 有意义的前提——
一次滑动如果被读成三次转，认证路线的长度当场失去含义。modifier 位不是猜的：
`tools/modifiers.mjs` 在本机 Chrome 上量出 alt=1 / ctrl=2 / meta=4 / shift=8。

### 5.6 一次性核查命令（可原样复现 §2#1、#3 的两行）

```bash
# 1) 引擎的 L 到底是哪个方向（对照 rotationMatrix 与手抄表）—— 本次与 test/geom.test.mjs:300 一致
node -e 'import("./js/core/geom.js").then(G=>{const {MOVES,SLOT_COORD,dot}=G;
 const c=[2,6,4,0]; const m=MOVES[MOVES.map(x=>x.name).indexOf("L")];
 const M=G.rotationMatrix(m.normal,-1);
 const idx=v=>SLOT_COORD.findIndex(q=>q.join()===v.join());
 const img=s=>idx([dot(M[0],SLOT_COORD[s]),dot(M[1],SLOT_COORD[s]),dot(M[2],SLOT_COORD[s])]);
 console.log("hand cycle",c.join(","),"| engine successors",c.map(s=>m.to[s]).join(","),
   "| rodrigues successors",c.map(img).join(","));})'
#    → hand cycle 2,6,4,0 | engine successors 6,4,0,2 | rodrigues successors 6,4,0,2
#      后两列是"每个角块顺转之后的下一个角块"，与手抄循环 2→6→4→0→2 逐项相同；
#      第一轮那次同样两列也是相等的，只是手抄列写成了 2,0,4,6（§2#1）

# 2) proof.mjs 那条断言的两种写法差多少（换位子 vs x x' y y'）
node -e '…for a,b in 0..11: [a,b,a^1,b^1] 与 [a,a^1,b,b^1] 是否回到已解…'
#    → commutator [a,b,a⁻¹,b⁻¹] not solved: 96 /144 ;  x x' y y' not solved: 0 /144

# 3) 分层门的变异（临时改一下、跑、撤回来）
node tools/check.mjs
```

### 5.7 推上去之后：远端 CI 的日志原文 + 对着线上再跑一遍浏览器层

提交历史分两类：**含代码的那一次是 `a3f3e27`**（author 与 committer 都是
`z-biz-game <bot@z-biz-game.dev>`，per-repo 配置），之后是只改文档的提交（改 `README.md` 与本节，
**不碰任何 `js/`、`css/`、`test/`、`tools/`、`index.html`**）。建远端 → 开 Pages
（`build_type: workflow`）→ 推送 → 三层复验。每次推送前都对着**入库的那棵树**跑过整条门：
`a3f3e27` 那次 `real 26.35`、`5b43c6b` 那次 `real 27.01`，两次都是 rc=0、150 行 0 失败
（数字在 §5.5 那组墙钟里）。远端两个 workflow 都绿，且**引的是各自日志里打印的数字**，
不是徽标：

```
CI run 36382218027  (head_sha a3f3e274…)
  unit    => completed/success   steps: Syntax ✓ / Suites ✓ / Layering ✓
          rows: 10 fail: 0   rows: 18 fail: 0   rows: 9 fail: 0
          rows: 14 fail: 0   rows:  5 fail: 0   rows: 4 fail: 0
  proof   => completed/success   「ALL PROOFS PASS」＋「diameter: 未实测 — run FULL=1 …」
  browser => completed/success
          rows: 17 fail: 0   rows: 17 fail: 0   rows: 23 fail: 0
          rows: 14 fail: 0   rows: 19 fail: 0   === ALL GREEN === → chrome exited
Deploy to GitHub Pages run 36382218075 => completed/success
```

`unit` 里那 6 行 `rows:` 是 5 个套件 + `Layering` step 的 `tools/check.mjs`（本次新增的那一步），
`browser` 的 5 行是 `@boot/@play/@routes/@save/@pointer` —— 与 §5.2/§5.5 本机的数字逐行相同，
差别只在平台（Linux runner / node 22 vs 本机 arm64 / node 26）。

**下表引的是代码所在那次提交（`a3f3e27`）的 run**，因为被验的东西只可能是代码。之后那些只改本文档的
提交同样各有自己的 run，也都在 push 之后当场读过日志——点名可查的是 `5b43c6b` 那次
（run `36383177273`）：`unit` 的 6 行 `rows:`、`proof` 的 35 行 `ok` + `ALL PROOFS PASS`、
`browser` 的 5 行 `rows:` + `=== ALL GREEN ===` 逐行与上表相同，对着线上的浏览器层重跑是
`real 19.72`、90 行 0 失败、逐文件 200 且字节数与磁盘同名文件全等（11 个文件：3,135 / 6,335 /
17,889 / 19,207 / 9,399 / 7,723 / 5,431 / 1,523 / 6,048 / 11,580 / 25,540 B）。
文档提交不改动任何被门禁消费的文件，所以这里不会出现新的数字分布，只有墙钟的抖动；
本节因此**不追记**后面每一次文档 run 的 id——它们各自都在 push 时当场读过日志，账上记的是
代码那一次的数字。

线上复验（第三层，`SKIP_UNIT=1 BASE_URL=https://z-biz-game.github.io/z-biz-game-pocket-cube-cos/ bash tools/verify.sh`）：

```
opened https://z-biz-game.github.io/z-biz-game-pocket-cube-cos/
(no console output)
boot lot: cube-01
=== @boot ===     rows: 17 fail: 0
=== @play ===     rows: 17 fail: 0
=== @routes ===   rows: 23 fail: 0
=== @save ===     rows: 14 fail: 0
=== @pointer ===  rows: 19 fail: 0
=== console (must be empty of errors) ===
(none)
chrome exited
=== ALL GREEN ===
real 19.41
rc=0
```

驱动的是**线上那份页面**（不是本地服务器）：台架用 `BASE_URL` 覆盖默认地址，Chrome 还是本机那个
（devtools 9359），所以这一层量的是"Pages 上那份静态文件的闭包能不能真的玩通"。
逐文件也核过 200 与字节数（`/` 3,135 B、`css/game.css` 6,335 B、`js/main.js` 17,889 B、
`js/view.js` 19,207 B、`js/core/{cube,game,library,rng,storage,geom}.js` 9,399/7,723/5,431/1,523/6,048/11,580 B、
`js/data/lots.js` 25,540 B）—— 每个都与本机磁盘上的同名文件同尺寸。

---

## 6. 未实现清单（诚实列）

按"缺什么"排序，不是"做完了什么"的换种说法。第 1–2 条是**门禁层面的缺口**（不是红灯，
是有东西没被任何断言看住），第 3–9 条是**边界**。本次没有为了让某条好看而删掉任何一条。

1. **`tools/survey.mjs` 与 `FULL=1 node tools/proof.mjs` 不在 CI 里，本次也没跑。** 前者的四档占比
   已经有穷尽扫描那份证据（§4.1）；后者是全群直径的另一种证法（直径 14 已经由 `fullsweep.js` 每次
   bake 实扫 + A080630 对账钉住，`proof.mjs` 末尾那句 `diameter: 未实测` 就是这个意思）。
   不进 CI 的理由是成本：`proof.mjs` 普通模式已 214–233 s / 410 MB，`FULL=1` 是分钟到小时级 CPU 与数百 MB。
2. **`test/` 仍缺 3 个注释点名的套件**：`fullsweep` / `orbit` / `make`
   （`grep -rho "test/[a-z]*\.test\.mjs" js tools` 可复现名单）。直接后果：`orbit.js` 的商群扫描与
   `make.js` 的候选生成只有**构建期**的自洽门在守（`bake` 会拒绝不合格的行），没有能在 CI 里单独跑的红/绿
   断言；`compactSeq` 也没有独立测试（它现在被 `verifyLot` 与 `test/library.test.mjs` 两侧夹住）。
   契约 §3 的两条数量门已经越过（node 60 / browser 90，都 ≥ 35），所以这不是阻断项。
3. **Electron 壳从未真实启动**。只有 `node --check electron/main.cjs` 过语法；仓内不装 electron。
   契约 §1 要求它复用 `server.cjs` + `port: 0`，**运行性未验证**。
4. **移动端未真机验证**。`css/game.css` 的断点写了，台架派发的是鼠标事件（`Input.dispatchMouseEvent`），
   没有派发过 `Input.dispatchTouchEvent`；魔方是拖动玩法，触屏才是主路径，这条比其他仓更要紧。
5. **`pressable` 是诚实口径，不是完备口径**（§2#16 的另一面）。`dragsFor(slot, k)` 给四个方向，
   被更近贴纸压住的那些带 `pressable: false`；台架与 `dragRoute()` 都只走 `pressable` 的那几个。
   也就是说"这一拖按下去是同一张贴纸"被验过了，"每个贴纸的每个方向都必须可按"
   **不是**本仓的主张（投影 + painter 顺序的固有性质，`DESIGN.md` §7.3/§9 同口径）。
6. **Actions 已经跑过了**（不再是"本机没执行过"）：`unit` / `proof` / `browser` 三条 job 与
   `Deploy to GitHub Pages` 都在 `a3f3e27` 上绿，日志里自己打的数字见 §5.7。
   留在账上的差异只有一条：runner 是 **node 22 / Linux**，本机是 **node 26 / arm64**——
   两侧的 `rows:` 数字逐行相同，但本机上没有 node 22 可用来把 §5.2–§5.5 在 22 下重跑一遍，
   所以"两个 node 版本之间没有行为差异"目前是**观察**，不是被验过的断言。
7. **Pages 已经上线并且是对着线上地址复验的**（§5.7：90 行 0 失败、逐文件 200 且字节数与磁盘同名文件相同）。
   没验的是两件事：`js/data/lots.js` 之类**改完之后**的 CDN 缓存失效路径（Pages 的 max-age 由它自己定，
   换 nonce 才能确定性地让玩家拿到新表），以及 Pages 的构建失败会不会让线上留**上一个版本**
   （会——那意味着"远端 CI 绿"和"线上是这一版"是两件事，§5.7 的逐文件字节核对就是为这个）。
8. **存档只有一个键**：`SAVE_KEY = 'pocketcube.save.v1'`，没有迁移逻辑（v1 之前没有版本，所以没东西可迁）。
   下次改记录结构时必须**换键名**并在读侧兼容旧键，否则 `@save` 那 14 行会替玩家把旧档读成新档形状。
9. **运营功能按禁令一律没做**：无成就 / 排行榜 / 签到 / 云存档 / 分享战绩、无音效彩带、无网络请求、
   无图片字体资源；`#/cube/<公式>` 分享**故意不带 par**（`library.js:89-105`：没测过的数不印，
   §2#13 就是这条的代码侧后果）。这不是缺口，是契约 §5 的边界，列在这里为了让接手的人别误以为"漏了"。
