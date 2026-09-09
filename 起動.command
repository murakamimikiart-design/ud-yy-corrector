#!/bin/bash
# ダブルクリックでアプリを起動する（イベント運営スタッフ用）
cd "$(dirname "$0")" || exit 1
exec /usr/bin/python3 uy_transcription_corrector.py
