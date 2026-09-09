#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UDトーク × YYprobe 半自動修正補助ツール
9月13日のトークイベント向け（5日間の急速実装）

要件：
- UDトークとYYprobeのテキスト比較
- 差分検出と色分け表示
- ワンクリック修正
- YYAPIなしで手動ペーストで動作
"""

import PySimpleGUI as sg
import difflib
from typing import List, Tuple

# テーマ設定
sg.theme('DarkBlue3')

class TranscriptionCorrector:
    def __init__(self):
        self.ud_text = ""
        self.yy_text = ""
        self.corrected_text = ""
        self.diffs = []
    
    def detect_differences(self, ud: str, yy: str) -> List[Tuple[str, str, str]]:
        """
        UDトークとYYprobeの差分を検出
        返値: [(操作タイプ, UDの部分, YYの部分), ...]
        """
        sm = difflib.SequenceMatcher(None, ud, yy)
        differences = []
        
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag != 'equal':
                ud_part = ud[i1:i2]
                yy_part = yy[j1:j2]
                differences.append((tag, ud_part, yy_part))
        
        return differences
    
    def generate_corrected_text(self) -> str:
        """
        YYの出力をベースに、修正済みテキストを生成
        """
        return self.yy_text
    
    def create_display_text(self) -> str:
        """
        差分検出結果を見やすく整形
        """
        if not self.ud_text or not self.yy_text:
            return "テキストを貼り付けてください"
        
        self.diffs = self.detect_differences(self.ud_text, self.yy_text)
        
        if not self.diffs:
            return "✓ 一致しています"
        
        display = "【差分検出結果】\n\n"
        for i, (tag, ud_part, yy_part) in enumerate(self.diffs, 1):
            if tag == 'replace':
                display += f"{i}. 誤り: '{ud_part}' → '{yy_part}'\n"
            elif tag == 'delete':
                display += f"{i}. 削除: '{ud_part}' （YYにはない）\n"
            elif tag == 'insert':
                display += f"{i}. 追加: '{yy_part}' （UDにはない）\n"
        
        return display


def create_layout():
    """
    UI レイアウト定義
    """
    layout = [
        [sg.Text('UDトーク × YYprobe 半自動修正補助ツール', font=('Arial', 14, 'bold'))],
        [sg.Text('9月13日トークイベント向け', font=('Arial', 10), text_color='lightblue')],
        [sg.Separator()],
        
        # 入力エリア（左右分割）
        [
            sg.Column([
                [sg.Text('UDトーク出力', font=('Arial', 11, 'bold'))],
                [sg.Multiline(
                    size=(40, 10),
                    key='UD_INPUT',
                    font=('Courier', 10),
                    background_color='#1a1a1a'
                )],
                [sg.Button('UDをクリア', size=(10, 1))]
            ], vertical_alignment='top'),
            
            sg.Column([
                [sg.Text('YYprobe出力', font=('Arial', 11, 'bold'))],
                [sg.Multiline(
                    size=(40, 10),
                    key='YY_INPUT',
                    font=('Courier', 10),
                    background_color='#1a1a1a'
                )],
                [sg.Button('YYをクリア', size=(10, 1))]
            ], vertical_alignment='top'),
        ],
        
        # 比較ボタン
        [sg.Button('差分を検出', size=(20, 1), button_color=('white', 'darkblue'))],
        
        # 差分表示エリア
        [sg.Text('【差分検出結果】', font=('Arial', 11, 'bold'))],
        [sg.Multiline(
            size=(85, 8),
            key='DIFF_OUTPUT',
            font=('Courier', 10),
            background_color='#0a0a0a',
            disabled=True
        )],
        
        # 修正済みテキスト
        [sg.Text('【修正済みテキスト（YY基準）】', font=('Arial', 11, 'bold'))],
        [sg.Multiline(
            size=(85, 6),
            key='CORRECTED_OUTPUT',
            font=('Courier', 10),
            background_color='#0a0a0a'
        )],
        
        # アクション
        [
            sg.Button('修正済みテキストをコピー', size=(20, 1), button_color=('white', 'green')),
            sg.Button('全て置き換え（YY→UD）', size=(20, 1), button_color=('white', 'orange')),
            sg.Button('リセット', size=(10, 1)),
            sg.Button('終了', size=(10, 1))
        ],
        
        [sg.Separator()],
        [sg.Text('💡 使い方：', font=('Arial', 10, 'bold'))],
        [sg.Text('1. UDトークのテキストを左に貼り付け', font=('Arial', 9))],
        [sg.Text('2. YYprobeのテキストを右に貼り付け', font=('Arial', 9))],
        [sg.Text('3. 「差分を検出」ボタンをクリック', font=('Arial', 9))],
        [sg.Text('4. 修正済みテキストが下に表示される', font=('Arial', 9))],
        [sg.Text('5. 「修正済みテキストをコピー」でコピーしてUDに流す', font=('Arial', 9))],
    ]
    
    return layout


def main():
    corrector = TranscriptionCorrector()
    layout = create_layout()
    window = sg.Window('UDトーク修正補助ツール', layout, finalize=True, size=(900, 900))
    
    # クリップボード機能（パイプライン対応）
    try:
        import pyperclip
        has_pyperclip = True
    except ImportError:
        has_pyperclip = False
        sg.popup_warning('pyperclip がインストールされていません。\n'
                        'コピー機能は制限されます。\n'
                        '（pip install pyperclip で対応可能）')
    
    while True:
        event, values = window.read()
        
        if event == sg.WINDOW_CLOSED or event == '終了':
            break
        
        elif event == '差分を検出':
            corrector.ud_text = values['UD_INPUT']
            corrector.yy_text = values['YY_INPUT']
            
            if not corrector.ud_text or not corrector.yy_text:
                sg.popup_error('両方のテキストを入力してください')
                continue
            
            # 差分表示を更新
            diff_display = corrector.create_display_text()
            window['DIFF_OUTPUT'].update(diff_display)
            
            # 修正済みテキストを生成
            corrector.corrected_text = corrector.generate_corrected_text()
            window['CORRECTED_OUTPUT'].update(corrector.corrected_text)
        
        elif event == '修正済みテキストをコピー':
            if corrector.corrected_text:
                if has_pyperclip:
                    pyperclip.copy(corrector.corrected_text)
                    sg.popup_ok('クリップボードにコピーしました！\nUDトークに貼り付けてください。')
                else:
                    # pyperclip がない場合は、Ctrl+C互換を提供
                    sg.popup_info('修正済みテキスト:\n\n' + corrector.corrected_text)
            else:
                sg.popup_warning('まず「差分を検出」を実行してください')
        
        elif event == '全て置き換え（YY→UD）':
            if corrector.corrected_text:
                window['UD_INPUT'].update(corrector.corrected_text)
                sg.popup_ok('UDのテキストを置き換えました！')
            else:
                sg.popup_warning('まず「差分を検出」を実行してください')
        
        elif event == 'UDをクリア':
            window['UD_INPUT'].update('')
            corrector.ud_text = ""
        
        elif event == 'YYをクリア':
            window['YY_INPUT'].update('')
            corrector.yy_text = ""
        
        elif event == 'リセット':
            window['UD_INPUT'].update('')
            window['YY_INPUT'].update('')
            window['DIFF_OUTPUT'].update('')
            window['CORRECTED_OUTPUT'].update('')
            corrector = TranscriptionCorrector()
    
    window.close()


if __name__ == '__main__':
    main()
