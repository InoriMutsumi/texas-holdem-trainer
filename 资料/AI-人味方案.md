# AI 人味改造方案（第 2 + 第 3 点）

> 目标：让 AI 的行为**前后一致**（像在演一个故事），并且**记得你**（像在跟人打）。
> 边界：不改规则引擎、不改 UI 布局、不做联网。全部改动在 `index.html` 的 AI 段（`// ---------------- AI ----------------` 到 `function scheduleAI` 之前）。

---

## 零、先说清楚现在的问题

现在的 `aiDecide(g, seat)` 是**每街独立决策**：

1. 算当前胜率 `eq`
2. 跟 `minEq` 比较
3. 加注 / 跟注 / 弃牌

后果：

- 同一手牌，翻牌它加注、转牌它突然过牌、河牌它又加注——**没有故事**，你读不出它。
- 它的「诈唬」是每次决策掷一次骰子（`Math.random() < bluffChance`），不是「我决定这手要偷，就一路偷到底」。
- 它对你的认知只有**聚合比率**（`foldedToBet / facedBet`），没有「你上一手刚这么干过」。

---

## 一、第 2 点：单手计划（Hand Plan）

### 1.1 核心设计

**每手牌只掷一次意图，整手按意图走。**

```
发牌 → rollPlan() 掷意图 → 每一街的 aiDecide 读意图 → 行为保持一致的"故事"
```

意图不是死的：**被强对抗时可以中途放弃**（诈唬被加注就该跑），但**不能无理由换故事**。

### 1.2 五种意图

| 意图 | 触发条件（底牌 + 位置） | 整手行为 |
|---|---|---|
| `value` 价值 | 牌力强（`preflopScore ≥ 0.60`），或翻后成牌（`handClass === 'value'`） | 每一街主动下注/加注，尺度略大（×1.10） |
| `bluff` 诈唬 | 牌力中等偏弱、位置好（BTN/CO），且本手还没人加注 | 翻前加注 → 翻牌必下注（60%）→ 转牌继续（40%）→ 河牌放弃（除非成牌） |
| `draw` 听牌 | 翻后判定为 `draw`（同花听/顺子听） | 便宜就跟，成牌后切 `value` 打法 |
| `trap` 慢打 | 牌力极强（`≥ 0.85`）或翻后成坚果 | 60% 过牌/仅跟注，河牌 30% 突然加注 |
| `giveup` 放弃 | 牌力弱且位置差（UTG/MP/BB） | 除非免费看牌，否则弃 |

### 1.3 数据结构

```js
var AI_PLAN = {};   // seat -> { intent, handId, raisedPre, street }

function rollPlan(g, seat) {
  var p = g.players[seat];
  var s = preflopScore(p.hole);
  var pos = posLabel(seat);   // 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB'
  var late = (pos === 'BTN' || pos === 'CO');
  var r = Math.random();
  var intent;
  if (s >= 0.82 && r < 0.35) intent = 'trap';
  else if (s >= 0.58) intent = 'value';
  else if (late && s >= 0.30 && r < 0.28) intent = 'bluff';
  else if (!late && s < 0.34) intent = 'giveup';
  else intent = 'value';
  AI_PLAN[seat] = {
    intent: intent,
    handId: g.handId,
    raisedPre: false,   // 翻前是否已经加注（保证诈唬故事连贯）
    street: 'preflop'
  };
}
```

在 `startHand` 之后、以及每位玩家的 `act` 之前调用一次（按 `handId` 去重）。

### 1.4 决策接入（全部在 `aiDecide` 里）

**翻前**（GTO 表之后、掷骰之前）：

```js
var plan = AI_PLAN[seat];
if (plan && plan.intent === 'bluff' && toCall <= 0 && canRaise) {
  plan.raisedPre = true;
  return raiseTo(preflopRaiseAmount(g, style));   // 诈唬意图：位置好就主动开
}
if (plan && plan.intent === 'giveup' && toCall > 0) {
  return { type: 'fold' };                        // 放弃意图：不花钱
}
if (plan && plan.intent === 'trap' && toCall <= 0) {
  return { type: 'check' };                       // 慢打：强牌先过
}
```

