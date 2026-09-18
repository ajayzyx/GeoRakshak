import { randomUUID } from 'node:crypto';
import { openNodeSqlite } from '../../../scripts/lib/nodeSqlite';
import { ApiClient } from '../api';
import { migrate } from '../db';
import { HttpClient, HttpRequest, HttpResponse, NetworkError } from '../http';
import { SqliteAckQueue, SqliteKeyValueStore } from '../localCache';
import { buildLocalReport, DraftMedia, emptyDraft, ReportDraft } from '../reportDraft';
import { SqliteReportStore } from '../reportStore';
import { Clock, CreateReportPayload } from '../types';

/** Opens the app's real schema on Node's built-in SQLite (`:memory:` or a file, to test restarts). */
export async function openStores(path = ':memory:') {
  const { db, close } = openNodeSqlite(path);
  await migrate(db);
  return {
    db,
    close,
    store: new SqliteReportStore(db),
    kv: new SqliteKeyValueStore(db),
    acks: new SqliteAckQueue(db),
  };
}

export class FakeClock implements Clock {
  constructor(public current = new Date('2026-07-14T06:30:00Z')) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

type Handler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

/** Scriptable HTTP fake. Records every request; never touches the network. */
export class FakeHttp implements HttpClient {
  readonly requests: HttpRequest[] = [];
  offline = false;
  private readonly routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

  /** Later registrations take precedence, so a test can override one route. */
  on(method: HttpRequest['method'], pattern: RegExp, handler: Handler): this {
    this.routes.unshift({ method, pattern, handler });
    return this;
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    if (this.offline) throw new NetworkError('Network request failed');
    const route = this.routes.find((r) => r.method === req.method && r.pattern.test(req.path));
    if (!route) return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no fake route' } } };
    return route.handler(req);
  }

  count(method: string, pattern: RegExp): number {
    return this.requests.filter((r) => r.method === method && pattern.test(r.path)).length;
  }
}

export const apiFor = (http: HttpClient, token = 'test-token') => new ApiClient(http, async () => token);

export const USER_ID = '11111111-1111-4111-8111-111111111111';

export function sampleDraft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return {
    ...emptyDraft(),
    category: 'ROAD_BLOCKED',
    severity: 'HIGH',
    description: 'Simulated test report: debris across the road.',
    lat: 25.6011,
    lon: 91.8043,
    gps_accuracy_m: 8,
    ...overrides,
  };
}

export function photo(sizeBytes = 2_000_000): DraftMedia {
  return {
    media_type: 'PHOTO',
    local_uri: `file:///data/app/media/${randomUUID()}.jpg`,
    mime_type: 'image/jpeg',
    size_bytes: sizeBytes,
    duration_s: null,
    captured_at: '2026-07-14T12:00:00+05:30',
  };
}

export function video(sizeBytes = 7_000_000, durationS = 10.4): DraftMedia {
  return {
    media_type: 'VIDEO',
    local_uri: `file:///data/app/media/${randomUUID()}.mp4`,
    mime_type: 'video/mp4',
    size_bytes: sizeBytes,
    duration_s: durationS,
    captured_at: '2026-07-14T12:00:05+05:30',
  };
}

export function buildReport(clock: Clock, draft: ReportDraft = sampleDraft(), owner = USER_ID) {
  return buildLocalReport(draft, { clock, newId: randomUUID, language: 'en', ownerUserId: owner });
}

const errorBody = (code: string, message: string, details: { field: string; issue: string }[] = []) => ({
  error: { code, message, details, request_id: 'fake' },
});

/**
 * In-memory stand-in for the report endpoints, following the semantics of our own
 * backend (backend/app/routers/reports.py, api.md §5.6–5.7): idempotency on
 * client_report_id / client_media_id scoped to the reporter (409 otherwise),
 * 422 for gps_accuracy_m <= 0 and video duration_s > 30, 404 for an unknown report.
 * The reporter is identified by the bearer token.
 */
