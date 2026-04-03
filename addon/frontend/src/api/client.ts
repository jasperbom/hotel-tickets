import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

// Voeg de HA auth token toe aan elke request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("ha_token") || "dev-token";
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;

// --- Types ---

export type Category = "technical" | "housekeeping" | "reception";
export type Status = "open" | "in_progress" | "closed";
export type Priority = "low" | "medium" | "high" | "urgent";
export type Role = "admin" | "supervisor" | "technician" | "housekeeping" | "reception";

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
}

export interface Location {
  id: string;
  name: string;
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
  create: (data: Partial<Ticket>) => api.post<Ticket>("/tickets/", data),
  get: (id: string) => api.get<Ticket>(`/tickets/${id}`),
  update: (id: string, data: Partial<Ticket>) => api.patch<Ticket>(`/tickets/${id}`, data),
  claim: (id: string) => api.post<Ticket>(`/tickets/${id}/claim`),
  remove: (id: string) => api.delete(`/tickets/${id}`),
  getComments: (id: string) => api.get<Comment[]>(`/tickets/${id}/comments`),
  addComment: (id: string, body: string) => api.post<Comment>(`/tickets/${id}/comments`, { body }),
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
};

export const recurringApi = {
  list: () => api.get<RecurringTemplate[]>("/recurring/"),
  create: (data: Partial<RecurringTemplate>) => api.post<RecurringTemplate>("/recurring/", data),
  get: (id: string) => api.get<RecurringTemplate>(`/recurring/${id}`),
  update: (id: string, data: Partial<RecurringTemplate>) => api.patch<RecurringTemplate>(`/recurring/${id}`, data),
  remove: (id: string) => api.delete(`/recurring/${id}`),
};

export const reportApi = {
  summary: (params?: Record<string, string>) => api.get<ReportSummary>("/reports/summary", { params }),
  timeline: (params?: Record<string, string>) => api.get<TimelinePoint[]>("/reports/timeline", { params }),
  exportCsv: () => api.get("/reports/export/csv", { responseType: "blob" }),
  exportExcel: () => api.get("/reports/export/excel", { responseType: "blob" }),
};
