import axios from "axios";

// HA ingress serveert de app op een dynamisch subpad (bijv. /api/hassio_ingress/TOKEN/).
// Door de baseURL van het huidige paginapad af te leiden werken API-calls
// zowel lokaal als via de HA ingress proxy.
const pagePath = window.location.pathname.endsWith("/")
  ? window.location.pathname
  : window.location.pathname + "/";
const API_BASE = pagePath + "api";

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

// Voeg de HA auth token toe aan elke request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("ha_token") || "dev-token";
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Standalone toegang (buiten HA ingress): bij een 401 is er geen geldige
// sessie — stuur de gebruiker naar de loginpagina. Via ingress komt een 401
// niet voor (de Supervisor-headers loggen automatisch in).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url || "";
    if (status === 401 && !url.includes("/auth/login") && !window.location.hash.startsWith("#/login")) {
      window.location.hash = "#/login";
    }
    return Promise.reject(error);
  }
);

export default api;

// --- Standalone login (sessietokens) ---

export interface LoginBan {
  ip: string;
  failed_count: number;
  last_username: string | null;
  last_attempt_at: string;
  banned: boolean;
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ token: string; expires_at: number; display_name: string }>("/auth/login", {
      username,
      password,
    }),
  changePassword: (current_password: string, new_password: string) =>
    api.post<{ ok: boolean }>("/auth/change-password", { current_password, new_password }),
  // Admin: IP's met mislukte inlogpogingen / blokkades
  listBans: () => api.get<LoginBan[]>("/auth/bans"),
  removeBan: (ip: string) => api.delete(`/auth/bans/${encodeURIComponent(ip)}`),
};

// Actieve sessies / apparaatbeheer (standalone loginpagina)
export interface Session {
  id: string;
  device: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  current: boolean;
  // Alleen gevuld in het admin-overzicht:
  display_name?: string | null;
  ha_user_id?: string | null;
}

export const sessionsApi = {
  /** De eigen actieve apparaten van de ingelogde medewerker. */
  list: () => api.get<Session[]>("/auth/sessions"),
  /** Admin: alle actieve sessies over alle medewerkers. */
  listAll: () => api.get<Session[]>("/auth/sessions/all"),
  /** Log een apparaat uit (eigen sessie, of elke sessie als admin). */
  revoke: (id: string) => api.delete(`/auth/sessions/${id}`),
  /** Log de huidige sessie server-side uit. */
  logout: () => api.post("/auth/logout"),
};

/** True wanneer de app draait op een sessietoken van de loginpagina. */
export function hasSessionToken(): boolean {
  return (localStorage.getItem("ha_token") || "").startsWith("hts.");
}

export function setSessionToken(token: string) {
  localStorage.setItem("ha_token", token);
}

export function clearSessionToken() {
  localStorage.removeItem("ha_token");
}

/**
 * Parseer een datetime-string van de API als UTC.
 * De backend stuurt naive UTC strings zonder "Z"-suffix; door "Z" toe te voegen
 * weet JavaScript dat het UTC is en converteert het correct naar de lokale tijdzone.
 */
export function parseUTC(s: string): Date {
  if (!s.endsWith("Z") && !s.match(/[+-]\d{2}:\d{2}$/)) {
    return new Date(s + "Z");
  }
  return new Date(s);
}

/**
 * Formatteer een datum (YYYY-MM-DD of ISO-timestamp) naar Nederlandse notatie DD:MM:YYYY.
 */
export function formatDateNL(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const [, y, m, d] = match;
  return `${d}:${m}:${y}`;
}

// --- Types ---

export type Category = "technical" | "housekeeping" | "reception" | "service" | "kitchen" | "sales" | "garden";
export type Status = "open" | "in_progress" | "closed";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Role = "admin" | "supervisor" | "employee";

export interface Subtask {
  label: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
}

export interface Ticket {
  id: string;
  title: string;
  description: string | null;
  category: Category;
  status: Status;
  priority: Priority;
  location_id: string | null;
  created_by: string;
  assigned_to: string | null;
  recurring_template_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
  notify_when_free: boolean;
  subtasks: Subtask[] | null;
  photos: string[] | null;
  comment_count?: number;
  pinned?: boolean;
  sort_order?: number;
}

export interface Comment {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
}

export type TicketEventType =
  | "created" | "assigned" | "unassigned" | "priority" | "closed" | "reopened" | "category";

