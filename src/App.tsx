import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import "./styles.css";
import "leaflet/dist/leaflet.css";

import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  WMSTileLayer,
  useMap,
} from "react-leaflet";

import {
  ensurePermission,
  flushQueuedAlerts,
  registerServiceWorker,
  showLocalAlert,
} from "./notifications";

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  CloudRain,
  LocateFixed,
  MapPin,
  Menu,
  Radio,
  Route,
  Send,
  Truck,
  Upload,
  Volume2,
  X,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type AlertItem = {
  id: string;
  severity: "High" | "Medium" | "Low";
  title: string;
  location: string;
  time: string;
};

type Summary = {
  accessible: number;
  monitored: number;
  highRisk: number;
  activeShipments: number;
  alerts: AlertItem[];
};

type Vehicle = {
  id: string;
  registration: string;
  type: string;
  status: string;
  driver: string;
  capacity_kg: number;
  current_load_kg: number;
};

type Shipment = {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  status: string;
  priority: string;
  cargo: string;
  weight_kg: number;
};

type Alert = {
  id: string;
  severity: string;
  title: string;
  message: string;
  area: string;
  acknowledged: boolean;
};

type CsvResult = {
  filename: string;
  columns: string[];
  row_count: number;
  preview: Record<string, string>[];
  normalized_preview: Record<string, string>[];
  map_points: Record<string, string>[];
  coordinate_count: number;
  numeric_summary: Record<
    string,
    {
      min: number;
      max: number;
      average: number;
    }
  >;
};

type FieldReport = {
  id: string;
  category: string;
  description: string;
  status: string;
  created_at: string;
};

type MapFeature = {
  id: string;
  geometry: {
    coordinates: [number, number];
  };
  properties: {
    kind?: string;
    registration?: string;
    status?: string;
    title?: string;
    area?: string;
  };
};

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const API_BASE = (() => {
  const envBase = import.meta.env.VITE_API_BASE;

  if (
    envBase &&
    typeof envBase === "string" &&
    envBase.trim()
  ) {
    return envBase.trim().replace(/\/+$/, "");
  }

  return "";
})();

/* -------------------------------------------------------------------------- */
/* Fallback data                                                              */
/* -------------------------------------------------------------------------- */

