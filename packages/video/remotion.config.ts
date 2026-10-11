/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setRspack(true);
// Dithering is per-pixel noise: lossless frames and a high-quality encode, or the codec smears it.
Config.setVideoImageFormat("png");
Config.setCrf(12);
Config.setOverwriteOutput(true);
// The overlays are the web app's own components (packages/web): resolve its workspace imports.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: { ...config.resolve, alias: { ...(config.resolve?.alias as object), "@aoa/shared": path.resolve(__dirname, "../shared/src/index.ts") } },
}));