export interface TicketEvent {
  id: string;
  ticket_id: string;
  actor_id: string;
  type: TicketEventType;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}

export interface PermissionEvent {
  id: string;
  subject_id: string;
  actor_id: string;
  field: string;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}

export interface UserRole {
  ha_user_id: string;
  display_name: string;
  ha_username: string | null;
  role: Role;
  /** Hoofdafdeling — leidend voor "mijn afdeling" in de overzichten. */
  department: Category | null;
  /** Alle afdelingen waarin gehandeld mag worden (hoofd + uitzonderingen). */
  departments?: Category[];
  /** Zichtbare modules; null = alle. */
  modules?: string[] | null;
  /** Rapportage: null = volgt de rol. */
  can_reports?: boolean | null;
  email: string | null;
  notify_push: boolean;
  notify_email: boolean;
  ha_notify_service: string | null;
  ha_device_tracker: string | null;
  notify_new_ticket: boolean;
  notify_direct_message: boolean;
  notify_mention: boolean;
  // true = lokaal app-account (wachtwoord in de addon zelf, geen HA nodig)
  has_password: boolean;
}

export type SubtaskMode = "none" | "subtasks" | "rooms";

export interface RecurringTemplate {
  id: string;
  title: string;
  description: string | null;
  category: Category;
  priority: Priority;
  location_id: string | null;
  assign_to: string | null;
  cron_expression: string;
  advance_days: number;
  interval_days: number | null;
  is_active: boolean;
  nfc_tag_id: string | null;
  next_run: string | null;
  next_due_at: string | null;
  subtask_mode: SubtaskMode;
  subtask_items: string[] | null;
  notify_when_free: boolean;
  emoji: string | null;
  folder: string | null;
}

export interface ActiveTicket {
  id: string;
  title: string;
  status: Status;
  location_id: string | null;
  subtasks: Subtask[] | null;
  assigned_to: string | null;
  notify_when_free: boolean;
}

export interface HistoryEntry {
  id: string;
  title: string;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
}

export interface UpcomingRecurring {
  id: string;
  title: string;
  category: Category;
  priority: Priority;
  location_id: string | null;
  nfc_tag_id: string | null;
  next_run: string;
  cron_expression?: string;
  interval_days?: number | null;
  subtask_done?: number;
  subtask_total?: number;
  emoji?: string | null;
  subtask_mode?: string;
  subtask_items?: string[];
}

export interface Location {
  id: string;
  name: string;
}

export interface KeycardStatus {
  entity_id: string;
  found: boolean;
  occupied: boolean | null;
  state?: string;
  friendly_name?: string;
}

export interface ReportSummary {
  status_counts: Record<Status, number>;
  category_counts: Record<Category, number>;
  priority_counts: Record<Priority, number>;
  avg_resolution_hours: number | null;
  /** Gemiddelde doorlooptijd per afdeling — de vraag die er echt is. */
  avg_resolution_by_category?: Partial<Record<Category, { hours: number; count: number }>>;
  /** Open tickets ouder dan zeven dagen. */
  open_older_than_7d?: number;
  total_tickets: number;
}

export interface TimelinePoint {
  period: string;
  total: number;
  open: number;
  closed: number;
}

// --- API functies ---

