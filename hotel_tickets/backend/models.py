import uuid
from datetime import datetime, date, timezone
from enum import Enum as PyEnum
from sqlalchemy import String, Text, DateTime, Date, Boolean, Integer, Float, ForeignKey, Enum
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
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    comments: Mapped[list["TicketComment"]] = relationship("TicketComment", back_populates="ticket", cascade="all, delete-orphan")
    recurring_template: Mapped["RecurringTemplate | None"] = relationship("RecurringTemplate", back_populates="tickets")


class TicketPin(Base):
    """Persoonlijke pin per gebruiker — gepinde tickets staan bovenaan in 'Mijn openstaande tickets'."""
    __tablename__ = "ticket_pins"

    ha_user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String(36), ForeignKey("tickets.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    # Interval-modus: als gevuld, wordt de volgende ticket X dagen na de laatste
    # afronding gepland (cron_expression wordt dan genegeerd voor scheduling).
    interval_days: Mapped[int | None] = mapped_column(Integer)
    # Tijdstip waarop de scheduler de eerstvolgende ticket mag aanmaken. Wordt
    # bijgewerkt bij elke afronding (NFC of handmatig) zodat de taak pas weer
    # opduikt op de dag dat hij echt moet gebeuren.
    next_due_at: Mapped[datetime | None] = mapped_column(DateTime)
    nfc_tag_id: Mapped[str | None] = mapped_column(String(255))
    subtask_mode: Mapped[str] = mapped_column(String(20), default="none")  # none | subtasks | rooms
    subtask_items: Mapped[str | None] = mapped_column(Text)  # JSON: [label, ...] or [area_id, ...]
    notify_when_free: Mapped[bool] = mapped_column(Boolean, default=False)
    emoji: Mapped[str | None] = mapped_column(String(10))
    folder: Mapped[str | None] = mapped_column(String(100))
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
    chloor_nfc_tag_id: Mapped[str | None] = mapped_column(String(255))
    zuur_nfc_tag_id: Mapped[str | None] = mapped_column(String(255))
    vlokmiddel_nfc_tag_id: Mapped[str | None] = mapped_column(String(255))
    # Optionele koppeling naar herhalende sjablonen die automatisch afgesloten
    # worden wanneer de bijbehorende NFC-tag gescand wordt.
    filter_template_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("recurring_templates.id"))
    filter_template_id_r: Mapped[str | None] = mapped_column(String(36), ForeignKey("recurring_templates.id"))
    chloor_template_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("recurring_templates.id"))
    zuur_template_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("recurring_templates.id"))
    vlokmiddel_template_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("recurring_templates.id"))


class PoolIncident(Base):
    __tablename__ = "pool_incidents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    pool_id: Mapped[PoolId] = mapped_column(Enum(PoolId), nullable=False)
    datum: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    tijd: Mapped[str] = mapped_column(String(5), nullable=False)    # HH:MM
    beschrijving: Mapped[str] = mapped_column(Text, nullable=False)
    maatregelen: Mapped[str | None] = mapped_column(Text)
    gemeld_door: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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


# ── Fietsen module ──────────────────────────────────────────────────────────────

class BikeStatus(str, PyEnum):
    available = "available"
    maintenance = "maintenance"
    retired = "retired"


class BikeReservationStatus(str, PyEnum):
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class BikeLogCategory(str, PyEnum):
    note = "note"
    maintenance = "maintenance"
    issue = "issue"


class BikeType(Base):
    __tablename__ = "bike_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    price_per_day: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    bikes: Mapped[list["Bike"]] = relationship("Bike", back_populates="bike_type")
    bike_reservations: Mapped[list["BikeReservation"]] = relationship("BikeReservation", back_populates="bike_type")


class Bike(Base):
    __tablename__ = "bikes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type_id: Mapped[int] = mapped_column(Integer, ForeignKey("bike_types.id"), nullable=False)
    is_reserve: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[BikeStatus] = mapped_column(Enum(BikeStatus), default=BikeStatus.available, nullable=False)
    total_rental_days: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    bike_type: Mapped["BikeType"] = relationship("BikeType", back_populates="bikes")
    reservation_bikes: Mapped[list["BikeReservationBike"]] = relationship("BikeReservationBike", back_populates="bike")
    maintenance_records: Mapped[list["BikeMaintenanceRecord"]] = relationship("BikeMaintenanceRecord", back_populates="bike")
    log_entries: Mapped[list["BikeLog"]] = relationship("BikeLog", back_populates="bike", cascade="all, delete-orphan")


class BikeReservation(Base):
    __tablename__ = "bike_reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guest_name: Mapped[str] = mapped_column(String(200), nullable=False)
    guest_room: Mapped[str | None] = mapped_column(String(50))
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    num_days: Mapped[int] = mapped_column(Integer, nullable=False)
    num_bikes: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    bike_type_id: Mapped[int] = mapped_column(Integer, ForeignKey("bike_types.id"), nullable=False)
    status: Mapped[BikeReservationStatus] = mapped_column(Enum(BikeReservationStatus), default=BikeReservationStatus.active, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    key_given_at: Mapped[datetime | None] = mapped_column(DateTime)
    key_returned_at: Mapped[datetime | None] = mapped_column(DateTime)
    key_ticket_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    bike_type: Mapped["BikeType"] = relationship("BikeType", back_populates="bike_reservations")
    reservation_bikes: Mapped[list["BikeReservationBike"]] = relationship("BikeReservationBike", back_populates="reservation", cascade="all, delete-orphan")


class BikeReservationBike(Base):
    __tablename__ = "bike_reservation_bikes"

    reservation_id: Mapped[int] = mapped_column(Integer, ForeignKey("bike_reservations.id"), primary_key=True)
    bike_id: Mapped[int] = mapped_column(Integer, ForeignKey("bikes.id"), primary_key=True)

    reservation: Mapped["BikeReservation"] = relationship("BikeReservation", back_populates="reservation_bikes")
    bike: Mapped["Bike"] = relationship("Bike", back_populates="reservation_bikes")


class BikeMaintenanceRecord(Base):
    __tablename__ = "bike_maintenance_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bike_id: Mapped[int] = mapped_column(Integer, ForeignKey("bikes.id"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_end_date: Mapped[date | None] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
    ticket_id: Mapped[str | None] = mapped_column(String(36))  # gekoppeld hotel-ticket id
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    bike: Mapped["Bike"] = relationship("Bike", back_populates="maintenance_records")


class BikeLog(Base):
    __tablename__ = "bike_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bike_id: Mapped[int] = mapped_column(Integer, ForeignKey("bikes.id"), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    category: Mapped[BikeLogCategory] = mapped_column(Enum(BikeLogCategory), default=BikeLogCategory.note, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    bike: Mapped["Bike"] = relationship("Bike", back_populates="log_entries")
