#!/bin/zsh
# 元画像（740×416）を AI で4倍に拡大して、サイト用の画像を作る。
# 必要なもの: Upscayl（brew install --cask upscayl）と ffmpeg
# 使い方（raiden-shogun フォルダで）: zsh tools/upscale.sh img/source.png

set -e
SRC="${1:-img/source.png}"
[ -f "$SRC" ] || { echo "ファイルが見つかりません: $SRC"; exit 1; }
APP=/Applications/Upscayl.app/Contents/Resources
TMP=$(mktemp -d)

# 1) 左の名前ロゴと右下の UID を周りの色でぼかして消す
ffmpeg -v error -y -i "$SRC" -vf "delogo=x=590:y=394:w=148:h=21,delogo=x=20:y=203:w=160:h=66" "$TMP/clean.png"
# 2) イラスト向けのモデル（digital-art-4x）で4倍に拡大
"$APP/bin/upscayl-bin" -i "$TMP/clean.png" -o "$TMP/up.png" -m "$APP/models" -n digital-art-4x -s 4
# 3) ヒーロー用の全体画像と、プロフィール用の切り抜き
ffmpeg -v error -y -i "$TMP/up.png" -q:v 3 img/hero.jpg
ffmpeg -v error -y -i "$TMP/up.png" -vf "crop=1320:1664:820:0,scale=900:-1:flags=lanczos" -q:v 3 img/portrait.jpg

rm -rf "$TMP"
echo "img/hero.jpg と img/portrait.jpg を作りました"
