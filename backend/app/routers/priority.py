from datetime import datetime, timezone

import psycopg
from fastapi import APIRouter, Depends

from app.db import get_db
from app.security import AUTHORITY_ROLES, CurrentUser, require_roles
from app.services import priority, system

router = APIRouter(tags=["priority"])


@router.get("/response-priorities")
def priorities(admin_boundary_id: str | None = None, lead_time_h: int = 0,
               user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    mode = system.run_mode()
    return {"computed_at": datetime.now(timezone.utc), "rule_version": priority.RULE_VERSION, "run_mode": mode,
            "items": priority.compute(db, mode, lead_time_h)}
