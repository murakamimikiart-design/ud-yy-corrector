#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""diff_engine の単体テスト（GUI不要・python3 test_diff_engine.py で実行）"""

import json
import os
import unittest

from diff_engine import apply_changes, compare, format_changes

HERE = os.path.dirname(os.path.abspath(__file__))


class TestCompare(unittest.TestCase):

    def test_identical(self):
        t = "本日はお集まりいただきありがとうございます。"
        res = compare(t, t)
        self.assertEqual(res.count, 0)
        self.assertEqual(apply_changes(t, res.changes)[0], t)

    def test_punctuation_only_is_ignored(self):
        res = compare("ありがとうございました", "ありがとうございました。")
        self.assertEqual(res.count, 0)

    def test_punctuation_counted_when_option_off(self):
        res = compare("ありがとうございました", "ありがとうございました。",
                      ignore_punct=False)
        self.assertEqual(res.count, 1)

    def test_fullwidth_halfwidth_ignored(self):
        res = compare("参加者は１２０名です。", "参加者は120名です。")
        self.assertEqual(res.count, 0)

    def test_simple_replace(self):
        res = compare("いい転記ですね。", "いい天気ですね。")
        self.assertEqual(res.count, 1)
        c = res.changes[0]
        self.assertEqual(c.kind, "replace")
        self.assertEqual(c.ud, "転記")
        self.assertEqual(c.yy, "天気")
        self.assertEqual(apply_changes(res.ud, res.changes)[0], "いい天気ですね。")

    def test_insert_missing_words(self):
        ud = "それでは質疑応答に移ります。"
        yy = "それでは、ここから質疑応答に移ります。挙手をお願いします。"
        res = compare(ud, yy)
        self.assertGreaterEqual(res.count, 1)
        self.assertEqual(apply_changes(ud, res.changes)[0].replace("、", ""),
                         yy.replace("、", ""))

    def test_delete_extra_words(self):
        ud = "資料をご覧ください。ください。"
        yy = "資料をご覧ください。"
        res = compare(ud, yy)
        self.assertEqual(apply_changes(ud, res.changes)[0], yy)

    def test_partial_acceptance_keeps_ud(self):
        """不採用にした変更は UD 側の表記が残る"""
        ud = "村上みきさんの発表を始めます。開始は14自30分です。"
        yy = "村上美樹さんの発表を始めます。開始は14時30分です。"
        res = compare(ud, yy)
        self.assertEqual(res.count, 2)
        res.changes[0].accepted = False
        out, spans = apply_changes(ud, res.changes)
        self.assertIn("村上みき", out)
        self.assertIn("14時30分", out)
        self.assertEqual(len(spans), 1)
        self.assertEqual(out[spans[0][0]:spans[0][1]], res.changes[1].yy)

    def test_spans_point_at_corrections(self):
        ud = "いい転記ですね。"
        yy = "いい天気ですね。"
        res = compare(ud, yy)
        out, spans = apply_changes(ud, res.changes)
        self.assertEqual([out[s:e] for s, e in spans], ["天気"])

    def test_empty_ud_takes_all_of_yy(self):
        res = compare("", "今日はいい天気です。")
        self.assertEqual(apply_changes("", res.changes)[0], "今日はいい天気です。")

    def test_multiline(self):
        ud = "用途トークは標準的なツールです\nしかし精度に課題があります"
        yy = "UDトークは標準的なツールです\nしかし精度に課題があります"
        res = compare(ud, yy)
        self.assertEqual(res.count, 1)
        self.assertEqual(apply_changes(ud, res.changes)[0], yy)

    def test_changes_do_not_overlap_and_are_ordered(self):
        ud = "きょうわ、いい転記ですね。田中さんが以下です。"
        yy = "今日は、いい天気ですね。田中さんが行かれます。"
        res = compare(ud, yy)
        last = 0
        for c in res.changes:
            self.assertGreaterEqual(c.ud_start, last)
            self.assertGreaterEqual(c.ud_end, c.ud_start)
            self.assertEqual(ud[c.ud_start:c.ud_end], c.ud)
            last = c.ud_end


class TestSamples(unittest.TestCase):
    """testdata/samples.json の全ペアで「全採用＝YY相当」になることを確認"""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, "testdata", "samples.json"), encoding="utf-8") as f:
            cls.pairs = json.load(f)["pairs"]

    @staticmethod
    def _loose(text):
        import re
        return re.sub(r"[\s、。]", "", text)

    def test_all_samples_converge_to_yy(self):
        for pair in self.pairs:
            with self.subTest(pair["title"]):
                res = compare(pair["ud"], pair["yy"])
                out, _ = apply_changes(pair["ud"], res.changes)
                self.assertEqual(self._loose(out), self._loose(pair["yy"]),
                                 msg=format_changes(res))


if __name__ == "__main__":
    unittest.main(verbosity=2)
