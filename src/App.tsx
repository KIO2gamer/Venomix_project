import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer, WMSTileLayer, useMap } from "react-leaflet";
import {
  ensurePermission,
  flushQueuedAlerts,
  registerServiceWorker,
  showLocalAlert,
} from "./notifications";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  CloudRain,
  LocateFixed,
  MapPin,
  Menu,
  PackageCheck,
  Radio,
  Route,
  Search,
  Send,
  Truck,
  Upload,
  X,
} from "lucide-react";

type AlertItem = { id: string; severity: "High" | "Medium" | "Low"; title: string; location: string; time: string };
type Summary = { accessible: number; monitored: number; highRisk: number; activeShipments: number; alerts: AlertItem[] };
type Vehicle = { id: string; registration: string; type: string; status: string; driver: string; capacity_kg: number; current_load_kg: number };
type Shipment = { id: string; reference: string; origin: string; destination: string; status: string; priority: string; cargo: string; weight_kg: number };
type Alert = { id: string; severity: string; title: string; message: string; area: string; acknowledged: boolean };
type CsvResult = { filename: string; columns: string[]; row_count: number; preview: Record<string, string>[]; normalized_preview: Record<string, string>[]; map_points: Record<string, string>[]; coordinate_count: number; numeric_summary: Record<string, { min: number; max: number; average: number }> };
type FieldReport = { id: string; category: string; description: string; status: string; created_at: string };
type MapFeature = { id: string; geometry: { coordinates: [number, number] }; properties: { kind?: string; registration?: string; status?: string; title?: string; area?: string } };

const API_BASE = (() => {
  const envBase = import.meta.env.VITE_API_BASE;
  if (envBase && typeof envBase === "string" && envBase.trim()) {
    return envBase.trim().replace(/\/+$/, "");
  }
  return "";
})();

const fallback: Summary = {
  accessible: 68,
  monitored: 127,
  highRisk: 14,
  activeShipments: 42,
  alerts: [
    { id: "a1", severity: "High", title: "NH-10 partial blockage", location: "East Sikkim", time: "12 min ago" },
    { id: "a2", severity: "Medium", title: "Heavy rainfall warning", location: "Dima Hasao, Assam", time: "28 min ago" },
    { id: "a3", severity: "Low", title: "Delivery delay predicted", location: "Lunglei, Mizoram", time: "41 min ago" },
  ],
};

async function loadSummary(): Promise<Summary> {
  try {
    const response = await fetch(`${API_BASE}/api/dashboard/summary`);
    if (!response.ok) throw new Error("API unavailable");
    return await response.json() as Summary;
  } catch {
    return fallback;
  }
}

async function getData<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error("API unavailable");
  return response.json() as Promise<T>;
}

