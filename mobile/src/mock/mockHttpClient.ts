import { HttpClient, HttpRequest, HttpResponse, NetworkError } from '../core/http';
import { Clock, CreateReportPayload, InboxItem, User, systemClock } from '../core/types';
import { MOCK_PROVENANCE, MOCK_USERS, mockInbox, mockRiskAt } from './fixtures_simulated';

const err = (status: number, code: string, message: string): HttpResponse => ({
  status,
  body: { error: { code, message, details: [], request_id: 'mock' } },
});

/**
 * In-memory stand-in for the backend (EXPO_PUBLIC_API_MODE=mock). Implements
 * only what the mobile app calls, with the status codes from docs/api.md.
 * State is lost when the app restarts. All data is SIMULATED_DEMO.
 */
export class MockHttpClient implements HttpClient {
  /** Set to true to simulate having no network. */
  offline = false;
  private readonly tokens = new Map<string, User>();
  private readonly reports = new Map<
    string,
    { id: string; reporterId: string; payload: CreateReportPayload; submitted_at: string }
  >();
  private readonly media = new Map<string, { id: string; report_id: string }>();
  private readonly acks = new Map<string, string>();
  private inbox: InboxItem[] | null = null;
  private seq = 0;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly latencyMs = 300,
  ) {}

  private nextId(prefix: string): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${prefix}${String(this.seq).padStart(12 - prefix.length, '0')}`;
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.offline) throw new NetworkError('Mock: offline');

    const { method, path } = req;
    if (method === 'POST' && path === '/auth/login') return this.login(req);

    const token = req.headers?.Authorization?.replace(/^Bearer /, '') ?? '';
    // Tokens encode the mock user id, so a session survives an app restart in mock mode.
    const user = this.tokens.get(token) ?? MOCK_USERS.find((u) => token.startsWith(`mock-token-${u.id}-`));
    if (!user) return err(401, 'UNAUTHENTICATED', 'Mock: sign in again');

    if (method === 'GET' && path === '/me') return { status: 200, body: user };
    if (method === 'PATCH' && path === '/me') {
      const lang = (req.json as { preferred_language?: string } | undefined)?.preferred_language;
      if (lang !== 'en' && lang !== 'hi') return err(422, 'VALIDATION_ERROR', 'Mock: unsupported language');
      user.preferred_language = lang;
      return { status: 200, body: user };
    }
    if (method === 'POST' && path === '/reports') return this.createReport(req, user);
    const mediaMatch = /^\/reports\/([^/]+)\/media$/.exec(path);
    if (method === 'POST' && mediaMatch) return this.uploadMedia(decodeURIComponent(mediaMatch[1] ?? ''), req, user);
    if (method === 'GET' && path === '/me/inbox') return { status: 200, body: { items: this.inboxFor(user) } };
    const ackMatch = /^\/alerts\/([^/]+)\/acknowledge$/.exec(path);
    if (method === 'POST' && ackMatch) return this.acknowledge(decodeURIComponent(ackMatch[1] ?? ''), user);
    if (method === 'GET' && path === '/risk/at') return { status: 200, body: mockRiskAt(this.clock.now()) };
    return err(404, 'NOT_FOUND', `Mock: ${method} ${path} is not mocked`);
  }

  private login(req: HttpRequest): HttpResponse {
    const { email, password } = (req.json ?? {}) as { email?: string; password?: string };
    const user = MOCK_USERS.find((u) => u.email === email?.toLowerCase());
    if (!user || !password) return err(401, 'UNAUTHENTICATED', 'Mock: unknown account or empty password');
    const token = `mock-token-${user.id}-${this.clock.now().getTime()}`;
    this.tokens.set(token, user);
    return { status: 200, body: { access_token: token, token_type: 'bearer', expires_in: 3600, user } };
  }

  private createReport(req: HttpRequest, user: User): HttpResponse {
    const p = req.json as CreateReportPayload;
    if (!p?.client_report_id || !p.category || !p.severity || !p.location) {
      return err(422, 'VALIDATION_ERROR', 'Mock: missing required report fields');
    }
    // Same rules as backend/app/routers/reports.py.
    if (!(typeof p.gps_accuracy_m === 'number' && p.gps_accuracy_m > 0)) {
      return err(422, 'VALIDATION_ERROR', 'Mock: gps_accuracy_m must be greater than 0');
    }
    const existing = this.reports.get(p.client_report_id);
    if (existing && existing.reporterId !== user.id) {
      return err(409, 'CONFLICT', 'Mock: client_report_id already used by another reporter');
    }
    const rec = existing ?? {
      id: this.nextId('r'),
      reporterId: user.id,
      payload: p,
      submitted_at: this.clock.now().toISOString(),
    };
    if (!existing) this.reports.set(p.client_report_id, rec);
    const received = [...this.media.values()].filter((m) => m.report_id === rec.id).length;
    return {
      status: existing ? 200 : 201,
      body: {
        id: rec.id,
        client_report_id: p.client_report_id,
        reporter_role: user.role,
        verification_status: 'UNVERIFIED',
        risk_zone_id: null,
        road_segment_id: null,
        submitted_at: rec.submitted_at,
        media: { expected: p.media_expected, received },
        provenance: MOCK_PROVENANCE,
      },
    };
  }

  private uploadMedia(reportId: string, req: HttpRequest, user: User): HttpResponse {
    if (![...this.reports.values()].some((r) => r.id === reportId && r.reporterId === user.id)) {
      return err(404, 'NOT_FOUND', 'Mock: report not found');
    }
    const f = req.multipart?.fields ?? {};
    const clientMediaId = f.client_media_id;
    if (!clientMediaId || (f.media_type !== 'PHOTO' && f.media_type !== 'VIDEO')) {
      return err(422, 'VALIDATION_ERROR', 'Mock: client_media_id and media_type are required');
    }
    const existing = this.media.get(clientMediaId);
    if (existing && existing.report_id !== reportId) {
      return err(409, 'CONFLICT', 'Mock: client_media_id already used for another report');
    }
    if (!existing && f.media_type === 'VIDEO' && f.duration_s !== undefined && Number(f.duration_s) > 30) {
      return err(422, 'VALIDATION_ERROR', 'Mock: video must be 30 s or shorter');
    }
    const rec = existing ?? { id: this.nextId('e'), report_id: reportId };
    if (!existing) this.media.set(clientMediaId, rec);
    return {
      status: existing ? 200 : 201,
      body: {
        id: rec.id,
        client_media_id: clientMediaId,
        media_type: f.media_type,
        mime_type: req.multipart?.file.type,
        upload_status: 'UPLOADED',
      },
    };
  }

  private inboxFor(user: User): InboxItem[] {
    if (!this.inbox) this.inbox = mockInbox(this.clock.now());
    return this.inbox
      .filter((i) => user.role !== 'CITIZEN' || i.tier !== 'WATCH')
      .map((i) => ({ ...i, acknowledged_at: this.acks.get(`${user.id}:${i.alert_id}`) ?? null }));
  }

  private acknowledge(alertId: string, user: User): HttpResponse {
    if (!this.inboxFor(user).some((i) => i.alert_id === alertId)) {
      return err(404, 'NOT_FOUND', 'Mock: alert not in your inbox');
    }
    const key = `${user.id}:${alertId}`;
    const at = this.acks.get(key) ?? this.clock.now().toISOString();
    this.acks.set(key, at);
    return { status: 200, body: { alert_id: alertId, acknowledged_at: at } };
  }
}
