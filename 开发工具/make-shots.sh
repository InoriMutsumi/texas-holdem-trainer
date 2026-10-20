#!/bin/bash
# 重新截一批界面图（加了规则按钮之后统一更新）
set -u
cd "$(dirname "$0")/.." || exit 1
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
BASE="file:///G:/大肥鱼/项目/德州扑克/index.html"
OUT="./截图"

shot() {
  local name="$1" query="$2" budget="${3:-3000}"
  "$EDGE" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=1440,900 --virtual-time-budget="$budget" \
    --screenshot="G:\\大肥鱼\\项目\\德州扑克\\截图\\$name.png" \
    "$BASE$query" >/dev/null 2>&1
  echo "$name"
}

shot "界面-开局" "?table=hu" 2500
shot "界面-6人桌" "?table=six&auto=1" 6000
shot "界面-9人桌" "?table=nine" 2500
shot "界面-规则-怎么玩" "?guide=flow" 2500
shot "界面-规则-牌型" "?guide=hands" 2500
shot "界面-规则-策略" "?guide=strategy" 2500
shot "界面-结算" "?table=hu&auto=1" 8000
shot "界面-统计" "?table=six&auto=6&stats=1" 30000
shot "界面-牌谱" "?table=six&auto=3&hist=1" 15000
shot "界面-牌谱回放" "?table=six&auto=4&hist=1&hand=1" 20000
shot "界面-头像" "?table=six&avatar=1" 3000
echo "全部完成"