export const ticketApi = {
  list: (params?: Record<string, string>) => api.get<Ticket[]>("/tickets/", { params }),
  counts: (params?: Record<string, string>) => api.get<Record<Status, number>>("/tickets/counts", { params }),
  create: (data: Partial<Ticket> & { subtask_labels?: string[] }) => api.post<Ticket>("/tickets/", data),
  get: (id: string) => api.get<Ticket>(`/tickets/${id}`),
  update: (id: string, data: Partial<Ticket>) => api.patch<Ticket>(`/tickets/${id}`, data),
  claim: (id: string) => api.post<Ticket>(`/tickets/${id}/claim`),
  remove: (id: string) => api.delete(`/tickets/${id}`),
  pin: (id: string) => api.post(`/tickets/${id}/pin`),
  unpin: (id: string) => api.delete(`/tickets/${id}/pin`),
  reorder: (ticket_ids: string[]) => api.post(`/tickets/reorder`, { ticket_ids }),
  getComments: (id: string) => api.get<Comment[]>(`/tickets/${id}/comments`),
  /** Het verloop: wie deed wat, en wanneer. */
  getEvents: (id: string) => api.get<TicketEvent[]>(`/tickets/${id}/events`),
  addComment: (id: string, body: string) => api.post<Comment>(`/tickets/${id}/comments`, { body }),
  updateComment: (ticketId: string, commentId: string, body: string) =>
    api.patch<Comment>(`/tickets/${ticketId}/comments/${commentId}`, { body }),
  deleteComment: (ticketId: string, commentId: string) =>
    api.delete(`/tickets/${ticketId}/comments/${commentId}`),
  updateSubtask: (id: string, index: number, done: boolean) =>
    api.patch<{ ok: boolean; subtasks: Subtask[] }>(`/tickets/${id}/subtasks`, { index, done }),
  addSubtask: (id: string, label: string) =>
    api.post<{ ok: boolean; subtasks: Subtask[] }>(`/tickets/${id}/subtasks`, { label }),
  listPhotos: (id: string) => api.get<{ filename: string }[]>(`/tickets/${id}/photos`),
  uploadPhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{ filename: string }>(`/tickets/${id}/photos`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deletePhoto: (id: string, filename: string) => api.delete(`/tickets/${id}/photos/${filename}`),
  photoUrl: (id: string, filename: string) => `${API_BASE}/tickets/${id}/photos/${filename}`,
};

export type NotificationType = "mention" | "comment";

export interface TicketNotification {
  id: string;
  type: NotificationType;
  ticket_id: string;
  ticket_title: string | null;
  comment_id: string | null;
  comment_body: string | null;
  actor_id: string;
  actor_name: string | null;
  read: boolean;
  created_at: string;
}

export const notificationApi = {
  list: () => api.get<TicketNotification[]>("/notifications/"),
  unreadCount: () => api.get<{ count: number }>("/notifications/unread-count"),
  markRead: (id: string) => api.post(`/notifications/${id}/read`),
  markAllRead: () => api.post("/notifications/read-all"),
  markReadByTicket: (ticketId: string) => api.post(`/notifications/read-by-ticket/${ticketId}`),
};

export interface DirectMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  from_me: boolean;
  read: boolean;
  created_at: string;
}

export interface Conversation {
  user_id: string;
  display_name: string;
  last_body: string;
  last_from_me: boolean;
  last_created_at: string;
  unread: number;
}

export const messageApi = {
  conversations: () => api.get<Conversation[]>("/messages/conversations"),
  thread: (userId: string) => api.get<DirectMessage[]>(`/messages/with/${userId}`),
  unreadCount: () => api.get<{ count: number }>("/messages/unread-count"),
  send: (recipientId: string, body: string) =>
    api.post<DirectMessage>("/messages/", { recipient_id: recipientId, body }),
};

export const userApi = {
  me: () => api.get<UserRole>("/users/me"),
  list: () => api.get<UserRole[]>("/users/"),
  create: (data: Partial<UserRole> & { password?: string }) => api.post<UserRole>("/users/", data),
  update: (id: string, data: Partial<UserRole> & { extra_departments?: Category[] }) =>
    api.patch<UserRole>(`/users/${id}`, data),
  /** Admin: wat er aan de rechten van deze medewerker veranderde, en door wie. */
  permissionEvents: (id: string) => api.get<PermissionEvent[]>(`/users/${id}/permission-events`),
  remove: (id: string) => api.delete(`/users/${id}`),
  // Admin: wachtwoord van een lokaal app-account instellen/resetten (null = uitschakelen)
  setPassword: (id: string, password: string | null) =>
    api.post<UserRole>(`/users/${id}/password`, { password }),
};

export const locationApi = {
  list: () => api.get<Location[]>("/locations/"),
  keycard: (areaId: string) => api.get<KeycardStatus>(`/locations/${areaId}/keycard`),
};

export const recurringApi = {
  list: () => api.get<RecurringTemplate[]>("/recurring/"),
  create: (data: Partial<RecurringTemplate>) => api.post<RecurringTemplate>("/recurring/", data),
  get: (id: string) => api.get<RecurringTemplate>(`/recurring/${id}`),
  update: (id: string, data: Partial<RecurringTemplate>) => api.patch<RecurringTemplate>(`/recurring/${id}`, data),
  remove: (id: string) => api.delete(`/recurring/${id}`),
  complete: (id: string, roomId?: string) =>
    api.post<{ ok: boolean; closed_ticket_ids: string[] }>(`/recurring/${id}/complete`, { room_id: roomId ?? null }),
  start: (id: string) =>
    api.post<{ ok: boolean; created_ticket_ids: string[] }>(`/recurring/${id}/start`),
  history: (id: string) => api.get<HistoryEntry[]>(`/recurring/${id}/history`),
  activeTickets: (id: string) => api.get<ActiveTicket[]>(`/recurring/${id}/active-tickets`),
};

