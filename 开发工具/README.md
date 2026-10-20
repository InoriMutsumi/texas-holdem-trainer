# 开发工具说明

这里不是游戏本体，全是开发期的验证与生成脚本。**只分享游戏的话，整个目录都不用带。**

所有脚本都在项目根目录之外，用 `node 开发工具/xxx.js` 跑。

## 回归验证

| 脚本 | 跑什么 | 用法 |
|---|---|---|
| `../test.js` | 规则引擎的 121 条断言（在根目录） | `node test.js` |
| `../check.js` | 语法检查 + DOM 桩冒烟，各桌型打完 10 手 | `node check.js` / `node check.js six` / `node check.js nine` |
| `sixmax.js` | 6 人桌随机 60 手压测，抓崩溃 | `node 开发工具/sixmax.js` |
| `repro-chips.js` | 筹码结算复现：短码全下 / 长码弃牌两种场景 | `node 开发工具/repro-chips.js` |

## AI 强度与「像不像人」

都是把 `index.html` 里的引擎和 AI 段抽到 Node 沙箱里跑，不经过 DOM。

| 脚本 | 口径 | 用法 |
|---|---|---|
| `aibench.js` | 1v1 三档对打，按筹码计净盈亏 | `node 开发工具/aibench.js 300 normal hard` |
| `aibench2.js` | 6 人桌对打 + VPIP/PFR/3bet/C-bet/WTSD 频率 | `node 开发工具/aibench2.js hard 300 six` |
| `bench.js` | 三档对打，按 **BB** 计净盈亏（每手重置 100BB，口径更干净） | `node 开发工具/bench.js 5 100` |
| `style-bench.js` | 难度统一，只改性格，看风格参数有没有跑通 | `node 开发工具/style-bench.js 5 100` |
| `sim.js` | 6 人桌跑 N 手，统计每个座位的 VPIP / PFR / 加注率 | `node 开发工具/sim.js 500` |
| `replay.js` | 把指定手数的完整行动过程打印出来，人肉读 AI 像不像人 | `node 开发工具/replay.js 50 0 3` |

## GTO 数据

| 脚本 | 干什么 |
|---|---|
| `build-gto.js` | 从 `matthiola0/poker-hand-review` 的原始数据生成 `gto-data.js`（169 手翻前表） |
| `inline-gto.js` | 把 `gto-data.js` 内联进 `index.html`，恢复「单文件双击即玩」 |
| `gto-data.js` | 生成物，`index.html` 里已经内联了一份 |

改 GTO 数据的顺序：`node 开发工具/build-gto.js` → `node 开发工具/inline-gto.js`。

## 截图与演示图

| 脚本 | 干什么 |
|---|---|
| `make-shots.sh` | 批量重截桌面端界面图（Edge headless，1440×900） |
| `shot-mobile.js` | 手机截图，走 CDP `Emulation.setDeviceMetricsOverride` |
| `make-demo-gif.py` | 把几张截图拼成 `截图/演示.gif`（需要 Pillow） |

**手机截图必须用 `shot-mobile.js`**：Edge headless 的 `--window-size` 有最小宽度（约 492px），传 390 会被悄悄抬到 492，再由 `--screenshot` 按 390 裁图——得到的是「左边 390px 的 492px 页面」，右对齐元素看起来全消失了。

```bash
node 开发工具/shot-mobile.js "file:///G:/大肥鱼/项目/德州扑克/index.html?table=six" out.png 390 844 2
```

## 仓库同步

GitHub 的 `github.com:443` 经常连不上，`api.github.com` 却通，所以走 Git Data API 推送。

| 脚本 | 干什么 |
|---|---|
| `push-api.js` | 全量同步：对比本地 `git ls-tree` 与远程 tree，删多余、传差异 |
| `sync-check.js` | 只对比不推送，列出哪些文件不一致 |
| `sync-pull.js` | 从远程拉差异文件（多机协作时用） |

先 `node 开发工具/sync-check.js` 看差异，再 `node 开发工具/push-api.js` 推。
