import { ApiError, HttpClient, HttpRequest, HttpResponse, toApiError } from './http';
import {
  AcknowledgeResponse,
  CreateReportPayload,
  CreateReportResponse,
  InboxItem,
  LocalMedia,
  LoginResponse,
  UploadMediaResponse,
  User,
} from './types';

export type TokenProvider = () => Promise<string | null>;

export interface CreateReportResult {
  /** true for `201 Created`, false for `200 OK` (same client_report_id already stored). */
  created: boolean;
  report: CreateReportResponse;
}

export interface UploadMediaResult {
  created: boolean;
  media: UploadMediaResponse;
}

/**
 * Typed wrapper over the frozen contract (docs/api.md v1). Every method either
 * resolves with a 2xx body or rejects with an ApiError.
 */
export class ApiClient {
  constructor(
    private readonly http: HttpClient,
    private readonly getToken: TokenProvider,
  ) {}

  private async call(req: HttpRequest, auth = true): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (auth) {
      const token = await this.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let res: HttpResponse;
    try {
      res = await this.http.send({ ...req, headers });
    } catch (err) {
      throw toApiError(err);
    }
    if (res.status < 200 || res.status >= 300) throw ApiError.fromResponse(res);
    return res;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await this.call(
      { method: 'POST', path: '/auth/login', json: { email, password } },
      false,
    );
    return res.body as LoginResponse;
  }

  async me(): Promise<User> {
    return (await this.call({ method: 'GET', path: '/me' })).body as User;
  }

  /** api.md §4: `PATCH /me` (language, SMS preference). Returns the updated user. */
  async updatePreferredLanguage(preferredLanguage: string): Promise<User> {
    const res = await this.call({
      method: 'PATCH',
      path: '/me',
      json: { preferred_language: preferredLanguage },
    });
    return res.body as User;
  }

  async createReport(payload: CreateReportPayload): Promise<CreateReportResult> {
    const res = await this.call({ method: 'POST', path: '/reports', json: payload });
    return { created: res.status === 201, report: res.body as CreateReportResponse };
  }

  /** api.md §5.7 multipart upload. Idempotent on client_media_id. */
  async uploadMedia(serverReportId: string, media: LocalMedia): Promise<UploadMediaResult> {
    const fields: Record<string, string> = {
      client_media_id: media.client_media_id,
      media_type: media.media_type,
      captured_at: media.captured_at,
    };
    // Lets the server enforce and record the 30 s video limit (api.md §5.7), not only the device.
    if (media.duration_s !== null) fields.duration_s = String(media.duration_s);
    if (media.lat !== null && media.lon !== null) {
      fields.lat = String(media.lat);
      fields.lon = String(media.lon);
    }
    const ext = media.mime_type === 'video/mp4' ? 'mp4' : media.mime_type === 'image/png' ? 'png' : 'jpg';
    const res = await this.call({
      method: 'POST',
      path: `/reports/${encodeURIComponent(serverReportId)}/media`,
      multipart: {
        fields,
        file: { uri: media.local_uri, name: `${media.client_media_id}.${ext}`, type: media.mime_type },
      },
    });
    return { created: res.status === 201, media: res.body as UploadMediaResponse };
  }

  async inbox(): Promise<InboxItem[]> {
    const res = await this.call({ method: 'GET', path: '/me/inbox' });
    return ((res.body as { items?: InboxItem[] } | null)?.items ?? []) as InboxItem[];
  }

  async acknowledge(alertId: string): Promise<AcknowledgeResponse> {
    const res = await this.call({
      method: 'POST',
      path: `/alerts/${encodeURIComponent(alertId)}/acknowledge`,
    });
    return res.body as AcknowledgeResponse;
  }

  /**
   * `GET /risk/at`. api.md lists the endpoint (§4) but freezes no response
   * shape, so the body is returned as-is and interpreted leniently by RiskService.
   */
  async riskAt(lat: number, lon: number, leadTimeH = 0): Promise<unknown> {
    const res = await this.call({
      method: 'GET',
      path: '/risk/at',
      query: { lat, lon, lead_time_h: leadTimeH },
    });
    return res.body;
  }
}
