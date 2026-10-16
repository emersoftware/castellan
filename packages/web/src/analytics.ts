import posthog, { type PostHogConfig } from "posthog-js";
import { analyticsTags } from "@aoa/shared";

let enabled = false;
let lastPath: string | undefined;
type Properties = Record<string, string | number | boolean | null | undefined>;

/** Capabilities live in query strings/fragments; analytics only needs the path. */
export function publicUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch { return ""; }
}

function scrubUrls(value: unknown): unknown {
  if (typeof value === "string" && /^https?:\/\//.test(value)) return publicUrl(value);
  if (Array.isArray(value)) return value.map(scrubUrls);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, scrubUrls(v)]));
  return value;
}

export const analyticsOptions: Partial<PostHogConfig> = {
  defaults: "2026-01-30",
  // Router notifications below count path changes, not playback's replaceState calls.
  capture_pageview: false,
  capture_pageleave: true,
  autocapture: false,
  disable_session_recording: true,
  disable_surveys: true,
  capture_exceptions: false,
  disable_capture_url_hashes: true,
  person_profiles: "identified_only",
  before_send: event => event ? { ...event, properties: scrubUrls(event.properties) as typeof event.properties } : null,
};

export function initAnalytics() {
  if (enabled) return posthog;
  const key = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;
  if (!key || !host) {
    if (import.meta.env.DEV) console.warn("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN / VITE_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once configured");
    return undefined;
  }
  try {
    posthog.init(key, { ...analyticsOptions, api_host: host });
    posthog.register(analyticsTags(import.meta.env.DEV ? undefined : import.meta.env.MODE));
    enabled = true;
    return posthog;
  } catch { return undefined; }
}

export function track(event: string, properties: Properties = {}) {
  if (!enabled) return;
  try { posthog.capture(event, properties); } catch { /* Analytics must not interrupt the game. */ }
}

export function trackPageview() {
  if (!enabled || location.pathname === lastPath) return;
  lastPath = location.pathname;
  track("$pageview", { $current_url: publicUrl(location.href), $pathname: location.pathname });
}

/** Known operation labels only: raw exceptions may contain tokens, scripts or chat. */
export function trackError(operation: string, properties: Properties = {}) {
  if (!enabled) return;
  try { posthog.captureException(new Error(`Failed to ${operation}`), { operation, ...properties }); } catch { /* Optional telemetry. */ }
}

export function analyticsHeaders(): Record<string, string> {
  if (!enabled) return {};
  try {
    const session = posthog.get_session_id();
    return { "X-POSTHOG-DISTINCT-ID": posthog.get_distinct_id(), ...(session ? { "X-POSTHOG-SESSION-ID": session } : {}) };
  } catch { return {}; }
}