function App() {
  const [summary, setSummary] = useState<Summary>(fallback);
  const [activeTab, setActiveTab] = useState("Overview");
  const [showReport, setShowReport] = useState(false);
  const [region, setRegion] = useState("All NER states");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [reports, setReports] = useState<FieldReport[]>([]);
  const [csvResult, setCsvResult] = useState<CsvResult | null>(null);
  const [dataError, setDataError] = useState("");
  const [mapFeatures, setMapFeatures] = useState<MapFeature[]>([]);
  const [reportToast, setReportToast] = useState("");

  const unacknowledgedCount = alerts.length
    ? alerts.filter((a) => !a.acknowledged).length
    : summary.alerts.length;
  const newReportCount = reports.filter((r) => r.status === "new").length;

  async function handleAcknowledgeAlert(alertId: string) {
    try {
      const response = await fetch(`${API_BASE}/api/alerts/${alertId}/acknowledge`, { method: "POST" });
      if (!response.ok) throw new Error("Acknowledge failed");
    } catch {
      // Keep the alert open when the API cannot confirm the acknowledgement,
      // otherwise the command centre shows a status the backend never stored.
      setDataError("The alert could not be acknowledged. Reconnect to the API and try again.");
      return;
    }
    setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a)));
    setSummary((prev) => ({ ...prev, alerts: prev.alerts.filter((a) => a.id !== alertId) }));
  }

  function handleReportSubmitted(report: FieldReport) {
    setReports((prev) => [report, ...prev.filter((item) => item.id !== report.id)]);
    setReportToast(`Field report ${report.id} received and added to the operations feed.`);
    window.setTimeout(() => setReportToast(""), 6000);
    // Refresh the summary so dashboard counts reflect the new report.
    void loadSummary().then(setSummary);
  }

  useEffect(() => {
    // Register the service worker up front so alert handling and the offline
    // app shell are available even before the alerts tab is opened.
    void registerServiceWorker();

    void loadSummary().then(setSummary);
    void Promise.all([
      getData<Vehicle[]>("/api/vehicles"),
      getData<Shipment[]>("/api/shipments"),
      getData<Alert[]>("/api/alerts?include_acknowledged=true"),
      getData<typeof reports>("/api/field-reports"),
      getData<{ features: MapFeature[] }>("/api/map/features"),
    ])
      .then(([nextVehicles, nextShipments, nextAlerts, nextReports, nextMap]) => {
        setVehicles(nextVehicles);
        setShipments(nextShipments);
        setAlerts(nextAlerts);
        setReports(nextReports);
        setMapFeatures(nextMap.features);
      })
      .catch(() => setDataError("Live operational data is unavailable. Start the FastAPI service to refresh it."));
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Route size={22} /></div>
          <div><strong>NER<span>Logistics</span></strong><small>ACCESSIBILITY INTELLIGENCE</small></div>
        </div>
        <div className="topbar-actions">
          <div className="live-pill"><span className="pulse" /> LIVE MONITORING</div>
          <button
            className="icon-button"
            aria-label="Notifications"
            title={`${unacknowledgedCount} unacknowledged alert(s)`}
            onClick={() => setActiveTab("Alert rules")}
          >
            <Bell size={19} />
            {unacknowledgedCount > 0 && <i>{unacknowledgedCount}</i>}
          </button>
          <div className="user-avatar">AK</div>
          <div className="user-name">A. Kumar <ChevronDown size={15} /></div>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <button className="mobile-menu"><Menu size={20} /></button>
          <div className="sidebar-label">COMMAND CENTRE</div>
          {["Overview", "Network status", "Shipments", "Field reports", "Emergency alerts"].map((tab) => (
            <button key={tab} className={`nav-item ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
              {tab === "Overview" && <CircleDot size={18} />}
              {tab === "Network status" && <Route size={18} />}
              {tab === "Shipments" && <Truck size={18} />}
              {tab === "Field reports" && <LocateFixed size={18} />}
              {tab === "Emergency alerts" && <Radio size={18} />}
              {tab}
              {tab === "Field reports" && newReportCount > 0 && <span className="nav-badge">{newReportCount}</span>}
            </button>
          ))}
          <div className="sidebar-label lower">DATA & SETTINGS</div>
          <button className={`nav-item ${activeTab === "Data sources" ? "active" : ""}`} onClick={() => setActiveTab("Data sources")}><Radio size={18} /> Data sources</button>
          <button className={`nav-item ${activeTab === "Alert rules" ? "active" : ""}`} onClick={() => setActiveTab("Alert rules")}>
            <Bell size={18} /> Alert rules
            {unacknowledgedCount > 0 && <span className="nav-badge">{unacknowledgedCount}</span>}
          </button>
          <div className="sidebar-footer"><div className="sync-dot" /><span>Dataset synced<br /><b>10 Sep 2026, 22:30</b></span></div>
        </aside>

        <main className="main-content">
          {activeTab !== "Overview" ? (
            <OperationsView
              activeTab={activeTab}
              vehicles={vehicles}
              shipments={shipments}
              alerts={alerts}
              reports={reports}
              onReportSubmitted={handleReportSubmitted}
              csvResult={csvResult}
              setCsvResult={setCsvResult}
              dataError={dataError}
              onAcknowledge={handleAcknowledgeAlert}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">THURSDAY, 10 SEPTEMBER 2026</p>
                  <h1>Regional overview</h1>
                  <p className="muted">A live picture of accessibility and essential supply movement across the North Eastern Region.</p>
                </div>
                <div className="heading-actions">
                  <label className="select-wrap">
                    <MapPin size={16} />
                    <select value={region} onChange={(e) => setRegion(e.target.value)}>
                      <option>All NER states</option>
                      <option>Assam</option>
                      <option>Manipur</option>
                      <option>Meghalaya</option>
                      <option>Mizoram</option>
                      <option>Nagaland</option>
                      <option>Sikkim</option>
                      <option>Tripura</option>
                      <option>Arunachal Pradesh</option>
                    </select>
                  </label>
                  <button className="primary-button" onClick={() => setShowReport(true)}><LocateFixed size={17} /> Report incident</button>
                </div>
              </div>

              <section className="stats-grid">
                <Stat label="Accessible network" value={`${summary.accessible}%`} change="+4.2%" icon={<Route />} tone="teal" />
                <Stat label="Monitored segments" value={summary.monitored.toString()} change="+11 this week" icon={<Radio />} tone="blue" />
                <Stat label="High-risk corridors" value={summary.highRisk.toString()} change="-3 since yesterday" icon={<AlertTriangle />} tone="amber" />
                <Stat label="Active shipments" value={summary.activeShipments.toString()} change="6 arriving today" icon={<PackageCheck />} tone="purple" />
              </section>

              <section className="content-grid">
                <div className="panel map-panel">
                  <div className="panel-heading">
                    <div><h2>Network accessibility</h2><p className="muted">Road and bridge status • Updated 6 min ago</p></div>
                    <button className="ghost-button" onClick={() => setActiveTab("Network status")}>View full map <ArrowUpRight size={16} /></button>
                  </div>
                  <MapView features={mapFeatures} csvResult={csvResult} />
                  <div className="map-footer">
                    <span><CloudRain size={16} /> Rainfall risk layers enabled</span>
                    <span><Truck size={16} /> {summary.activeShipments} vehicles tracked</span>
                    <button className="link-button" onClick={() => setActiveTab("Network status")}>Explore network <ArrowUpRight size={14} /></button>
                  </div>
                </div>
                <div className="panel alerts-panel">
                  <div className="panel-heading">
                    <div><h2>Priority alerts</h2><p className="muted">Requiring attention</p></div>
                    <span className="count-badge">{summary.alerts.length}</span>
                  </div>
                  <div className="alert-list">
                    {summary.alerts.map((alert) => (
                      <AlertRow key={alert.id} alert={alert} />
                    ))}
                  </div>
                  <button className="full-width-button" onClick={() => setActiveTab("Alert rules")}>
                    View all alerts <ArrowUpRight size={15} />
                  </button>
                </div>
              </section>

          <section className="bottom-grid">
            <div className="panel district-panel"><div className="panel-heading"><div><h2>District connectivity</h2><p className="muted">Accessibility score by district</p></div><button className="ghost-button">See all <ArrowUpRight size={15} /></button></div><div className="district-list"><District name="East Khasi Hills" state="Meghalaya" score={92} status="Good" /><District name="Papum Pare" state="Arunachal Pradesh" score={78} status="Stable" /><District name="Dima Hasao" state="Assam" score={51} status="At risk" /><District name="Lunglei" state="Mizoram" score={43} status="At risk" /></div></div>
            <div className="panel shipment-panel"><div className="panel-heading"><div><h2>Essential supply movement</h2><p className="muted">Latest shipment activity</p></div><button className="ghost-button">Track all <ArrowUpRight size={15} /></button></div><div className="shipment-row"><div className="shipment-icon medicine"><PackageCheck size={19} /></div><div><strong>Medical supplies</strong><small>Guwahati → Imphal</small></div><span className="shipment-status on-time">On route</span></div><div className="shipment-row"><div className="shipment-icon food"><Truck size={19} /></div><div><strong>Rice & essentials</strong><small>Silchar → Aizawl</small></div><span className="shipment-status delayed">Delayed 42m</span></div><div className="shipment-row"><div className="shipment-icon build"><Route size={19} /></div><div><strong>Construction material</strong><small>Jorhat → Itanagar</small></div><span className="shipment-status delivered">Delivered</span></div></div>
          </section>
            </>
          )}
        </main>
      </div>
      {showReport && <ReportModal onClose={() => setShowReport(false)} onSubmitted={handleReportSubmitted} />}
      {reportToast && <div className="data-notice" role="status"><CheckCircle2 size={16} /> {reportToast}</div>}
    </div>
  );
}

function MapView({ features, csvResult }: { features: MapFeature[]; csvResult: CsvResult | null }) {
  const csvPoints = (csvResult?.map_points ?? csvResult?.normalized_preview ?? []).flatMap((row, index) => {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? [{ id: `csv-${index}`, latitude, longitude, name: row.name ?? row.id ?? "Dataset point", status: row.status ?? row.type ?? "CSV record", risk: row.risk_score ?? "" }]
      : [];
  });
  return <div className="map-canvas live-map"><MapContainer center={[25.8, 93.5]} zoom={6} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><NerdrrLayers /><GeoSearch /><LocateControl />{features.map((feature) => { const [longitude, latitude] = feature.geometry.coordinates; return <CircleMarker key={feature.id} center={[latitude, longitude]} radius={7} pathOptions={{ color: feature.properties.kind === "field_report" ? "#d65c50" : "#0f927f", fillOpacity: .8 }}><Popup><strong>{feature.properties.registration ?? feature.properties.title ?? "Network feature"}</strong><br />{feature.properties.status ?? feature.properties.area ?? feature.properties.kind}</Popup></CircleMarker>; })}{csvPoints.map((point) => <CircleMarker key={point.id} center={[point.latitude, point.longitude]} radius={6} pathOptions={{ color: point.risk && Number(point.risk) >= 60 ? "#d65c50" : "#3e8ccd", fillColor: point.risk && Number(point.risk) >= 60 ? "#f2a09a" : "#9cc8ee", fillOpacity: .9 }}><Popup><strong>{point.name}</strong><br />{point.status}<br />{point.risk ? `Priority score: ${point.risk}` : "No priority score"}<br /><small>Imported from {csvResult?.filename}</small></Popup></CircleMarker>)}</MapContainer>{csvPoints.length > 0 && <div className="map-data-badge">{csvPoints.length} CSV points plotted</div>}</div>;
}

function NerdrrLayers() {
  const [lightning, setLightning] = useState(false);
  return <><WMSTileLayer url="https://nerdrr.gov.in/geoserver/wms?" layers="workgroup:NER_STATES" format="image/png" transparent opacity={0.65} />{lightning && <WMSTileLayer url="https://geoserver.nesdr.gov.in/geoserver/smartAxom/wms?" layers="smartAxom:lightning_data_iitm" format="image/png" transparent opacity={0.85} />}<div className="nerdrr-layers"><strong>NER-DRR layers</strong><label><input type="checkbox" checked={lightning} onChange={(event) => setLightning(event.target.checked)} /> Lightning observations</label><small>State boundaries and lightning data via NER-DRR GeoServer</small></div></>;
}

function GeoSearch() {
  const map = useMap();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  async function searchPlace(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setError("");
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`);
      const results = await response.json() as Array<{ lat: string; lon: string }>;
      if (!results.length) throw new Error("Place not found");
      map.flyTo([Number(results[0].lat), Number(results[0].lon)], 11, { duration: 1 });
    } catch { setError("Not found"); }
    finally { setSearching(false); }
  }
  return <form className="map-search" onSubmit={(event) => void searchPlace(event)}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a place" aria-label="Search a place" /><button type="submit" disabled={searching}>{searching ? "..." : "Go"}</button>{error && <span>{error}</span>}</form>;
}

function LocateControl() {
  const map = useMap();
  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => map.flyTo([coords.latitude, coords.longitude], 12, { duration: 1 }));
  }
  return <button type="button" className="map-locate" aria-label="Use my location" title="Use my location" onClick={locate}><LocateFixed size={16} /></button>;
}

