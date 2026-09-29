"""Keep the source crown/hood still; composite only the generated warm fire.

uv run --with pillow --with numpy python assets/animations/finalize-king-fire.py
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / ('assets/animations/king/inner-fire-continuous' if '--continuous' in sys.argv else 'assets/animations/king/inner-fire')
SIZE = 544

def fire_weight(rgb):
    r, g, b = (rgb[..., i] for i in range(3))
    return np.clip((r - b - 24) / 30, 0, 1) * np.clip((r - g + 5) / 15, 0, 1)

request = json.loads((DIRECTORY / 'request.json').read_text())
source_size = request['reference_size']
offset_x, offset_y = request['reference_offset']
head = Image.open(ROOT / 'assets/raw/king-head-inner-fire-v2.png').convert('RGBA').resize(
    (source_size, source_size), Image.Resampling.LANCZOS)
source = Image.new('RGBA', (SIZE, SIZE))
source.alpha_composite(head, (offset_x, offset_y))
rgba = np.asarray(source).astype(np.float32)
cavity = Image.new('L', (SIZE, SIZE))
ImageDraw.Draw(cavity).polygon(
    [(int(x * source_size / 1280) + offset_x, int(y * source_size / 1280) + offset_y) for x, y in
     [(848, 526), (917, 553), (950, 662), (1000, 858), (948, 967),
      (872, 1090), (827, 1015), (729, 975), (663, 903), (740, 681)]], fill=255)
material_alpha = rgba[..., 3] / 255 * (1 - fire_weight(rgba[..., :3]))
material_alpha *= 1 - np.asarray(cavity).astype(np.float32) / 255
static_rgb = rgba[..., :3] * material_alpha[..., None]
layers = DIRECTORY / 'layers-frames' if '--layers' in sys.argv else None
if layers:
    layers.mkdir(exist_ok=True)
    material = np.dstack([rgba[..., :3], material_alpha * 255]).clip(0, 255).astype(np.uint8)
    Image.fromarray(material).save(layers / 'material.png')

probe = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=r_frame_rate', '-of', 'json', str(DIRECTORY / 'generated.mp4')]))
rate = probe['streams'][0]['r_frame_rate']
decoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', str(DIRECTORY / 'generated.mp4'),
                            '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
encoder = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                            '-s', f'{SIZE}x{SIZE}', '-r', rate, '-i', '-', '-an',
                            '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p',
                            '-movflags', '+faststart', str(DIRECTORY / 'king-fire.mp4')], stdin=subprocess.PIPE)
frames = []
protected = material_alpha >= 0.98
effect_occlusion = np.where(protected, 1, material_alpha)
# Let stray sparks dissolve before the image boundary instead of clipping.
y, x = np.mgrid[:SIZE, :SIZE]
edge_distance = np.minimum.reduce([x, y, SIZE - 1 - x, SIZE - 1 - y])
edge_fade = np.clip((edge_distance - 16) / 48, 0, 1)
edge_fade = edge_fade * edge_fade * (3 - 2 * edge_fade)
max_static_delta = 0
while True:
    data = decoder.stdout.read(SIZE * SIZE * 3)
    if not data:
        break
    assert len(data) == SIZE * SIZE * 3
    rgb = np.frombuffer(data, dtype=np.uint8).reshape(SIZE, SIZE, 3).astype(np.float32)
    effect = fire_weight(rgb)
    # Preserve hot, near-white cores within the known face opening too.
    effect = np.maximum(effect, np.clip((rgb.min(axis=2) - 170) / 70, 0, 1)
                        * (np.asarray(cavity) / 255))
    effect *= (1 - effect_occlusion) * edge_fade
    if layers:
        Image.fromarray((rgb * effect[..., None]).clip(0, 255).astype(np.uint8)).save(
            layers / f'fire-{len(frames):03d}.png')
    composite = np.clip(static_rgb + rgb * effect[..., None], 0, 255).astype(np.uint8)
    max_static_delta = max(max_static_delta, int(np.abs(
        composite[protected].astype(int) - static_rgb[protected].astype(np.uint8).astype(int)).max()))
    encoder.stdin.write(composite.tobytes())
    frames.append(Image.fromarray(composite))
decoder.stdout.close()
encoder.stdin.close()
assert decoder.wait() == 0 and encoder.wait() == 0
frames[0].save(DIRECTORY / 'preview.webp', save_all=True, append_images=frames[1:],
               duration=42, loop=0, lossless=True)
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(DIRECTORY / 'king-fire.mp4'),
                '-vf', f'fps={2 if request["duration"] > 3 else 6},scale=216:216,tile=6x2', '-frames:v', '1',
                str(DIRECTORY / 'final-contact-sheet.png')], check=True)
print(json.dumps({'frames': len(frames), 'protected_pixels': int(protected.sum()),
                  'max_static_pixel_delta_before_video_encoding': max_static_delta}))
