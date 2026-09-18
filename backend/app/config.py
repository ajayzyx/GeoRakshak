from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = "postgresql://localhost:5432/georakshak"
    jwt_secret: str = "dev-only-change-me"
    jwt_ttl_s: int = 3600
    cors_origins: str = "http://localhost:5173,http://localhost:8081,http://localhost:19006"
    media_dir: Path = BACKEND_DIR / "var" / "media"
    media_url_ttl_s: int = 600
    run_mode: str = "DEMO_REPLAY"
    monitor_interval_s: int = 900  # LIVE mode only; 0 disables the scheduler
    allow_dev_settings: bool = False  # local LIVE-mode testing only; never set this on a deployment
    # H11 operating thresholds (moderate,high,very_high). Selected for the MVP demo from the measured
    # decision table in scripts/threshold_options.py; an operational choice, not a statistically optimal one.
    severity_thresholds: str = "0.25,0.55,0.70"
    weather_provider: str = "none"
    weather_min_interval_s: int = 3600  # don't re-fetch a provider on every cycle; respects rate limits
    assessment_retention_days: int = 7  # LIVE only: superseded assessments and old forecasts are pruned  # "none" | "open-meteo" (non-IMD, H16) | "imd-weather-api" (awaiting access)
    pilot_data_dir: Path = REPO_DIR / "ml" / "data" / "processed"
    demo_user_password: str = "georakshak-local-demo"
    public_base_url: str = "http://localhost:8000"

    @property
    def severity_threshold_values(self) -> tuple[float, float, float]:
        parts = [p.strip() for p in self.severity_thresholds.split(",")]
        if len(parts) != 3:
            raise ValueError("SEVERITY_THRESHOLDS must be 'moderate,high,very_high'")
        moderate, high, very_high = (float(p) for p in parts)
        return moderate, high, very_high

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


DEV_DEFAULTS = {"jwt_secret": "dev-only-change-me", "demo_user_password": "georakshak-local-demo"}


def check_production_safety(settings: "Settings") -> list[str]:
    """Development defaults are fine locally but must never protect real users in LIVE mode."""
    problems = []
    for field, default in DEV_DEFAULTS.items():
        if getattr(settings, field) == default:
            problems.append(f"{field.upper()} still has its development default")
    if "*" in settings.cors_origin_list:
        problems.append("CORS_ORIGINS allows every origin")
    return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
