import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { reportApi, type ReportSummary, type TimelinePoint } from "../api/client";

const CATEGORY_COLORS = { technical: "#8b5cf6", housekeeping: "#14b8a6", reception: "#6366f1" };
const CATEGORY_LABELS = { technical: "TD", housekeeping: "Huishouding", reception: "Receptie" };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("week");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = { group_by: groupBy };
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;

    Promise.all([
      reportApi.summary(params),
      reportApi.timeline(params),
    ])
      .then(([s, t]) => {
        setSummary(s.data);
        setTimeline(t.data);
      })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, groupBy]);

  async function exportFile(type: "csv" | "excel") {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;

      const r = type === "csv"
        ? await reportApi.exportCsv()
        : await reportApi.exportExcel();
      downloadBlob(r.data, type === "csv" ? "tickets.csv" : "tickets.xlsx");
    } finally {
      setExporting(false);
    }
  }

  const categoryPieData = summary
    ? Object.entries(summary.category_counts).map(([key, val]) => ({
        name: CATEGORY_LABELS[key as keyof typeof CATEGORY_LABELS],
        value: val,
        color: CATEGORY_COLORS[key as keyof typeof CATEGORY_COLORS],
      }))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Rapportage</h1>
        <div className="flex gap-2">
          <button
            onClick={() => exportFile("csv")}
            disabled={exporting}
            className="btn-secondary text-sm"
          >
            Export CSV
          </button>
          <button
            onClick={() => exportFile("excel")}
            disabled={exporting}
            className="btn-secondary text-sm"
          >
            Export Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Van:</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Tot:</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
        </div>
        <div className="flex gap-1">
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={`px-3 py-1 text-sm rounded-lg border transition-colors ${
                groupBy === g ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {g === "day" ? "Dag" : g === "week" ? "Week" : "Maand"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <>
          {/* Samenvattingscijfers */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="card text-center">
                <p className="text-3xl font-bold text-blue-700">{summary.total_tickets}</p>
                <p className="text-sm text-gray-500 mt-1">Totaal tickets</p>
              </div>
              <div className="card text-center">
                <p className="text-3xl font-bold text-yellow-600">{summary.status_counts.open}</p>
                <p className="text-sm text-gray-500 mt-1">Open</p>
              </div>
              <div className="card text-center">
                <p className="text-3xl font-bold text-green-600">{summary.status_counts.closed}</p>
                <p className="text-sm text-gray-500 mt-1">Gesloten</p>
              </div>
              <div className="card text-center">
                <p className="text-3xl font-bold text-purple-700">
                  {summary.avg_resolution_hours != null ? `${summary.avg_resolution_hours}u` : "—"}
                </p>
                <p className="text-sm text-gray-500 mt-1">Gem. afdoening</p>
              </div>
            </div>
          )}

          {/* Tijdlijn grafiek */}
          <div className="card">
            <h2 className="font-semibold mb-4">Tickets over tijd</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={timeline}>
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total" name="Totaal" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="open" name="Open" stroke="#eab308" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="closed" name="Gesloten" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Categoriegrafiek */}
          <div className="card">
            <h2 className="font-semibold mb-4">Verdeling per categorie</h2>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={categoryPieData} dataKey="value" cx="50%" cy="50%" outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {categoryPieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
