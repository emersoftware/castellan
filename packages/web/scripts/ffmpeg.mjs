// ffmpeg as the asset and video scripts run it.
import { execFileSync, spawn } from "node:child_process";

/** Runs ffmpeg quietly, overwriting outputs. */
export const ff = (...args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);

/** A media file's length in seconds. */
export const probeDuration = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" }).trim());

/**
 * Encodes the frames written to its stdin as the delivery MP4: dithered pixels are the worst case for video
 * codecs, so H.264 at high quality, in 4:2:0 and with the index up front so any player streams it.
 * `args`: everything before the encoder (log level, the piped input, filters).
 */
export const encodeMp4 = (args, out) =>
  spawn("ffmpeg", ["-y", ...args, "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    { stdio: ["pipe", "inherit", "inherit"] });
