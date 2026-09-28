# 魔方袖珍 · POCKET CUBE

把一个 2×2×2 魔方在**最少季度转（QTM）**里收回去。二阶魔方的浏览器实现，它和"随手扭着玩"的关键区别只有一条：
**屏幕上印的每一个 `par` 都是引擎在魔方自己的完整状态群上量出来的最短转数**——
`8! × 3⁷ = 88,179,840` 个可解状态，构建期一次广度优先扫描全部走完，一个状态一字节。

二阶是**唯一一种"最少转数"是一条定理而不是一个估值**的魔方尺寸：状态群阶可以写成
`8! · 3⁷`（八个角块的全排列 × 前七个角的扭转，第八个被"扭转之和 ≡ 0 (mod 3)"钉死），
可达当且仅当这条判据成立。所以 `par` 不是启发式的下界、不是"我们没找到更短的"，是穷尽之后的事实。

- **谁算了屏幕上的每个数字**：`js/core/cube.js` 是唯一存放规则的地方（状态 = `(perm, twist)`、判据、QTM 转表）；
  `js/core/geom.js` 不从记忆里抄转块表，而是用 3×3 整数旋转矩阵作用在八个角坐标上**推出**十二个季度转；
  `js/core/fullsweep.js` 用这张表把 88,179,840 个状态全扫一遍，产出距离数组与逐层直方图。
  面板上的 `par / 超出 / 还有 N 步`、提示给出的那一转、通关卡上的星级，读的都是这次扫描的结果。
- **搜索器不给自己打分，有两条外部证据**：
  ① 扫描出的**逐距离直方图**与这个仓没有写过的公开表逐行相同——OEIS A080630
  （"number of positions that are exactly n moves from the start"，半转算两步）：
  `1, 12, 114, 924, 6539, 39528, 199926, 806136, 2761740, 8656152, 22334112, 32420448, 18780864, 2166720, 6624`，
  合计 `88,179,840`，直径 **14**，顶上 **6,624** 个状态。直方图对不上，`tools/bake.mjs` 直接拒绝写文件。
  ② 每个入库魔方都用**两个没见过这张表的求解器**从打乱公式独立重解一遍：
  `js/core/bfs.js`（双向 BFS，参考实现）与 `js/core/ida.js`（IDA\*，启发函数来自五块 pattern database），
  两个数都必须等于印着的 `par`，且解串回放后真的回到已解态，否则构建失败。
- **一关能不能存在，由"从序列化之后重新解一遍"决定**：`js/data/lots.js` 里每行都带
  `check: [{solver:'bfs'…},{solver:'ida'…}]`，是构建期对这一行**打乱串本身**重解的实录；
  `node tools/bake.mjs` 每次都会把 64 行全部重解一遍再落盘。
- 零依赖、零美术、零打包器：只有 `index.html` + `css/` + `js/`，画面是自己写投影画的 8 个立方体，没有 three.js。
- 64 关已烘焙：四档 par 区间 `4-6 / 7-9 / 10-11 / 12-14`，**边界是从全群直方图上量的**，不是拍脑袋。
- 战役 / 每日 / 随机 / 分享链接四种入口，同一个 id 或同一个 token 在任何设备上是同一个魔方；
  `#/cube/<打乱公式>` 也能玩，但它**印"未实测"**——前端不许搜索。
- 本地存档（localStorage），无账号、无网络请求、可离线。

## 跑起来

```bash
node server.cjs            # http://127.0.0.1:5199/
npm run check              # node --check 全量（js / tools / test / server / electron）
npm run unit               # 五个 test/*.test.mjs 各跑一遍（56 行；整层 60 行含 tools/check.mjs）
node tools/check.mjs       # 分层门：import 落盘、core 不碰 DOM、core 不 import 壳、页面闭包不碰构建期层
bash tools/verify.sh       # node 套件 + 分层门 + headless Chrome 五个场景（一层 16.8 s）
node tools/proof.mjs       # 对外锚点：转表双射/判据穷举/编码互逆/启发可采纳（实测 214–233 s、410 MB）
node tools/bake.mjs        # 重扫全群 → 出题 → 逐关独立重解 → 写 js/data/lots.js（上次实录 29.6 s）
node tools/survey.mjs      # 决定四档边界的量具：5000 题 par 直方图 + 各带接受率（分钟级 CPU）
npx electron .             # 桌面壳（需自行 npm i -D electron，本仓不装）
```

`server.cjs` 是零依赖静态服务器（默认端口 **5199**，`npm run dev` 显式传同一个端口），存在的唯一理由是
ES module 需要一个 origin，`file://` 会被 CORS 挡掉。5199 不是随手选的：`tools/verify.sh` 的 web/devtools
端口必须与同系列其它仓错开，撞上别人的 Chrome 就是一次假绿。

