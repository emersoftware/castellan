import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PostHog } from "posthog-node";
import { analyticsHeaders, analyticsTags } from "@aoa/shared";

type Properties = Record<string, string | number | boolean | undefined>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Browser IDs are UUIDs; never use a player/spectator capability as an identity. */
function browserId(req: FastifyRequest, header: string) {
  const value = req.headers[header];
  return typeof value === "string" && uuid.test(value) ? value : undefined;
}

export function serverAnalytics(app: FastifyInstance) {
  const key = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;
  let client: PostHog | undefined;
  if (key && host) {
    try {
      client = new PostHog(key, { host, enableExceptionAutocapture: false });
      client.on("error", () => { /* Delivery failures must not affect match hosting. */ });
    } catch { app.log.warn("PostHog initialization failed"); }
  } else if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    app.log.warn("POSTHOG_PROJECT_TOKEN / POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once configured");
  }

  const context = (req: FastifyRequest, fallback: string) => {
    const distinctId = browserId(req, analyticsHeaders.distinctId);
    return {
      distinctId: distinctId ?? fallback,
      properties: {
        ...analyticsTags(process.env.NODE_ENV),
        actor_type: distinctId ? "browser" : "host",
        $process_person_profile: false,
        $session_id: distinctId ? browserId(req, analyticsHeaders.sessionId) : undefined,
      },
    };
  };

  app.addHook("onError", async (req, _reply, error) => {
    if (!client || (error.statusCode ?? 500) < 500) return;
    try {
      const identity = context(req, `server:${randomUUID()}`);
      client.captureException(new Error("Game API request failed"), identity.distinctId, {
        ...identity.properties, route: req.routeOptions.url, method: req.method,
      });
    } catch { /* Do not mask the original API error. */ }
  });
  app.addHook("onClose", async () => {
    try { await client?.shutdown(2000); } catch { /* Optional telemetry. */ }
  });

  return {
    capture(req: FastifyRequest, event: string, fallback: string, properties: Properties) {
      if (!client) return;
      try {
        const identity = context(req, fallback);
        client.capture({ event, distinctId: identity.distinctId, properties: { ...identity.properties, ...properties } });
      } catch { /* Never turn successful room creation into a failed request. */ }
    },
  };
}
