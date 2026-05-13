from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    device_id: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    schedules: Mapped[list["Schedule"]] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
    )


class Schedule(Base):
    __tablename__ = "schedules"

    id: Mapped[str] = mapped_column(String(80), primary_key=True, index=True)
    device_id: Mapped[str] = mapped_column(
        String(120),
        ForeignKey("devices.device_id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), default="새 일정")
    target_time: Mapped[str] = mapped_column(String(5), default="09:00")
    buffer_minutes: Mapped[int] = mapped_column(Integer, default=10)
    plan: Mapped[list[dict]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    device: Mapped[Device] = relationship(back_populates="schedules")