## 玩

- 画面上是一个 2×2×2，能看清三个面。**在某个可见面上按下、沿该面的边方向拖**，越过 16 css px 就提交一次 90° 转
  （一次拖动 = 一次转，不连转）；反向拖 = 反向转。
- **拖动视角不算一步**：在空白处拖只改 yaw/pitch（观察），状态与转数都不动。
- 目标：把六个面各自回到单一颜色（`js/core/cube.js` 的 `isSolved` 要求**参考朝向**，
  整体旋转不是"免费的一步"，这一点决定了 `par` 的数字，见 DESIGN.md 第 1.2 节）。
- 面板实时印 `转数 / par / 超出 / 最佳`；`还有 N 步` 由提示给出。
- 提示（`h`）只念**烘焙好的认证路线**：位置在路线上时给下一转，偏离时明确说"已偏离认证路线，浏览器端不搜索"，
  而不是现编一个数字。撤销 `u`、重开 `r`。
- 打平 `par` = ★★★「一手不差」；超出 1–3 转 = ★★「干净收口」；更多 = ★「绕了一圈」。
  星级只对着量出来的 `par` 算。

## 这张表是谁算的

```bash
node tools/bake.mjs        # 下面每一行都是它的输出
```

| 档 | 关卡数 | 最少转数（实测区间） | par 中位 | 占全群比例 | 生成时试了/收了 |
|---|---|---|---|---|---|
| 起手 first | 16 | 4–6 | 5 | 0.28% | 22 / 16（72.73%） |
| 热身 warm | 16 | 7–9 | 8 | 13.86% | 31 / 16（51.61%） |
| 上手 spin | 16 | 10–11 | 10 | 62.09% | 62 / 16（25.81%） |
| 缠绕 tangle | 16 | 12–14（本批落成 12–13） | 12 | 23.76% | 76 / 16（21.05%） |

区间不是"感觉上 4–6 算简单"，而是**全群 88,179,840 个状态的 par 直方图**切出来的四段：
par 落在 10–11 的状态占 **62.09%**，落在 4–6 的只占 **0.28%**（247,044 个里的样子货）。
随机撒一个均匀状态几乎必然落在 10–11，所以低档必须靠"从已解态走 k 步"来造——
`js/core/make.js` 的 `walk` 策略与每档的 `walk: [k, k+1]` 都是 `tools/survey.mjs` 量出来的结果，
成对长度是因为十二转图是**二分图**：走 k 步只能落在与 k 同奇偶的 par 上，固定一个 k 永远拿不到奇数档。

状态空间这一头同样是量出来的（同一条命令的 `== sweep ==` 段与 `== band shares ==` 段）：

```
sweep 5059 ms, 84.1 MB, diameter 14, antipodes 6624, OEIS A080630 matched exactly
quotient sweep for comparison: 3674160 orbits, diameter 14, 373 ms, 4 MB
rejections across the run: {"par-out-of-band":127}
```

`diameter 14` 与 `antipodes 6624` 是**这次扫描自己给的**，不是从文献抄来的：抄来的只有那 15 个直方图数字，
而它们与扫描结果逐行相等——这就是"外部锚点"的意思。第二行是**另一种等价关系**（把 24 个整体旋转认同）
扫出来的：它便宜一个量级，但它是 par 的**下界**而不是 par，理由写在 DESIGN.md 第 3 节。

已发布池子里 par 的实际分布（`node -e` 读 `js/data/lots.js` 即得）：
`4:6, 5:5, 6:5, 7:7, 8:7, 9:2, 10:14, 11:2, 12:15, 13:1` ——最深的一关 `par 13`，
全群最深处（par 14 的 6,624 个状态）**没有入库**：`walk: [21,22]` 的随机走很难落在那 0.0075% 上。

## 为什么生成只在构建期跑

规划类仓的规矩是"点击时不许做无上限现场搜索"。这里生成 = 全群扫描或一次真实求解，所以**一行都不放进浏览器**：

- `js/core/fullsweep.js` 要 84 MB 距离数组和约 5 秒 CPU；`js/main.js` 不 import 它，`js/data/lots.js` 只带结论。
- 参考求解器在一批最深的 shipped 题 `cube-58`（par 13，打乱 21 转）上本次实测：
  双向 BFS 展开 **1,300,224** 个结点、**4.6 s**；IDA\* 展开 **220,816** 个结点、**3.2 s**；两者都给出 13 转，
  且各自解出的路线回放到 `isSolved`。这是"前端不许搜"的全部理由——也是把 64 关全部重解一遍只要
  **7.6 s**（`test/library.test.mjs` 实测）的原因：它贵在一个玩家永远不必做的事上。
