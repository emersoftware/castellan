// ffmpeg as the asset and recording scripts run it.
import { execFileSync, spawn } from "node:child_process";

/** Runs ffmpeg quietly, overwriting outputs; returns what it writes to stdout (`-` as the output), such as raw samples. */
export const ff = (...args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 1 << 30 });

/** A media file's length in seconds; for a video also its size in pixels and frame rate (a fraction, as ffmpeg takes it). */
export function probe(file) {
  const { format, streams: [video] = [] } = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "format=duration:stream=width,height,r_frame_rate", "-of", "json", file], { encoding: "utf8" }));
  return { duration: Number(format.duration), width: video?.width, height: video?.height, rate: video?.r_frame_rate };
}

/**
 * Encodes the frames written to its stdin as the delivery MP4: dithered pixels are the worst case for video
 * codecs, so H.264 at high quality, in 4:2:0 and with the index up front so any player streams it.
 * `args`: everything before the encoder (log level, the piped input, filters).
 */
export const encodeMp4 = (args, out) =>
  spawn("ffmpeg", ["-y", ...args, "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    { stdio: ["pipe", "inherit", "inherit"] });
