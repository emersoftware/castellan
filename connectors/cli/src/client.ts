/** The one HTTP client every connector goes through: CLI commands, MCP tools and the loop keepers. */
import { agentHeader, serverUrl, type GenericConnector } from "@castellan/shared";

export interface ClientOptions {
  connector?: string;
  server?: string;
  token?: string;
  /** Where CASTELLAN_SERVER, CASTELLAN_TOKEN and the declared agent come from. */
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Whether calls declare the agent configuration. Keepers report theirs separately, so their calls declare nothing. */
  declare?: boolean;
  redirect?: RequestRedirect;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Client = ReturnType<typeof client>;

/** Calls that declare no connector are the generic CLI, so a harness's own declaration keeps precedence on the server. */
const undeclared: GenericConnector = "cli";

export function client(opts: ClientOptions = {}) {
  const { env = process.env, fetchImpl = fetch, declare = true, redirect } = opts;
  const server = serverUrl(opts.server ?? env.CASTELLAN_SERVER);
  const token = opts.token ?? env.CASTELLAN_TOKEN;

  /**
   * JSON bodies come back parsed, text bodies (`format=text`) as strings. Non-2xx throws ApiError; a call
   * whose `signal` aborts rejects with the signal's reason, as fetch does.
   */
  async function request<T = unknown>(method: string, path: string, body?: unknown, { signal }: CallOptions = {}): Promise<T> {
    const headers: Record<string, string> = declare ? agentHeader({
      connector: env.CASTELLAN_CONNECTOR ?? opts.connector ?? undeclared, model: env.CASTELLAN_MODEL ?? null,
      effort: env.CASTELLAN_EFFORT ?? null, connectorVersion: env.CASTELLAN_CONNECTOR_VERSION ?? null,
      promptSha256: env.CASTELLAN_PROMPT_SHA256 ?? null, memoryPolicy: env.CASTELLAN_MEMORY_POLICY ?? null,
      contextPolicy: env.CASTELLAN_CONTEXT_POLICY ?? null,
    }) : {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(server + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, redirect });
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      throw new ApiError(0, `cannot reach ${server}: ${(e as Error).cause ?? (e as Error).message}`);
    }
    const text = await response.text();
    const parsed = (response.headers.get("content-type") ?? "").includes("json") ? safeJson(text) : text;
    if (!response.ok) {
      // Our server always answers errors in JSON; anything else is some other service.
      const msg =
        typeof parsed === "object" && parsed && "error" in parsed ? String(parsed.error)
        : typeof parsed === "string" && parsed.startsWith("FAILED") ? parsed // text answer: reason + current view
        : `${response.statusText} from ${server} (not an Castellan server?)`;
      throw new ApiError(response.status, `${response.status} ${msg}`);
    }
    return parsed as T;
  }

  return {
    server,
    token,
    get: <T = unknown>(path: string, call?: CallOptions) => request<T>("GET", path, undefined, call),
    post: <T = unknown>(path: string, body: unknown, call?: CallOptions) => request<T>("POST", path, body, call),
    put: <T = unknown>(path: string, body: unknown, call?: CallOptions) => request<T>("PUT", path, body, call),
  };
}

/** One call's options: aborting `signal` ends it. */
export interface CallOptions { signal?: AbortSignal }

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
