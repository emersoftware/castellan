"""Run with: uv run --with gradio_client python assets/animations/ranger/walk-east-continuous/generate.py

Authentication: HF_TOKEN or the local session saved by `hf auth login`.
Credentials are never stored in output.
"""
import json
from pathlib import Path
import shutil
import time

from gradio_client import Client, handle_file
from huggingface_hub import get_token

HERE = Path(__file__).resolve().parent
PROMPT = (
    "Seamless walk cycle in place, constant pace from first to last frame, "
    "no pauses or easing. Fixed isometric camera. "
    "Preserve character, bow and magenta background."
)

def main():
    params = dict(prompt=PROMPT, canvas="544x544 · 1:1 fast", duration=2,
                  steps=4, seed=42, upsample=False, lora="larry")
    (HERE / "request.json").write_text(json.dumps({
        "space": "MiniMaxAI/MiniMax-H3-Turbo-Lora",
        "source": "assets/animations/ranger/walk-east-isometric/generated.mp4",
        "source_frame": 12,
        "reference": "reference.png", "first_and_last_frame": True, **params,
    }, indent=2, ensure_ascii=False) + "\n")
    token = get_token()
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
