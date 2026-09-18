// Node transport for the core HttpClient (used by `npm run check:live` only).
// Mirrors FetchHttpClient, but reads the `file://` media URI from disk into a
// Blob because Node's FormData cannot take React Native's {uri, name, type} part.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HttpClient, HttpRequest, HttpResponse, NetworkError } from '../../src/core/http';

export class NodeHttpClient implements HttpClient {
  readonly log: string[] = [];

  constructor(private readonly baseUrl: string) {}

  async send(req: HttpRequest): Promise<HttpResponse> {
    const qs = Object.entries(req.query ?? {})
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = this.baseUrl.replace(/\/+$/, '') + req.path + (qs ? `?${qs}` : '');
    const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers ?? {}) };
    let body: FormData | string | undefined;
    if (req.multipart) {
      const form = new FormData();
      for (const [k, v] of Object.entries(req.multipart.fields)) form.append(k, v);
      const bytes = await readFile(fileURLToPath(req.multipart.file.uri));
      form.append('file', new Blob([bytes], { type: req.multipart.file.type }), req.multipart.file.name);
      body = form;
    } else if (req.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.json);
    }
    let res: Response;
    try {
      res = await fetch(url, { method: req.method, headers, body, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : String(e));
    }
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: { message: text.slice(0, 200) } };
      }
    }
    this.log.push(`${req.method} ${req.path} → ${res.status}`);
    return { status: res.status, body: parsed };
  }
}
