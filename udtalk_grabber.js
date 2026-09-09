/* UDトーク「ウェブで公開」ページ（live.udtalk.jp）から、
   ふりがな（ルビ）を取り除いた素のテキストを取り出すブックマークレット。

   このページは漢字に <ruby><rt>ふりがな</rt></ruby> が付いているため、
   普通に選択してコピーすると「担当たんとう」のようにルビが本文に混ざる。
   <rt> と <rp> を取り除いてから取り出すことで、修正補助ツールに
   そのまま貼れるテキストになる。

   ※ .v-list-item__subtitle は UDトーク側の内部クラス名。
     サイト更新で変わる可能性があるため、ルビを含む要素を探す予備手段も入れてある。 */
(function () {
  var old = document.getElementById('udyy-panel');
  if (old) { old.remove(); return; }

  function clean(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('rt,rp').forEach(function (n) { n.remove(); });
    c.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
    return c.textContent.replace(/[ \t]+/g, ' ').trim();
  }

  function lines() {
    var a = [].slice.call(document.querySelectorAll('.v-list-item__subtitle'));
    if (!a.length) {
      a = [].slice.call(document.querySelectorAll('div,p,li')).filter(function (e) {
        return e.querySelector('ruby') && !e.querySelector('div');
      });
    }
    // 認識中の途中経過は「...」だけの行として出るので落とす
    return a.map(clean).filter(function (t) { return t && !/^[.．…・\s]+$/.test(t); });
  }

  var p = document.createElement('div');
  p.id = 'udyy-panel';
  p.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:360px;background:rgba(17,20,24,.96);color:#fff;font:13px/1.5 -apple-system,sans-serif;padding:9px;border-radius:10px;border:1px solid #667;box-shadow:0 6px 20px rgba(0,0,0,.6)';

  var bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:7px';

  var ta = document.createElement('textarea');
  ta.style.cssText = 'width:100%;height:96px;background:#0c1015;color:#fff;border:1px solid #556;border-radius:7px;padding:7px;font:14px/1.6 sans-serif;resize:vertical';

  var st = document.createElement('div');
  st.style.cssText = 'color:#9fe3b5;margin-top:5px;min-height:17px';

  function btn(t, fn) {
    var b = document.createElement('button');
    b.textContent = t;
    b.style.cssText = 'font:13px sans-serif;padding:5px 9px;border-radius:6px;border:1px solid #667;background:#243040;color:#fff;cursor:pointer';
    b.onclick = fn;
    return b;
  }

  function take(n, label) {
    var a = lines();
    var t = (n ? a.slice(-n) : a).join('\n');
    ta.value = t; ta.focus(); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).catch(function () {});
    }
    st.textContent = ok ? '✓ ' + label + 'をコピーしました'
                        : '↑選択済み。⌘C でコピーしてください';
  }

  bar.appendChild(btn('最新1件', function () { take(1, '1件'); }));
  bar.appendChild(btn('最新3件', function () { take(3, '3件'); }));
  bar.appendChild(btn('全部',   function () { take(0, '全部'); }));
  bar.appendChild(btn('×',      function () { p.remove(); }));

  p.appendChild(bar); p.appendChild(ta); p.appendChild(st);
  document.body.appendChild(p);
  take(3, '3件');
})();
