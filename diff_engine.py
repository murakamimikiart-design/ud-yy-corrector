#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UDトーク × YYprobe 差分エンジン（GUI非依存・単体テスト可能）

設計方針:
- YYprobe の出力を「正」とし、UDトークのテキストの誤りだけを差し替える。
- 全文置換ではなく「変更点ごとに採用／不採用」を選べるようにする
  （UD側が正しい箇所やルビ付き表記を壊さないため）。
- 日本語向けに、比較時は句読点・空白・全半角のゆらぎを無視できる。
"""

from __future__ import annotations

import difflib
import unicodedata
from dataclasses import dataclass, field
from typing import List, Tuple

# 比較時に無視できる記号（長音「ー」は意味を持つので絶対に含めない）
IGNORE_PUNCT = set("、。，．,.！？!?…‥・「」『』（）()〈〉《》【】〔〕”“\"'‘’；;：:")


@dataclass
class Change:
    """UD → YY の変更 1 件"""

    index: int          # 1 始まりの通し番号
    kind: str           # 'replace' | 'delete' | 'insert'
    ud: str             # UD 側の該当文字列（insert のときは空）
    yy: str             # YY 側の該当文字列（delete のときは空）
    ud_start: int       # UD 原文中の開始位置
    ud_end: int         # UD 原文中の終了位置（insert のときは start と同じ）
    accepted: bool = True

    def label(self) -> str:
        """一覧表示用の 1 行ラベル"""
        if self.kind == "replace":
            return f"{self.index}. 「{self.ud}」→「{self.yy}」"
        if self.kind == "delete":
            return f"{self.index}. 「{self.ud}」を削除（YYには無い）"
        return f"{self.index}. 「{self.yy}」を挿入（UDに抜けている）"


@dataclass
class DiffResult:
    ud: str
    yy: str
    changes: List[Change] = field(default_factory=list)
    similarity: float = 1.0

    @property
    def count(self) -> int:
        return len(self.changes)


def _fold(text: str, ignore_punct: bool = True, ignore_space: bool = True
          ) -> Tuple[str, List[int]]:
    """
    比較用に文字列を正規化し、正規化後の各文字が原文の何文字目由来かを返す。

    戻り値: (正規化文字列, 原文インデックスの配列)
    """
    chars: List[str] = []
    origin: List[int] = []
    for i, ch in enumerate(text):
        if ignore_space and ch.isspace():
            continue
        if ignore_punct and ch in IGNORE_PUNCT:
            continue
        # 全角/半角のゆらぎを吸収（1 文字が複数文字に展開されても原文位置は同じ）
        for c in unicodedata.normalize("NFKC", ch):
            if ignore_space and c.isspace():
                continue
            chars.append(c)
            origin.append(i)
    return "".join(chars), origin


def _to_origin_span(origin: List[int], text_len: int, i1: int, i2: int) -> Tuple[int, int]:
    """
    正規化後の [i1, i2) を原文の [start, end) に戻す。

    終端は「次に残っている文字の直前」まで広げる。こうすると比較時に無視した
    句読点が範囲に含まれ、UD 側とYY 側で同じ扱いになるため、
    置換しても句読点が消えたり二重になったりしない。
    """
    start = origin[i1] if i1 < len(origin) else text_len
    end = origin[i2] if i2 < len(origin) else text_len
    return start, max(start, end)


def _merged_opcodes(matcher: difflib.SequenceMatcher, gap: int = 1) -> List[Tuple[int, int, int, int]]:
    """
    差分を粗くまとめる。
    日本語を 1 文字単位で差分すると「い→い天」のような細切れになるため、
    間に挟まる一致が gap 文字以下なら 1 件の変更として結合する。
    """
    blocks: List[Tuple[int, int, int, int]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if blocks:
            pi1, pi2, pj1, pj2 = blocks[-1]
            if (i1 - pi2) <= gap and (j1 - pj2) <= gap:
                blocks[-1] = (pi1, i2, pj1, j2)
                continue
        blocks.append((i1, i2, j1, j2))
    return blocks


def compare(ud: str, yy: str, ignore_punct: bool = True,
            ignore_space: bool = True, gap: int = 1) -> DiffResult:
    """UD テキストと YY テキストを比較して変更一覧を返す"""
    fud, oud = _fold(ud, ignore_punct, ignore_space)
    fyy, oyy = _fold(yy, ignore_punct, ignore_space)

    matcher = difflib.SequenceMatcher(None, fud, fyy, autojunk=False)
    result = DiffResult(ud=ud, yy=yy, similarity=matcher.ratio())

    for n, (i1, i2, j1, j2) in enumerate(_merged_opcodes(matcher, gap), 1):
        ud_start, ud_end = _to_origin_span(oud, len(ud), i1, i2)
        yy_start, yy_end = _to_origin_span(oyy, len(yy), j1, j2)
        ud_part = ud[ud_start:ud_end]
        yy_part = yy[yy_start:yy_end]
        if i1 == i2:
            kind = "insert"
        elif j1 == j2:
            kind = "delete"
        else:
            kind = "replace"
        result.changes.append(
            Change(index=n, kind=kind, ud=ud_part, yy=yy_part,
                   ud_start=ud_start, ud_end=ud_end)
        )
    return result


def apply_changes(ud: str, changes: List[Change]) -> Tuple[str, List[Tuple[int, int]]]:
    """
    採用された変更だけを UD 原文に適用する。

    戻り値: (修正済みテキスト, 修正済みテキスト内での変更箇所 [(start, end), ...])
    """
    out: List[str] = []
    spans: List[Tuple[int, int]] = []
    cursor = 0
    for ch in sorted(changes, key=lambda c: (c.ud_start, c.ud_end)):
        if not ch.accepted:
            continue
        if ch.ud_start < cursor:  # 念のための重なり防止
            continue
        out.append(ud[cursor:ch.ud_start])
        start = sum(len(s) for s in out)
        out.append(ch.yy)
        if ch.yy:
            spans.append((start, start + len(ch.yy)))
        cursor = ch.ud_end
    out.append(ud[cursor:])
    return "".join(out), spans


def format_changes(result: DiffResult) -> str:
    """テキスト出力用（ログ・CLI 確認用）"""
    if not result.changes:
        return "✓ 差分はありません（UDトークとYYprobeは一致）"
    lines = [f"【差分 {result.count} 件／一致率 {result.similarity * 100:.1f}%】", ""]
    lines += [c.label() for c in result.changes]
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    if len(sys.argv) == 3:
        with open(sys.argv[1], encoding="utf-8") as f:
            ud_text = f.read()
        with open(sys.argv[2], encoding="utf-8") as f:
            yy_text = f.read()
    else:
        ud_text = "きょうわ、いい転記ですね。田中さんが以下です。"
        yy_text = "今日は、いい天気ですね。田中さんが行かれます。"
    res = compare(ud_text, yy_text)
    print(format_changes(res))
    print("\n【修正案】")
    print(apply_changes(ud_text, res.changes)[0])