export interface IntegrationStatus {
  installed: boolean;
  installed_version: string | null;
  bundled_version: string;
  update_available: boolean;
}

export const integrationApi = {
  status: () => api.get<IntegrationStatus>("/integration/status"),
  install: () => api.post<{ ok: boolean; version: string; message: string }>("/integration/install"),
};

// --- Beta-omgeving ---

export interface BetaStatus {
  beta_mode: boolean;
  label: string;
  version: string;
  source: {
    available: boolean;
    modified_at?: string | null;
    size_bytes?: number | null;
  };
  last_copy_at: string | null;
  copied_source_modified_at: string | null;
}

export interface BetaCopyResult {
  ok: boolean;
  copied_at: string;
  source_modified_at: string | null;
  tables: Record<string, number>;
  photos: number;
  message: string;
}

export const betaApi = {
  status: () => api.get<BetaStatus>("/beta/status"),
  copyProduction: () => api.post<BetaCopyResult>("/beta/copy-production"),
};

export interface SystemSettings {
  ticket_base_url: string;
}

export const systemSettingsApi = {
  get: () => api.get<SystemSettings>("/settings/system"),
  update: (data: Partial<SystemSettings>) => api.patch<SystemSettings>("/settings/system", data),
};

export interface BrandingSettings {
  brand_color: string | null;
  brand_logo: string | null;
  btn_color: string | null;
  bg_color: string | null;
  bg_image: string | null;
}