**翻后**（`minEq` 计算之后、弃牌判定之前）：

```js
if (plan) {
  if (plan.intent === 'value') {
    minEq -= 0.03;
    // 下注尺度在 betSize 里乘 1.1
  } else if (plan.intent === 'bluff') {
    // 故事连贯：翻牌必下（60%），转牌继续（40%），河牌放弃
    if (g.street === 'flop' && toCall <= 0 && canRaise && Math.random() < 0.60) {
      return raiseTo(betSize(0.55));
    }
    if (g.street === 'turn' && plan.raisedPre && toCall <= 0 && canRaise && Math.random() < 0.40) {
      return raiseTo(betSize(0.65));
    }
    if (g.street === 'river' && hclass !== 'value') {
      // 河牌没成牌就放弃，不硬撑（这是"完整故事"，不是死磕）
      return toCall > 0 ? { type: 'fold' } : { type: 'check' };
    }
  } else if (plan.intent === 'draw') {
    if (hclass === 'draw') minEq -= 0.04;          // 听牌便宜就跟
    if (hclass === 'value') plan.intent = 'value'; // 成牌了，切成价值打法
  } else if (plan.intent === 'trap') {
    if (toCall <= 0 && canRaise && Math.random() < 0.40) {
      return raiseTo(betSize(0.35));               // 河牌 40% 突然加注（埋伏）
    }
    minEq += 0.02;                                  // 慢打时更愿意跟
  } else if (plan.intent === 'giveup') {
    minEq += 0.05;
  }
}
```

**尺度**：`betSize(frac)` 里加 `var pm = (plan && plan.intent === 'value') ? 1.10 : 1;`，返回 `... * pm`。

### 1.5 成本与风险

- **代码量**：约 130 行（`rollPlan` 30 行 + 接入 80 行 + 清理 20 行）。
- **风险 1：AI 变弱**。计划僵化可能让 AI 在「意图错配」时硬打。缓解：`rollPlan` 只对 `normal` / `hard` 生效，`easy` 保持不变；bench 对比 `hard vs normal` 300 手 × 3 次。
- **风险 2：和现有阈值逻辑打架**。缓解：意图只调 `minEq` 和「主动下注时机」，不覆盖 GTO 表的翻前范围。
- **风险 3：可读性变差（对玩家是好事，对调试是坏事）**。缓解：加 `?debug=plan` 参数，在右侧栏显示每个 AI 本手的意图。

### 1.6 验收标准

1. `?debug=plan` 能看到每个 AI 的意图。
2. 同一手牌，AI 的下注动作**前后语义一致**（诈唬意图不会翻牌下注、转牌无缘无故过牌）。
3. `aibench.js 300 normal hard` 跑 3 次，`hard` 中位数为正（不显著弱于改前）。
4. `test.js` 121 条全过。

---

## 二、第 3 点：AI 记住你（Player Memory）

### 2.1 现状

`AI_MIND[seat]` 已经记录：

- `facedBet / foldedToBet`（面对下注弃牌率）
- `riverFaced / riverFolded`（河牌弃牌率）
- `sFaced / sFolded`（分街弃牌率）
- `showCats / raisedShowCats`（摊牌牌型分布）

**问题**：这些是**聚合比率**，说不出「你刚才干了什么」。

### 2.2 要加的东西

**事件记忆**（最近 30 手）：

```js
var PLAYER_MEM = [];   // [{ handId, street, type, amount }]
function remember(ev) {
  PLAYER_MEM.push(ev);
  if (PLAYER_MEM.length > 30) PLAYER_MEM.shift();
}
```

记录的事件（**只用公开可见的行为**，不碰底牌）：

