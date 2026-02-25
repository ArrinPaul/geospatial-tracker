import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useWebSocket } from "../hooks/useWebSocket";
import CameraPanel from "./CameraPanel";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws/live";
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

/* ─── Types ──────────────────────────────────────────────────── */

interface Stats {
  aircraft: number;
  vehicles: number;
  pedestrians: number;
  anomalies: number;
  alerts: number;
  total: number;
}

interface CityConfig {
  name: string;
  center: [number, number];
  zoom: number;
}

interface WeatherData {
  temp_c: number;
  description: string;
  wind_speed: number;
  wind_deg: number;
  visibility_km: number;
  clouds_pct: number;
  icon: string;
}

interface Alert {
  type: string;
  severity: string;
  message: string;
  icao24?: string;
  zone_name?: string;
}

/* ─── Component ──────────────────────────────────────────────── */

export default function LiveMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [stats, setStats] = useState<Stats>({
    aircraft: 0, vehicles: 0, pedestrians: 0, anomalies: 0, alerts: 0, total: 0,
  });

  // Feature states
  const [city, setCity] = useState("los_angeles");
  const [cities, setCities] = useState<Record<string, CityConfig>>({});
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showGeofences, setShowGeofences] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [replayMode, setReplayMode] = useState(false);
  const [replaySnapshots, setReplaySnapshots] = useState<any[]>([]);
  const [replayIndex, setReplayIndex] = useState(0);

  /* ─── Fetch cities list on mount ───────────────────────────── */
  useEffect(() => {
    fetch(`${API_BASE}/api/cities`)
      .then((r) => r.json())
      .then((data) => setCities(data))
      .catch(() => {
        setCities({
          los_angeles: { name: "Los Angeles", center: [-118.25, 34.05], zoom: 10 },
          new_york: { name: "New York", center: [-74.006, 40.7128], zoom: 10 },
          san_francisco: { name: "San Francisco", center: [-122.4194, 37.7749], zoom: 11 },
          chicago: { name: "Chicago", center: [-87.6298, 41.8781], zoom: 10 },
        });
      });
  }, []);

  /* ─── Fetch weather on city change ─────────────────────────── */
  useEffect(() => {
    fetch(`${API_BASE}/api/weather?city=${city}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setWeather(data);
      })
      .catch(() => setWeather(null));
  }, [city]);

  /* ─── Fetch geofence zones ─────────────────────────────────── */
  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    fetch(`${API_BASE}/api/geofences`)
      .then((r) => r.json())
      .then((geojson) => {
        const src = map.current?.getSource("geofences") as mapboxgl.GeoJSONSource;
        if (src) src.setData(geojson);
      })
      .catch(() => {});
  }, [mapLoaded, city]);

  /* ─── WebSocket message handler ────────────────────────────── */
  const handleMessage = useCallback(
    (data: any) => {
      if (replayMode) return; // Ignore live data during replay

      const geojson = data;
      const source = map.current?.getSource("detections") as mapboxgl.GeoJSONSource;
      if (source) source.setData(geojson);

      const features = geojson.features || [];
      const metadata = geojson.metadata || {};

      setStats({
        aircraft: features.filter((f: any) => f.properties?.category === "aircraft").length,
        vehicles: features.filter((f: any) => f.properties?.category === "vehicles").length,
        pedestrians: features.filter((f: any) => f.properties?.category === "pedestrians").length,
        anomalies: (metadata.anomalies || []).length,
        alerts: (metadata.geofence_alerts || []).length,
        total: features.length,
      });

      // Merge geofence + anomaly alerts
      const newAlerts: Alert[] = [
        ...(metadata.geofence_alerts || []),
        ...(metadata.anomalies || []),
      ];
      if (newAlerts.length > 0) {
        setAlerts((prev) => [...newAlerts, ...prev].slice(0, 50));
      }

      // Update geofence overlay if included
      if (metadata.geofence_zones) {
        const gfSrc = map.current?.getSource("geofences") as mapboxgl.GeoJSONSource;
        if (gfSrc) gfSrc.setData(metadata.geofence_zones);
      }
    },
    [replayMode],
  );

  const { connected, lastUpdate } = useWebSocket({
    url: WS_URL,
    onMessage: handleMessage,
    city,
  });

  /* ─── City change — fly to new location ────────────────────── */
  useEffect(() => {
    if (!map.current || !cities[city]) return;
    const cfg = cities[city];
    map.current.flyTo({ center: cfg.center, zoom: cfg.zoom, duration: 2000 });
  }, [city, cities]);

  /* ─── Historical replay ────────────────────────────────────── */
  const startReplay = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/history/snapshots?city=${city}&limit=50`);
      const data = await res.json();
      if (data.snapshots?.length) {
        setReplaySnapshots(data.snapshots);
        setReplayIndex(0);
        setReplayMode(true);
        // Load first snapshot
        loadReplaySnapshot(data.snapshots[0].id);
      }
    } catch (e) {
      console.error("Replay load error:", e);
    }
  };

  const loadReplaySnapshot = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/snapshot/${id}`);
      const data = await res.json();
      if (data.geojson) {
        const src = map.current?.getSource("detections") as mapboxgl.GeoJSONSource;
        if (src) src.setData(data.geojson);
      }
    } catch (e) {
      console.error("Snapshot load error:", e);
    }
  };

  const replayStep = (direction: number) => {
    const newIdx = Math.max(0, Math.min(replaySnapshots.length - 1, replayIndex + direction));
    setReplayIndex(newIdx);
    if (replaySnapshots[newIdx]) loadReplaySnapshot(replaySnapshots[newIdx].id);
  };

  /* ─── Toggle heatmap layer ─────────────────────────────────── */
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;
    if (m.getLayer("heatmap-layer")) {
      m.setLayoutProperty("heatmap-layer", "visibility", showHeatmap ? "visible" : "none");
    }
    // Toggle point layers inverse
    for (const layerId of ["aircraft-layer", "vehicle-layer", "pedestrian-layer"]) {
      if (m.getLayer(layerId)) {
        m.setLayoutProperty(layerId, "visibility", showHeatmap ? "none" : "visible");
      }
    }
  }, [showHeatmap, mapLoaded]);

  /* ─── Toggle geofences ─────────────────────────────────────── */
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    for (const layerId of ["geofence-fill", "geofence-outline", "geofence-labels"]) {
      if (map.current.getLayer(layerId)) {
        map.current.setLayoutProperty(layerId, "visibility", showGeofences ? "visible" : "none");
      }
    }
  }, [showGeofences, mapLoaded]);

  /* ─── Toggle satellite tiles ───────────────────────────────── */
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;
    if (showSatellite) {
      if (!m.getSource("satellite-tiles")) {
        m.addSource("satellite-tiles", {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
        });
        m.addLayer(
          { id: "satellite-layer", type: "raster", source: "satellite-tiles", paint: { "raster-opacity": 0.7 } },
          "aircraft-layer", // Insert below data layers
        );
      } else if (m.getLayer("satellite-layer")) {
        m.setLayoutProperty("satellite-layer", "visibility", "visible");
      }
    } else {
      if (m.getLayer("satellite-layer")) {
        m.setLayoutProperty("satellite-layer", "visibility", "none");
      }
    }
  }, [showSatellite, mapLoaded]);

  /* ─── Map initialization ───────────────────────────────────── */
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-118.25, 34.05],
      zoom: 10,
      pitch: 45,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.current.on("load", () => {
      const m = map.current!;

      // ── Detection source ─────────────────────────────────────
      m.addSource("detections", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // ── Geofence source ──────────────────────────────────────
      m.addSource("geofences", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // ── Heatmap layer (hidden by default) ────────────────────
      m.addLayer({
        id: "heatmap-layer",
        type: "heatmap",
        source: "detections",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["coalesce", ["get", "confidence"], 0.5], 0, 0, 1, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 15, 3],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "rgba(0,255,128,0.3)",
            0.4, "rgba(0,200,255,0.5)",
            0.6, "rgba(255,200,0,0.7)",
            0.8, "rgba(255,100,0,0.85)",
            1, "rgba(255,0,50,1)",
          ],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 15, 30],
          "heatmap-opacity": 0.8,
        },
      });

      // ── Geofence fill ────────────────────────────────────────
      m.addLayer({
        id: "geofence-fill",
        type: "fill",
        source: "geofences",
        paint: {
          "fill-color": [
            "match", ["get", "severity"],
            "critical", "rgba(255,0,0,0.12)",
            "high", "rgba(255,165,0,0.10)",
            "rgba(255,255,0,0.08)",
          ],
          "fill-opacity": 0.6,
        },
      });

      m.addLayer({
        id: "geofence-outline",
        type: "line",
        source: "geofences",
        paint: {
          "line-color": [
            "match", ["get", "severity"],
            "critical", "#ff0000",
            "high", "#ff8800",
            "#ffcc00",
          ],
          "line-width": 2,
          "line-dasharray": [4, 2],
          "line-opacity": 0.7,
        },
      });

      m.addLayer({
        id: "geofence-labels",
        type: "symbol",
        source: "geofences",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-anchor": "center",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#ff8800",
          "text-halo-color": "#000000",
          "text-halo-width": 1.5,
        },
      });

      // ── Aircraft layer ───────────────────────────────────────
      m.addLayer({
        id: "aircraft-layer",
        type: "circle",
        source: "detections",
        filter: ["==", ["get", "category"], "aircraft"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 14, 12],
          "circle-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "altitude"], 0],
            0, "#00ff88",
            5000, "#ffaa00",
            12000, "#ff0044",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9,
        },
      });

      // ── Vehicle layer ────────────────────────────────────────
      m.addLayer({
        id: "vehicle-layer",
        type: "circle",
        source: "detections",
        filter: ["==", ["get", "category"], "vehicles"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#00d4ff",
          "circle-opacity": 0.8,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#006688",
        },
      });

      // ── Pedestrian layer ─────────────────────────────────────
      m.addLayer({
        id: "pedestrian-layer",
        type: "circle",
        source: "detections",
        filter: ["==", ["get", "category"], "pedestrians"],
        paint: {
          "circle-radius": 3,
          "circle-color": "#ffee00",
          "circle-opacity": 0.7,
        },
      });

      // ── Click popups ─────────────────────────────────────────
      for (const layerId of ["aircraft-layer", "vehicle-layer", "pedestrian-layer"]) {
        m.on("click", layerId, (e) => {
          if (!e.features?.length) return;
          const props = e.features[0].properties || {};
          const coords = (e.features[0].geometry as any).coordinates.slice();

          const html = Object.entries(props)
            .filter(([k]) => !["source_model", "bounding_box"].includes(k))
            .map(([k, v]) => `<b>${k}:</b> ${v}`)
            .join("<br/>");

          new mapboxgl.Popup()
            .setLngLat(coords)
            .setHTML(`<div style="font-size:12px;max-width:250px">${html}</div>`)
            .addTo(m);
        });

        m.on("mouseenter", layerId, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", layerId, () => { m.getCanvas().style.cursor = ""; });
      }

      setMapLoaded(true);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  /* ─── Severity color helper ────────────────────────────────── */
  const severityColor = (s: string) =>
    s === "critical" ? "#ff3344" : s === "high" ? "#ff8800" : s === "warning" ? "#ffcc00" : "#88aaff";

  /* ─── Render ───────────────────────────────────────────────── */
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

      {/* ── HUD — top-left ────────────────────────────────────── */}
      <div className="hud-panel" style={{
        position: "absolute", top: 16, left: 16,
        background: "rgba(0,0,0,0.88)", color: "#0f0",
        padding: "16px 20px", borderRadius: 10,
        fontFamily: "'Courier New', monospace", fontSize: 13,
        border: "1px solid rgba(0,255,0,0.3)",
        backdropFilter: "blur(10px)", minWidth: 240, maxWidth: 300, zIndex: 10,
      }}>
        <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 8, letterSpacing: 2 }}>
          GEOSPATIAL TRACKER v2.0
        </div>

        {/* City selector */}
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{
            width: "100%", marginBottom: 10, padding: "6px 8px",
            background: "#111", color: "#0f0", border: "1px solid rgba(0,255,0,0.3)",
            borderRadius: 4, fontFamily: "inherit", fontSize: 12, cursor: "pointer",
          }}
        >
          {Object.entries(cities).map(([id, cfg]) => (
            <option key={id} value={id}>{cfg.name}</option>
          ))}
        </select>

        <div style={{ marginBottom: 3 }}>✈ AIRCRAFT: {stats.aircraft}</div>
        <div style={{ marginBottom: 3, color: "#00d4ff" }}>🚗 VEHICLES: {stats.vehicles}</div>
        <div style={{ marginBottom: 3, color: "#ffee00" }}>🚶 PEDESTRIANS: {stats.pedestrians}</div>
        {stats.anomalies > 0 && (
          <div style={{ marginBottom: 3, color: "#ff8800" }}>⚠ ANOMALIES: {stats.anomalies}</div>
        )}
        {stats.alerts > 0 && (
          <div style={{ marginBottom: 3, color: "#ff3344" }}>🚨 ALERTS: {stats.alerts}</div>
        )}

        <div style={{ borderTop: "1px solid rgba(0,255,0,0.2)", paddingTop: 8, marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "#888" }}>TOTAL: {stats.total}</div>
          <div style={{ fontSize: 10, marginTop: 4, color: connected ? "#0f0" : "#f44" }}>
            {replayMode ? "⏪ REPLAY MODE" : connected ? "● LIVE" : "○ DISCONNECTED"}
            {" • "}
            {lastUpdate ? lastUpdate.toLocaleTimeString() : "Waiting..."}
          </div>
        </div>
      </div>

      {/* ── Layer toggles — top-left below HUD ────────────────── */}
      <div className="toggle-panel" style={{
        position: "absolute", top: 320, left: 16,
        background: "rgba(0,0,0,0.85)", color: "#ccc",
        padding: "12px 16px", borderRadius: 8,
        fontFamily: "'Courier New', monospace", fontSize: 11,
        border: "1px solid rgba(0,255,0,0.2)",
        backdropFilter: "blur(10px)", zIndex: 10,
      }}>
        <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 8, letterSpacing: 1 }}>LAYERS</div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showHeatmap} onChange={() => setShowHeatmap(!showHeatmap)} />
          <span>🔥 Heatmap</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showGeofences} onChange={() => setShowGeofences(!showGeofences)} />
          <span>🛡 Geofences</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showSatellite} onChange={() => setShowSatellite(!showSatellite)} />
          <span>🛰 Satellite</span>
        </label>
        <button
          onClick={() => setShowAlertPanel(!showAlertPanel)}
          style={{
            width: "100%", marginTop: 4, padding: "4px 8px",
            background: alerts.length > 0 ? "rgba(255,60,0,0.2)" : "rgba(255,255,255,0.05)",
            color: alerts.length > 0 ? "#ff8800" : "#888",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4,
            cursor: "pointer", fontFamily: "inherit", fontSize: 10,
          }}
        >
          🔔 Alerts {alerts.length > 0 && `(${alerts.length})`}
        </button>
      </div>

      {/* ── Replay controls — bottom-center ───────────────────── */}
      <div className="replay-panel" style={{
        position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.88)", color: "#ccc",
        padding: "8px 16px", borderRadius: 8,
        fontFamily: "'Courier New', monospace", fontSize: 11,
        border: "1px solid rgba(0,255,0,0.2)",
        backdropFilter: "blur(10px)", display: "flex", alignItems: "center", gap: 10, zIndex: 10,
      }}>
        {!replayMode ? (
          <button onClick={startReplay} style={btnStyle}>⏮ REPLAY</button>
        ) : (
          <>
            <button onClick={() => replayStep(-1)} style={btnStyle} disabled={replayIndex <= 0}>◀</button>
            <span style={{ color: "#0f0", minWidth: 80, textAlign: "center" }}>
              {replayIndex + 1} / {replaySnapshots.length}
            </span>
            <button onClick={() => replayStep(1)} style={btnStyle}
              disabled={replayIndex >= replaySnapshots.length - 1}>▶</button>
            <button onClick={() => { setReplayMode(false); setReplaySnapshots([]); }} style={btnStyle}>
              ⏹ LIVE
            </button>
          </>
        )}
      </div>

      {/* ── Weather widget — top-right ────────────────────────── */}
      {weather && (
        <div className="weather-panel" style={{
          position: "absolute", top: 60, right: 60,
          background: "rgba(0,0,0,0.85)", color: "#ccc",
          padding: "10px 14px", borderRadius: 8,
          fontFamily: "'Courier New', monospace", fontSize: 11,
          border: "1px solid rgba(0,200,255,0.3)",
          backdropFilter: "blur(10px)", zIndex: 10, minWidth: 150,
        }}>
          <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 6, letterSpacing: 1 }}>WEATHER</div>
          <div style={{ fontSize: 16, marginBottom: 4 }}>
            {weather.temp_c !== undefined ? `${weather.temp_c.toFixed(0)}°C` : "—"}
          </div>
          <div style={{ textTransform: "capitalize", marginBottom: 3 }}>{weather.description || "—"}</div>
          <div>💨 {weather.wind_speed?.toFixed(1) ?? "—"} m/s</div>
          <div>👁 {weather.visibility_km?.toFixed(0) ?? "—"} km</div>
          <div>☁ {weather.clouds_pct ?? "—"}%</div>
        </div>
      )}

      {/* ── Alert panel — right side ──────────────────────────── */}
      {showAlertPanel && (
        <div className="alert-panel" style={{
          position: "absolute", top: 16, right: 60,
          background: "rgba(0,0,0,0.92)", color: "#ccc",
          padding: "12px 16px", borderRadius: 10,
          fontFamily: "'Courier New', monospace", fontSize: 11,
          border: "1px solid rgba(255,100,0,0.4)",
          backdropFilter: "blur(10px)", zIndex: 20,
          maxHeight: "60vh", overflowY: "auto", width: 320,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 6,
          }}>
            <span style={{ color: "#ff8800", letterSpacing: 1, fontSize: 10 }}>
              🔔 ALERTS & ANOMALIES ({alerts.length})
            </span>
            <button onClick={() => setAlerts([])} style={{
              background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 10,
            }}>CLEAR</button>
          </div>
          {alerts.length === 0 ? (
            <div style={{ color: "#555", textAlign: "center", padding: 16 }}>No alerts</div>
          ) : (
            alerts.slice(0, 30).map((alert, i) => (
              <div key={i} style={{
                padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <span style={{
                  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                  background: severityColor(alert.severity), marginRight: 6,
                }} />
                <span style={{ color: severityColor(alert.severity), fontSize: 10, marginRight: 4 }}>
                  [{alert.severity.toUpperCase()}]
                </span>
                <span style={{ fontSize: 11 }}>{alert.message}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Camera panel */}
      <CameraPanel />
    </div>
  );
}

/* ── Shared button style ─────────────────────────────────────── */
const btnStyle: React.CSSProperties = {
  background: "rgba(0,255,0,0.1)",
  color: "#0f0",
  border: "1px solid rgba(0,255,0,0.3)",
  borderRadius: 4,
  padding: "4px 10px",
  cursor: "pointer",
  fontFamily: "'Courier New', monospace",
  fontSize: 11,
};
