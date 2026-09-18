import { HttpClient, HttpRequest, HttpResponse, NetworkError } from './http';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface FetchHttpClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
}

/** Live-mode transport over `fetch` (React Native provides fetch + FormData). */
export class FetchHttpClient implements HttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly uploadTimeoutMs: number;

  constructor(opts: FetchHttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init));
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    // A 25 MB video on a weak 3G link needs far longer than a JSON call.
    this.uploadTimeoutMs = opts.uploadTimeoutMs ?? 300_000;
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    // Built by hand: React Native's URL polyfill does not implement searchParams mutation.
    const qs = Object.entries(req.query ?? {})
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = this.baseUrl + req.path + (qs ? `?${qs}` : '');

    const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers ?? {}) };
    let body: BodyInit | undefined;
    if (req.multipart) {
      const form = new FormData();
      for (const [k, v] of Object.entries(req.multipart.fields)) form.append(k, v);
      // React Native's FormData accepts {uri, name, type} for file parts.
      form.append('file', req.multipart.file as unknown as Blob);
      body = form;
    } else if (req.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.json);
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      req.multipart ? this.uploadTimeoutMs : this.timeoutMs,
    );
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text().catch(() => '');
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: { message: text.slice(0, 200) } };
      }
    }
    return { status: res.status, body: parsed };
  }
}