export class ContractServer {
  readonly reports = new Map<string, { id: string; reporter: string; payload: CreateReportPayload }>();
  readonly media = new Map<string, { id: string; reportId: string }>();
  /**
   * Run after the server has stored a new record and before it answers. Throw to
   * simulate a response that never reaches the device, or act on the device state
   * while the request is "on the wire".
   */
  afterReportStored: ((req: HttpRequest) => void | Promise<void>) | null = null;
  afterMediaStored: ((req: HttpRequest) => void | Promise<void>) | null = null;
  /** Status of every response that reached the device, in order. */
  readonly responses: { kind: 'report' | 'media'; status: number }[] = [];
  private seq = 0;

  constructor(readonly http: FakeHttp) {
    http.on('POST', /^\/reports$/, async (req) => this.record('report', await this.createReport(req)));
    http.on('POST', /^\/reports\/[^/]+\/media$/, async (req) => this.record('media', await this.uploadMedia(req)));
  }

  statuses(kind: 'report' | 'media'): number[] {
    return this.responses.filter((r) => r.kind === kind).map((r) => r.status);
  }

  private record(kind: 'report' | 'media', res: HttpResponse): HttpResponse {
    this.responses.push({ kind, status: res.status });
    return res;
  }

  private reporterOf(req: HttpRequest): string {
    return req.headers?.Authorization?.replace(/^Bearer /, '') ?? '';
  }

  private async createReport(req: HttpRequest): Promise<HttpResponse> {
    const p = req.json as CreateReportPayload;
    if (!(typeof p.gps_accuracy_m === 'number' && p.gps_accuracy_m > 0)) {
      return {
        status: 422,
        body: errorBody('VALIDATION_ERROR', 'Request validation failed', [
          { field: 'gps_accuracy_m', issue: 'Input should be greater than 0' },
        ]),
      };
    }
    const reporter = this.reporterOf(req);
    const existing = this.reports.get(p.client_report_id);
    if (existing && existing.reporter !== reporter) {
      return { status: 409, body: errorBody('CONFLICT', 'client_report_id already used by another reporter') };
    }
    const rec = existing ?? { id: `rp-${++this.seq}`, reporter, payload: p };
    if (!existing) {
      this.reports.set(p.client_report_id, rec);
      await this.afterReportStored?.(req);
    }
    return {
      status: existing ? 200 : 201,
      body: { id: rec.id, client_report_id: p.client_report_id, verification_status: 'UNVERIFIED', submitted_at: 'x' },
    };
  }

  private async uploadMedia(req: HttpRequest): Promise<HttpResponse> {
    const reportId = req.path.split('/')[2] as string;
    const reporter = this.reporterOf(req);
    if (![...this.reports.values()].some((r) => r.id === reportId && r.reporter === reporter)) {
      return { status: 404, body: errorBody('NOT_FOUND', 'Report not found') };
    }
    const f = req.multipart?.fields ?? {};
    const clientMediaId = f.client_media_id as string;
    const existing = this.media.get(clientMediaId);
    if (existing && existing.reportId !== reportId) {
      return { status: 409, body: errorBody('CONFLICT', 'client_media_id already used for another report') };
    }
    if (!existing && f.media_type === 'VIDEO' && f.duration_s !== undefined && Number(f.duration_s) > 30) {
      return {
        status: 422,
        body: errorBody('VALIDATION_ERROR', 'Video must be 30 s or shorter', [{ field: 'duration_s', issue: 'too long' }]),
      };
    }
    const rec = existing ?? { id: `ev-${++this.seq}`, reportId };
    if (!existing) {
      this.media.set(clientMediaId, rec);
      await this.afterMediaStored?.(req);
    }
    return {
      status: existing ? 200 : 201,
      body: { id: rec.id, client_media_id: clientMediaId, media_type: f.media_type, upload_status: 'UPLOADED' },
    };
  }
}
