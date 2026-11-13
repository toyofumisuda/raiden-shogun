#!/bin/zsh
# スクロール演出用のコマ画像（img/frames/f_001.jpg …）を作る。
#
# 使い方（raiden-shogun フォルダで実行）:
#   画像から作る : zsh tools/make_frames.sh img/source.png
#   動画から作る : zsh tools/make_frames.sh 動画.mp4
#
# 画像のときは、4秒・120コマで「暗い所から明るくなり、顔へゆっくり寄る」動きを作る。
# 途中で2回、雷のように画面が光る。
# 動画のとき（Seedance などで作った4秒動画など）は、そのまま120コマに分解する。
# コマ数を変えたら js/main.js の FRAME_COUNT も同じ数にする。

set -e
SRC="$1"
OUT="img/frames"
COUNT=120
W=1480; H=832

[ -z "$SRC" ] && { echo "使い方: zsh tools/make_frames.sh <画像 or 動画>"; exit 1; }
[ -f "$SRC" ] || { echo "ファイルが見つかりません: $SRC"; exit 1; }
rm -f "$OUT"/f_*.jpg(N)
mkdir -p "$OUT"

case "${SRC:l}" in
  *.png|*.jpg|*.jpeg|*.webp)
    # 1) 左の名前ロゴと右下の UID 表示を周りの色でぼかして消す  2) 4倍に拡大してから寄る（カクつき防止）
    # 3) 寄り: 1.0 → 1.38 倍、顔のあたり（横49%・縦24%）へ
    # 4) 明るさ: 最初の1秒で暗→明、2秒目と3秒目付近で雷の光
    ffmpeg -v error -y -loop 1 -i "$SRC" -vf "\
delogo=x=590:y=394:w=148:h=21,delogo=x=20:y=203:w=160:h=66,\
scale=iw*4:ih*4:flags=lanczos,\
zoompan=z='1+0.38*pow(on/$((COUNT-1)),1.5)':x='(iw-iw/zoom)*0.49':y='(ih-ih/zoom)*0.24':d=1:s=${W}x${H}:fps=30,\
eq=eval=frame:brightness='-0.45*max(0,1-t/1.1) + 0.2*exp(-pow((t-1.95)*14,2)) + 0.14*exp(-pow((t-2.9)*18,2))':saturation='1+0.2*min(1,t/2)'" \
      -frames:v $COUNT -q:v 5 "$OUT/f_%03d.jpg"
    ;;
  *)
    DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")
    FPS=$(echo "$COUNT / $DUR" | bc -l)
    ffmpeg -v error -y -i "$SRC" -vf "fps=$FPS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}" \
      -frames:v $COUNT -q:v 5 "$OUT/f_%03d.jpg"
    ;;
esac

echo "$(ls "$OUT" | wc -l | tr -d ' ') コマを $OUT に書き出しました"
