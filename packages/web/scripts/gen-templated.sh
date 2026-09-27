#!/bin/sh
# Generates art on top of an isometric reference template (assets/templates/*.png)
# so every asset shares the game's camera.
#   cd assets/raw && ../../packages/web/scripts/gen-templated.sh <template.png> <out.png> "<what to draw on the diamonds>"
template=$1; out=$2; what=$3
printf "%s" "Use your image generation tool to create ONE image, using the attached image as the exact layout and camera reference, and save it in the current directory as $out.
The attached template: the shaded grey cube shows the exact camera, a 2:1 isometric (dimetric) projection like Age of Empires II, looking down about 30 degrees and rotated 45 degrees; the grey diamonds are tile footprints lying flat on the ground. Keep the same canvas size, the same diamond positions and the same camera.
Draw: $what
Every object must stand exactly on its diamond (base centred on it, sized to it) and be drawn with EXACTLY the cube's camera and angle, so all objects are consistent with each other and with the isometric grid; vertical edges stay vertical.
Style: realistic, almost 3D rendered miniatures, dramatic chiaroscuro light from the top-left (bright highlights, deep black shadows, very high contrast). No faces visible on any character. Not cartoon, not cute: serious and weathered.
Final image: REMOVE the reference cube and the diamond lines; the background must be flat pure magenta #FF00FF everywhere else, with no ground plane, no cast shadows, no text." | codex exec --skip-git-repo-check -s workspace-write -c approval_policy=never -i "$template" > /tmp/gen-$out.log 2>&1
