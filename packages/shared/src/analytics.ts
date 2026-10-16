/** How the web and the server tag their PostHog events, so both land in one app and environment. */
export const analyticsTags = (environment: string | undefined) => ({ app: "age-of-agents", environment: environment ?? "development" });

/** Sent by the web so the server's events join the browser's PostHog person and session. */
export const analyticsHeaders = { distinctId: "x-posthog-distinct-id", sessionId: "x-posthog-session-id" };
