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

export default api;

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

// --- Types ---

export type Category = "technical" | "housekeeping" | "reception";
export type Status = "open" | "in_progress" | "closed";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Role = "admin" | "supervisor" | "technician" | "housekeeping" | "reception";

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
}

export interface Comment {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface UserRole {
  ha_user_id: string;
  display_name: string;
  role: Role;
  department: Category | null;
  email: string | null;
  notify_push: boolean;
  notify_email: boolean;
  ha_notify_service: string | null;
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
  is_active: boolean;
  nfc_tag_id: string | null;
  next_run: string | null;
  subtask_mode: SubtaskMode;
  subtask_items: string[] | null;
  notify_when_free: boolean;
  emoji: string | null;
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
  create: (data: Partial<Ticket> & { subtask_labels?: string[] }) => api.post<Ticket>("/tickets/", data),
  get: (id: string) => api.get<Ticket>(`/tickets/${id}`),
  update: (id: string, data: Partial<Ticket>) => api.patch<Ticket>(`/tickets/${id}`, data),
  claim: (id: string) => api.post<Ticket>(`/tickets/${id}/claim`),
  remove: (id: string) => api.delete(`/tickets/${id}`),
  getComments: (id: string) => api.get<Comment[]>(`/tickets/${id}/comments`),
  addComment: (id: string, body: string) => api.post<Comment>(`/tickets/${id}/comments`, { body }),
  updateSubtask: (id: string, index: number, done: boolean) =>
    api.patch<{ ok: boolean; subtasks: Subtask[] }>(`/tickets/${id}/subtasks`, { index, done }),
  uploadPhoto: (id: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<{ ok: boolean; filename: string; photos: string[] }>(`/tickets/${id}/photos`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deletePhoto: (id: string, filename: string) =>
    api.delete<{ ok: boolean; photos: string[] }>(`/tickets/${id}/photos/${filename}`),
  photoUrl: (id: string, filename: string) => `${API_BASE}/tickets/${id}/photos/${filename}`,
};

export const userApi = {
  me: () => api.get<UserRole>("/users/me"),
  list: () => api.get<UserRole[]>("/users/"),
  create: (data: Partial<UserRole>) => api.post<UserRole>("/users/", data),
  update: (id: string, data: Partial<UserRole>) => api.patch<UserRole>(`/users/${id}`, data),
  remove: (id: string) => api.delete(`/users/${id}`),
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

export interface SystemSettings {
  ticket_base_url: string;
}

export const systemSettingsApi = {
  get: () => api.get<SystemSettings>("/settings/system"),
  update: (data: Partial<SystemSettings>) => api.patch<SystemSettings>("/settings/system", data),
};

export const reportApi = {
  summary: (params?: Record<string, string>) => api.get<ReportSummary>("/reports/summary", { params }),
  timeline: (params?: Record<string, string>) => api.get<TimelinePoint[]>("/reports/timeline", { params }),
  exportCsv: () => api.get("/reports/export/csv", { responseType: "blob" }),
  exportExcel: () => api.get("/reports/export/excel", { responseType: "blob" }),
};