const fallback: Summary = {
  accessible: 68,
  monitored: 127,
  highRisk: 14,
  activeShipments: 42,
  alerts: [
    {
      id: "a1",
      severity: "High",
      title: "NH-10 partial blockage",
      location: "East Sikkim",
      time: "12 min ago",
    },
    {
      id: "a2",
      severity: "Medium",
      title: "Heavy rainfall warning",
      location: "Dima Hasao, Assam",
      time: "28 min ago",
    },
    {
      id: "a3",
      severity: "Low",
      title: "Delivery delay predicted",
      location: "Lunglei, Mizoram",
      time: "41 min ago",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* API helpers                                                                */
/* -------------------------------------------------------------------------- */

async function loadSummary(): Promise<Summary> {
  try {
    const response = await fetch(
      `${API_BASE}/api/dashboard/summary`,
    );

    if (!response.ok) {
      throw new Error("API unavailable");
    }

    return (await response.json()) as Summary;
  } catch {
    return fallback;
  }
}

async function getData<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);

  if (!response.ok) {
    throw new Error("API unavailable");
  }

  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* App                                                                        */
/* -------------------------------------------------------------------------- */

function App() {
  const [summary, setSummary] =
    useState<Summary>(fallback);

  const [activeTab, setActiveTab] =
    useState("Overview");

  const [showReport, setShowReport] =
    useState(false);

  const [region, setRegion] =
    useState("All NER states");

  const [vehicles, setVehicles] =
    useState<Vehicle[]>([]);

  const [shipments, setShipments] =
    useState<Shipment[]>([]);

  const [alerts, setAlerts] =
    useState<Alert[]>([]);

  const [reports, setReports] =
    useState<FieldReport[]>([]);

  const [csvResult, setCsvResult] =
    useState<CsvResult | null>(null);

  const [dataError, setDataError] =
    useState("");

  const [mapFeatures, setMapFeatures] =
    useState<MapFeature[]>([]);

  const [reportToast, setReportToast] =
    useState("");

  const unacknowledgedCount =
    alerts.length > 0
      ? alerts.filter(
          (alert) => !alert.acknowledged,
        ).length
      : summary.alerts.length;

  const newReportCount =
    reports.filter(
      (report) => report.status === "new",
    ).length;

  async function handleAcknowledgeAlert(
    alertId: string,
  ) {
    try {
      const response = await fetch(
        `${API_BASE}/api/alerts/${alertId}/acknowledge`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Acknowledge failed");
      }
    } catch {
      setDataError(
        "The alert could not be acknowledged. Reconnect to the API and try again.",
      );

      return;
    }

    setAlerts((previous) =>
      previous.map((alert) =>
        alert.id === alertId
          ? {
              ...alert,
              acknowledged: true,
            }
          : alert,
      ),
    );

    setSummary((previous) => ({
      ...previous,
      alerts: previous.alerts.filter(
        (alert) => alert.id !== alertId,
      ),
    }));
  }

  function handleReportSubmitted(
    report: FieldReport,
  ) {
    setReports((previous) => [
      report,
      ...previous.filter(
        (item) => item.id !== report.id,
      ),
    ]);

    setReportToast(
      `Field report ${report.id} received and added to the operations feed.`,
    );

    window.setTimeout(
      () => setReportToast(""),
      6000,
    );

    void loadSummary().then(setSummary);
  }

  useEffect(() => {
    void registerServiceWorker();

    void loadSummary().then(setSummary);

    void Promise.all([
      getData<Vehicle[]>("/api/vehicles"),
      getData<Shipment[]>("/api/shipments"),
      getData<Alert[]>(
        "/api/alerts?include_acknowledged=true",
      ),
      getData<FieldReport[]>(
        "/api/field-reports",
      ),
      getData<{ features: MapFeature[] }>(
        "/api/map/features",
      ),
    ])
      .then(
        ([
          nextVehicles,
          nextShipments,
          nextAlerts,
          nextReports,
          nextMap,
        ]) => {
          setVehicles(nextVehicles);
          setShipments(nextShipments);
          setAlerts(nextAlerts);
          setReports(nextReports);
          setMapFeatures(nextMap.features);
        },
      )
      .catch(() => {
        setDataError(
          "Live operational data is unavailable. Start the FastAPI service to refresh it.",
        );
      });
  }, []);

  return (
    <div className="app-shell">
      {/* ---------------------------------------------------------------- */}
      {/* Header                                                           */}
      {/* ---------------------------------------------------------------- */}

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Route size={22} />
          </div>

          <div>
            <strong>
              NER<span>Logistics</span>
            </strong>

            <small>
              ACCESSIBILITY INTELLIGENCE
            </small>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="live-pill">
            <span className="pulse" />
            LIVE MONITORING
          </div>

          <button
            className="icon-button"
            aria-label="Notifications"
            title={`${unacknowledgedCount} unacknowledged alert(s)`}
            onClick={() =>
              setActiveTab("Alert rules")
            }
          >
            <Bell size={19} />

            {unacknowledgedCount > 0 && (
              <i>{unacknowledgedCount}</i>
            )}
          </button>

          <div className="user-avatar">
            AK
          </div>

          <div className="user-name">
            A. Kumar
            <ChevronDown size={15} />
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Workspace                                                        */}
      {/* ---------------------------------------------------------------- */}

      <div className="workspace">
        <aside className="sidebar">
          <button
            className="mobile-menu"
            type="button"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <div className="sidebar-label">
            COMMAND CENTRE
          </div>

          {[
            "Overview",
            "Network status",
            "Shipments",
            "Field reports",
            "Emergency alerts",
          ].map((tab) => (
            <button
              key={tab}
              type="button"
              className={`nav-item ${
                activeTab === tab ? "active" : ""
              }`}
              onClick={() =>
                setActiveTab(tab)
              }
            >
              {tab === "Overview" && (
                <CircleDot size={18} />
              )}

              {tab === "Network status" && (
                <Route size={18} />
              )}

              {tab === "Shipments" && (
                <Truck size={18} />
              )}

              {tab === "Field reports" && (
                <LocateFixed size={18} />
              )}

              {tab === "Emergency alerts" && (
                <Radio size={18} />
              )}

              {tab}

              {tab === "Field reports" &&
                newReportCount > 0 && (
                  <span className="nav-badge">
                    {newReportCount}
                  </span>
                )}
            </button>
          ))}

          <div className="sidebar-label lower">
            DATA & SETTINGS
          </div>

          <button
            type="button"
            className={`nav-item ${
              activeTab === "Data sources"
                ? "active"
                : ""
            }`}
            onClick={() =>
              setActiveTab("Data sources")
            }
          >
            <Radio size={18} />
            Data sources
          </button>

          <button
            type="button"
            className={`nav-item ${
              activeTab === "Alert rules"
                ? "active"
                : ""
            }`}
            onClick={() =>
              setActiveTab("Alert rules")
            }
          >
            <Bell size={18} />
            Alert rules

            {unacknowledgedCount > 0 && (
              <span className="nav-badge">
                {unacknowledgedCount}
              </span>
            )}
          </button>

          <div className="sidebar-footer">
            <div className="sync-dot" />

            <span>
              Dataset synced
              <br />
              <b>10 Sep 2026, 22:30</b>
            </span>
          </div>
        </aside>

        {/* ---------------------------------------------------------------- */}
        {/* Main content                                                     */}
        {/* ---------------------------------------------------------------- */}

        <main className="main-content">
          {activeTab !== "Overview" ? (
            <OperationsView
              activeTab={activeTab}
              vehicles={vehicles}
              shipments={shipments}
              alerts={alerts}
              reports={reports}
              csvResult={csvResult}
              setCsvResult={setCsvResult}
              dataError={dataError}
              onAcknowledge={
                handleAcknowledgeAlert
              }
            />
          ) : (
            <>
              {/* Page heading */}

              <div className="page-heading">
                <div>
                  <p className="eyebrow">
                    THURSDAY, 10 SEPTEMBER 2026
                  </p>

                  <h1>
                    Regional overview
                  </h1>

                  <p className="muted">
                    A live picture of accessibility
                    and essential supply movement
                    across the North Eastern Region.
                  </p>
                </div>

                <div className="heading-actions">
                  <label className="select-wrap">
                    <MapPin size={16} />

                    <select
                      value={region}
                      onChange={(event) =>
                        setRegion(
                          event.target.value,
                        )
                      }
                    >
                      <option>
                        All NER states
                      </option>
                      <option>Assam</option>
                      <option>Manipur</option>
                      <option>Meghalaya</option>
                      <option>Mizoram</option>
                      <option>Nagaland</option>
                      <option>Sikkim</option>
                      <option>Tripura</option>
                      <option>
                        Arunachal Pradesh
                      </option>
                    </select>
                  </label>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      setShowReport(true)
                    }
                  >
                    <LocateFixed size={17} />
                    Report incident
                  </button>
                </div>
              </div>

              {/* Stats */}

              <section className="stats-grid">
                <Stat
                  label="Accessible network"
                  value={`${summary.accessible}%`}
                  change="+4.2%"
                  icon={
                    <CheckCircle2 size={20} />
                  }
                  tone="teal"
                />

                <Stat
                  label="Monitored segments"
                  value={summary.monitored.toString()}
                  change="+8"
                  icon={<Route size={20} />}
                  tone="blue"
                />

                <Stat
                  label="High-risk corridors"
                  value={summary.highRisk.toString()}
                  change="-2"
                  icon={
                    <AlertTriangle size={20} />
                  }
                  tone="amber"
                />

                <Stat
                  label="Active shipments"
                  value={summary.activeShipments.toString()}
                  change="+6"
                  icon={<Truck size={20} />}
                  tone="purple"
                />
              </section>

              {/* Dashboard */}

              <section className="dashboard-grid">
                <div className="panel map-panel">
                  <PanelTitle
                    title="Network accessibility"
                    subtitle="Live accessibility, incidents, and imported datasets."
                  />

                  <MapView
                    features={mapFeatures}
                    csvResult={csvResult}
                  />
                </div>

                <div className="panel">
                  <PanelTitle
                    title="Latest alerts"
                    subtitle={`${summary.alerts.length} recent events`}
                  />

                  <div className="alert-list">
                    {summary.alerts.map(
                      (alert) => (
                        <AlertRow
                          key={alert.id}
                          alert={alert}
                        />
                      ),
                    )}
                  </div>
                </div>
              </section>

              {/* Shipment summary */}

              <section className="panel">
                <div className="panel-header-row">
                  <PanelTitle
                    title="Essential supply movement"
                    subtitle="Latest shipment activity"
                  />

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      setActiveTab(
                        "Shipments",
                      )
                    }
                  >
                    See all
                  </button>
                </div>

                <div className="shipment-summary">
                  <div>
                    <strong>
                      Medical supplies
                    </strong>

                    <span>
                      Guwahati → Imphal
                    </span>

                    <small>On route</small>
                  </div>

                  <div>
                    <strong>
                      Rice & essentials
                    </strong>

                    <span>
                      Silchar → Aizawl
                    </span>

                    <small>
                      Delayed 42m
                    </small>
                  </div>

                  <div>
                    <strong>
                      Construction material
                    </strong>

                    <span>
                      Jorhat → Itanagar
                    </span>

                    <small>
                      Delivered
                    </small>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* Report modal */}

          {showReport && (
            <ReportModal
              onClose={() =>
                setShowReport(false)
              }
              onSubmitted={(report) => {
                handleReportSubmitted(
                  report,
                );
                setShowReport(false);
              }}
            />
          )}

          {/* Toast */}

          {reportToast && (
            <div className="toast">
              {reportToast}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Map                                                                        */
/* -------------------------------------------------------------------------- */

function MapView({
  features,
  csvResult,
}: {
  features: MapFeature[];
  csvResult: CsvResult | null;
}) {
  const csvPoints = (
    csvResult?.map_points ??
    csvResult?.normalized_preview ??
    []
  ).flatMap((row, index) => {
    const latitude = Number(
      row.latitude,
    );

    const longitude = Number(
      row.longitude,
    );

    return Number.isFinite(latitude) &&
      Number.isFinite(longitude)
      ? [
          {
            id: `csv-${index}`,
            latitude,
            longitude,
            name:
              row.name ??
              row.id ??
              "Dataset point",
            status:
              row.status ??
              row.type ??
              "CSV record",
            risk: row.risk_score ?? "",
          },
        ]
      : [];
  });

  return (
    <div className="map-wrapper">
      <MapContainer
        center={[25.8, 93.5]}
        zoom={6}
        scrollWheelZoom
        className="leaflet-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <GeoSearch />

        <LocateControl />

        <NerdrrLayers />

        {features.map((feature) => {
          const [
            longitude,
            latitude,
          ] = feature.geometry.coordinates;

          const isFieldReport =
            feature.properties.kind ===
            "field_report";

          return (
            <CircleMarker
              key={feature.id}
              center={[
                latitude,
                longitude,
              ]}
              radius={7}
              pathOptions={{
                color: isFieldReport
                  ? "#d65c50"
                  : "#0f927f",
                fillOpacity: 0.8,
              }}
            >
              <Popup>
                <strong>
                  {feature.properties
                    .registration ??
                    feature.properties
                      .title ??
                    "Network feature"}
                </strong>

                <br />

                {feature.properties
                  .status ??
                  feature.properties
                    .area ??
                  feature.properties
                    .kind}
              </Popup>
            </CircleMarker>
          );
        })}

        {csvPoints.map((point) => {
          const highRisk =
            point.risk !== "" &&
            Number(point.risk) >= 60;

          return (
            <CircleMarker
              key={point.id}
              center={[
                point.latitude,
                point.longitude,
              ]}
              radius={6}
              pathOptions={{
                color: highRisk
                  ? "#d65c50"
                  : "#3e8ccd",
                fillColor: highRisk
                  ? "#f2a09a"
                  : "#9cc8ee",
                fillOpacity: 0.9,
              }}
            >
              <Popup>
                <strong>
                  {point.name}
                </strong>

                <br />

                {point.status}

                <br />

                {point.risk
                  ? `Priority score: ${point.risk}`
                  : "No priority score"}

                <br />

                Imported from{" "}
                {csvResult?.filename}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {csvPoints.length > 0 && (
        <div className="map-point-count">
          {csvPoints.length} CSV points
          plotted
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* NER-DRR layers                                                             */
/* -------------------------------------------------------------------------- */

function NerdrrLayers() {
  const [lightning, setLightning] =
    useState(false);

  /*
   * Replace this with your actual NER-DRR
   * GeoServer WMS endpoint and layer name.
   */
  const WMS_URL =
    import.meta.env
      .VITE_NERDRR_WMS_URL ?? "";

  const WMS_LAYER =
    import.meta.env
      .VITE_NERDRR_LIGHTNING_LAYER ??
    "lightning";

  return (
    <>
      {lightning && WMS_URL && (
        <WMSTileLayer
          url={WMS_URL}
          layers={WMS_LAYER}
          format="image/png"
          transparent
          opacity={0.7}
        />
      )}

      <div className="nerdrr-layers">
        <strong>
          NER-DRR layers
        </strong>

        <label>
          <input
            type="checkbox"
            checked={lightning}
            onChange={(event) =>
              setLightning(
                event.target.checked,
              )
            }
          />

          Lightning observations
        </label>

        <small>
          State boundaries and lightning
          data via NER-DRR GeoServer
        </small>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Map search                                                                 */
/* -------------------------------------------------------------------------- */

function GeoSearch() {
  const map = useMap();

  const [query, setQuery] =
    useState("");

  const [searching, setSearching] =
    useState(false);

  const [error, setError] =
    useState("");

  async function searchPlace(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (!query.trim()) {
      return;
    }

    setSearching(true);
    setError("");

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(
          query.trim(),
        )}`,
        {
          headers: {
            Accept:
              "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          "Search failed",
        );
      }

      const results =
        (await response.json()) as Array<{
          lat: string;
          lon: string;
          display_name?: string;
        }>;

      if (!results.length) {
        throw new Error(
          "Place not found",
        );
      }

      map.flyTo(
        [
          Number(results[0].lat),
          Number(results[0].lon),
        ],
        11,
        {
          duration: 1,
        },
      );
    } catch {
      setError("Not found");
    } finally {
      setSearching(false);
    }
  }

  return (
    <form
      className="map-search"
      onSubmit={(event) =>
        void searchPlace(event)
      }
    >
      <input
        value={query}
        onChange={(event) =>
          setQuery(event.target.value)
        }
        placeholder="Search a place"
        aria-label="Search a place"
      />

      <button
        type="submit"
        className="ghost-button"
        disabled={searching}
      >
        {searching ? "..." : "Go"}
      </button>

      {error && (
        <span className="map-search-error">
          {error}
        </span>
      )}
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Locate control                                                             */
/* -------------------------------------------------------------------------- */

function LocateControl() {
  const map = useMap();

  function locate() {
    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        map.flyTo(
          [
            coords.latitude,
            coords.longitude,
          ],
          12,
          {
            duration: 1,
          },
        );
      },
      () => {
        console.warn(
          "Unable to determine current location.",
        );
      },
    );
  }

  return (
    <button
      type="button"
      className="map-locate-button"
      onClick={locate}
      title="Locate me"
      aria-label="Locate me"
    >
      <LocateFixed size={18} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Operations view                                                            */
/* -------------------------------------------------------------------------- */

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
}: {
  activeTab: string;
  vehicles: Vehicle[];
  shipments: Shipment[];
  alerts: Alert[];
  reports: FieldReport[];
  csvResult: CsvResult | null;
  setCsvResult: (
    result: CsvResult | null,
  ) => void;
  dataError: string;
  onAcknowledge?: (
    alertId: string,
  ) => void;
}) {
  const titles: Record<
    string,
    [string, string]
  > = {
    "Network status": [
      "Network status",
      "Live vehicles, capacity, and field observations.",
    ],

    Shipments: [
      "Shipments",
      "Track essential supplies from origin to destination.",
    ],

    "Field reports": [
      "Field reports",
      "Review incidents submitted by field teams.",
    ],

    "Data sources": [
      "Data sources",
      "Bring a CSV dataset into the intelligence workspace.",
    ],

    "Alert rules": [
      "Alert rules",
      "Review active alerts and acknowledge resolved events.",
    ],

    "Emergency alerts": [
      "Emergency alerts",
      "Simulate area-wide alert delivery and automatic fallback.",
    ],
  };

  const [title, subtitle] =
    titles[activeTab] ??
    titles["Network status"];

  const openAlerts = alerts.filter(
    (alert) => !alert.acknowledged,
  );

  return (
    <div className="operations-workspace">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            OPERATIONS WORKSPACE
          </p>

          <h1>{title}</h1>

          <p className="muted">
            {subtitle}
          </p>
        </div>
      </div>

      {dataError && (
        <div className="error-banner">
          <AlertTriangle size={18} />
          {dataError}
        </div>
      )}

      {activeTab ===
        "Network status" && (
        <div className="operations-grid">
          <section className="panel">
            <PanelTitle
              title="Vehicle network"
              subtitle={`${vehicles.length} tracked vehicles`}
            />

            <DataTable
              headers={[
                "Vehicle",
                "Driver",
                "Status",
                "Load",
              ]}
              rows={vehicles.map(
                (vehicle) => [
                  vehicle.registration,
                  vehicle.driver,
                  vehicle.status.replace(
                    "*",
                    " ",
                  ),
                  `${Math.round(
                    (vehicle.current_load_kg /
                      vehicle.capacity_kg) *
                      100,
                  )}%`,
                ],
              )}
            />
          </section>

          <section className="panel">
            <PanelTitle
              title="Live alerts"
              subtitle={`${openAlerts.length} open alerts`}
            />

            <AlertList
              alerts={openAlerts}
              onAcknowledge={
                onAcknowledge
              }
            />
          </section>
        </div>
      )}

      {activeTab === "Shipments" && (
        <section className="panel">
          <PanelTitle
            title="Shipment manifest"
            subtitle={`${shipments.length} shipments in the current operational feed`}
          />

          <DataTable
            headers={[
              "Reference",
              "Cargo",
              "Route",
              "Status",
              "Weight",
            ]}
            rows={shipments.map(
              (shipment) => [
                shipment.reference,
                shipment.cargo,
                `${shipment.origin} → ${shipment.destination}`,
                shipment.status.replace(
                  "*",
                  " ",
                ),
                `${shipment.weight_kg.toLocaleString()} kg`,
              ],
            )}
          />
        </section>
      )}

      {activeTab ===
        "Field reports" && (
        <section className="panel">
          <PanelTitle
            title="Submitted field reports"
            subtitle={`${reports.length} reports received`}
          />

          <DataTable
            headers={[
              "Category",
              "Description",
              "Status",
              "Received",
            ]}
            rows={reports.map(
              (report) => [
                report.category,
                report.description,
                report.status,
                new Date(
                  report.created_at,
                ).toLocaleString(),
              ],
            )}
          />
        </section>
      )}

      {activeTab ===
        "Alert rules" && (
        <section className="panel">
          <PanelTitle
            title="Active alerts"
            subtitle={`${openAlerts.length} alerts require attention`}
          />

          <AlertList
            alerts={alerts}
            onAcknowledge={
              onAcknowledge
            }
          />
        </section>
      )}

      {activeTab ===
        "Emergency alerts" && (
        <EmergencyAlertPanel />
      )}

      {activeTab ===
        "Data sources" && (
        <section className="panel">
          <PanelTitle
            title="CSV data source"
            subtitle="Import external operational datasets."
          />

          <CsvSource
            csvResult={csvResult}
            setCsvResult={
              setCsvResult
            }
          />
        </section>
      )}

      {/* Keep this prop available for future
          field-report workflows. */}
      {activeTab === "Data sources" && (
        <section className="panel">
          <PanelTitle
            title="CSV data source"
            subtitle="Import external operational datasets."
          />

          <CsvSource
            csvResult={csvResult}
            setCsvResult={setCsvResult}
          />
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Emergency alert panel                                                      */
/* -------------------------------------------------------------------------- */

function EmergencyAlertPanel() {
  const [area, setArea] =
    useState("Assam");

  const [message, setMessage] =
    useState(
      "Severe weather warning. Move to safe shelter and follow official instructions.",
    );

  const [severity, setSeverity] =
    useState("high");

  const [towers, setTowers] =
    useState(12);

  const [baud, setBaud] =
    useState(300);

  const [
    broadcastingAudio,
    setBroadcastingAudio,
  ] = useState(false);

  const [result, setResult] =
    useState<{
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

  const [error, setError] =
    useState("");

  async function simulate() {
    setError("");

    const alertPayload = {
      title: `${severity.charAt(0).toUpperCase()}${severity.slice(
        1,
      )} emergency alert`,
      body: message,
      area,
    };

    try {
      const response =
        await fetch(
          `${API_BASE}/api/emergency-alerts/simulate`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              area,
              message,
              severity,
              towers_available:
                towers,
              target_devices: 25000,
            }),
          },
        );

      if (!response.ok) {
        throw new Error(
          "Simulation failed",
        );
      }

      setResult(
        (await response.json()) as {
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
        },
      );

      void showLocalAlert(
        alertPayload,
      );
    } catch {
      const shown =
        await showLocalAlert(
          alertPayload,
        );

      setError(
        shown
          ? "Backend unreachable. The alert was delivered to this device and queued for other devices."
          : "Backend unreachable and notifications are not permitted on this device. The alert was queued.",
      );
    }
  }

  async function broadcastAudio() {
    setBroadcastingAudio(true);

    try {
      await transmitAcousticAlert(
        `[${severity.toUpperCase()}] ${area}: ${message}`,
        baud,
      );
    } catch (err) {
      console.error(
        "Audio transmission failed:",
        err,
      );
    } finally {
      setBroadcastingAudio(false);
    }
  }

  return (
    <div className="emergency-panel">
      <section className="panel">
        <PanelTitle
          title="Emergency alert broadcast"
          subtitle="Simulate delivery across available communication channels."
        />

        <div className="form-grid">
          <label>
            Target area

            <select
              value={area}
              onChange={(event) =>
                setArea(
                  event.target.value,
                )
              }
            >
              <option>Assam</option>
              <option>Arunachal Pradesh</option>
              <option>Manipur</option>
              <option>Meghalaya</option>
              <option>Mizoram</option>
              <option>Nagaland</option>
              <option>Sikkim</option>
              <option>Tripura</option>
            </select>
          </label>

          <label>
            Severity

            <select
              value={severity}
              onChange={(event) =>
                setSeverity(
                  event.target.value,
                )
              }
            >
              <option value="high">
                High
              </option>

              <option value="medium">
                Medium
              </option>

              <option value="low">
                Low
              </option>
            </select>
          </label>
        </div>

        <label>
          Towers available{" "}
          <strong>{towers}</strong>

          <input
            type="range"
            min="0"
            max="50"
            value={towers}
            onChange={(event) =>
              setTowers(
                Number(
                  event.target.value,
                ),
              )
            }
          />
        </label>

        <label>
          Acoustic transmission rate
          (baud)

          <input
            type="number"
            min="50"
            max="2400"
            value={baud}
            onChange={(event) =>
              setBaud(
                Number(
                  event.target.value,
                ),
              )
            }
          />
        </label>

        <label>
          Message

          <textarea
            value={message}
            onChange={(event) =>
              setMessage(
                event.target.value,
              )
            }
            rows={4}
          />
        </label>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "10px",
            marginTop: "15px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              void simulate()
            }
          >
            <Radio size={17} />
            Run delivery simulation
          </button>

          <button
            type="button"
            className="primary-button"
            style={{
              background: "#4e8cc5",
            }}
            disabled={broadcastingAudio}
            onClick={() =>
              void broadcastAudio()
            }
          >
            <Volume2 size={17} />

            {broadcastingAudio
              ? "Transmitting tones..."
              : `Broadcast tones (${baud} baud)`}
          </button>
        </div>
      </section>

      {result ? (
        <section className="panel">
          <p className="eyebrow">
            SIMULATION RESULT
          </p>

          <h2>
            {result.delivery_mode ===
            "bcc"
              ? "BCC delivery active"
              : "Fallback channels active"}
          </h2>

          <div className="channel-list">
            {result.channels.map(
              (channel) => (
                <span
                  key={channel}
                  className="channel-pill"
                >
                  {channel}
                </span>
              ),
            )}
          </div>

          <div className="result-stats">
            <div>
              <strong>
                {result.estimated_reached_devices.toLocaleString()}
              </strong>

              <span>
                estimated devices reached
              </span>
            </div>

            <div>
              <strong>
                {result.estimated_unreachable_devices.toLocaleString()}
              </strong>

              <span>
                estimated unreachable
              </span>
            </div>
          </div>

          <p>{result.explanation}</p>

          <p>
            Phone push delivery:{" "}
            {result.push_sent} sent,{" "}
            {result.push_failed} failed.
            {result.push_error &&
              ` Note: ${result.push_error}`}
          </p>

          <p>
            {result.sms_attempted > 0
              ? `Offline devices texted by SMS: ${result.sms_sent} sent, ${result.sms_failed} failed.`
              : "No devices were offline, so no SMS fallback was needed."}

            {result.sms_error &&
              ` Note: ${result.sms_error}`}
          </p>
        </section>
      ) : (
        <section className="panel empty-state">
          <Radio size={30} />

          <p>
            Run a simulation to test tower
            failure, automatic satellite
            fallback, and browser push
            alerts.
          </p>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Push setup                                                                 */
/* -------------------------------------------------------------------------- */

const PHONE_KEY =
  "ner-alert-phone";

function normalizePhone(
  raw: string,
): string | null {
  const cleaned = raw.replace(
    /[^\d+]/g,
    "",
  );

  const digits = cleaned
    .replace(/^00/, "+")
    .replace(/\D/g, "");

  return digits.length >= 6 &&
    digits.length <= 15
    ? `+${digits}`
    : null;
}

function PushSetup() {
  const [status, setStatus] =
    useState("Checking...");

  const [testing, setTesting] =
    useState(false);

  const [testResult, setTestResult] =
    useState("");

  const [online, setOnline] =
    useState(() =>
      navigator.onLine,
    );

  const [phone, setPhone] =
    useState(() => {
      try {
        return (
          localStorage.getItem(
            PHONE_KEY,
          ) ?? ""
        );
      } catch {
        return "";
      }
    });

  useEffect(() => {
    async function checkStatus() {
      if (!("Notification" in window)) {
        setStatus(
          "Notifications not supported in this browser",
        );

        return;
      }

      if (
        Notification.permission ===
        "denied"
      ) {
        setStatus(
          "Notifications blocked in browser permissions",
        );

        return;
      }

      const hasPushManager =
        "serviceWorker" in
          navigator &&
        "PushManager" in window;

      try {
        const reg = hasPushManager
          ? await navigator.serviceWorker.getRegistration(
              "/sw.js",
            )
          : undefined;

        if (reg) {
          const sub =
            await reg.pushManager.getSubscription();

          if (sub) {
            setStatus(
              Notification.permission ===
                "granted"
                ? "Enabled (online + offline)"
                : "Push subscribed - grant permission",
            );

            void fetch(
              `${API_BASE}/api/push/subscribe`,
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json",
                },
                body: JSON.stringify(
                  sub.toJSON(),
                ),
              },
            ).catch(() => undefined);

            return;
          }
        }
      } catch {
        // Ignore subscription errors.
      }

      if (
        Notification.permission ===
        "granted"
      ) {
        setStatus(
          hasPushManager
            ? "Local alerts enabled (click Enable for server push)"
            : "Local alerts enabled (offline-capable)",
        );
      } else {
        setStatus("Not enabled");
      }
    }

    void checkStatus();

    function goOnline() {
      setOnline(true);

      void flushQueuedAlerts().then(
        (count) => {
          if (count > 0) {
            setTestResult(
              `Delivered ${count} queued alert(s) now that you are back online.`,
            );
          }
        },
      );
    }

    function goOffline() {
      setOnline(false);
    }

    window.addEventListener(
      "online",
      goOnline,
    );

    window.addEventListener(
      "offline",
      goOffline,
    );

    return () => {
      window.removeEventListener(
        "online",
        goOnline,
      );

      window.removeEventListener(
        "offline",
        goOffline,
      );
    };
  }, []);

  async function enablePush() {
    const isLocalhost =
      window.location.hostname ===
        "localhost" ||
      window.location.hostname ===
        "127.0.0.1";

    if (
      !window.isSecureContext &&
      !isLocalhost
    ) {
      setStatus(
        "HTTPS tunnel required on a mobile phone",
      );

      return;
    }

    if (!("Notification" in window)) {
      setStatus(
        "Notifications not supported in this browser",
      );

      return;
    }

    setStatus(
      "Requesting permission...",
    );

    const granted =
      await ensurePermission();

    if (!granted) {
      setStatus(
        "Notification permission denied",
      );

      return;
    }

    setStatus(
      "Registering service worker...",
    );

    const registration =
      await registerServiceWorker();

    if (
      !registration ||
      !("PushManager" in window)
    ) {
      setStatus(
        "Local alerts enabled (offline-capable)",
      );

      return;
    }

    try {
      setStatus(
        "Fetching VAPID key...",
      );

      const keyResponse =
        await fetch(
          `${API_BASE}/api/push/public-key`,
          {
            signal:
              AbortSignal.timeout(
                8000,
              ),
          },
        );

      if (!keyResponse.ok) {
        const err =
          (await keyResponse
            .json()
            .catch(() => ({
              detail:
                "VAPID key unavailable",
            }))) as {
            detail?: string;
          };

        throw new Error(
          err.detail ??
            "VAPID public key is not configured",
        );
      }

      const {
        public_key: publicKey,
      } =
        (await keyResponse.json()) as {
          public_key: string;
        };

      if (!publicKey) {
        throw new Error(
          "Received empty public key from server",
        );
      }

      setStatus(
        "Purging stale local subscription...",
      );

      const existing =
        await registration.pushManager.getSubscription();

      if (existing) {
        try {
          await existing.unsubscribe();
        } catch {
          // Ignore.
        }
      }

      setStatus(
        "Subscribing to push manager...",
      );

      const subscription =
        await registration.pushManager.subscribe(
          {
            userVisibleOnly: true,
            applicationServerKey:
              urlB64ToUint8Array(
                publicKey,
              ),
          },
        );

      setStatus(
        "Syncing with backend...",
      );

      const phoneNumber =
        normalizePhone(phone);

      const subscribeResponse =
        await fetch(
          `${API_BASE}/api/push/subscribe`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              ...subscription.toJSON(),
              phone_number:
                phoneNumber,
            }),
            signal:
              AbortSignal.timeout(
                8000,
              ),
          },
        );

      if (!subscribeResponse.ok) {
        throw new Error(
          "Subscription registration failed",
        );
      }

      if (phoneNumber) {
        try {
          localStorage.setItem(
            PHONE_KEY,
            phoneNumber,
          );
        } catch {
          // Private mode.
        }
      }

      setStatus(
        phoneNumber
          ? "Enabled (push + SMS fallback)"
          : "Enabled (online + offline)",
      );
    } catch (pushError) {
      console.error(
        "Push setup error:",
        pushError,
      );

      setStatus(
        "Server push unavailable - local alerts still work offline",
      );
    }
  }

  async function testPush() {
    setTesting(true);
    setTestResult("");

    try {
      const response =
        await fetch(
          `${API_BASE}/api/push/test`,
          {
            method: "POST",
          },
        );

      if (!response.ok) {
        throw new Error(
          "Test request failed",
        );
      }

      const data =
        (await response.json()) as {
          sent: number;
          failed: number;
          error?: string;
          subscriptions: number;
        };

      if (data.sent > 0) {
        setTestResult(
          `Test alert delivered to ${data.sent} device(s)`,
        );
      } else if (
        data.subscriptions === 0
      ) {
        const shown =
          await showLocalAlert({
            title:
              "Test alert (local)",
            body:
              "Emergency broadcast notification delivery is operational on this device.",
            area:
              "Assam & North East",
          });

        setTestResult(
          shown
            ? "Test alert shown on this device (offline mode)"
            : "Enable notifications first to see the test alert",
        );
      } else {
        setTestResult(
          `Push delivery: ${
            data.error ?? "Failed"
          }`,
        );
      }
    } catch {
      const shown =
        await showLocalAlert({
          title:
            "Test alert (offline)",
          body:
            "Backend unreachable, but on-device emergency notifications are working.",
          area:
            "Assam & North East",
        });

      setTestResult(
        shown
          ? "Offline test alert shown on this device"
          : "Enable notifications first to see the test alert",
      );
    } finally {
      setTesting(false);
    }
  }

  async function savePhoneNumber() {
    const phoneNumber =
      normalizePhone(phone);

    if (!phoneNumber) {
      setTestResult(
        "Enter a valid phone number in international format, e.g. +919876543210",
      );

      return;
    }

    try {
      const registration =
        await navigator.serviceWorker?.ready;

      const subscription =
        registration
          ? await registration.pushManager.getSubscription()
          : null;

      if (!subscription) {
        setTestResult(
          "Enable push first, then save your number for the SMS fallback.",
        );

        return;
      }

      const response =
        await fetch(
          `${API_BASE}/api/push/phone`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              endpoint:
                subscription.endpoint,
              phone_number:
                phoneNumber,
            }),
            signal:
              AbortSignal.timeout(
                8000,
              ),
          },
        );

      if (!response.ok) {
        throw new Error(
          "Phone registration failed",
        );
      }

      try {
        localStorage.setItem(
          PHONE_KEY,
          phoneNumber,
        );
      } catch {
        // Private mode.
      }

      setStatus(
        "Enabled (push + SMS fallback)",
      );

      setTestResult(
        `Saved ${phoneNumber}. Alerts will be texted there if this device goes offline.`,
      );
    } catch {
      setTestResult(
        "Could not save the number. Connect to the API and try again.",
      );
    }
  }

  return (
    <section className="panel push-setup">
      <PanelTitle
        title="Phone & Browser notifications"
        subtitle={status}
      />

      <p>
        {online
          ? "Online"
          : "Offline"}{" "}
        - alerts are shown on this device
        and queued until the network
        returns.
      </p>

      <label>
        Mobile number for SMS fallback

        <input
          type="tel"
          value={phone}
          onChange={(event) =>
            setPhone(
              event.target.value,
            )
          }
          placeholder="+919876543210"
        />
      </label>

      {testResult && (
        <div className="info-message">
          {testResult}
        </div>
      )}

      <div className="button-row">
        <button
          type="button"
          className="ghost-button"
          onClick={() =>
            void enablePush()
          }
        >
          <Bell size={16} />
          Enable push
        </button>

        <button
          type="button"
          className="ghost-button secondary"
          onClick={() =>
            void savePhoneNumber()
          }
        >
          Save number
        </button>

        <button
          type="button"
          className="ghost-button secondary"
          disabled={testing}
          onClick={() =>
            void testPush()
          }
        >
          {testing
            ? "Testing..."
            : "Send test"}
        </button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* VAPID key conversion                                                       */
/* -------------------------------------------------------------------------- */

function urlB64ToUint8Array(
  base64String: string,
): Uint8Array<ArrayBuffer> {
  let clean = base64String
    .replace(
      /-----BEGIN[^-]+-----/g,
      "",
    )
    .replace(
      /-----END[^-]+-----/g,
      "",
    )
    .replace(
      /^Application Server Key\s*=\s*/i,
      "",
    )
    .replace(/\s+/g, "");

  const padding = "=".repeat(
    (4 - (clean.length % 4)) % 4,
  );

  const base64 = (
    clean + padding
  )
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData =
    window.atob(base64);

  const outputArray =
    new Uint8Array(
      new ArrayBuffer(rawData.length),
    );

  for (
    let i = 0;
    i < rawData.length;
    i++
  ) {
    outputArray[i] =
      rawData.charCodeAt(i);
  }

  if (
    outputArray.length === 91 &&
    outputArray[26] === 0x04
  ) {
    const sliced =
      outputArray.slice(26);

    return sliced;
  }

  return outputArray;
}

/* -------------------------------------------------------------------------- */
/* Panel title                                                                */
/* -------------------------------------------------------------------------- */

function PanelTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>

      <p>{subtitle}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Data table                                                                 */
/* -------------------------------------------------------------------------- */

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  if (!rows.length) {
    return (
      <div className="empty-state">
        No records are available yet.
      </div>
    );
  }

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map(
              (header) => (
                <th key={header}>
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>

        <tbody>
          {rows.map(
            (row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map(
                  (
                    cell,
                    cellIndex,
                  ) => (
                    <td
                      key={
                        cellIndex
                      }
                    >
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alert list                                                                 */
/* -------------------------------------------------------------------------- */

function AlertList({
  alerts,
  onAcknowledge,
}: {
  alerts: Alert[];
  onAcknowledge?: (
    alertId: string,
  ) => void;
}) {
  if (!alerts.length) {
    return (
      <div className="empty-state">
        No open alerts.
      </div>
    );
  }

  return (
    <div className="alert-list">
      {alerts.map((alert) => (
        <div
          className={`operations-alert ${
            alert.acknowledged
              ? "acknowledged"
              : ""
          }`}
          key={alert.id}
        >
          <div
            className={`alert-icon ${
              alert.severity ===
              "critical"
                ? "high"
                : alert.severity ===
                    "warning"
                  ? "medium"
                  : "low"
            }`}
          >
            {alert.severity ===
            "critical" ? (
              <AlertTriangle
                size={18}
              />
            ) : alert.severity ===
              "warning" ? (
              <CloudRain size={18} />
            ) : (
              <Bell size={18} />
            )}
          </div>

          <div className="alert-body">
            <div className="alert-title-row">
              <strong>
                {alert.title}
              </strong>

              {alert.acknowledged ? (
                <span className="acknowledged-label">
                  Acknowledged
                </span>
              ) : (
                onAcknowledge && (
                  <button
                    type="button"
                    className="ack-button"
                    onClick={() =>
                      onAcknowledge(
                        alert.id,
                      )
                    }
                    title="Acknowledge this alert"
                  >
                    Acknowledge
                  </button>
                )
              )}
            </div>

            <p>
              {alert.message}
            </p>

            <small>
              {alert.area}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* CSV source                                                                 */
/* -------------------------------------------------------------------------- */

function CsvSource({
  csvResult,
  setCsvResult,
}: {
  csvResult: CsvResult | null;
  setCsvResult: (
    result: CsvResult | null,
  ) => void;
}) {
  const [uploading, setUploading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function handleFile(
    file: File,
  ) {
    setUploading(true);
    setError("");

    const form = new FormData();

    form.append("file", file);

    try {
      const response =
        await fetch(
          `${API_BASE}/api/datasets/csv`,
          {
            method: "POST",
            body: form,
          },
        );

      if (!response.ok) {
        const detail =
          (await response
            .json()) as {
            detail?: string;
          };

        throw new Error(
          detail.detail ??
            "CSV import failed",
        );
      }

      setCsvResult(
        (await response.json()) as CsvResult,
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof
          Error
          ? uploadError.message
          : "CSV import failed",
      );
    } finally {
      setUploading(false);
    }
  }

  const columns = [
    "id",
    "name",
    "type",
    "state",
    "latitude",
    "longitude",
    "status",
    "risk_score",
  ];

  return (
    <div className="csv-source">
      <div className="upload-box">
        <Upload size={24} />

        <strong>
          {uploading
            ? "Processing dataset..."
            : "Choose a CSV file"}
        </strong>

        <p>
          Recognizes names, coordinates,
          types, status, and risk fields.
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          disabled={uploading}
          onChange={(event) => {
            const file =
              event.target.files?.[0];

            if (file) {
              void handleFile(
                file,
              );
            }
          }}
        />
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {csvResult && (
        <>
          <p>
            {csvResult.coordinate_count}{" "}
            of{" "}
            {csvResult.row_count}{" "}
            rows are ready to plot on
            the map.
          </p>

          <PanelTitle
            title={`${csvResult.filename} • normalized preview`}
            subtitle={`${csvResult.row_count.toLocaleString()} rows • ${csvResult.coordinate_count} mappable points`}
          />

          <DataTable
            headers={columns}
            rows={csvResult.normalized_preview.map(
              (row) =>
                columns.map(
                  (column) =>
                    row[column] ??
                    "",
                ),
            )}
          />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Statistic card                                                             */
/* -------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  change,
  icon,
  tone,
}: {
  label: string;
  value: string;
  change: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <div
        className={`stat-icon ${tone}`}
      >
        {icon}
      </div>

      <div className="stat-content">
        <span>{label}</span>

        <strong>{value}</strong>

        <small
          className={
            change.startsWith("-")
              ? "down"
              : ""
          }
        >
          {change}
        </small>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Relative time                                                              */
/* -------------------------------------------------------------------------- */

function relativeTime(
  value: string,
): string {
  const timestamp =
    Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  const seconds = Math.round(
    (Date.now() - timestamp) /
      1000,
  );

  if (seconds < 60) {
    return "Just now";
  }

  const minutes = Math.round(
    seconds / 60,
  );

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(
    minutes / 60,
  );

  if (hours < 24) {
    return `${hours} hr ago`;
  }

  return `${Math.round(
    hours / 24,
  )} day(s) ago`;
}

/* -------------------------------------------------------------------------- */
/* Alert row                                                                  */
/* -------------------------------------------------------------------------- */

function AlertRow({
  alert,
}: {
  alert: AlertItem;
}) {
  return (
    <div
      className={`alert-row ${alert.severity.toLowerCase()}`}
    >
      <div className="alert-icon">
        {alert.severity === "High" ? (
          <AlertTriangle size={18} />
        ) : alert.severity ===
          "Medium" ? (
          <CloudRain size={18} />
        ) : (
          <Bell size={18} />
        )}
      </div>

      <div className="alert-content">
        <strong>
          {alert.title}
        </strong>

        <span>
          {alert.location}
        </span>

        <small>
          {relativeTime(
            alert.time,
          )}
        </small>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* District                                                                   */
/* -------------------------------------------------------------------------- */

function District({
  name,
  state,
  score,
  status,
}: {
  name: string;
  state: string;
  score: number;
  status: string;
}) {
  return (
    <div className="district-row">
      <div className="district-info">
        <strong>{name}</strong>
        <span>{state}</span>
      </div>

      <div className="progress-container">
        <div
          className={`progress-fill ${
            score < 60
              ? "risk"
              : ""
          }`}
          style={{
            width: `${score}%`,
          }}
        />
      </div>

      <strong>
        {score}%
      </strong>

      <span
        className={`status ${
          score < 60
            ? "risk"
            : ""
        }`}
      >
        {status}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Report modal                                                               */
/* -------------------------------------------------------------------------- */

function ReportModal({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  onSubmitted: (
    report: FieldReport,
  ) => void;
}) {
  const [sent, setSent] =
    useState(false);

  const [category, setCategory] =
    useState("road");

  const [description, setDescription] =
    useState("");

  const [location, setLocation] =
    useState<
      [number, number] | null
    >(null);

  const [locating, setLocating] =
    useState(false);

  const [error, setError] =
    useState("");

  function captureLocation() {
    if (!navigator.geolocation) {
      setError(
        "This browser does not expose a location API.",
      );

      return;
    }

    setLocating(true);
    setError("");

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation([
          coords.latitude,
          coords.longitude,
        ]);

        setLocating(false);
      },
      () => {
        setError(
          "Location permission was denied or unavailable.",
        );

        setLocating(false);
      },
    );
  }

  async function submitReport() {
    if (!description.trim()) {
      setError(
        "Add a short description before submitting.",
      );

      return;
    }

    try {
      const response =
        await fetch(
          `${API_BASE}/api/field-reports`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              reporter: "A. Kumar",
              category,
              description,
              location,
            }),
          },
        );

      if (!response.ok) {
        throw new Error(
          "Report could not be submitted",
        );
      }

      const report =
        (await response.json()) as FieldReport;

      onSubmitted(report);

      setSent(true);
    } catch {
      setError(
        "The API is unavailable. Start the backend and try again.",
      );
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="report-modal">
        {sent ? (
          <div className="report-success">
            <CheckCircle2 size={42} />

            <h2>
              Report queued
            </h2>

            <p>
              Your incident was
              accepted by the field
              reports service.
            </p>

            <button
              type="button"
              className="primary-button"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="modal-header">
              <div>
                <p className="eyebrow">
                  FIELD UPDATE
                </p>

                <h2>
                  Report an incident
                </h2>

                <p className="muted">
                  Capture a road,
                  bridge, weather, or
                  delivery disruption.
                </p>
              </div>

              <button
                type="button"
                className="icon-button"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <label>
              Incident type

              <select
                value={category}
                onChange={(event) =>
                  setCategory(
                    event.target.value,
                  )
                }
              >
                <option value="road">
                  Road blockage
                </option>

                <option value="landslide">
                  Landslide
                </option>

                <option value="flooding">
                  Flooding
                </option>

                <option value="bridge">
                  Bridge damage
                </option>

                <option value="delivery">
                  Delivery delay
                </option>
              </select>
            </label>

            <div className="location-row">
              <strong>
                Location
              </strong>

              <button
                type="button"
                className="ghost-button"
                onClick={
                  captureLocation
                }
                disabled={locating}
              >
                <LocateFixed
                  size={16}
                />

                {locating
                  ? "Locating..."
                  : location
                    ? `${location[0].toFixed(
                        4,
                      )}, ${location[1].toFixed(
                        4,
                      )}`
                    : "Use current location"}
              </button>
            </div>

            <label>
              Notes

              <textarea
                value={description}
                onChange={(event) =>
                  setDescription(
                    event.target.value,
                  )
                }
                placeholder="Describe what you see..."
                rows={3}
              />
            </label>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={onClose}
              >
                Cancel
              </button>

              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  void submitReport()
                }
              >
                <Send size={16} />
                Submit report
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Acoustic alert transmitter                                                 */
/* -------------------------------------------------------------------------- */

async function transmitAcousticAlert(
  text: string,
  baud: number = 300,
) {
  const AudioContextClass =
    window.AudioContext ??
    (
      window as unknown as {
        webkitAudioContext: typeof AudioContext;
      }
    ).webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error(
      "Web Audio API is unavailable",
    );
  }

  const audioCtx =
    new AudioContextClass();

  await audioCtx.resume();

  const bitDuration =
    1 / baud;

  const MARK_FREQ = 1200;
  const SPACE_FREQ = 2200;

  const encoder =
    new TextEncoder();

  const bytes = encoder.encode(
    `${text}\n`,
  );

  const bits: number[] = [];

  for (const byte of bytes) {
    // Start bit
    bits.push(0);

    // Data bits, LSB first
    for (let i = 0; i < 8; i++) {
      bits.push(
        (byte >> i) & 1,
      );
    }

    // Stop bit
    bits.push(1);
  }

  let startTime =
    audioCtx.currentTime +
    0.1;

  for (const bit of bits) {
    const osc =
      audioCtx.createOscillator();

    const gain =
      audioCtx.createGain();

    osc.type = "sine";

    osc.frequency.value =
      bit === 1
        ? MARK_FREQ
        : SPACE_FREQ;

    gain.gain.setValueAtTime(
      0.3,
      startTime,
    );

    gain.gain.exponentialRampToValueAtTime(
      0.001,
      startTime +
        bitDuration,
    );

    osc.connect(gain);
    gain.connect(
      audioCtx.destination,
    );

    osc.start(startTime);

    osc.stop(
      startTime +
        bitDuration,
    );

    startTime += bitDuration;
  }

  const totalDuration =
    bits.length *
    bitDuration +
    0.2;

  await new Promise<void>(
    (resolve) => {
      window.setTimeout(
        resolve,
        totalDuration * 1000,
      );
    },
  );

  await audioCtx.close();
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

export default App;