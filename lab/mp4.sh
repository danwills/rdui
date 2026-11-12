#!/bin/sh
# lab/mp4.sh <frames dir> <out.mp4> [fps] [crop w:h:x:y in frame pixels]
# Phone-friendly H.264 (baseline, yuv420p, faststart) from f0000.png...
dir=$1 out=$2 fps=${3:-12} crop=$4
vf="scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"
[ -n "$crop" ] && vf="crop=$crop,$vf"
ffmpeg -y -loglevel error -framerate "$fps" -i "$dir/f%04d.png" -vf "$vf" -c:v libx264 -profile:v baseline -movflags +faststart -crf 20 "$out" && ls -la "$out"
