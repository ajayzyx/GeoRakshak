"""Weather adapters (api.md §7.2, architecture.md §4).

Two providers exist:

* `imd-api` — the official IMD weather API (OR-17). **No access granted**, so it raises `NotConnected`
  and its registry status stays `AWAITING_ACCESS`. No request format is invented here.
* `open-meteo` — the approved non-IMD fallback (H16). Free API, CC-BY 4.0, non-commercial use. Its data is
  **model output from national weather services, not Indian gauge observations**, so everything it returns is
  labelled non-IMD, and its "past days" precipitation is recorded as modelled, never as a gauge reading.

A provider is used only when `WEATHER_PROVIDER` names it. Nothing is fetched by default, and a source becomes
`CONNECTED_LIVE` only after a real successful call (CLAUDE.md §9 rule 8).
"""
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Protocol

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_LICENCE = (
    "CC-BY 4.0 (Open-Meteo free API, non-commercial use, <10000 calls/day per their terms of 2026-09-18). "
    "Attribution required to Open-Meteo and the underlying national weather services."
)


class NotConnected(RuntimeError):
    """Raised when an adapter has no real connection. Never return placeholder data instead."""


@dataclass(frozen=True)
class DailyRainfall:
    """One provider point, one day, in millimetres."""

    point_index: int
    day: date
    rainfall_mm: float


@dataclass(frozen=True)
class ForecastBatch:
    issue_time: datetime
    days: list[DailyRainfall]


class WeatherProvider(Protocol):
    slug: str
    label: str
    is_imd: bool

    def observed_daily(self, points: list[tuple[float, float]], days: int) -> list[DailyRainfall]:
        """Daily rainfall totals for the last `days` complete days, oldest first."""

    def forecast_daily(self, points: list[tuple[float, float]], days: int) -> ForecastBatch:
        """Daily rainfall totals for the next `days` days, with the issue time."""


class ImdApiProvider:
    """Interface-only placeholder. IMD API access has been requested and not granted (OR-17)."""

    slug = "imd-weather-api"
    label = "India Meteorological Department API"
    is_imd = True
    _message = "IMD weather API access has not been granted; no request format is assumed (AWAITING_ACCESS)."

    def observed_daily(self, points, days):
        raise NotConnected(self._message)

    def forecast_daily(self, points, days):
        raise NotConnected(self._message)


class OpenMeteoProvider:
    """Approved non-IMD fallback (H16). Model output, labelled as non-IMD everywhere it is shown."""

    slug = "open-meteo"
    label = "Open-Meteo (non-IMD model forecast)"
    is_imd = False

    def __init__(self, url: str = OPEN_METEO_URL, timeout_s: float = 20.0):
        self.url = url
        self.timeout_s = timeout_s

    def _fetch(self, points: list[tuple[float, float]], params: dict) -> list[dict]:
        if not points:
            return []
        query = {
            "latitude": ",".join(f"{lat:.4f}" for lat, _ in points),
            "longitude": ",".join(f"{lon:.4f}" for _, lon in points),
            "daily": "precipitation_sum",
            "timezone": "UTC",
            **params,
        }
        url = f"{self.url}?{urllib.parse.urlencode(query)}"
        try:
            with urllib.request.urlopen(url, timeout=self.timeout_s) as res:
                payload = json.loads(res.read())
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            raise NotConnected(f"Open-Meteo request failed: {e}") from e
        # One point returns an object; several return a list.
        blocks = payload if isinstance(payload, list) else [payload]
        if len(blocks) != len(points):
            raise NotConnected(f"Open-Meteo returned {len(blocks)} blocks for {len(points)} points")
        return blocks

    @staticmethod
    def _rows(blocks: list[dict]) -> list[DailyRainfall]:
        out: list[DailyRainfall] = []
        for i, block in enumerate(blocks):
            daily = block.get("daily") or {}
            times, values = daily.get("time") or [], daily.get("precipitation_sum") or []
            if not times:
                raise NotConnected("Open-Meteo response carried no daily precipitation")
            for day, value in zip(times, values):
                if value is None:  # a gap is left out rather than filled in
                    continue
                out.append(DailyRainfall(point_index=i, day=date.fromisoformat(day), rainfall_mm=float(value)))
        return out

    def observed_daily(self, points, days):
        blocks = self._fetch(points, {"past_days": max(1, min(days, 92)), "forecast_days": 1})
        today = datetime.now(timezone.utc).date()
        return [r for r in self._rows(blocks) if r.day < today]

    def forecast_daily(self, points, days):
        blocks = self._fetch(points, {"forecast_days": max(1, min(days + 1, 16))})
        today = datetime.now(timezone.utc).date()
        rows = [r for r in self._rows(blocks) if r.day >= today]
        return ForecastBatch(issue_time=datetime.now(timezone.utc), days=rows)


PROVIDERS = {ImdApiProvider.slug: ImdApiProvider, OpenMeteoProvider.slug: OpenMeteoProvider}


def get_provider(name: str | None) -> WeatherProvider | None:
    """Resolve the configured provider. `none`/empty means no weather source is connected."""
    if not name or name.lower() in ("none", "off", "disabled"):
        return None
    cls = PROVIDERS.get(name)
    if cls is None:
        raise ValueError(f"unknown weather provider {name!r}; known: {sorted(PROVIDERS)} or 'none'")
    return cls()