- 玩家能做的只有查表：`js/core/game.js` 的提示走 `routeMap(lot)`（按 `encode(state)` 索引的一张 Map），
  构建一次、不搜索；偏离路线时它**拒绝**给数，而不是给一个没验证过的数。

## 验收

`bash tools/verify.sh` 一条命令跑两层。以下数字是本次在这台机器上跑出来的（2026-09-28，arm64 / node 26.8.1 /
Chrome 154，整条门 25.0–25.7 s；复现命令与逐条原因见 `deliverable.md` §5）：

- **node 层**（60 行，`fail: 0`）：

  | 套件 | 行数 | 失败 | 墙钟 |
  | --- | --- | --- | --- |
  | `test/geom.test.mjs` | 18 | 0 | 0.05 s |
  | `test/library.test.mjs` | 9 | 0 | 7.6 s |
  | `test/game.test.mjs` | 10 | 0 | 0.03 s |
  | `test/storage.test.mjs` | 14 | 0 | 0.03 s |
  | `test/view.test.mjs`（手势符号：96 个 (角块, 面, 拖动方向) 三元组逐条对物理贴纸模型验） | 5 | 0 | 0.03 s |
  | `tools/check.mjs`（分层门：import 落盘 / core 不碰 DOM / core 不 import 壳 / 页面的模块闭包不碰构建期层） | 4 | 0 | 0.03 s |

- **数学层**：`node tools/proof.mjs` → `ALL PROOFS PASS`（35 行 ok / 0 FAIL），实测 **214–233 s**、
  峰值 **410 MB**，在 CI 里是独立的 `proof` job（`.github/workflows/ci.yml`），因为它比其余全部加起来还贵一个量级。
- **浏览器层**（90 行，`fail: 0`，墙钟 **16.8 s**：`SKIP_UNIT=1 bash tools/verify.sh`）：
  `@boot 17` / `@play 17` / `@routes 23` / `@save 14` / `@pointer 19`，
  台架驱动的是本仓钩子 `window.pocketcube`（不再是上一仓的 `window.gridlock`），
  console 干净、Chrome 自行退出、末行 `=== ALL GREEN ===`。
- 这一层曾经**是**红的，而且红在产品代码上：`#/cube/<公式>` 直接崩壳、`超出` 给未实测的题印一个真数、
  转镜头后画面不重绘、未实测的题能拿到 `perfect`、`turns: null` 能写进存档，以及
  `dragsFor()` 承诺了四个方向而其中有些**按下去命中的是另一张贴纸**。
  五条修完之后 `@play`/`@pointer` 才绿；过程与证据在 `deliverable.md` §2/§5，没有为了让它绿而放宽任何期望值。

## 文件地图

