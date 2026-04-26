const DEFAULT_BASE_URL = "https://api.freee.co.jp/hr/api/v1";

export interface FreeeClientOptions {
  accessToken: string;
  baseUrl?: string;
}

export interface FreeeRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

export class FreeeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly responseBody: unknown,
    public readonly endpoint: string,
  ) {
    super(
      `freee API ${status} ${statusText} on ${endpoint}: ${typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)}`,
    );
    this.name = "FreeeApiError";
  }
}

export class FreeeHrClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;

  constructor({ accessToken, baseUrl }: FreeeClientOptions) {
    if (!accessToken) {
      throw new Error("freee HR access token is required");
    }
    this.accessToken = accessToken;
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async request<T = unknown>(
    path: string,
    { method = "GET", query, body }: FreeeRequestOptions = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/json",
      "FREEE-VERSION": "2022-02-01",
    };
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const response = await fetch(url, { method, headers, body: payload });
    const text = await response.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep raw text if not JSON
      }
    }

    if (!response.ok) {
      throw new FreeeApiError(response.status, response.statusText, parsed, `${method} ${url.pathname}`);
    }
    return parsed as T;
  }
}
