// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  init: vi.fn(), register: vi.fn(), capture: vi.fn(), captureException: vi.fn(),
  get_distinct_id: vi.fn(() => "019a1234-0000-7000-8000-000000000001"),
  get_session_id: vi.fn(() => "019a1234-0000-7000-8000-000000000002"),
}));
vi.mock("posthog-js", () => ({ default: sdk }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("VITE_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
  history.replaceState(null, "", "/watch/test?token=private#spectator=private");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("does not initialize or capture when configuration is incomplete", async () => {
  vi.stubEnv("VITE_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const analytics = await import("../src/analytics");
  expect(analytics.initAnalytics()).toBeUndefined();
  analytics.track("test"); analytics.trackPageview(); analytics.trackError("load game data");
  expect(analytics.analyticsHeaders()).toEqual({});
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.capture).not.toHaveBeenCalled();
  expect(sdk.captureException).not.toHaveBeenCalled();
});

it("initializes once and scrubs capabilities from URLs including nested initial properties", async () => {
  const analytics = await import("../src/analytics");
  analytics.initAnalytics(); analytics.initAnalytics();
  expect(sdk.init).toHaveBeenCalledTimes(1);
  const options = sdk.init.mock.calls[0][1];
  expect(options).toMatchObject({ api_host: "https://eu.i.posthog.com", autocapture: false, disable_session_recording: true, capture_exceptions: false });
  const event = options.before_send({ event: "$pageview", properties: {
    $current_url: location.href,
    $referrer: "https://example.com/?token=private#spectator=private",
    $set_once: { $initial_current_url: location.href },
    $exception_list: [{ stacktrace: { frames: [{ filename: "https://example.com/app.js?token=private" }] } }],
  } });
  expect(JSON.stringify(event)).not.toContain("private");
  expect(event.properties.$current_url).toBe(`${location.origin}/watch/test`);
});

it("counts initial and subsequent route paths once, ignoring replay time and fragment updates", async () => {
  const analytics = await import("../src/analytics");
  analytics.initAnalytics();
  analytics.trackPageview(); analytics.trackPageview();
  history.replaceState(null, "", "/watch/test?t=12#spectator=other");
  analytics.trackPageview();
  history.pushState(null, "", "/battles"); analytics.trackPageview();
  history.pushState(null, "", "/watch/test"); analytics.trackPageview();
  expect(sdk.capture.mock.calls.map(([event]) => event)).toEqual(["$pageview", "$pageview", "$pageview"]);
  expect(JSON.stringify(sdk.capture.mock.calls)).not.toContain("spectator");
});

it("passes browser identity to game APIs while preserving spectator authorization", async () => {
  const analytics = await import("../src/analytics"); analytics.initAnalytics();
  const fetch = vi.fn().mockImplementation(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const { api } = await import("../src/api");
  await api.roomScripts("test");
  const headers = fetch.mock.calls[0][1].headers as Headers;
  expect(headers.get("authorization")).toBe("Bearer private");
  expect(headers.get("x-posthog-distinct-id")).toBe(sdk.get_distinct_id());
  expect(headers.get("x-posthog-session-id")).toBe(sdk.get_session_id());
  await api.showcase("test");
  expect(fetch.mock.calls[1][1]).toBeUndefined();
});

it("keeps controls usable when the SDK throws", async () => {
  const analytics = await import("../src/analytics"); analytics.initAnalytics();
  sdk.capture.mockImplementationOnce(() => { throw new Error("offline"); });
  sdk.captureException.mockImplementationOnce(() => { throw new Error("offline"); });
  expect(() => analytics.track("battle_selected")).not.toThrow();
  expect(() => analytics.trackError("load game data")).not.toThrow();
});
