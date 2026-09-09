#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UDトーク × YYprobe 半自動修正補助ツール
9月13日トークイベント向け

- YYprobe の正確な出力を「正」として、UDトークの誤りだけを直す。
- 変更は 1 件ずつ採用／不採用を選べる（全文置換ではない）。
- 追加インストール不要：Python 標準の tkinter だけで動く。

起動:  python3 uy_transcription_corrector.py
"""

import json
import os
import subprocess
import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox

from diff_engine import DiffResult, apply_changes, compare

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(HERE, "testdata", "samples.json")

BG = "#1b1f24"
PANEL = "#12161a"
FG = "#e8e8e8"
ACCENT = "#2f7de1"
OK_GREEN = "#2e7d46"
WARN = "#c0392b"
JP_FONT = "Hiragino Sans"


# ---------------------------------------------------------------- clipboard
def clipboard_read(root):
    """クリップボードを読む（pbpaste 優先。なければ tk）"""
    try:
        return subprocess.run(["pbpaste"], capture_output=True, text=True,
                              check=True).stdout
    except Exception:
        try:
            return root.clipboard_get()
        except tk.TclError:
            return ""


def clipboard_write(root, text):
    """クリップボードに書く（アプリ終了後も残るよう pbcopy も使う）"""
    root.clipboard_clear()
    root.clipboard_append(text)
    root.update_idletasks()
    try:
        subprocess.run(["pbcopy"], input=text, text=True, check=True)
    except Exception:
        pass


class App:
    def __init__(self, root):
        self.root = root
        self.result = None
        self.font_size = 15
        self.auto = tk.BooleanVar(value=True)
        self.ignore_punct = tk.BooleanVar(value=True)
        self._after_id = None
        self._samples = self._load_samples()
        self._sample_i = 0

        root.title("UDトーク修正補助ツール（YYprobe基準）")
        root.configure(bg=BG)
        root.geometry("1180x860")
        root.minsize(900, 640)

        self.f_ui = tkfont.Font(family=JP_FONT, size=13)
        self.f_text = tkfont.Font(family=JP_FONT, size=self.font_size)
        self.f_head = tkfont.Font(family=JP_FONT, size=14, weight="bold")

        self._build_toolbar()
        self._build_inputs()
        self._build_middle()
        self._build_output()
        self._build_status()
        self._bind_keys()
        self.compare_now()

    # ------------------------------------------------------------ 部品作り
    def _label(self, parent, text, font=None, fg=FG):
        return tk.Label(parent, text=text, bg=BG, fg=fg, font=font or self.f_ui)

    def _button(self, parent, text, cmd, color=None, width=None):
        return tk.Button(parent, text=text, command=cmd, font=self.f_ui,
                         width=width, highlightbackground=BG,
                         fg="black" if color is None else "white",
                         bg=color or "#dddddd", activebackground=color or "#cccccc")

    def _build_toolbar(self):
        bar = tk.Frame(self.root, bg=BG)
        bar.pack(fill="x", padx=12, pady=(10, 4))
        self._label(bar, "UDトーク × YYprobe 修正補助", font=self.f_head).pack(side="left")
        self._button(bar, "終了", self.root.destroy).pack(side="right", padx=(6, 0))
        self._button(bar, "リセット", self.reset).pack(side="right", padx=6)
        self._button(bar, "大きく ＋", lambda: self.zoom(1)).pack(side="right")
        self._button(bar, "小さく －", lambda: self.zoom(-1)).pack(side="right", padx=6)
        self._button(bar, "サンプル読込", self.load_sample).pack(side="right", padx=6)
        tk.Checkbutton(bar, text="句読点の違いは無視", variable=self.ignore_punct,
                       command=self.compare_now, bg=BG, fg=FG, selectcolor=PANEL,
                       activebackground=BG, activeforeground=FG,
                       font=self.f_ui).pack(side="right", padx=10)
        tk.Checkbutton(bar, text="自動で比較", variable=self.auto, bg=BG, fg=FG,
                       selectcolor=PANEL, activebackground=BG, activeforeground=FG,
                       font=self.f_ui).pack(side="right")

    def _text_pane(self, parent, title, hint, color):
        frame = tk.Frame(parent, bg=BG)
        head = tk.Frame(frame, bg=BG)
        head.pack(fill="x")
        self._label(head, title, font=self.f_head, fg=color).pack(side="left")
        self._label(head, hint).pack(side="left", padx=8)
        box = tk.Frame(frame, bg=BG)
        box.pack(fill="both", expand=True)
        txt = tk.Text(box, height=8, font=self.f_text, bg=PANEL, fg=FG,
                      insertbackground=FG, wrap="word", relief="flat",
                      highlightthickness=1, highlightbackground="#33393f",
                      padx=8, pady=6, undo=True)
        sb = tk.Scrollbar(box, command=txt.yview)
        txt.configure(yscrollcommand=sb.set)
        txt.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        return frame, txt

    def _build_inputs(self):
        wrap = tk.Frame(self.root, bg=BG)
        wrap.pack(fill="both", expand=True, padx=12, pady=4)
        wrap.columnconfigure(0, weight=1)
        wrap.columnconfigure(1, weight=1)
        wrap.rowconfigure(0, weight=1)

        left, self.ud = self._text_pane(wrap, "UDトーク（修正する側）", "⌘1", "#e8a33d")
        right, self.yy = self._text_pane(wrap, "YYprobe（正しい側）", "⌘2", "#5fb37a")
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        right.grid(row=0, column=1, sticky="nsew", padx=(6, 0))

        lb = tk.Frame(left, bg=BG)
        lb.pack(fill="x", pady=4)
        self._button(lb, "貼り付け", lambda: self.paste_into(self.ud)).pack(side="left")
        self._button(lb, "クリア", lambda: self.clear(self.ud)).pack(side="left", padx=6)
        rb = tk.Frame(right, bg=BG)
        rb.pack(fill="x", pady=4)
        self._button(rb, "貼り付け", lambda: self.paste_into(self.yy)).pack(side="left")
        self._button(rb, "クリア", lambda: self.clear(self.yy)).pack(side="left", padx=6)
        self._button(rb, "差分を検出（⌘R）", self.compare_now,
                     color=ACCENT).pack(side="right")

        for t in (self.ud, self.yy):
            t.bind("<<Modified>>", self._on_modified)

    def _build_middle(self):
        wrap = tk.Frame(self.root, bg=BG)
        wrap.pack(fill="both", expand=True, padx=12, pady=4)
        wrap.columnconfigure(0, weight=1)
        wrap.columnconfigure(1, weight=1)
        wrap.rowconfigure(1, weight=1)

        self._label(wrap, "修正候補（クリックで採用／不採用を切替）",
                    font=self.f_head).grid(row=0, column=0, sticky="w")
        self._label(wrap, "プレビュー（緑＝修正される部分）",
                    font=self.f_head).grid(row=0, column=1, sticky="w", padx=(12, 0))

        lbox = tk.Frame(wrap, bg=BG)
        lbox.grid(row=1, column=0, sticky="nsew", padx=(0, 6))
        self.changes_list = tk.Listbox(lbox, selectmode=tk.MULTIPLE, font=self.f_text,
                                       bg=PANEL, fg=FG, relief="flat", height=7,
                                       highlightthickness=1, highlightbackground="#33393f",
                                       selectbackground=OK_GREEN, selectforeground="white",
                                       activestyle="none", exportselection=False)
        sb1 = tk.Scrollbar(lbox, command=self.changes_list.yview)
        self.changes_list.configure(yscrollcommand=sb1.set)
        self.changes_list.pack(side="left", fill="both", expand=True)
        sb1.pack(side="right", fill="y")
        self.changes_list.bind("<<ListboxSelect>>", lambda e: self.refresh_preview())

        pbox = tk.Frame(wrap, bg=BG)
        pbox.grid(row=1, column=1, sticky="nsew", padx=(6, 0))
        self.preview = tk.Text(pbox, font=self.f_text, bg=PANEL, fg=FG, wrap="word",
                               relief="flat", height=7, padx=8, pady=6,
                               highlightthickness=1, highlightbackground="#33393f")
        sb2 = tk.Scrollbar(pbox, command=self.preview.yview)
        self.preview.configure(yscrollcommand=sb2.set, state="disabled")
        self.preview.pack(side="left", fill="both", expand=True)
        sb2.pack(side="right", fill="y")
        self.preview.tag_configure("fix", background="#1d4d2e", foreground="#c9f7d5")

        btns = tk.Frame(wrap, bg=BG)
        btns.grid(row=2, column=0, columnspan=2, sticky="w", pady=6)
        self._button(btns, "すべて採用", lambda: self.select_all(True)).pack(side="left")
        self._button(btns, "すべて不採用", lambda: self.select_all(False)).pack(side="left", padx=6)

    def _build_output(self):
        wrap = tk.Frame(self.root, bg=BG)
        wrap.pack(fill="both", expand=True, padx=12, pady=4)
        self._label(wrap, "修正済みテキスト（このままUDトークに貼り付け）",
                    font=self.f_head).pack(anchor="w")
        box = tk.Frame(wrap, bg=BG)
        box.pack(fill="both", expand=True)
        self.output = tk.Text(box, font=self.f_text, bg=PANEL, fg=FG, wrap="word",
                              relief="flat", height=5, padx=8, pady=6,
                              insertbackground=FG, highlightthickness=1,
                              highlightbackground="#33393f", undo=True)
        sb = tk.Scrollbar(box, command=self.output.yview)
        self.output.configure(yscrollcommand=sb.set)
        self.output.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        btns = tk.Frame(wrap, bg=BG)
        btns.pack(fill="x", pady=6)
        self._button(btns, "コピー（⌘⇧C）", self.copy_output,
                     color=OK_GREEN).pack(side="left")
        self._button(btns, "UD欄に反映して次へ", self.push_to_ud).pack(side="left", padx=8)

    def _build_status(self):
        self.status = tk.Label(self.root, text="", bg="#0d1013", fg="#9fb0c0",
                               font=self.f_ui, anchor="w", padx=12, pady=6)
        self.status.pack(fill="x", side="bottom")

    def _bind_keys(self):
        self.root.bind("<Command-r>", lambda e: self.compare_now())
        self.root.bind("<Command-Shift-C>", lambda e: self.copy_output())
        self.root.bind("<Command-Key-1>", lambda e: self.ud.focus_set())
        self.root.bind("<Command-Key-2>", lambda e: self.yy.focus_set())
        self.root.bind("<Command-Key-0>", lambda e: self.reset())

    # -------------------------------------------------------------- 動作
    def _on_modified(self, event):
        widget = event.widget
        widget.edit_modified(False)
        if not self.auto.get():
            return
        if self._after_id:
            self.root.after_cancel(self._after_id)
        self._after_id = self.root.after(350, self.compare_now)

    def compare_now(self, *_):
        self._after_id = None
        ud = self.ud.get("1.0", "end-1c")
        yy = self.yy.get("1.0", "end-1c")
        if not yy.strip():
            # YY 側が空のときに「UD 全文を削除」という差分を出すと危険なので、
            # 比較そのものを行わず UD をそのまま残す。
            self.result = DiffResult(ud=ud, yy=yy, changes=[], similarity=1.0)
        else:
            self.result = compare(ud, yy, ignore_punct=self.ignore_punct.get())

        self.changes_list.delete(0, "end")
        for c in self.result.changes:
            self.changes_list.insert("end", c.label())
        self.changes_list.select_set(0, "end")   # 既定は全採用
        self.refresh_preview()

    def _sync_accepted(self):
        chosen = set(self.changes_list.curselection())
        for i, c in enumerate(self.result.changes):
            c.accepted = i in chosen

    def refresh_preview(self):
        if self.result is None:
            return
        self._sync_accepted()
        text, spans = apply_changes(self.result.ud, self.result.changes)

        self.preview.configure(state="normal")
        self.preview.delete("1.0", "end")
        self.preview.insert("1.0", text)
        for s, e in spans:
            self.preview.tag_add("fix", f"1.0+{s}c", f"1.0+{e}c")
        self.preview.configure(state="disabled")

        self.output.delete("1.0", "end")
        self.output.insert("1.0", text)

        n = self.result.count
        taken = sum(1 for c in self.result.changes if c.accepted)
        has_ud = bool(self.result.ud.strip())
        has_yy = bool(self.result.yy.strip())
        if not has_ud and not has_yy:
            msg = "両方のテキストを貼り付けてください（左＝UDトーク／右＝YYprobe）"
        elif not has_yy:
            msg = "YYprobe のテキストを右に貼り付けてください（⌘2）"
        elif not has_ud:
            msg = "UDトークのテキストを左に貼り付けてください（⌘1）"
        elif n == 0:
            msg = "✓ 差分なし。修正の必要はありません。"
        else:
            msg = f"差分 {n} 件／採用 {taken} 件　一致率 {self.result.similarity * 100:.1f}%"
        self.status.configure(text=msg)

    def select_all(self, on):
        if on:
            self.changes_list.select_set(0, "end")
        else:
            self.changes_list.selection_clear(0, "end")
        self.refresh_preview()

    def paste_into(self, widget):
        text = clipboard_read(self.root)
        if not text.strip():
            messagebox.showwarning("貼り付け", "クリップボードが空です。")
            return
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        self.compare_now()

    def clear(self, widget):
        widget.delete("1.0", "end")
        self.compare_now()

    def copy_output(self, *_):
        text = self.output.get("1.0", "end-1c")
        if not text.strip():
            messagebox.showwarning("コピー", "コピーする内容がありません。")
            return
        clipboard_write(self.root, text)
        self.status.configure(text="✓ コピーしました。UDトークに貼り付けてください。")

    def push_to_ud(self):
        """修正済みをUD欄へ移し、YY欄を空けて次の発話に備える"""
        text = self.output.get("1.0", "end-1c")
        self.ud.delete("1.0", "end")
        self.ud.insert("1.0", text)
        self.yy.delete("1.0", "end")
        self.yy.focus_set()
        self.compare_now()

    def reset(self, *_):
        for w in (self.ud, self.yy, self.output):
            w.delete("1.0", "end")
        self.compare_now()

    def zoom(self, delta):
        self.font_size = max(10, min(30, self.font_size + delta))
        self.f_text.configure(size=self.font_size)

    # ------------------------------------------------------------ サンプル
    def _load_samples(self):
        try:
            with open(SAMPLES, encoding="utf-8") as f:
                return json.load(f)["pairs"]
        except Exception:
            return []

    def load_sample(self):
        if not self._samples:
            messagebox.showinfo("サンプル", "testdata/samples.json が読み込めません。")
            return
        pair = self._samples[self._sample_i % len(self._samples)]
        self._sample_i += 1
        self.ud.delete("1.0", "end")
        self.ud.insert("1.0", pair["ud"])
        self.yy.delete("1.0", "end")
        self.yy.insert("1.0", pair["yy"])
        self.compare_now()
        self.status.configure(text=f"サンプル: {pair['title']}（{self.status.cget('text')}）")


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
