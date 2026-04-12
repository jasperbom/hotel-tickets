import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum
from sqlalchemy import String, Text, DateTime, Boolean, Integer, ForeignKey, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


def new_uuid() -> str:
    return str(uuid.uuid4())


class Category(str, PyEnum):
    technical = "technical"
    housekeeping = "housekeeping"
    reception = "reception"


class Status(str, PyEnum):
    open = "open"
    in_progress = "in_progress"
    closed = "closed"


class Priority(str, PyEnum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


class Role(str, PyEnum):
    admin = "admin"
    supervisor = "supervisor"
    technician = "technician"
    housekeeping = "housekeeping"
    reception = "reception"


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[Category] = mapped_column(Enum(Category), nullable=False)
    status: Mapped[Status] = mapped_column(Enum(Status), default=Status.open, nullable=False)
    priority: Mapped[Priority] = mapped_column(Enum(Priority), default=Priority.medium, nullable=False)
    location_id: Mapped[str | None] = mapped_column(String(255))  # HA area_id
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)  # HA user_id
    assigned_to: Mapped[str | None] = mapped_column(String(255))  # HA user_id
    recurring_template_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("recurring_templates.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    closed_by: Mapped[str | None] = mapped_column(String(255))  # HA user_id
    notify_when_free: Mapped[bool] = mapped_column(Boolean, default=False)
    subtasks: Mapped[str | None] = mapped_column(Text)  # JSON: [{label, done, done_by, done_at}]
    photos: Mapped[str | None] = mapped_column(Text)  # JSON: ["filename1.jpg", ...]

    comments: Mapped[list["TicketComment"]] = relationship("TicketComment", back_populates="ticket", cascade="all, delete-orphan")
    recurring_template: Mapped["RecurringTemplate | None"] = relationship("RecurringTemplate", back_populates="tickets")


class TicketComment(Base):
    __tablename__ = "ticket_comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    ticket_id: Mapped[str] = mapped_column(String(36), ForeignKey("tickets.id"), nullable=False)
    author_id: Mapped[str] = mapped_column(String(255), nullable=False)  # HA user_id
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)

    ticket: Mapped[Ticket] = relationship("Ticket", back_populates="comments")


class RecurringTemplate(Base):
    __tablename__ = "recurring_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[Category] = mapped_column(Enum(Category), nullable=False)
    priority: Mapped[Priority] = mapped_column(Enum(Priority), default=Priority.medium, nullable=False)
    location_id: Mapped[str | None] = mapped_column(String(255))
    assign_to: Mapped[str | None] = mapped_column(String(255))  # HA user_id
    cron_expression: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    advance_days: Mapped[int] = mapped_column(Integer, default=0)
    nfc_tag_id: Mapped[str | None] = mapped_column(String(255))
    subtask_mode: Mapped[str] = mapped_column(String(20), default="none")  # none | subtasks | rooms
    subtask_items: Mapped[str | None] = mapped_column(Text)  # JSON: [label, ...] or [area_id, ...]
    notify_when_free: Mapped[bool] = mapped_column(Boolean, default=False)
    emoji: Mapped[str | None] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    tickets: Mapped[list[Ticket]] = relationship("Ticket", back_populates="recurring_template")


class PoolId(str, PyEnum):
    wellness = "wellness"
    zwembad = "zwembad"


class PoolLog(Base):
    __tablename__ = "pool_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pool_id: Mapped[PoolId] = mapped_column(Enum(PoolId), nullable=False)
    datum: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    tijd: Mapped[str] = mapped_column(String(5), nullable=False)    # HH:MM
    doorzicht: Mapped[str | None] = mapped_column(String(50))
    water_temp: Mapped[float | None] = mapped_column()
    ph: Mapped[float | None] = mapped_column()
    vbc_in: Mapped[float | None] = mapped_column()
    vbc_uit: Mapped[float | None] = mapped_column()
    tbc: Mapped[float | None] = mapped_column()
    gbc: Mapped[float | None] = mapped_column()
    ph_automaat: Mapped[float | None] = mapped_column()
    vbc_automaat: Mapped[float | None] = mapped_column()
    watermeter: Mapped[float | None] = mapped_column()
    verbruik: Mapped[float | None] = mapped_column()
    filterspoeling: Mapped[str | None] = mapped_column("filterspoeling_str", String(10))
    bezoekers: Mapped[int | None] = mapped_column(Integer)
    reiniging: Mapped[bool] = mapped_column(Boolean, default=False)
    flow: Mapped[float | None] = mapped_column()
    chemicalien: Mapped[str | None] = mapped_column(Text)
    gemeten_door: Mapped[str] = mapped_column(String(255), nullable=False)
    notitie: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class PoolConfig(Base):
    __tablename__ = "pool_configs"

    pool_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    filter_nfc_tag_id: Mapped[str | None] = mapped_column(String(255))
    filter_nfc_tag_id_r: Mapped[str | None] = mapped_column(String(255))  # zwembad rechter filter


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class UserRole(Base):
    __tablename__ = "user_roles"

    ha_user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(Enum(Role), nullable=False)
    department: Mapped[Category | None] = mapped_column(Enum(Category))
    email: Mapped[str | None] = mapped_column(String(255))
    notify_push: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_email: Mapped[bool] = mapped_column(Boolean, default=False)
    ha_notify_service: Mapped[str | None] = mapped_column(String(255))  # bijv. "notify.mobile_app_iphone"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