export const brandingApi = {
  get: () => api.get<BrandingSettings>("/settings/branding"),
  update: (data: { brand_color?: string | null; btn_color?: string | null; bg_color?: string | null }) =>
    api.patch<BrandingSettings>("/settings/branding", data),
  uploadLogo: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<BrandingSettings>("/settings/branding/logo", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  uploadBackground: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<BrandingSettings>("/settings/branding/background", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteBackground: () => api.delete<BrandingSettings>("/settings/branding/background"),
};

// --- Loginpagina huisstijl ---

export interface LoginBranding {
  title: string;
  subtitle: string;
  footer: string;
  logo: string | null;
  btn_color: string | null;
  bg_color: string | null;
  bg_image: string | null;
  /** Per veld: true = eigen loginpagina-waarde, false = geërfd van de huisstijl */
  custom: Record<string, boolean>;
}

export const loginBrandingApi = {
  get: () => api.get<LoginBranding>("/settings/login-branding"),
  update: (data: {
    title?: string | null;
    subtitle?: string | null;
    footer?: string | null;
    btn_color?: string | null;
    bg_color?: string | null;
  }) => api.patch<LoginBranding>("/settings/login-branding", data),
  uploadLogo: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<LoginBranding>("/settings/login-branding/logo", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteLogo: () => api.delete<LoginBranding>("/settings/login-branding/logo"),
  uploadBackground: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<LoginBranding>("/settings/login-branding/background", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteBackground: () => api.delete<LoginBranding>("/settings/login-branding/background"),
};

// --- Zwembaden types ---

export type PoolId = "wellness" | "zwembad";

export interface PoolLog {
  id: string;
  pool_id: PoolId;
  datum: string;
  tijd: string;
  doorzicht: string | null;
  water_temp: number | null;
  ph: number | null;
  vbc_in: number | null;
  vbc_uit: number | null;
  tbc: number | null;
  gbc: number | null;
  ph_automaat: number | null;
  vbc_automaat: number | null;
  watermeter: number | null;
  verbruik: number | null;
  filterspoeling: string | null;
  bezoekers: number | null;
  reiniging: boolean;
  flow: number | null;
  chemicalien: string | null;
  gemeten_door: string;
  notitie: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChemicalReplacement {
  datum: string;
  tijd: string;
  door: string | null;
}

export interface PoolStatus {
  pool_id: string;
  label: string;
  today: string;
  measurements_today: number;
  compliant: boolean;
  latest: PoolLog | null;
  chemicalien_vervangen?: Record<string, ChemicalReplacement | null>;
}

export interface PoolConfigItem {
  pool_id: string;
  label: string;
  filter_nfc_tag_id: string | null;
  filter_nfc_tag_id_r: string | null;
  chloor_nfc_tag_id: string | null;
  zuur_nfc_tag_id: string | null;
  vlokmiddel_nfc_tag_id: string | null;
  filter_template_id: string | null;
  filter_template_id_r: string | null;
  chloor_template_id: string | null;
  zuur_template_id: string | null;
  vlokmiddel_template_id: string | null;
}

export interface PoolIncident {
  id: string;
  pool_id: PoolId;
  datum: string;
  tijd: string;
  beschrijving: string;
  maatregelen: string | null;
  gemeld_door: string;
  created_at: string;
}

export interface PoolIncidentCreate {
  pool_id: PoolId;
  datum: string;
  tijd: string;
  beschrijving: string;
  maatregelen?: string | null;
}

export const poolApi = {
  status: () => api.get<PoolStatus[]>("/pools/status"),
  list: (params?: Record<string, string>) => api.get<PoolLog[]>("/pools/logs", { params }),
  create: (data: Partial<PoolLog>) => api.post<PoolLog>("/pools/logs", data),
  get: (id: string) => api.get<PoolLog>(`/pools/logs/${id}`),
  update: (id: string, data: Partial<PoolLog>) => api.patch<PoolLog>(`/pools/logs/${id}`, data),
  remove: (id: string) => api.delete(`/pools/logs/${id}`),
  getConfigs: () => api.get<PoolConfigItem[]>("/pools/config"),
  updateConfig: (poolId: string, data: Partial<PoolConfigItem>) => api.patch<PoolConfigItem>(`/pools/config/${poolId}`, data),
  listIncidents: (params?: Record<string, string>) => api.get<PoolIncident[]>("/pools/incidents", { params }),
  createIncident: (data: PoolIncidentCreate) => api.post<PoolIncident>("/pools/incidents", data),
  removeIncident: (id: string) => api.delete(`/pools/incidents/${id}`),
  importCsv: (file: File, poolId: string) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{ imported: number; skipped: number }>(`/pools/import?pool_id=${poolId}`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  exportCsv: (params?: Record<string, string>) =>
    api.get("/pools/export/csv", { params, responseType: "blob" }),
  resetLogs: (poolId?: string) =>
    api.delete<{ deleted: number }>(`/pools/logs${poolId ? `?pool_id=${poolId}` : ""}`),
};

export const reportApi = {
  summary: (params?: Record<string, string>) => api.get<ReportSummary>("/reports/summary", { params }),
  timeline: (params?: Record<string, string>) => api.get<TimelinePoint[]>("/reports/timeline", { params }),
  exportCsv: () => api.get("/reports/export/csv", { responseType: "blob" }),
  exportExcel: () => api.get("/reports/export/excel", { responseType: "blob" }),
};

// --- Fietsen types ---

export type BikeStatus = "available" | "maintenance" | "retired";
export type BikeReservationStatus = "active" | "completed" | "cancelled";
export type BikeLogCategory = "note" | "maintenance" | "issue";
export type BikesModuleRoles = "all" | "reception" | "admin_supervisor";

export interface BikeType {
  id: number;
  name: string;
  price_per_day: number;
  bike_count?: number;
}

export interface Bike {
  id: number;
  number: string;
  name: string;
  type_id: number;
  type_name: string | null;
  is_reserve: boolean;
  status: BikeStatus;
  total_rental_days: number;
  notes: string | null;
}

export interface BikeReservation {
  id: number;
  guest_name: string;
  guest_room: string | null;
  start_date: string;
  end_date: string;
  num_days: number;
  num_bikes: number;
  bike_type_id: number;
  bike_type_name: string | null;
  price_per_day: number | null;
  total_price: number | null;
  status: BikeReservationStatus;
  notes: string | null;
  key_given_at: string | null;
  key_returned_at: string | null;
  bikes: { id: number; number: string; name: string }[];
  created_at: string | null;
}

export interface BikeAvailability {
  available: boolean;
  available_count: number;
  requested_count: number;
  bikes: Bike[];
}

export interface BikeLogEntry {
  id: number | null;
  type: BikeLogCategory | "rental" | "maintenance";
  date: string;
  end_date: string | null;
  description: string;
  meta: string | null;
  ticket_id?: string | null;
  deletable: boolean;
}

export interface BikeMaintenanceConflict {
  reservation_id: number;
  guest_name: string;
  start_date: string;
  end_date: string;
  can_move: boolean;
  alternative_bike: string | null;
}

export interface BikeMaintenanceRecord {
  id: number;
  start_date: string;
  expected_end_date: string | null;
  reason: string | null;
  notes: string | null;
  resolved_at: string | null;
  ticket_id: string | null;
}

// --- Fietsen API ---

export const bikeApi = {
  // Fietstypes
  listTypes: () => api.get<BikeType[]>("/bikes/types"),
  createType: (data: { name: string; price_per_day: number }) => api.post<BikeType>("/bikes/types", data),
  updateType: (id: number, data: Partial<BikeType>) => api.put<BikeType>(`/bikes/types/${id}`, data),
  deleteType: (id: number) => api.delete(`/bikes/types/${id}`),

  // Fietsen
  list: () => api.get<Bike[]>("/bikes"),
  create: (data: Omit<Bike, "id" | "type_name" | "status" | "total_rental_days" | "notes"> & { notes?: string | null }) =>
    api.post<Bike>("/bikes", data),
  update: (id: number, data: Partial<Bike>) => api.put<Bike>(`/bikes/${id}`, data),
  remove: (id: number) => api.delete(`/bikes/${id}`),

  // Beschikbaarheid
  checkAvailability: (params: { start_date: string; num_days: number; type_id: number; count?: number }) =>
    api.get<BikeAvailability>("/bikes/availability", { params }),

  // Logboek
  getLog: (bikeId: number) => api.get<BikeLogEntry[]>(`/bikes/${bikeId}/log`),
  addLog: (bikeId: number, data: { entry_date: string; category: BikeLogCategory; description: string }) =>
    api.post<{ id: number; ok: boolean }>(`/bikes/${bikeId}/log`, data),
  deleteLog: (bikeId: number, entryId: number) => api.delete(`/bikes/${bikeId}/log/${entryId}`),
};

export const bikeReservationApi = {
  list: (status?: BikeReservationStatus | "all") =>
    api.get<BikeReservation[]>("/bike-reservations", { params: status && status !== "all" ? { status } : {} }),
  create: (data: {
    guest_name: string;
    guest_room?: string;
    start_date: string;
    num_days: number;
    num_bikes: number;
    bike_type_id: number;
    notes?: string;
  }) => api.post<BikeReservation>("/bike-reservations", data),
  get: (id: number) => api.get<BikeReservation>(`/bike-reservations/${id}`),
  update: (id: number, data: Partial<BikeReservation> & { key_given?: boolean; key_returned?: boolean }) =>
    api.put<BikeReservation>(`/bike-reservations/${id}`, data),
  cancel: (id: number) => api.delete(`/bike-reservations/${id}`),
};

export const bikeMaintenanceApi = {
  start: (data: {
    bike_id: number;
    start_date: string;
    expected_end_date?: string;
    reason?: string;
    notes?: string;
    conflict_action?: "move" | "cancel";
  }) => api.post<{ ok: boolean; maintenance_record_id: number; ticket_id: string; moved_reservations: object[]; cancelled_reservations: object[] }>("/bike-maintenance/start", data),
  resolve: (bikeId: number) =>
    api.post<{ ok: boolean }>("/bike-maintenance/resolve", { bike_id: bikeId }),
  checkConflicts: (bikeId: number, startDate: string, expectedEndDate?: string) =>
    api.get<BikeMaintenanceConflict[]>(`/bike-maintenance/conflicts/${bikeId}`, {
      params: { start_date: startDate, ...(expectedEndDate ? { expected_end_date: expectedEndDate } : {}) },
    }),
  history: (bikeId: number) =>
    api.get<BikeMaintenanceRecord[]>(`/bike-maintenance/history/${bikeId}`),
};

export const bikesModuleApi = {
  getSetting: () => api.get<{ bikes_module_roles: BikesModuleRoles }>("/settings/bikes-module"),
  updateSetting: (roles: BikesModuleRoles) =>
    api.patch<{ bikes_module_roles: BikesModuleRoles }>("/settings/bikes-module", { bikes_module_roles: roles }),
};

export const bikeAdminApi = {
  importExcel: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{
      ok: boolean;
      imported: number;
      skipped: number;
      skipped_duplicates: number;
      skipped_no_bike: number;
      bikes_created: number;
      errors: string[];
    }>(
      "/bike-admin/import-excel",
      form,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
  },
  exportExcel: async () => {
    const response = await api.get("/bike-admin/export-excel", { responseType: "blob" });
    const blob = new Blob([response.data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `fietsreserveringen_${today}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  },
  rebalance: (dryRun?: boolean) =>
    api.post<{ ok: boolean; changed: number; total_future: number; dry_run: boolean; projected_days?: Record<number, number> }>(
      `/bike-admin/rebalance${dryRun ? "?dry_run=true" : ""}`
    ),
  resetDatabase: () =>
    api.delete<{ ok: boolean; message: string }>("/bike-admin/reset"),
};

// --- Kennisbank / bot ---

export type KnowledgeQuestionStatus = "answered_by_bot" | "pending" | "resolved" | "dismissed";

export type KnowledgeVisibility = "all" | "department" | "management" | "admin";

export const VISIBILITY_LABELS: Record<KnowledgeVisibility, string> = {
  all: "🌐 Iedereen",
  department: "🏢 Alleen afdeling",
  management: "👔 Supervisors + admin",
  admin: "🔑 Alleen admin",
};

export interface KnowledgeEntry {
  id: string;
  title: string;
  answer: string;
  keywords: string | null;
  context: string | null;
  category: Category | null;
  visibility: KnowledgeVisibility;
  folder: string | null;
  source_ticket_id: string | null;
  images: string[];
  ask_count: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeImportResult {
  found: number;
  imported: number;
  skipped: number;
  images: number;
}

export interface KnowledgeQuestion {
  id: string;
  question_text: string;
  asked_by: string;
  asked_by_name: string | null;
  category: Category | null;
  status: KnowledgeQuestionStatus;
  matched_entry_id: string | null;
  resolved_entry_id: string | null;
  proposed_answer: string | null;
  proposed_by: string | null;
  conversation: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface AskDocument {
  id: string;
  title: string;
  images: string[];
}

export interface AskResponse {
  answered: boolean;
  question_id: string;
  entries: KnowledgeEntry[];
  documents?: AskDocument[];
  ai_answer?: string | null;
  source?: "ai" | "entries" | null;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  source_filename: string | null;
  context: string | null;
  keywords: string | null;
  category: Category | null;
  visibility: KnowledgeVisibility;
  folder: string | null;
  images: string[];
  chunk_count: number;
  created_at: string;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  content: string;
}

export interface KnowledgeDocumentMatch extends KnowledgeDocument {
  snippet: string;
}

export interface KnowledgeSearchResults {
  entries: KnowledgeEntry[];
  documents: KnowledgeDocumentMatch[];
}

export interface KnowledgeCleanupResult {
  title: string;
  category: Category | null;
  folder: string | null;
  content: string;
}

export interface KnowledgeAiSettings {
  ai_available: boolean;
  ai_enabled: boolean;
  model: string;
  has_key: boolean;
  key_from_addon: boolean;
  web_search_enabled: boolean;
  web_domains: string;
}

export interface KnowledgeAiSettingsUpdate {
  enabled?: boolean;
  api_key?: string;
  model?: string;
  web_search_enabled?: boolean;
  web_domains?: string;
}

export interface KnowledgeStats {
  pending_count: number;
  entry_count: number;
  top_entries: KnowledgeEntry[];
}

export interface KnowledgeEntryInput {
  title?: string;
  answer?: string;
  keywords?: string | null;
  context?: string | null;
  category?: Category | null;
  visibility?: KnowledgeVisibility;
  folder?: string | null;
  is_published?: boolean;
  source_ticket_id?: string | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export const knowledgeApi = {
  ask: (question: string, category?: Category | null, history?: ChatTurn[]) =>
    api.post<AskResponse>("/knowledge/ask", {
      question,
      category: category ?? null,
      history: history ?? [],
    }),
  listEntries: (params?: Record<string, string>) =>
    api.get<KnowledgeEntry[]>("/knowledge/entries", { params }),
  getEntry: (id: string) => api.get<KnowledgeEntry>(`/knowledge/entries/${id}`),
  createEntry: (data: KnowledgeEntryInput) =>
    api.post<KnowledgeEntry>("/knowledge/entries", data),
  updateEntry: (id: string, data: KnowledgeEntryInput) =>
    api.patch<KnowledgeEntry>(`/knowledge/entries/${id}`, data),
  removeEntry: (id: string) => api.delete(`/knowledge/entries/${id}`),
  submitSolution: (questionId: string, solution: string, conversation?: ChatTurn[]) =>
    api.post<{ status: "queued" | "already_known" }>(
      `/knowledge/questions/${questionId}/solution`,
      { solution, conversation: conversation ?? [] }
    ),
  queue: () => api.get<KnowledgeQuestion[]>("/knowledge/queue"),
  answerQueue: (
    qid: string,
    data: { title: string; answer: string; keywords?: string | null; category?: Category | null; folder?: string | null }
  ) => api.post<KnowledgeEntry>(`/knowledge/queue/${qid}/answer`, data),
  dismissQueue: (qid: string) => api.post(`/knowledge/queue/${qid}/dismiss`),
  fromTicket: (ticketId: string, data?: KnowledgeEntryInput) =>
    api.post<KnowledgeEntry>(`/knowledge/from-ticket/${ticketId}`, data ?? {}),
  stats: () => api.get<KnowledgeStats>("/knowledge/stats"),
  imageUrl: (entryId: string, filename: string) =>
    `${API_BASE}/knowledge/entries/${entryId}/images/${filename}`,
  uploadImage: (entryId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{ filename: string }>(`/knowledge/entries/${entryId}/images`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteImage: (entryId: string, filename: string) =>
    api.delete(`/knowledge/entries/${entryId}/images/${filename}`),
  importFile: (file: File, category?: Category | null) => {
    const form = new FormData();
    form.append("file", file);
    const qs = category ? `?category=${category}` : "";
    return api.post<KnowledgeImportResult>(`/knowledge/import${qs}`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  // Documenten (RAG-bron)
  listDocuments: () => api.get<KnowledgeDocument[]>("/knowledge/documents"),
  createDocument: (data: { title: string; content: string; context?: string | null; keywords?: string | null; category?: Category | null; visibility?: KnowledgeVisibility; folder?: string | null }) =>
    api.post<KnowledgeDocument>("/knowledge/documents", data),
  uploadDocument: (
    file: File,
    title?: string,
    category?: Category | null,
    folder?: string | null,
    context?: string | null,
    visibility?: KnowledgeVisibility,
    keywords?: string | null
  ) => {
    const form = new FormData();
    form.append("file", file);
    const params = new URLSearchParams();
    if (title) params.set("title", title);
    if (context) params.set("context", context);
    if (keywords) params.set("keywords", keywords);
    if (category) params.set("category", category);
    if (visibility) params.set("visibility", visibility);
    if (folder) params.set("folder", folder);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return api.post<KnowledgeDocument>(`/knowledge/documents/upload${qs}`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  getDocument: (id: string) => api.get<KnowledgeDocumentDetail>(`/knowledge/documents/${id}`),
  updateDocument: (
    id: string,
    data: { title?: string; content?: string; context?: string | null; keywords?: string | null; category?: Category | null; visibility?: KnowledgeVisibility; folder?: string | null }
  ) => api.patch<KnowledgeDocumentDetail>(`/knowledge/documents/${id}`, data),
  removeDocument: (id: string) => api.delete(`/knowledge/documents/${id}`),
  docImageUrl: (documentId: string, filename: string) =>
    `${API_BASE}/knowledge/documents/${documentId}/images/${filename}`,
  uploadDocImage: (documentId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{ filename: string }>(`/knowledge/documents/${documentId}/images`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteDocImage: (documentId: string, filename: string) =>
    api.delete(`/knowledge/documents/${documentId}/images/${filename}`),
  aiCleanup: (text: string) =>
    api.post<KnowledgeCleanupResult>("/knowledge/ai/cleanup", { text }),
  searchBeheer: (q: string) =>
    api.get<KnowledgeSearchResults>("/knowledge/search", { params: { q } }),
  // AI-instellingen
  getAiSettings: () => api.get<KnowledgeAiSettings>("/knowledge/ai-settings"),
  updateAiSettings: (data: KnowledgeAiSettingsUpdate) =>
    api.patch<KnowledgeAiSettings>("/knowledge/ai-settings", data),
};

export const CATEGORY_LABELS: Record<Category, string> = {
  technical: "Technisch",
  housekeeping: "Huishouding",
  reception: "Receptie",
  service: "Bediening",
  kitchen: "Keuken",
  sales: "Sales",
  garden: "Tuin",
};
