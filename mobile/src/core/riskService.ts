import { ApiClient } from './api';
import { KeyValueStore } from './localCache';
import { Clock } from './types';

/** Shown with every risk value, whatever the server returns (CLAUDE.md §3, api.md §5.2). */
export const RISK_DISCLAIMER = 'Decision-support risk estimate. Not an official warning.';

export interface AreaRisk {
  severity: string | null;
  score: number | null;
  confidence: string | null;
  provenance: string | null;
  run_mode: string | null;
  model_version: string | null;
  issue_time: string | null;
  grid_code: string | null;
  /** Plain-language factor texts, most important first (CLAUDE.md §10.2). */
  factors: string[];
  server_disclaimer: string | null;
  lat: number;
  lon: number;
  /** Device time when this was fetched. */
  fetched_at: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * api.md lists `GET /risk/at` but freezes no response body. We accept either a
 * flat summary or the §5.3 risk-zone detail shape (`assessment` + `factors`),
 * and show "unknown" for anything missing rather than guessing.
 */
export function parseRiskAt(body: unknown, lat: number, lon: number, fetchedAt: string): AreaRisk {
  const root = obj(body) ?? {};
  const a = obj(root.assessment) ?? root;
  const rawFactors = Array.isArray(a.factors) ? a.factors : Array.isArray(root.factors) ? root.factors : [];
  const factors = rawFactors
    .map((f) => str(obj(f)?.text) ?? str(obj(f)?.label))
    .filter((t): t is string => !!t)
    .slice(0, 3);
  return {
    severity: str(a.severity),
    score: num(a.score),
    confidence: str(a.confidence),
    provenance: str(a.provenance) ?? str(root.provenance),
    run_mode: str(a.run_mode) ?? str(root.run_mode),
    model_version: str(a.model_version),
    issue_time: str(a.issue_time),
    grid_code: str(root.grid_code),
    factors,
    server_disclaimer: str(root.disclaimer),
    lat,
    lon,
    fetched_at: fetchedAt,
  };
}

export class RiskService {
  constructor(
    private readonly deps: { api: ApiClient; cache: KeyValueStore; clock: Clock; userId: string },
  ) {}

  private get key(): string {
    return `risk_at:${this.deps.userId}`;
  }

  async getCached(): Promise<AreaRisk | null> {
    return (await this.deps.cache.get<AreaRisk>(this.key))?.value ?? null;
  }

  /** Rejects with ApiError on failure; the cached value is left untouched. */
  async refresh(lat: number, lon: number): Promise<AreaRisk> {
    const body = await this.deps.api.riskAt(lat, lon, 0);
    const now = this.deps.clock.now().toISOString();
    const risk = parseRiskAt(body, lat, lon, now);
    await this.deps.cache.set(this.key, risk, now);
    return risk;
  }
}
