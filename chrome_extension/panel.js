/* 自動生成。udtalk_live_panel.js を編集して build_extension.command を実行すること。 */
function __udyyRun() {
/* UDトーク「ウェブで公開」ページに、YYprobe との比較パネルを重ねる。

   ■ 設計の要点：UDトークは「1発話ずつ」編集する
   UDとYYでは発話の区切りがまるで違う（UDは細かく切れ、YYは長くつながる）。
   複数発話をつなげて直すと、貼り付けたときに前後の発話まで入り込んで重複する。
   そこで「直す発話を1つ選ぶ → その発話に対応するYYの箇所を自動で切り出す →
   その発話だけを直す」形にしている。コピーされるのは常に1発話ぶんだけ。

   ■ 取り込み
   UD側：このページのDOMを監視（ルビ・途中経過を除去）
   YY側：YYの配信ページに入れた yy.js が chrome.storage 経由で送ってくる */
(function () {
  var ID = 'udyy-live';
  var old = document.getElementById(ID);
  if (old) { old.remove(); return; }

  /* ============ 差分ロジック ============ */
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

  function buildDp(a, b) {
    var n = a.length, m = b.length, w = m + 1;
    var dp = new Uint32Array((n + 1) * w), i, j;
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--)
        dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    return dp;
  }

  function rawOpcodes(a, b) {
    var n = a.length, m = b.length;
    if (!n && !m) return [];
    if (!n) return [[0, 0, 0, m]];
    if (!m) return [[0, n, 0, 0]];
    var w = m + 1, dp = buildDp(a, b);
    var ops = [], i = 0, j = 0, si = 0, sj = 0, inD = false;
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

  /* UD発話それぞれに対応するYY側の範囲を切り出す。

     発話ごとに個別に探すと範囲が前後へはみ出し、隣の発話ぶんまで拾ってしまう
     （＝貼り付けたときに文が重複する原因）。UDもYYも時系列なので、
     全発話をまとめて対応付け、境界で切り分けて重ならないようにする。 */
  function alignAll(items, yy) {
    var out = items.map(function () { return { text: '', ratio: 0 }; });
    if (!items.length || !yy) return out;

    var udAll = items.join('');
    var A = fold(udAll), B = fold(yy);
    if (!A.s.length || !B.s.length) return out;
    if (A.s.length * B.s.length > 4000000) return out;

    // 原文の位置 → 正規化後の位置（無視された文字は次の位置に寄せる）
    var o2f = new Int32Array(udAll.length + 1).fill(-1);
    for (var k = 0; k < A.origin.length; k++) {
      if (o2f[A.origin[k]] < 0) o2f[A.origin[k]] = k;
    }
    var nextv = A.s.length;
    for (var q = udAll.length; q >= 0; q--) {
      if (o2f[q] < 0) o2f[q] = nextv; else nextv = o2f[q];
    }

    // UDの各文字が、YYのどこに対応するか（単調増加）
    var a = A.s, b = B.s, n = a.length, m = b.length, w = m + 1;
    var dp = buildDp(a, b);
    var mapI = new Int32Array(n + 1).fill(-1);
    var matchedAt = new Uint8Array(n);
    var i = 0, j = 0;
    while (i < n && j < m) {
      if (mapI[i] < 0) mapI[i] = j;
      if (a[i] === b[j]) { matchedAt[i] = 1; i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
    while (i <= n) { if (mapI[i] < 0) mapI[i] = j; i++; }

    // 発話ごとに範囲を割り当てる
    var pos = 0;
    items.forEach(function (t, idx) {
      var fs2 = o2f[pos], fe = o2f[pos + t.length];
      pos += t.length;
      if (fe <= fs2) return;
      var j1 = mapI[fs2], j2 = mapI[fe];
      if (j2 < j1) j2 = j1;
      var s1 = j1 < B.origin.length ? B.origin[j1] : yy.length;
      var s2 = j2 < B.origin.length ? B.origin[j2] : yy.length;
      var hit = 0;
      for (var z = fs2; z < fe; z++) if (matchedAt[z]) hit++;
      out[idx] = { text: yy.slice(s1, Math.max(s1, s2)), ratio: hit / (fe - fs2) };
    });
    return out;
  }

  function compare(ud, yy) {
    var A = fold(ud), B = fold(yy);
    if (A.s.length * B.s.length > 4000000) return { ud: ud, yy: yy, changes: [] };
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
    var out = '', cursor = 0;
    changes.slice().sort(function (a, b) { return a.udStart - b.udStart; }).forEach(function (c) {
      if (c.udStart < cursor || c.choice === 'ud') return;
      out += ud.slice(cursor, c.udStart);
      out += (c.choice === 'custom' ? c.custom : c.yy);
      cursor = c.udEnd;
    });
    return out + ud.slice(cursor);
  }

  function isMinor(c) { return KANA_ONLY.test(c.ud) && KANA_ONLY.test(c.yy); }

  /* 検証用の入口。挙動には影響しないが、実ページ上で
     alignYY / compare の結果を確かめられるようにしておく。 */
  try { window.__udyyDebug = { alignAll: alignAll, compare: compare, fold: fold }; } catch (e) { }

  /* ============ ページからの取り込み ============ */
  function clean(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('rt,rp').forEach(function (n) { n.remove(); });
    c.querySelectorAll('br').forEach(function (n) { n.replaceWith(' '); });
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

  /* ============ 画面 ============ */
  var fs = 15, full = false, live = true;
  var udItems = [], selText = null, yyLines = null, result = null, timer = null;

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
  function label(text, color) {
    return el('div', 'flex:0 0 auto;font-size:11px;margin:0 0 3px;color:' + (color || '#93a2b1'), text);
  }

  var p = el('div', '');
  p.id = ID;

  var head = el('div', 'flex:0 0 auto;display:flex;gap:6px;align-items:center;margin-bottom:8px;cursor:move');
  head.appendChild(el('b', 'flex:1;font-size:13px', 'UD × YY ライブ比較'));

  var liveBtn = btn('自動取得: ON', function () { setLive(!live); }, 'background:#1d4d2e;border-color:#3c9a59');
  head.appendChild(liveBtn);
  var nSel = el('select', 'font:13px sans-serif;padding:4px;border-radius:6px;background:#232c35;color:#e9edf1;border:1px solid #5a656f');
  [['3', '直近3件'], ['5', '直近5件'], ['8', '直近8件']].forEach(function (o) {
    var op = el('option', '', o[1]); op.value = o[0]; nSel.appendChild(op);
  });
  nSel.value = '5';
  nSel.onchange = function () { refresh(true); };
  head.appendChild(nSel);
  var fullBtn = btn('全画面', function () { setFull(!full); });
  head.appendChild(fullBtn);
  head.appendChild(btn('×', function () { obs.disconnect(); p.remove(); }));
  p.appendChild(head);

  p.appendChild(label('① 直す発話を選ぶ（UDトーク）', '#e8a33d'));
  var udList = el('div', 'flex:1 1 0;min-height:64px;overflow-y:auto;margin-bottom:7px;' +
    'border:1px solid #e8a33d55;border-radius:8px;padding:5px;background:#0c1015');
  p.appendChild(udList);

  var yyLabel = label('② 対応するYYprobeの箇所（自動）', '#5fb37a');
  p.appendChild(yyLabel);
  /* 自動で埋まるが、手で書き換えることもできる（拡張機能が使えないときの逃げ道）。
     手を入れた場合は、その内容をそのままこの発話に対応するYYとして扱う。 */
  var yyBox = el('textarea', 'flex:0 0 auto;height:64px;background:#0c1015;color:#e9edf1;' +
    'border:1px solid #5fb37a55;border-radius:8px;padding:6px 9px;resize:none;margin-bottom:7px;' +
    'font:15px/1.6 "Hiragino Sans",sans-serif;width:100%');
  var yyManual = false;
  yyBox.addEventListener('input', function () {
    yyManual = true;
    clearTimeout(timer);
    timer = setTimeout(function () { recompare(true); }, 200);
  });
  p.appendChild(yyBox);

  p.appendChild(label('③ 食い違いを選ぶ'));
  var listWrap = el('div', 'flex:1.4 1 0;min-height:70px;overflow-y:auto;margin-bottom:7px');
  p.appendChild(listWrap);

  p.appendChild(label('④ この発話の直した文（これだけをUDトークに貼る）'));
  var outBox = el('textarea', '');
  p.appendChild(outBox);

  var foot = el('div', 'flex:0 0 auto;display:flex;gap:6px;align-items:center;margin-top:7px');
  foot.appendChild(btn('決定してコピー', decide, 'background:#2e7d46;border-color:#3c9a59;font-weight:700'));
  var showMinor = false;
  var minorBtn = btn('言い回しも表示', function () {
    showMinor = !showMinor;
    minorBtn.style.background = showMinor ? '#1b3358' : '#232c35';
    render();
  });
  foot.appendChild(minorBtn);
  var stat = el('div', 'flex:1;font-size:11px;color:#93a2b1;text-align:right');
  foot.appendChild(stat);
  p.appendChild(foot);
  document.body.appendChild(p);

  function setFull(on) {
    full = on;
    fullBtn.textContent = full ? '小さく' : '全画面';
    fs = full ? 20 : 15;
    var base = 'position:fixed;z-index:2147483647;background:#12161b;color:#e9edf1;' +
      'font:13px/1.6 "Hiragino Sans",sans-serif;display:flex;flex-direction:column;overflow:hidden;' +
      'border:1px solid #4a545e;box-shadow:0 10px 30px rgba(0,0,0,.6);';
    p.style.cssText = base + (full
      ? 'inset:0;border-radius:0;padding:16px 20px;'
      : 'right:14px;bottom:14px;width:470px;height:min(640px,86vh);border-radius:12px;padding:10px;');
    udList.style.fontSize = fs + 'px';
    yyBox.style.font = fs + 'px/1.6 "Hiragino Sans",sans-serif';
    yyBox.style.height = (full ? 92 : 64) + 'px';
    outBox.style.cssText = 'flex:0 0 auto;width:100%;height:' + (full ? '110px' : '78px') +
      ';background:#0c1015;color:#e9edf1;border:1px solid #5a656f;border-radius:8px;padding:7px 9px;' +
      'font:' + fs + 'px/1.6 "Hiragino Sans",sans-serif;resize:none';
    render();
  }

  function setLive(on, why) {
    live = on;
    liveBtn.textContent = '自動取得: ' + (live ? 'ON' : '固定');
    liveBtn.style.background = live ? '#1d4d2e' : '#5a3a12';
    liveBtn.style.borderColor = live ? '#3c9a59' : '#c08a3e';
    if (live) refresh(true);
    if (why) stat.textContent = why;
  }

  /* ============ データの流れ ============ */
  function refresh(force) {
    if (!live && !force) return;
    var n = parseInt(nSel.value, 10);
    var all = udLines();
    var next = all.slice(-n);
    // 選んだ発話が直近N件から流れ出ても、一覧に残して選択を保つ。
    // （直している途中に対象が消えると作業がやり直しになる）
    if (selText && next.indexOf(selText) < 0 && all.indexOf(selText) >= 0) {
      next = [selText].concat(next);
    }
    if (!force && next.join('␟') === udItems.join('␟')) return;
    udItems = next;
    if (selText === null || udItems.indexOf(selText) < 0) {
      selText = udItems.length ? udItems[udItems.length - 1] : null;
    }
    recompare();
  }

  function yyText() { return yyLines ? yyLines.join('\n') : ''; }

  var lastSig = null;
  function recompare(force) {
    if (!selText) { result = null; lastSig = null; render(); return; }

    // この発話に対応するYY側の文字列を決める（手入力があればそれを優先）
    var yyWin, ratio;
    if (yyManual && yyBox.value.trim()) {
      yyWin = yyBox.value; ratio = 1;
    } else {
      var wins = alignAll(udItems, yyText());
      var al = wins[udItems.indexOf(selText)] || { text: '', ratio: 0 };
      yyWin = al.text; ratio = al.ratio;
    }

    // 比較の中身が前と同じなら作り直さない。作り直すと選んだ内容が消えるため。
    // ✎ に入力している最中も触らない。
    var sig = selText + '␟' + yyWin;
    if (!force) {
      if (sig === lastSig) { renderUdList(); return; }
      if (listWrap.contains(document.activeElement)) { renderUdList(); return; }
    }

    var prev = {};
    if (result) {
      result.changes.forEach(function (c) {
        prev[c.ud + '␟' + c.yy] = { choice: c.choice, custom: c.custom };
      });
    }
    lastSig = sig;
    result = yyWin ? compare(selText, yyWin) : { ud: selText, yy: '', changes: [] };
    result.ratio = ratio;
    result.changes.forEach(function (c) {
      var q = prev[c.ud + '␟' + c.yy];
      if (q) { c.choice = q.choice; c.custom = q.custom; }
    });
    render();
  }

  function renderUdList() {
    var atBottom = udList.scrollHeight - udList.scrollTop - udList.clientHeight < 24;
    udList.innerHTML = '';
    if (!udItems.length) {
      udList.appendChild(el('div', 'color:#93a2b1;font-size:12px;padding:4px', '字幕を待っています'));
    }
    udItems.forEach(function (t) {
      var on = t === selText;
      var row = el('div', 'padding:5px 7px;margin:2px 0;border-radius:6px;cursor:pointer;' +
        'font-size:' + fs + 'px;line-height:1.5;' +
        (on ? 'background:#4a3410;border:1px solid #e8a33d' : 'border:1px solid transparent'), t);
      row.onclick = function () {
        // 止めない。選んだ発話は流れても固定されるので、裏では取り込みを続ける。
        selText = t;
        yyManual = false;
        recompare(true);
      };
      udList.appendChild(row);
    });
    if (atBottom) udList.scrollTop = udList.scrollHeight;
  }

  function render() {
    renderUdList();

    /* ② 対応するYY */
    if (!yyManual) {
      yyBox.value = result && result.yy ? result.yy : '';
      yyBox.placeholder = yyLines ? '（対応する箇所が見つかりません）'
        : 'YYの配信ページを開くと自動で入ります。手で貼り付けることもできます。';
    }

    /* ③ 候補 */
    listWrap.innerHTML = '';
    var shown = 0, minor = 0;
    if (result) {
      result.changes.forEach(function (c) {
        if (isMinor(c)) { minor++; if (!showMinor) return; }
        shown++;
        var row = el('div', 'border:1px solid #39424b;border-radius:8px;padding:6px;margin-bottom:5px;' +
          'background:#171d24;display:flex;gap:6px;align-items:stretch');
        row.appendChild(el('div', 'font-size:11px;color:#93a2b1;display:flex;align-items:center', String(c.index)));
        function opt(kind, who, text, empty) {
          var b = el('button', 'flex:1;text-align:left;font:' + fs + 'px "Hiragino Sans",sans-serif;' +
            'padding:5px 8px;border-radius:6px;border:1px solid #4a545e;background:#1d242c;' +
            'color:#e9edf1;cursor:pointer');
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
          c.choice = 'custom';
          render();
          var i2 = listWrap.querySelector('input[data-i="' + c.index + '"]');
          if (i2) { i2.focus(); i2.select(); }
        });
        if (c.choice === 'custom') { ed.style.borderColor = '#7aa9ff'; ed.style.background = '#1b3358'; }
        row.appendChild(ed);
        listWrap.appendChild(row);
        if (c.choice === 'custom') {
          var inp = el('input', 'width:100%;margin:-2px 0 6px;padding:6px 8px;border-radius:6px;' +
            'border:1px solid #7aa9ff;background:#0d1622;color:#e9edf1;' +
            'font:' + fs + 'px "Hiragino Sans",sans-serif');
          inp.value = c.custom; inp.setAttribute('data-i', c.index);
          inp.oninput = function () { c.custom = inp.value; paint(); };
          listWrap.appendChild(inp);
        }
      });
      if (!result.changes.length) {
        listWrap.appendChild(el('div', 'font-size:12px;color:#93a2b1;padding:4px',
          result.yy ? 'この発話に食い違いはありません。' : 'YYの対応箇所がないため比較できません。'));
      } else if (!shown) {
        listWrap.appendChild(el('div', 'font-size:12px;color:#93a2b1;padding:4px',
          '言い回しの差 ' + minor + ' 件のみ（結果には反映済み）'));
      }
    }
    paint();
    if (result) {
      var need = result.changes.length - minor;
      stat.textContent = '要判断 ' + need + ' / 言い回し ' + minor +
        (result.ratio < 0.4 ? '　※YYとの対応が弱いです' : '');
    }
  }

  function paint() {
    outBox.value = result ? applyChoices(result.ud, result.changes) : '';
  }

  function decide() {
    var t = outBox.value;
    if (!t.trim()) { stat.textContent = 'コピーする内容がありません'; return; }
    outBox.focus(); outBox.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(function () { });
    var msg = ok ? '✓ この発話をコピーしました' : '選択済み。⌘C を押してください';
    if (!live) setLive(true);
    stat.textContent = msg + '（自動取得を再開）';
  }

  /* ============ YY側の受信 ============ */
  function extAlive() {
    try {
      return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id &&
        chrome.storage && !!chrome.storage.local;
    } catch (e) { return false; }
  }
  if (extAlive()) {
    try {
      chrome.storage.local.get('udyy_yy', function (o) {
        if (o && o.udyy_yy) { yyLines = o.udyy_yy.lines; if (live) recompare(); }
      });
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area === 'local' && ch.udyy_yy && ch.udyy_yy.newValue) {
          yyLines = ch.udyy_yy.newValue.lines;
          if (live) recompare();
        }
      });
    } catch (e) {
      yyLabel.textContent = '② YY受信が切れています。ページを再読み込みしてください';
      yyLabel.style.color = '#ffd479';
    }
  } else {
    yyLabel.textContent = '② 対応するYYprobeの箇所（拡張機能が無効です）';
  }

  /* ============ 監視・移動 ============ */
  var obs = new MutationObserver(function () {
    if (!live) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 350);
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });

  (function () {
    var sx, sy, ox, oy, moving = false;
    head.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
      moving = true; sx = e.clientX; sy = e.clientY;
      var r = p.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!moving || full) return;
      p.style.left = (ox + e.clientX - sx) + 'px';
      p.style.top = (oy + e.clientY - sy) + 'px';
      p.style.right = 'auto'; p.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { moving = false; });
  })();

  setFull(false);
  refresh(true);
})();

}
__udyyRun();
document.addEventListener('keydown', function (e) {
  if (e.altKey && (e.key === 'u' || e.key === 'U' || e.code === 'KeyU')) __udyyRun();
});
