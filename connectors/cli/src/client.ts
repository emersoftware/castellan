/** The one HTTP client every connector command goes through. */

export interface ClientOptions {
  server?: string;
  token?: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type Client = ReturnType<typeof client>;

export function client(opts: ClientOptions = {}) {
  const server = (opts.server ?? process.env.AOA_SERVER ?? "http://localhost:4400").replace(/\/+$/, "");
  const token = opts.token ?? process.env.AOA_TOKEN;

  /** JSON bodies come back parsed, text bodies (`format=text`) as strings. Non-2xx throws ApiError. */
  async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
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