function OperationsView({
  activeTab,
  vehicles,
  shipments,
  alerts,
  reports,
  csvResult,
  setCsvResult,
  dataError,
  onAcknowledge,
  onReportSubmitted,
}: {
  activeTab: string;
  vehicles: Vehicle[];
  shipments: Shipment[];
  alerts: Alert[];
  reports: FieldReport[];
  csvResult: CsvResult | null;
  setCsvResult: (result: CsvResult | null) => void;
  dataError: string;
  onAcknowledge?: (alertId: string) => void;
  onReportSubmitted: (report: FieldReport) => void;
}) {
  const titles: Record<string, [string, string]> = {
    "Network status": ["Network status", "Live vehicles, capacity, and field observations."],
    Shipments: ["Shipments", "Track essential supplies from origin to destination."],
    "Field reports": ["Field reports", "Review incidents submitted by field teams."],
    "Data sources": ["Data sources", "Bring a CSV dataset into the intelligence workspace."],
    "Alert rules": ["Alert rules", "Review active alerts and acknowledge resolved events."],
    "Emergency alerts": ["Emergency alerts", "Simulate area-wide alert delivery and automatic fallback."],
  };
  const [title, subtitle] = titles[activeTab] ?? titles["Network status"];
  const openAlerts = alerts.filter((a) => !a.acknowledged);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OPERATIONS WORKSPACE</p>
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
        </div>
      </div>
      {dataError && <div className="data-notice"><AlertTriangle size={16} /> {dataError}</div>}
      {activeTab === "Network status" && (
        <div className="operations-grid">
          <div className="panel table-panel">
            <PanelTitle title="Vehicle network" subtitle={`${vehicles.length} tracked vehicles`} />
            <DataTable
              headers={["Vehicle", "Driver", "Status", "Load"]}
              rows={vehicles.map((vehicle) => [
                vehicle.registration,
                vehicle.driver,
                vehicle.status.replace("_", " "),
                `${Math.round((vehicle.current_load_kg / vehicle.capacity_kg) * 100)}%`,
              ])}
            />
          </div>
          <div className="panel table-panel">
            <PanelTitle title="Live alerts" subtitle={`${openAlerts.length} open alerts`} />
            <AlertList alerts={alerts} onAcknowledge={onAcknowledge} />
          </div>
        </div>
      )}
      {activeTab === "Shipments" && (
        <div className="panel table-panel">
          <PanelTitle title="Shipment manifest" subtitle={`${shipments.length} shipments in the current operational feed`} />
          <DataTable
            headers={["Reference", "Cargo", "Route", "Status", "Weight"]}
            rows={shipments.map((shipment) => [
              shipment.reference,
              shipment.cargo,
              `${shipment.origin} -> ${shipment.destination}`,
              shipment.status.replace("_", " "),
              `${shipment.weight_kg.toLocaleString()} kg`,
            ])}
          />
        </div>
      )}
      {activeTab === "Field reports" && (
        <div className="panel table-panel">
          <PanelTitle title="Submitted field reports" subtitle={`${reports.length} reports received`} />
          <DataTable
            headers={["Category", "Description", "Status", "Received"]}
            rows={reports.map((report) => [
              report.category,
              report.description,
              report.status,
              new Date(report.created_at).toLocaleString(),
            ])}
          />
        </div>
      )}
      {activeTab === "Alert rules" && (
        <div className="panel table-panel">
          <PanelTitle
            title="Operational alert feed"
            subtitle="Review active emergency conditions and acknowledge resolved events to update command centre status."
          />
          <AlertList alerts={alerts} onAcknowledge={onAcknowledge} />
        </div>
      )}
      {activeTab === "Emergency alerts" && <EmergencyAlertPanel />}
      {activeTab === "Data sources" && <CsvSource csvResult={csvResult} setCsvResult={setCsvResult} />}
    </>
  );
}

