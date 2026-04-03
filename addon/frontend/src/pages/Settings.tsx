import { useEffect, useState } from "react";
import { userApi, type UserRole, type Role, type Category } from "../api/client";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  technician: "Technicus",
  housekeeping: "Huishouding",
  reception: "Receptie",
};

const DEPT_LABELS: Record<Category, string> = {
  technical: "Technisch",
  housekeeping: "Huishouding",
  reception: "Receptie",
};

export default function Settings() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<UserRole>>({});
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ ha_user_id: "", display_name: "", role: "technician" as Role, email: "", ha_notify_service: "" });

  useEffect(() => {
    userApi.list().then((r) => setUsers(r.data)).finally(() => setLoading(false));
  }, []);

  async function saveEdit(userId: string) {
    const r = await userApi.update(userId, editForm);
    setUsers((prev) => prev.map((u) => u.ha_user_id === userId ? r.data : u));
    setEditing(null);
  }

  async function deleteUser(userId: string) {
    if (!confirm("Gebruiker verwijderen?")) return;
    await userApi.remove(userId);
    setUsers((prev) => prev.filter((u) => u.ha_user_id !== userId));
  }

  async function createUser() {
    const r = await userApi.create({
      ...newForm,
      notify_push: true,
      notify_email: !!newForm.email,
    });
    setUsers((prev) => [...prev, r.data]);
    setNewForm({ ha_user_id: "", display_name: "", role: "technician", email: "", ha_notify_service: "" });
    setShowNew(false);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Instellingen</h1>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Medewerkers & rollen</h2>
          <button onClick={() => setShowNew(true)} className="btn-primary text-sm">+ Toevoegen</button>
        </div>

        {showNew && (
          <div className="bg-blue-50 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold">Nieuwe medewerker</h3>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="HA user_id" value={newForm.ha_user_id}
                onChange={(e) => setNewForm({ ...newForm, ha_user_id: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 text-sm" />
              <input placeholder="Naam" value={newForm.display_name}
                onChange={(e) => setNewForm({ ...newForm, display_name: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 text-sm" />
              <select value={newForm.role}
                onChange={(e) => setNewForm({ ...newForm, role: e.target.value as Role })}
                className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
              <input placeholder="E-mail (optioneel)" value={newForm.email}
                onChange={(e) => setNewForm({ ...newForm, email: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 text-sm" />
              <input placeholder="HA notify service (bijv. notify.mobile_app_telefoon)" value={newForm.ha_notify_service}
                onChange={(e) => setNewForm({ ...newForm, ha_notify_service: e.target.value })}
                className="col-span-2 border border-gray-300 rounded px-2 py-1 text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={createUser} className="btn-primary text-sm">Opslaan</button>
              <button onClick={() => setShowNew(false)} className="btn-secondary text-sm">Annuleren</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-20">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {users.map((user) => (
              <div key={user.ha_user_id} className="py-3">
                {editing === user.ha_user_id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input value={editForm.display_name || ""}
                        onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                        placeholder="Naam"
                        className="border border-gray-300 rounded px-2 py-1 text-sm" />
                      <select value={editForm.role || user.role}
                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                      <input value={editForm.email || ""}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                        placeholder="E-mail"
                        className="border border-gray-300 rounded px-2 py-1 text-sm" />
                      <input value={editForm.ha_notify_service || ""}
                        onChange={(e) => setEditForm({ ...editForm, ha_notify_service: e.target.value })}
                        placeholder="Notify service"
                        className="border border-gray-300 rounded px-2 py-1 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(user.ha_user_id)} className="btn-primary text-sm">Opslaan</button>
                      <button onClick={() => setEditing(null)} className="btn-secondary text-sm">Annuleren</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="font-medium text-sm">{user.display_name}</p>
                      <p className="text-xs text-gray-500">{user.ha_user_id}</p>
                      <div className="flex gap-1.5 mt-1">
                        <span className="badge bg-blue-100 text-blue-700">{ROLE_LABELS[user.role]}</span>
                        {user.department && (
                          <span className="badge bg-gray-100 text-gray-600">{DEPT_LABELS[user.department]}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <button onClick={() => { setEditing(user.ha_user_id); setEditForm({ ...user }); }}
                        className="text-blue-600 hover:text-blue-700">Bewerken</button>
                      <button onClick={() => deleteUser(user.ha_user_id)}
                        className="text-red-600 hover:text-red-700">Verwijderen</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {users.length === 0 && (
              <p className="py-6 text-center text-gray-500 text-sm">Nog geen medewerkers geconfigureerd</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
