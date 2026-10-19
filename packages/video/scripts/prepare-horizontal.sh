#!/usr/bin/env bash
set -euo pipefail

# Native landscape versions of the approved v7 shots. The server must expose these
# existing recordings; this script never starts agents or creates matches.
task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
video_public="$task_root/packages/video/public"
video_server="${CASTELLAN_VIDEO_SERVER:-http://localhost:5173}"
mkdir -p "$video_public/horizontal"
for replay_id in 53bed717 eb3ebd01 3829ed85 c46c237a d0e598c5; do
  if [[ ! -f "$task_root/replays/$replay_id.json.gz" ]]; then
    printf 'Missing original replay: %s\n' "$replay_id" >&2
    exit 1
  fi
  if [[ ! -f "$video_public/$replay_id.json" ]]; then
    pnpm --dir "$task_root/packages/sim" exec tsx src/video-timeline.mts "$replay_id" "$video_public/$replay_id.json"
  fi
done
mkdir -p "$video_public/music"
if [[ ! -f "$video_public/music/acompanamiento.flac" ]]; then
  cp "$task_root/packages/web/public/music/dos-voces-v3/acompanamiento.flac" "$video_public/music/acompanamiento.flac"
fi
record=(node "$task_root/packages/web/scripts/record.mjs")
common=(--clean --width 960 --height 540 --scale 2 --server "$video_server" --dy 35)

"${record[@]}" 53bed717 "${common[@]}" --pov p1 --camera auto --zoom 2 --from 126 --to 137.43 --speed 2 --fade-out 1 --out "$video_public/horizontal/s1-pov.mp4"
"${record[@]}" eb3ebd01 "${common[@]}" --camera auto --zoom 2 --from 155 --to 172.14 --speed 2 --fade-in 1 --fade-out 1 --world-out 0.8 --out "$video_public/horizontal/s2-kite.mp4"
"${record[@]}" 3829ed85 "${common[@]}" --camera 7,7 --zoom 2 --from 466 --to 483.14 --speed 2 --world-in 0.8 --fade-in 1 --fade-out 1 --out "$video_public/horizontal/s3-truce.mp4"
"${record[@]}" c46c237a "${common[@]}" --camera 37.6,5.6 --zoom 2 --from 171 --to 262.43 --speed 16 --fade-in 1 --fade-out 1 --world-out 0.8 --out "$video_public/horizontal/s4-towers.mp4"
"${record[@]}" d0e598c5 "${common[@]}" --camera auto --zoom 1 --from 183.14 --speed 2 --world-in 0.8 --fade-in 1 --out "$video_public/horizontal/s5-charge.mp4"

for clip in s1-pov s2-kite s3-truce s4-towers s5-charge; do
  node "$task_root/packages/video/scripts/sfx.mjs" "$video_public/horizontal/$clip.mp4" --ending-cues
done
