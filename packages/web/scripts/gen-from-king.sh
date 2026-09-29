#!/bin/sh
# Redraws the King's turnaround sheet (assets/raw/king_sheet.png) as another
# unit, so every unit shares the King's camera, scale, light and level of detail.
#   cd assets/raw && ../../packages/web/scripts/gen-from-king.sh <out.png> "<character>"
out=$1; who=$2
printf "%s" "Use your image generation tool to create ONE image and save it in the current directory as $out.
The attached image is a turnaround sheet of a faceless king: the same figure 5 times, facing (left to right) toward the camera, three-quarter front-right, right in profile, three-quarter back-right, and away from the camera, seen with a 2:1 isometric camera like Age of Empires II.
Redraw the sheet with a different character in place of the king: $who
Keep EXACTLY the same canvas size, the same 5 positions, the same facing in each of the 5, the same camera, the same light from the top-left and the same rendering style as the king. Feet on the same ground line as the king's feet.
LOW DETAIL: this becomes a tiny game sprite (about 25 pixels tall), so use a few big, clear shapes and a strong readable silhouette; no small ornaments, no embroidery, no fine texture, no straps or buckles, no pouches. Simple solid materials with bold light and shadow. No face visible.
Background: flat pure magenta #FF00FF, exactly like the attached image; no ground, no cast shadows, no text." | codex exec --skip-git-repo-check -s workspace-write -c approval_policy=never -i king_sheet.png > /tmp/gen-$out.log 2>&1
