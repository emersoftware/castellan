"""Run with: uv run --with gradio_client python assets/animations/ranger/walk-east/generate.py

Optional authentication: HF_TOKEN in the environment. Never stored in output.
"""
import json
import os
from pathlib import Path
import shutil
import time

from gradio_client import Client, handle_file

HERE = Path(__file__).resolve().parent
PROMPT = (
    "Animate this exact hooded medieval archer as a game character walk cycle. "
    "Full body, side view facing screen right throughout. The archer walks IN PLACE "
    "at a steady relaxed pace, alternating left and right legs with clear heel contact, "
    "weight transfer and natural knee bends. The body stays centered at the same position "
    "and size. He keeps holding the same undrawn bow upright in his forward hand. "
    "The cloak sways gently with each step. Preserve the exact hood, hidden face, green "
    "cloak, brown leather clothing, boots, bow and proportions of the reference. "
    "Two complete even walking cycles, ending in the starting pose for a seamless loop. "
    "Locked orthographic camera, same slightly elevated viewing angle as the reference. "
    "Uniform flat bright magenta background throughout. No camera movement, no turning, "
    "no zoom, no scenery, no floor, no text, no shooting, no extra equipment or characters."
)

def main():
    params = dict(prompt=PROMPT, canvas="544x544 · 1:1 fast", duration=2,
                  steps=4, seed=42, upsample=False, lora="larry")
    (HERE / "request.json").write_text(json.dumps({
        "space": "MiniMaxAI/MiniMax-H3-Turbo-Lora",
        "source": "assets/raw/ranger_sheet.png",
        "reference_crop": {"x": 570, "y": 535, "width": 400, "height": 400},
        "reference": "reference.png", "first_and_last_frame": True, **params,
    }, indent=2, ensure_ascii=False) + "\n")
    token = os.environ.get("HF_TOKEN")
    client = Client("MiniMaxAI/MiniMax-H3-Turbo-Lora", token=token,
                    download_files=str(HERE / "downloads"))
    print("Connected; authentication:", "token" if token else "public", flush=True)
    job = client.submit(
        in_0=PROMPT, in_1=handle_file(str(HERE / "reference.png")),
        in_2=handle_file(str(HERE / "reference.png")),
        in_3=params["canvas"], in_4=params["duration"], in_5=params["steps"],
        in_6=params["seed"], in_7=False, in_8=params["lora"], api_name="/output_video",
    )
    previous = None
    while not job.done():
        status = job.status()
        label = str(status.code)
        if label != previous:
            print(label, "queue:", status.rank, flush=True)
            previous = label
        time.sleep(5)
    result = job.result()
    (HERE / "result.json").write_text(json.dumps(result, indent=2, default=str) + "\n")
    video = result[0]
    if isinstance(video, dict):
        video = video.get("path") or video.get("video", {}).get("path")
    shutil.copy2(video, HERE / "generated.mp4")
    print("Saved:", HERE / "generated.mp4", flush=True)
    print("Report:", result[1], flush=True)

if __name__ == "__main__":
    main()
