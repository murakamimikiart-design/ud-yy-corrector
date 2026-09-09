/* 自動生成。udtalk_live_panel.js を編集して build_extension.command を実行すること。 */
function __udyyRun() {
/* UDトーク「ウェブで公開」ページ（live.udtalk.jp）に、
   UD × YY 比較パネルをそのまま重ねて表示するブックマークレット。

   ローカルのHTMLからは他サイトの中身を読めない（同一生成元ポリシー）ため、
   リアルタイムに UD の字幕を取り込むにはページ側で動かす必要がある。

   - UD側：ページの字幕を自動で追跡（MutationObserver）。喋るたびに更新される
   - YY側：手で貼り付ける
   - 判断中に UD が更新されると作業が飛ぶので「固定」で止められる */
(function () {
  var ID = 'udyy-live';
  var old = document.getElementById(ID);
  if (old) { old.remove(); return; }

  /* ---------- 差分ロジック（uy_corrector.html と同じ） ---------- */
  var IGNORE_PUNCT = new Set("、。，．,.！？!?…‥・「」『』（）()〈〉《》【】〔〕”“\"'‘’；;：:".split(""));
  var KANA_ONLY = /^[぀-ゟー、。，．・…「」『』（）()？！?!\s]*$/;

  function fold(text) {
    var chars = [], origin = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (/\s/.test(ch) || IGNORE_PUNCT.has(ch)) continue;
      var nk = ch.normalize('NFKC');
      for (var j = 0; j < nk.length; j++) {
        if (/\s/.test(nk[j])) continue;
        chars.push(nk[j]); origin.push(i);
      }
    }
    return { s: chars.join(''), origin: origin };
  }

  function rawOpcodes(a, b) {
    var n = a.length, m = b.length;
    if (!n && !m) return [];
    if (!n) return [[0, 0, 0, m]];
    if (!m) return [[0, n, 0, 0]];
    var w = m + 1, dp = new Uint32Array((n + 1) * w), i, j;
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--)
        dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    var ops = [], si = 0, sj = 0, inD = false;
    i = 0; j = 0;
    function close() { if (inD) { ops.push([si, i, sj, j]); inD = false; } }
    while (i < n && j < m) {
      if (a[i] === b[j]) { close(); i++; j++; }
      else {
        if (!inD) { si = i; sj = j; inD = true; }
        if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++; else j++;
      }
    }
    if (i < n || j < m) { if (!inD) { si = i; sj = j; inD = true; } i = n; j = m; }
    close();
    return ops;
  }

  function toOrigin(origin, len, i1, i2) {
    var s = i1 < origin.length ? origin[i1] : len;
    var e = i2 < origin.length ? origin[i2] : len;
    return [s, Math.max(s, e)];
  }

  function compare(ud, yy) {
    var A = fold(ud), B = fold(yy);
    if (A.s.length * B.s.length > 4000000) return { ud: ud, yy: yy, changes: [], tooLong: true };
    var ops = [], raw = rawOpcodes(A.s, B.s);
    raw.forEach(function (o) {
      var p = ops[ops.length - 1];
      if (p && (o[0] - p[1]) <= 1 && (o[2] - p[3]) <= 1) { p[1] = o[1]; p[3] = o[3]; }
      else ops.push(o.slice());
    });
    var changes = ops.map(function (o, k) {
      var u = toOrigin(A.origin, ud.length, o[0], o[1]);
      var y = toOrigin(B.origin, yy.length, o[2], o[3]);
      return {
        index: k + 1, ud: ud.slice(u[0], u[1]), yy: yy.slice(y[0], y[1]),
        udStart: u[0], udEnd: u[1], choice: 'yy', custom: ''
      };
    });
    return { ud: ud, yy: yy, changes: changes };
  }

  function applyChoices(ud, changes) {
    var out = '', cursor = 0, spans = [];
    changes.slice().sort(function (a, b) { return a.udStart - b.udStart; }).forEach(function (c) {
      if (c.udStart < cursor || c.choice === 'ud') return;
      var t = c.choice === 'custom' ? c.custom : c.yy;
      out += ud.slice(cursor, c.udStart);
      var st = out.length;
      out += t;
      if (t) spans.push([st, out.length, c.choice]);
      cursor = c.udEnd;
    });
    out += ud.slice(cursor);
    return { text: out, spans: spans };
  }

  function isMinor(c) { return KANA_ONLY.test(c.ud) && KANA_ONLY.test(c.yy); }

  /* ---------- ページから UD の字幕を取り出す ---------- */
  function clean(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('rt,rp').forEach(function (n) { n.remove(); });
    c.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
    return c.textContent.replace(/[ \t]+/g, ' ').trim();
  }

  function udLines() {
    var a = [].slice.call(document.querySelectorAll('.v-list-item__subtitle')).filter(function (e) {
      var item = e.closest('.v-list-item');
      var head = item && item.querySelector('.v-list-item__title');
      return !(head && head.textContent.indexOf(e.textContent.trim()) >= 0);
    });
    return a.map(clean).filter(function (t) { return t && !/^[.．…・\s]+$/.test(t); });
  }

  /* ---------- 画面 ---------- */
  var css = 'all:initial;font-family:"Hiragino Sans",sans-serif;';
  var p = document.createElement('div');
  p.id = ID;
  p.style.cssText = 'position:fixed;right:14px;bottom:14px;width:460px;max-height:88vh;overflow:auto;' +
    'z-index:2147483647;background:#12161b;color:#e9edf1;font:13px/1.6 "Hiragino Sans",sans-serif;' +
    'padding:10px;border-radius:12px;border:1px solid #4a545e;box-shadow:0 10px 30px rgba(0,0,0,.6)';

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(label, fn, extra) {
    var b = el('button', 'font:13px "Hiragino Sans",sans-serif;padding:5px 10px;border-radius:7px;' +
      'border:1px solid #5a656f;background:#232c35;color:#e9edf1;cursor:pointer;' + (extra || ''), label);
    b.onclick = fn;
    return b;
  }

  var head = el('div', 'display:flex;gap:6px;align-items:center;margin-bottom:8px;cursor:move');
  head.appendChild(el('b', 'flex:1;font-size:13px', 'UD × YY ライブ比較'));

  var live = true;
  var liveBtn = btn('自動取得: ON', function () {
    live = !live;
    liveBtn.textContent = '自動取得: ' + (live ? 'ON' : '固定');
    liveBtn.style.background = live ? '#1d4d2e' : '#5a3a12';
    if (live) { refreshUd(); applyYY(); }
  }, 'background:#1d4d2e');
  head.appendChild(liveBtn);

  var nSel = el('select', 'font:13px sans-serif;padding:4px;border-radius:6px;background:#232c35;color:#e9edf1;border:1px solid #5a656f');
  [['1', '最新1件'], ['2', '最新2件'], ['3', '最新3件'], ['5', '最新5件']].forEach(function (o) {
    var op = el('option', '', o[1]); op.value = o[0]; nSel.appendChild(op);
  });
  nSel.value = '2';
  nSel.onchange = function () { refreshUd(); applyYY(); };
  head.appendChild(nSel);
  head.appendChild(btn('×', function () { obs.disconnect(); p.remove(); }));
  p.appendChild(head);

  var udBox = el('div', 'background:#0c1015;border:1px solid #e8a33d55;border-radius:8px;padding:7px 9px;' +
    'font-size:15px;white-space:pre-wrap;max-height:110px;overflow:auto;margin-bottom:6px');
  p.appendChild(el('div', 'font-size:11px;color:#e8a33d;margin-bottom:3px', 'UDトーク（自動取得）'));
  p.appendChild(udBox);

  var yyLabel = el('div', 'font-size:11px;color:#5fb37a;margin-bottom:3px', 'YYprobe（ここに貼り付け ⌘V）');
  p.appendChild(yyLabel);
  var yyBox = el('textarea', 'width:100%;height:66px;background:#0c1015;color:#e9edf1;border:1px solid #5fb37a55;' +
    'border-radius:8px;padding:7px 9px;font:15px/1.6 "Hiragino Sans",sans-serif;resize:vertical;margin-bottom:6px');
  yyBox.placeholder = 'YYprobe のテキストを貼り付け';
  p.appendChild(yyBox);

  var listWrap = el('div', 'margin-bottom:6px');
  p.appendChild(listWrap);

  p.appendChild(el('div', 'font-size:11px;color:#93a2b1;margin-bottom:3px', '最終テキスト（直接書き換え可）'));
  var outBox = el('textarea', 'width:100%;height:70px;background:#0c1015;color:#e9edf1;border:1px solid #5a656f;' +
    'border-radius:8px;padding:7px 9px;font:15px/1.6 "Hiragino Sans",sans-serif;resize:vertical');
  p.appendChild(outBox);

  var foot = el('div', 'display:flex;gap:6px;align-items:center;margin-top:7px');
  foot.appendChild(btn('決定してコピー', decide, 'background:#2e7d46;border-color:#3c9a59;font-weight:700'));
  var showMinor = false;
  var minorBtn = btn('言い回しも表示', function () { showMinor = !showMinor; minorBtn.style.background = showMinor ? '#1b3358' : '#232c35'; render(); });
  foot.appendChild(minorBtn);
  var stat = el('div', 'flex:1;font-size:11px;color:#93a2b1;text-align:right');
  foot.appendChild(stat);
  p.appendChild(foot);

  document.body.appendChild(p);

  /* ---------- 動き ---------- */
  var udText = '', result = null, timer = null;

  function refreshUd() {
    if (!live) return;
    var a = udLines();
    var n = parseInt(nSel.value, 10);
    udText = a.slice(-n).join('\n');
    udBox.textContent = udText || '（まだ字幕がありません）';
    recompare();
  }

  function recompare() {
    result = yyBox.value.trim() ? compare(udText, yyBox.value)
      : { ud: udText, yy: '', changes: [] };
    render();
  }

  function render() {
    listWrap.innerHTML = '';
    if (!result) return;
    var shown = 0, minor = 0;
    result.changes.forEach(function (c) {
      if (isMinor(c)) { minor++; if (!showMinor) return; }
      shown++;
      var row = el('div', 'border:1px solid #39424b;border-radius:8px;padding:6px;margin-bottom:5px;background:#171d24;display:flex;gap:6px;align-items:stretch');
      row.appendChild(el('div', 'font-size:11px;color:#93a2b1;display:flex;align-items:center', String(c.index)));
      function opt(kind, who, text, empty) {
        var b = el('button', 'flex:1;text-align:left;font:15px "Hiragino Sans",sans-serif;padding:5px 8px;' +
          'border-radius:6px;border:1px solid #4a545e;background:#1d242c;color:#e9edf1;cursor:pointer');
        b.appendChild(el('span', 'display:block;font-size:10px;color:#93a2b1', who));
        b.appendChild(document.createTextNode(text || empty));
        b.onclick = function () { c.choice = kind; render(); };
        if (c.choice === kind) {
          b.style.borderColor = kind === 'ud' ? '#e8a33d' : '#5fb37a';
          b.style.background = kind === 'ud' ? '#4a3410' : '#14432a';
        }
        return b;
      }
      row.appendChild(opt('ud', 'UDトーク', c.ud, '（入れない）'));
      row.appendChild(opt('yy', 'YYprobe', c.yy, '（削除する）'));
      var ed = btn('✎', function () {
        if (!c.custom) c.custom = c.yy || c.ud;
        c.choice = 'custom'; render();
        var inp = row.parentElement.querySelector('input[data-i="' + c.index + '"]');
        if (inp) { inp.focus(); inp.select(); }
      });
      if (c.choice === 'custom') { ed.style.borderColor = '#7aa9ff'; ed.style.background = '#1b3358'; }
      row.appendChild(ed);
      listWrap.appendChild(row);
      if (c.choice === 'custom') {
        var inp = el('input', 'width:100%;margin:-2px 0 6px;padding:6px 8px;border-radius:6px;border:1px solid #7aa9ff;' +
          'background:#0d1622;color:#e9edf1;font:15px "Hiragino Sans",sans-serif');
        inp.value = c.custom; inp.setAttribute('data-i', c.index);
        inp.oninput = function () { c.custom = inp.value; paint(); };
        listWrap.appendChild(inp);
      }
    });
    if (!result.changes.length) {
      listWrap.appendChild(el('div', 'font-size:12px;color:#93a2b1;padding:4px',
        yyBox.value.trim() ? '食い違いはありません。' : 'YY側を貼り付けると候補が出ます。'));
    } else if (!shown) {
      listWrap.appendChild(el('div', 'font-size:12px;color:#93a2b1;padding:4px',
        '言い回しの差 ' + minor + ' 件のみ（結果には反映済み）'));
    }
    paint();
    var need = result.changes.length - minor;
    stat.textContent = result.changes.length
      ? '要判断 ' + need + ' / 言い回し ' + minor
      : (udText ? '' : '字幕待ち');
  }

  function paint() {
    var r = applyChoices(result.ud, result.changes);
    outBox.value = r.text;
  }

  function decide() {
    var t = outBox.value;
    if (!t.trim()) { stat.textContent = 'コピーする内容なし'; return; }
    outBox.focus(); outBox.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(function () { });
    stat.textContent = ok ? '✓ コピーしました' : '選択済み。⌘C を押してください';
  }

  yyBox.addEventListener('input', function () {
    clearTimeout(timer); timer = setTimeout(recompare, 200);
  });

  /* YY側を拡張機能のストレージから自動受信する
     （YYの配信ページに入れた yy_reader.js が書き込んでいる） */
  var yyLines = null;
  function applyYY() {
    if (!live || !yyLines) return;
    var n = parseInt(nSel.value, 10);
    var t = yyLines.slice(-n).join('\n');
    if (t !== yyBox.value) { yyBox.value = t; recompare(); }
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    yyLabel.textContent = 'YYprobe（自動受信）';
    chrome.storage.local.get('udyy_yy', function (o) {
      if (o && o.udyy_yy) { yyLines = o.udyy_yy.lines; applyYY(); }
    });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.udyy_yy && ch.udyy_yy.newValue) {
        yyLines = ch.udyy_yy.newValue.lines;
        applyYY();
      }
    });
  }

  /* 字幕の追加を監視して自動更新 */
  var obs = new MutationObserver(function () {
    if (!live) return;
    clearTimeout(timer); timer = setTimeout(refreshUd, 350);
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });

  /* ヘッダをつかんで移動 */
  (function () {
    var sx, sy, ox, oy, moving = false;
    head.addEventListener('mousedown', function (e) {
      if (e.target !== head && e.target.tagName === 'BUTTON') return;
      moving = true; sx = e.clientX; sy = e.clientY;
      var r = p.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!moving) return;
      p.style.left = (ox + e.clientX - sx) + 'px';
      p.style.top = (oy + e.clientY - sy) + 'px';
      p.style.right = 'auto'; p.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { moving = false; });
  })();

  refreshUd();
})();

}
__udyyRun();
document.addEventListener('keydown', function (e) {
  if (e.altKey && (e.key === 'u' || e.key === 'U' || e.code === 'KeyU')) __udyyRun();
});
