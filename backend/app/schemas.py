from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ScheduleBase(BaseModel):
    name: str = Field(default="새 일정", min_length=1, max_length=120)
    target_time: str = Field(default="09:00", pattern=r"^\d{2}:\d{2}$")
    buffer_minutes: int = Field(default=10, ge=0, le=240)
    plan: list[dict[str, Any]] = Field(default_factory=list)


class ScheduleCreate(ScheduleBase):
    id: str | None = None


class ScheduleUpdate(ScheduleBase):
    pass


class ScheduleOut(ScheduleBase):
    id: str
    device_id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