```
index.html            壳：顶栏 / 画布 / 右侧面板 / 通关卡（含 data: 的 favicon，防 404 污染 console）
css/game.css          全部样式，一个文件
js/core/cube.js       规则唯一来源：(perm,twist)、扭转判据、QTM 语义、Lehmer 编码/解码
js/core/geom.js       由旋转矩阵推出十二个转；贴纸模型与"表模型"对账；投影函数
js/core/fullsweep.js  88,179,840 状态的穷尽 BFS：距离数组、逐层计数、路线读出（仅构建期）
js/core/orbit.js      24 个整体旋转的商群扫描（3,674,160 个轨道）：par 的下界 + 第二套索引
js/core/bfs.js        参考求解器：双向 BFS（仅构建期与测试）
js/core/ida.js        第二个求解器：IDA*，h = max(单角块表, 扭转下界, 五块 PDB)
js/core/pdb.js        五块 pattern database：1,632,960 个抽象状态，1.6 MB，直径 10
js/core/make.js       候选生成（walk / rank）+ 逐带接受率 + verifyLot 自洽检查
js/core/library.js    查表：64 关 / 每日 / 随机 / id / 打乱串 + 加载期结构复验 + stats()
js/core/game.js       一局：turn/undo/hint/grade，hint 只查烘焙路线，不搜索
js/core/storage.js    localStorage 存档，无 window 或存储被拒时退化成内存
js/core/rng.js        hashSeed（FNV-1a 派生的两轮混合）+ mulberry32
js/data/lots.js       构建期产物：BAKE 实录、TIERS_META、64 行带实测 par 与两份独立重解
js/view.js            canvas 2D 自写投影 + 手势（拖面 = 转，拖空白 = 看），不判合法性
js/main.js            路由、DOM、存档写入、window.pocketcube 测试钩子
server.cjs            零依赖静态服务器（默认 5199，与 tools/verify.sh 同端口）
electron/main.cjs     桌面壳（复用同一个服务器，port 0）
tools/bake.mjs        扫描 → 出题 → 逐关独立重解 → 写 js/data/lots.js，拒绝在失败时写
tools/survey.mjs      决定四档边界的量具（5000 题 par 直方图 + 各带接受率）
tools/proof.mjs       对外锚点集合：转表双射、判据穷举、编码互逆、启发可采纳（CI 里独立一个 proof job）
tools/check.mjs       分层门：相对 import 全部落盘、js/core 不碰 DOM、core 不 import 壳、从 js/main.js 走得到的模块闭包里没有构建期层
tools/playtest.mjs    零依赖 CDP 驱动，五个 in-page 场景 + 真实指针拖拽
tools/modifiers.mjs   量 CDP 的 modifiers 位到底对应哪个键（1=alt 2=ctrl 4=meta 8=shift），台架里 shift 拖靠它
tools/verify.sh       一次性验收门：node 套件 → 起 Chrome → 五个场景 → console 必须干净
tools/harness.mjs     微型测试框架，node 与浏览器套件输出形状一致
test/geom.test.mjs    几何层：转表推导、双射、扭转增量、贴纸模型对账
test/library.test.mjs 数据层：64 关逐关重解、带界与实到区间、打乱串回读、加载期守卫
test/game.test.mjs    规则层：一局的生命周期、评分带、无烘焙路线的题、分享串回读
test/storage.test.mjs 存档层：无 window、写入被拒、脏记录、损坏文件、未实测 par 不许加星
test/view.test.mjs   手势层：dragTurn 的符号对物理贴纸模型逐条验（96 个三元组、48 组正反拖）
```

## 已知边界

- **`par` 是 QTM 数字，换度量就换数**：半转算两步（`R2` = 2）、整体旋转不是步数、
  终点是**参考朝向**（`isSolved`）。HTM 的下界在 `js/core/orbit.js` 里有表，但屏幕上不印它。
- **本仓的"唯一解证明"不是逻辑推演类那种**：二阶没有线索可拆，所以难度证据是"穷尽 + 外部对账 + 双求解器"，
  不是解计数器返回 1。契约 §3 里"去掉一条线索后解数 ≥2"那一条在这里**不适用**，也没有伪装成适用。
- **`tools/proof.mjs` 现在是绿的**（`ALL PROOFS PASS`，214 s / 410 MB），但它曾经跑不完，两条都是它自己的错，
  记在 `deliverable.md` §6：`checkEncoding()` 用了没 import 的 `rankTo8`（`ReferenceError` 会把后面的锚点整段吞掉），
  以及一条断言把"正反两转互相抵消"写成了换位子 `x y x' y'`——144 个里 96 个不回已解态是非交换群的**正确**行为，
  该验的族是 `x x' y y'`。现在两套模型（表 / 物理贴纸）各验一遍。没有为了让它绿而改期望值。
- **一个贴纸的"中心"不一定按得下去**：拖拽向量是逐个贴纸算的，但一次按下是对**画出来的那一帧**做命中测试，
  前面一个角块的贴纸可以正好盖住后面那个的中心。`js/view.js` 的 `dragFor()` 现在会用指针用的同一个
  `stickerAt()` 回读自己给出的那一点，并把它标成 `pressable: false`＋`under`（盖住它的是谁）；
  `@pointer` 有一行专门验这个回读，另有一行断言整条认证路线都能一拖一转地拖完。
- **浏览器层已接线**（`window.pocketcube`，web 5199 / devtools 9359，见 `tools/verify.sh` 的端口说明）。
  仍然没有真机验证的是：**Electron 壳只过 `node --check`，没有真实启动过**、**移动端断点没在真机上看过**、
  **UI 只有中文**。
- `FULL=1 node tools/proof.mjs` 的穷尽扫描（88,179,840 个状态）不在 CI 里：它的全部输出已经打印在
  `js/data/lots.js` 的文件头里，并与 OEIS A080630 逐层对过账。这里不假装 CI 跑过它。
- 缠绕档在真手上是 12–14 次转，比九连环那种几百步友好得多，但它存在的意义仍是**印着一个可证数字**。
- 通关后没有彩带、没有音效、没有分享弹窗；分享只分享谜题本身（`#/lot/<id>`、`#/cube/<公式>`），不带战绩。

## License

MIT © 2026 z-biz-game
