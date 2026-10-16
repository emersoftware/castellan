/** The one HTTP client every connector command goes through. */
import { agentHeader, defaultServer, type GenericConnector } from "@aoa/shared";

export interface ClientOptions {
  connector?: string;
  server?: string;
  token?: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type Client = ReturnType<typeof client>;

/** Calls that declare no connector are the generic CLI, so a harness's own declaration keeps precedence on the server. */
const undeclared: GenericConnector = "cli";

export function client(opts: ClientOptions = {}) {
  const server = (opts.server ?? process.env.AOA_SERVER ?? defaultServer).replace(/\/+$/, "");
  const token = opts.token ?? process.env.AOA_TOKEN;

  /** JSON bodies come back parsed, text bodies (`format=text`) as strings. Non-2xx throws ApiError. */
  async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const declared = { connector: process.env.AOA_CONNECTOR ?? opts.connector ?? undeclared, model: process.env.AOA_MODEL ?? null,
      effort: process.env.AOA_EFFORT ?? null, connectorVersion: process.env.AOA_CONNECTOR_VERSION ?? null,
      promptSha256: process.env.AOA_PROMPT_SHA256 ?? null, memoryPolicy: process.env.AOA_MEMORY_POLICY ?? null,
      contextPolicy: process.env.AOA_CONTEXT_POLICY ?? null };
    const headers: Record<string, string> = agentHeader(declared);
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(server + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError(0, `cannot reach ${server}: ${(e as Error).cause ?? (e as Error).message}`);
    }
    const text = await res.text();
    const parsed = (res.headers.get("content-type") ?? "").includes("json") ? safeJson(text) : text;
    if (!res.ok) {
      // Our server always answers errors in JSON; anything else is some other service.
      const msg =
        typeof parsed === "object" && parsed && "error" in parsed ? String(parsed.error)
        : typeof parsed === "string" && parsed.startsWith("FAILED") ? parsed // text answer: reason + current view
        : `${res.statusText} from ${server} (not an Age of Agents server?)`;
      throw new ApiError(res.status, `${res.status} ${msg}`);
    }
    return parsed as T;
  }

  return {
    server,
    token,
    get: <T = unknown>(path: string) => request<T>("GET", path),
    post: <T = unknown>(path: string, body: unknown) => request<T>("POST", path, body),
    put: <T = unknown>(path: string, body: unknown) => request<T>("PUT", path, body),
  };
}

/** `?a=1&b=2` from the defined values, or "". */
export function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return q.length ? `?${q.join("&")}` : "";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
