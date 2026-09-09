/* YYProbe の字幕配信ページ（analytics.yyprobe-demo.com など）から発話を読み取り、
   拡張機能の共有ストレージに書き出す。UDトーク側のパネルがこれを受け取る。

   ページ構造：
     .default-content .remark-content-div  … 日本語の発話（これを使う）
     .foreigncontent  .remark-content-div  … 翻訳側（d-none で隠れている。使わない）
   ルビは付いていないので、そのまま取り出せる。 */
(function () {
  var KEEP = 8;   // 直近何件を共有するか

  function lines() {
    return [].slice.call(document.querySelectorAll('.default-content .remark-content-div'))
      .map(function (e) {
        return e.textContent.replace(/[ \t]+/g, ' ')
          .replace(/[.．…]{2,}$/, '')   // 認識途中の末尾「...」を落とす
          .trim();
      })
      .filter(Boolean)
      .slice(-KEEP);
  }

  var last = '';
  function push() {
    var a = lines();
    var joined = a.join('\n');
    if (joined === last) return;
    last = joined;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ udyy_yy: { lines: a, ts: Date.now() } });
    }
    badge.textContent = 'YY→UD 送信中（' + a.length + '件）';
  }

  var badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483647;' +
    'background:rgba(20,67,42,.95);color:#c9f7d5;font:12px/1.5 "Hiragino Sans",sans-serif;' +
    'padding:5px 10px;border-radius:8px;border:1px solid #3c9a59';
  badge.textContent = 'YY→UD 待機中';
  document.body.appendChild(badge);

  /* YYのタブは裏に回ることが多い。Chrome は裏タブの setTimeout を強く制限するため、
     デバウンスをタイマー任せにせず、時刻を見てその場で実行する経路を用意する。 */
  var lastRun = 0, pending = false;
  function schedule() {
    var now = Date.now();
    if (now - lastRun > 250) { lastRun = now; push(); return; }
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; lastRun = Date.now(); push(); }, 250);
  }

  new MutationObserver(schedule)
    .observe(document.body, { childList: true, subtree: true, characterData: true });

  push();
})();