| 事件 | 何时记 |
|---|---|
| `fold_pre` | 玩家翻前弃牌 |
| `fold_river` | 玩家河牌面对下注弃牌 |
| `call_big` | 玩家跟注超过 30% 筹码 |
| `raise` | 玩家主动加注 |
| `show_weak` | 玩家摊牌是高牌/一对 |
| `show_strong` | 玩家摊牌是三条以上 |

### 2.3 三条台词规则

**规则 A：模式识别**（连续行为）

- 连续 3 手 `fold_pre` → 「又弃？你这椅子是不是太硬了」
- 最近 5 手里 3 次 `fold_river` → 「你河牌跑得有点快啊」
- 最近 3 手里 2 次 `raise` → 「今天手气不错嘛」

**规则 B：记忆回指**（具体事件）

- 玩家刚被诈唬输掉 → 「上次也是这么输的吧」（下一手开始说）
- 玩家刚 `show_weak` 就加注 → 「你这加注我记住了」

**规则 C：反向利用**（决策微调，已有 `exploitOf` 的加强）

- 河牌弃牌率 > 0.60 → AI 河牌诈唬频率 ×1.35
- 摊牌弱牌占比 > 0.55 → AI 跟注门槛 −0.05
- 从不诈唬（`raisedShowCats` 全是强牌）→ AI 见到加注就跑（`minEq += 0.06`，已有）

### 2.4 成本与风险

- **代码量**：约 90 行（`remember` 15 行 + 事件埋点 30 行 + 台词规则 35 行 + 决策微调 10 行）。
- **风险 1：变成"通灵"**。缓解：只记**公开信息**（弃牌、摊牌、下注额），代码里加注释禁止读取 `p.hole`。
- **风险 2：台词太多太吵**。缓解：每手最多 1 句记忆类台词，和现有 `_talkBudget` 共享配额。
- **风险 3：AI 太强**。缓解：只对 `hard` 生效；`normal` 只看规则 A 的台词，不看决策微调。

### 2.5 验收标准

1. 打 10 手，至少触发 2 条记忆台词。
2. 台词**对得上事儿**（不能夸你赢了，但你其实输了）。
3. 关闭「AI 消息」开关后，记忆台词也一起关闭。
4. `test.js` 121 条全过，`check.js` 三档冒烟过。

---

## 三、实施顺序

| 步骤 | 内容 | 预计 |
|---|---|---|
| 1 | `rollPlan` + 意图接入（第 2 点） | 2–3 小时 |
| 2 | `?debug=plan` 面板 + 人工验证一致性 | 0.5 小时 |
| 3 | bench 三次对比，确认不弱于改前 | 1 小时 |
| 4 | `PLAYER_MEM` + 事件埋点 | 1 小时 |
| 5 | 台词规则 + 配额控制 | 1 小时 |
| 6 | 决策微调（只对 hard） | 0.5 小时 |
| 7 | 回归 + 截图 + 推送 | 0.5 小时 |

**总计约 7 小时**，可以分两次提交（第 2 点一次、第 3 点一次），中间可回滚。

---

## 四、明确不做

- ❌ 读玩家底牌（伪作弊已经够了，再读就变成作弊器）
- ❌ 每街重掷意图（那就退回阈值决策，失去"故事"）
- ❌ 给 AI 加"记忆持久化到 localStorage"（换一局就忘是合理的，否则 AI 会越来越强）
- ❌ 让 `easy` 也用计划（新手档要"看起来傻"，计划会露馅）

---

## 五、一个诚实的提醒

这两点做完，AI 会**更像人**，但不一定**更强**。

「像人」对玩家的价值是：可读、有故事、输得服气、赢得有成就感。
「更强」对玩家的价值是：练得更有压力。

这两个目标在弱玩家身上是**冲突的**——太像人的 AI 会故意犯错（诈唬被抓、慢打被反超），这些错误对人类玩家是"破绽"，对 AI 对战是"亏损"。

所以第 2 点的 bench 验收标准我写的是「不显著弱于改前」，不是「显著强于改前」。**这是刻意的取舍。**