function EmergencyAlertPanel() {
  const [area, setArea] = useState("Assam");
  const [message, setMessage] = useState("Severe weather warning. Move to safe shelter and follow official instructions.");
  const [severity, setSeverity] = useState("high");
  const [towers, setTowers] = useState(12);
  const [result, setResult] = useState<{
    delivery_mode: string;
    channels: string[];
    estimated_reached_devices: number;
    estimated_unreachable_devices: number;
    explanation: string;
    push_sent: number;
    push_failed: number;
    push_error?: string;
    sms_attempted: number;
    sms_sent: number;
    sms_failed: number;
    sms_error?: string;
  } | null>(null);
  const [error, setError] = useState("");

  async function simulate() {
    setError("");
    const alertPayload = { title: `${severity.charAt(0).toUpperCase()}${severity.slice(1)} emergency alert`, body: message, area };
    try {
      const response = await fetch(`${API_BASE}/api/emergency-alerts/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, message, severity, towers_available: towers, target_devices: 25000 }),
      });
      if (!response.ok) throw new Error("Simulation failed");
      setResult(await response.json());
      // Mirror the server alert on this device so a dropped connection does not
      // hide the notification.
      void showLocalAlert(alertPayload);
    } catch {
      // Offline / backend down: raise and queue a local on-device alert instead of failing.
      const shown = await showLocalAlert(alertPayload);
      setError(
        shown
          ? "Backend unreachable. The alert was delivered to this device and queued for other devices."
          : "Backend unreachable and notifications are not permitted on this device. The alert was queued."
      );
    }
  }

  return (
    <div className="emergency-grid">
      <div className="panel emergency-form">
        <PanelTitle
          title="Emergency alert simulation"
          subtitle="Training mode only. Models area-wide BCC broadcast and automatic fallback to satellite/radio."
        />
        <PushSetup />
        <label>
          Target area
          <input value={area} onChange={(event) => setArea(event.target.value)} />
        </label>
        <label>
          Severity
          <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="warning">Warning</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>
          Towers available <span className="range-value">{towers}</span>
          <input type="range" min="0" max="50" value={towers} onChange={(event) => setTowers(Number(event.target.value))} />
        </label>
        <label>
          Message
          <textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" onClick={() => void simulate()}>
          <Radio size={16} /> Run delivery simulation
        </button>
      </div>
      <div className="panel emergency-result">
        {result ? (
          <>
            <p className="eyebrow">SIMULATION RESULT</p>
            <h2>{result.delivery_mode === "bcc" ? "BCC delivery active" : "Fallback channels active"}</h2>
            <div className="channel-list">
              {result.channels.map((channel) => (
                <span key={channel}>{channel}</span>
              ))}
            </div>
            <div className="delivery-stats">
              <strong>{result.estimated_reached_devices.toLocaleString()}</strong>
              <span>estimated devices reached</span>
              <strong>{result.estimated_unreachable_devices.toLocaleString()}</strong>
              <span>estimated unreachable</span>
            </div>
            <p className="muted">{result.explanation}</p>
            <p className="push-result">
              Phone push delivery: {result.push_sent} sent, {result.push_failed} failed.
              {result.push_error && ` Note: ${result.push_error}`}
            </p>
            <p className="push-result">
              {result.sms_attempted > 0
                ? `Offline devices texted by SMS: ${result.sms_sent} sent, ${result.sms_failed} failed.`
                : "No devices were offline, so no SMS fallback was needed."}
              {result.sms_error && ` Note: ${result.sms_error}`}
            </p>
          </>
        ) : (
          <div className="empty-state">
            <Radio size={28} />
            <p>Run a simulation to test tower failure, automatic satellite fallback, and browser push alerts.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const PHONE_KEY = "ner-alert-phone";

function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/^00/, "+").replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15 ? `+${digits}` : null;
}

function PushSetup() {
  const [status, setStatus] = useState("Checking...");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [phone, setPhone] = useState(() => {
    try {
      return localStorage.getItem(PHONE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    async function checkStatus() {
      if (!("Notification" in window)) {
        setStatus("Notifications not supported in this browser");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("Notifications blocked in browser permissions");
        return;
      }
      // A local permission grant is enough for offline alerts, even without
      // the PushManager or a reachable backend.
      const hasPushManager = "serviceWorker" in navigator && "PushManager" in window;
      try {
        const reg = hasPushManager ? await navigator.serviceWorker.getRegistration("/sw.js") : undefined;
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            setStatus(Notification.permission === "granted" ? "Enabled (online + offline)" : "Push subscribed - grant permission");
            void fetch(`${API_BASE}/api/push/subscribe`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(sub.toJSON()),
            }).catch(() => undefined);
            return;
          }
        }
      } catch {
        // ignore - fall through to the permission-only status below
      }
      if (Notification.permission === "granted") {
        setStatus(hasPushManager ? "Local alerts enabled (click Enable for server push)" : "Local alerts enabled (offline-capable)");
      } else {
        setStatus("Not enabled");
      }
    }
    void checkStatus();

 function goOnline() {
      setOnline(true);
      // Connectivity is back: deliver anything raised while offline.
      void flushQueuedAlerts().then((count) => {
        if (count > 0) setTestResult(`Delivered ${count} queued alert(s) now that you are back online.`);
      });
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  async function enablePush() {
    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (!window.isSecureContext && !isLocalhost) {
      setStatus("HTTPS tunnel required on a mobile phone");
      return;
    }
    if (!("Notification" in window)) {
      setStatus("Notifications not supported in this browser");
      return;
    }

    // Step 1: always ensure the on-device permission + service worker, so
    // alerts work offline even if the server push path is unavailable.
    setStatus("Requesting permission...");
    const granted = await ensurePermission();
    if (!granted) {
      setStatus("Notification permission denied");
      return;
    }
    setStatus("Registering service worker...");
    const registration = await registerServiceWorker();

    // Step 2: try the server push path (needs connectivity + a VAPID key).
    // If it fails, keep the offline-capable local alerts instead of erroring out.
    if (!registration || !("PushManager" in window)) {
      setStatus("Local alerts enabled (offline-capable)");
      return;
    }

    try {
      setStatus("Fetching VAPID key...");
      const keyResponse = await fetch(`${API_BASE}/api/push/public-key`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!keyResponse.ok) {
        const err = await keyResponse.json().catch(() => ({ detail: "VAPID key unavailable" }));
        throw new Error(err.detail ?? "VAPID public key is not configured");
      }
      const { public_key: publicKey } = (await keyResponse.json()) as { public_key: string };
      if (!publicKey) {
        throw new Error("Received empty public key from server");
      }

      setStatus("Subscribing to push manager...");
      // Clean up any stale subscription to avoid mismatched VAPID keys
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        try {
          await existing.unsubscribe();
        } catch {
          // ignore
        }
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey) as unknown as BufferSource,
      });

      setStatus("Syncing with backend...");
      // The phone number is saved with the device so the backend can text the
      // user if this device later goes offline and push can no longer reach it.
      const phoneNumber = normalizePhone(phone);
      const subscribeResponse = await fetch(`${API_BASE}/api/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...subscription.toJSON(), phone_number: phoneNumber }),
        signal: AbortSignal.timeout(8000),
      });
      if (!subscribeResponse.ok) throw new Error("Subscription registration failed");
      if (phoneNumber) {
        try {
          localStorage.setItem(PHONE_KEY, phoneNumber);
        } catch {
          // Private mode: the number was still sent with the subscription.
        }
      }
      setStatus(phoneNumber ? "Enabled (push + SMS fallback)" : "Enabled (online + offline)");
    } catch (pushError) {
      console.error("Push setup error:", pushError);
      setStatus("Server push unavailable - local alerts still work offline");
    }
  }

  async function testPush() {
    setTesting(true);
    setTestResult("");
    try {
      const response = await fetch(`${API_BASE}/api/push/test`, { method: "POST" });
      if (!response.ok) throw new Error("Test request failed");
      const data = (await response.json()) as { sent: number; failed: number; error?: string; subscriptions: number };
      if (data.sent > 0) {
        setTestResult(`Test alert delivered to ${data.sent} device(s)`);
      } else if (data.subscriptions === 0) {
        // No server subscriptions, but we can still show the alert on this device.
        const shown = await showLocalAlert({
          title: "Test alert (local)",
          body: "Emergency broadcast notification delivery is operational on this device.",
          area: "Assam & North East",
        });
        setTestResult(shown ? "Test alert shown on this device (offline mode)" : "Enable notifications first to see the test alert");
      } else {
        setTestResult(`Push delivery: ${data.error ?? "Failed"}`);
      }
    } catch {
      // Backend unreachable: still prove the offline path works.
      const shown = await showLocalAlert({
        title: "Test alert (offline)",
        body: "Backend unreachable, but on-device emergency notifications are working.",
        area: "Assam & North East",
      });
      setTestResult(shown ? "Offline test alert shown on this device" : "Enable notifications first to see the test alert");
    } finally {
      setTesting(false);
    }
  }

  /** Save the phone number against the device already registered online. */
  async function savePhoneNumber() {
    const phoneNumber = normalizePhone(phone);
    if (!phoneNumber) {
      setTestResult("Enter a valid phone number in international format, e.g. +919876543210");
      return;
    }
    try {
      const registration = await navigator.serviceWorker?.ready;
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (!subscription) {
        setTestResult("Enable push first, then save your number for the SMS fallback.");
        return;
      }
      const response = await fetch(`${API_BASE}/api/push/phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, phone_number: phoneNumber }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Phone registration failed");
      try {
        localStorage.setItem(PHONE_KEY, phoneNumber);
      } catch {
        // Private mode: the number is still stored on the server.
      }
      setStatus("Enabled (push + SMS fallback)");
      setTestResult(`Saved ${phoneNumber}. Alerts will be texted there if this device goes offline.`);
    } catch {
      setTestResult("Could not save the number. Connect to the API and try again.");
    }
  }

  return (
    <div className="push-setup">
      <div>
        <strong>Phone & Browser notifications</strong>
        <small>{status}</small>
        <small className="muted">
          {online ? "Online" : "Offline"} - alerts are shown on this device and queued until the network returns.
        </small>
        <label className="phone-input">
          Mobile number for SMS fallback
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+919876543210"
            aria-label="Mobile number for SMS fallback"
          />
        </label>
        {testResult && <small className="test-result">{testResult}</small>}
      </div>
      <div className="push-actions">
        <button className="ghost-button" onClick={() => void enablePush()}>
          Enable push
        </button>
        <button className="ghost-button secondary" onClick={() => void savePhoneNumber()}>
          Save number
        </button>
        <button className="ghost-button secondary" disabled={testing} onClick={() => void testPush()}>
          {testing ? "Testing..." : "Send test"}
        </button>
      </div>
    </div>
  );
}

function urlB64ToUint8Array(base64String: string): Uint8Array {
  let clean = base64String
    .replace(/-----BEGIN[^-]+-----/g, "")
    .replace(/-----END[^-]+-----/g, "")
    .replace(/^Application Server Key\s*=\s*/i, "")
    .replace(/\s+/g, "");

  const padding = "=".repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  let outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  if (outputArray.length === 91 && outputArray[26] === 0x04) {
    outputArray = outputArray.slice(26);
  }
  return outputArray;
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>
      </div>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="empty-state">No records are available yet.</p>
  );
}

function AlertList({
  alerts,
  onAcknowledge,
}: {
  alerts: Alert[];
  onAcknowledge?: (alertId: string) => void;
}) {
  return alerts.length ? (
    <div className="operations-alerts">
      {alerts.map((alert) => (
        <div className={`operations-alert ${alert.acknowledged ? "acknowledged" : ""}`} key={alert.id}>
          <div className={`alert-icon ${alert.severity === "critical" ? "high" : alert.severity === "warning" ? "medium" : "low"}`}>
            <AlertTriangle size={16} />
          </div>
          <div className="alert-content">
            <div className="alert-header">
              <strong>{alert.title}</strong>
              {alert.acknowledged ? (
                <span className="ack-badge">Acknowledged</span>
              ) : onAcknowledge ? (
                <button
                  className="ack-button"
                  onClick={() => onAcknowledge(alert.id)}
                  title="Acknowledge this alert"
                >
                  <CheckCircle2 size={13} /> Acknowledge
                </button>
              ) : null}
            </div>
            <p>{alert.message}</p>
            <small>{alert.area}</small>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className="empty-state">No open alerts.</p>
  );
}

function CsvSource({ csvResult, setCsvResult }: { csvResult: CsvResult | null; setCsvResult: (result: CsvResult | null) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function handleFile(file: File) {
    setUploading(true); setError("");
    const form = new FormData(); form.append("file", file);
    try {
      const response = await fetch(`${API_BASE}/api/datasets/csv`, { method: "POST", body: form });
      if (!response.ok) { const detail = await response.json() as { detail?: string }; throw new Error(detail.detail ?? "CSV import failed"); }
      setCsvResult(await response.json() as CsvResult);
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "CSV import failed"); }
    finally { setUploading(false); }
  }
  return <div className="data-source-grid"><div className="panel upload-panel"><PanelTitle title="Import a CSV dataset" subtitle="Files are cleaned into the map schema automatically. Maximum size: 10 MB." /><label className="upload-drop"><Upload size={25} /><strong>{uploading ? "Processing dataset..." : "Choose a CSV file"}</strong><span>Recognizes names, coordinates, types, status, and risk fields</span><input type="file" accept=".csv,text/csv" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); }} /></label>{error && <p className="form-error">{error}</p>}{csvResult && <p className="import-summary">{csvResult.coordinate_count} of {csvResult.row_count} rows are ready to plot on the map.</p>}</div>{csvResult && <div className="panel table-panel"><PanelTitle title={`${csvResult.filename} • normalized preview`} subtitle={`${csvResult.row_count.toLocaleString()} rows • ${csvResult.coordinate_count} mappable points`} /><DataTable headers={["id", "name", "type", "state", "latitude", "longitude", "status", "risk_score"]} rows={csvResult.normalized_preview.map((row) => ["id", "name", "type", "state", "latitude", "longitude", "status", "risk_score"].map((column) => row[column] ?? ""))} /></div>}</div>;
}

function Stat({ label, value, change, icon, tone }: { label: string; value: string; change: string; icon: React.ReactNode; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small className={change.startsWith("-") ? "down" : ""}>{change}</small></div></div>;
}
function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} day(s) ago`;
}

function AlertRow({ alert }: { alert: AlertItem }) {
  return <div className="alert-row"><div className={`alert-icon ${alert.severity.toLowerCase()}`}>{alert.severity === "High" ? <AlertTriangle size={17} /> : <CloudRain size={17} />}</div><div className="alert-copy"><strong>{alert.title}</strong><span>{alert.location}</span><small>{relativeTime(alert.time)}</small></div><ArrowUpRight size={16} className="row-arrow" /></div>;
}
function District({ name, state, score, status }: { name: string; state: string; score: number; status: string }) {
  return <div className="district-row"><div className="district-name"><strong>{name}</strong><span>{state}</span></div><div className="progress-track"><div className={`progress-fill ${score < 60 ? "risk" : ""}`} style={{ width: `${score}%` }} /></div><strong className="score">{score}%</strong><span className={`status ${score < 60 ? "risk" : ""}`}>{status}</span></div>;
}
function ReportModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: (report: FieldReport) => void }) {
  const [sent, setSent] = useState(false);
  const [category, setCategory] = useState("road");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  function captureLocation() {
    if (!navigator.geolocation) { setError("This browser does not expose a location API."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setLocation([coords.latitude, coords.longitude]); setLocating(false); },
      () => { setError("Location permission was denied or unavailable."); setLocating(false); },
    );
  }

  async function submitReport() {
    if (!description.trim()) { setError("Add a short description before submitting."); return; }
    try {
      const response = await fetch(`${API_BASE}/api/field-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reporter: "A. Kumar", category, description, location }),
      });
      if (!response.ok) throw new Error("Report could not be submitted");
      const report = await response.json() as FieldReport;
      onSubmitted(report);
      setSent(true);
    } catch { setError("The API is unavailable. Start the backend and try again."); }
  }
  return <div className="modal-backdrop"><div className="modal"><button className="close-button" onClick={onClose}><X size={19} /></button>{sent ? <div className="success-state"><CheckCircle2 size={42} /><h2>Report queued</h2><p>Your incident was accepted by the field reports service.</p><button className="primary-button" onClick={onClose}>Done</button></div> : <><p className="eyebrow">FIELD UPDATE</p><h2>Report an incident</h2><p className="muted">Capture a road, bridge, weather, or delivery disruption.</p><label>Incident type<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="road">Road blockage</option><option value="safety">Landslide</option><option value="other">Flooding</option><option value="road">Bridge damage</option><option value="delivery">Delivery delay</option></select></label><label>Location<button type="button" className="location-input" onClick={captureLocation}><MapPin size={16} /> Use current location <span>{locating ? "Locating..." : location ? `${location[0].toFixed(4)}, ${location[1].toFixed(4)}` : "Not captured"}</span></button></label><label>Notes<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe what you see..." rows={3} /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={() => void submitReport()}><Send size={16} /> Submit report</button></div></>}</div></div>;
}

export default App;
