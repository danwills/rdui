#!/bin/sh
# Runs a command in one of a few GPU slots, waiting for a free one, so headless recordings share the GPU without
# crowding it (one at a time left it mostly idle; many at once lost the browsers' devices):
#   lab/gpu-slot.sh <folder> <command...>
# The slots are lock files <folder>/.gpu.lock.<i>, GPU_SLOTS of them (default 1: two headless browsers at once still lost their devices, 2026-11-19).
dir=$1; shift
n=${GPU_SLOTS:-1}
# (one slot: wait on it, so waiters take turns; polling let the batch, straight back each time, starve the others)
[ "$n" = 1 ] && exec flock "$dir/.gpu.lock.0" "$@"
while :; do
  i=0
  while [ "$i" -lt "$n" ]; do
    flock -n -E 75 "$dir/.gpu.lock.$i" "$@"; r=$?
    [ "$r" != 75 ] && exit "$r"
    i=$((i + 1))
  done
  sleep 2
done
