#!/bin/bash
# udtalk_live_panel.js を編集したあと、拡張機能側に反映するスクリプト
cd "$(dirname "$0")" || exit 1
python3 - <<'PY'
src = open('udtalk_live_panel.js', encoding='utf-8').read()
out = ("function __udyyRun() {\n" + src + "\n}\n__udyyRun();\n"
       "document.addEventListener('keydown', function (e) {\n"
       "  if (e.altKey && (e.key === 'u' || e.key === 'U' || e.code === 'KeyU')) __udyyRun();\n});\n")
open('chrome_extension/panel.js', 'w', encoding='utf-8').write(out)
print('chrome_extension/panel.js を更新しました')
PY
echo "Chrome の chrome://extensions で「更新」を押してください"
read -n 1 -s -r -p "何かキーを押すと閉じます"
