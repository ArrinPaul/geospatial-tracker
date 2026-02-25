import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useWebSocket } from "../hooks/useWebSocket";
import CameraPanel from "./CameraPanel";

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

/* ─── Utility: formatted time ────────────────────────────────── */
const clockFormat = () => {
  const d = new Date();
  const utc = d.toISOString().slice(11, 19);
  const local = d.toLocaleTimeString("en-US", { hour12: false });
  return { utc, local, date: d.toISOString().slice(0, 10) };
};

/* ─── Component ──────────────────────────────────────────────── */

export default function LiveMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [stats, setStats] = useState<Stats>({
    aircraft: 0, vehicles: 0, pedestrians: 0, anomalies: 0, alerts: 0, total: 0,
  });
  const [clock, setClock] = useState(clockFormat());

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

  /* ─── Clock tick ───────────────────────────────────────────── */
  useEffect(() => {
    const iv = setInterval(() => setClock(clockFormat()), 1000);
    return () => clearInterval(iv);
  }, []);

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
        const src = map.current?.getSource("geofences") as maplibregl.GeoJSONSource;
        if (src) src.setData(geojson);
      })
      .catch(() => {});
  }, [mapLoaded, city]);

  /* ─── WebSocket message handler ────────────────────────────── */
  const handleMessage = useCallback(
    (data: any) => {
      if (replayMode) return;
      const geojson = data;
      const source = map.current?.getSource("detections") as maplibregl.GeoJSONSource;
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

      const newAlerts: Alert[] = [
        ...(metadata.geofence_alerts || []),
        ...(metadata.anomalies || []),
      ];
      if (newAlerts.length > 0) {
        setAlerts((prev) => [...newAlerts, ...prev].slice(0, 50));
      }

      if (metadata.geofence_zones) {
        const gfSrc = map.current?.getSource("geofences") as maplibregl.GeoJSONSource;
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
    map.current.flyTo({ center: cfg.center, zoom: cfg.zoom, duration: 2500, essential: true });
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
        const src = map.current?.getSource("detections") as maplibregl.GeoJSONSource;
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
          "aircraft-layer",
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

  /* ─── Map initialization — GLOBE PROJECTION ────────────────── */
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        name: "Tactical Dark Globe",
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          "carto-dark": {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution: "&copy; CARTO &copy; OSM contributors",
            maxzoom: 19,
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#050a12" },
          },
          {
            id: "carto-tiles",
            type: "raster",
            source: "carto-dark",
            paint: {
              "raster-opacity": 0.85,
              "raster-saturation": -0.3,
              "raster-brightness-max": 0.7,
              "raster-contrast": 0.15,
            },
          },
        ],
      },
      center: [-118.25, 34.05],
      zoom: 3,
      pitch: 0,
      maxPitch: 85,
      maplibreLogo: false,
      attributionControl: false,
    });

    // Enable globe projection
    map.current.on("load", () => {
      const m = map.current!;

      // Set globe projection for the sphere effect
      (m as any).setProjection?.({ type: "globe" });

      // Add atmosphere / sky for the globe
      try {
        m.setSky?.({
          "sky-color": "#050a12",
          "horizon-color": "#0a1628",
          "fog-color": "#050a12",
          "sky-horizon-blend": 0.5,
          "horizon-fog-blend": 0.8,
          "fog-ground-blend": 0.9,
        } as any);
      } catch {
        // sky not supported in all versions
      }

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
            0.15, "rgba(0,229,255,0.15)",
            0.3, "rgba(0,229,255,0.35)",
            0.5, "rgba(0,180,255,0.55)",
            0.7, "rgba(255,145,0,0.75)",
            0.85, "rgba(255,23,68,0.85)",
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
            "critical", "rgba(255,23,68,0.08)",
            "high", "rgba(255,145,0,0.06)",
            "rgba(0,229,255,0.04)",
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
            "critical", "#ff1744",
            "high", "#ff9100",
            "#00e5ff",
          ],
          "line-width": 1.5,
          "line-dasharray": [6, 3],
          "line-opacity": 0.5,
        },
      });

      m.addLayer({
        id: "geofence-labels",
        type: "symbol",
        source: "geofences",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-anchor": "center",
          "text-allow-overlap": false,
          "text-font": ["Open Sans Regular"],
        },
        paint: {
          "text-color": "#ff9100",
          "text-halo-color": "rgba(0,0,0,0.8)",
          "text-halo-width": 1.5,
        },
      });

      // ── Aircraft layer — pulsing circles ─────────────────────
      m.addLayer({
        id: "aircraft-glow",
        type: "circle",
        source: "detections",
        filter: ["==", ["get", "category"], "aircraft"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 8, 14, 20],
          "circle-color": "transparent",
          "circle-stroke-width": 1,
          "circle-stroke-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "altitude"], 0],
            0, "rgba(0,229,255,0.3)",
            5000, "rgba(255,145,0,0.3)",
            12000, "rgba(255,23,68,0.3)",
          ],
          "circle-blur": 1,
          "circle-opacity": 0.6,
        },
      });

      m.addLayer({
        id: "aircraft-layer",
        type: "circle",
        source: "detections",
        filter: ["==", ["get", "category"], "aircraft"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 14, 8],
          "circle-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "altitude"], 0],
            0, "#00e5ff",
            5000, "#ff9100",
            12000, "#ff1744",
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "rgba(255,255,255,0.6)",
          "circle-opacity": 0.95,
        },
      });

      // ── Vehicle layer ────────────────────────────────────────
      m.addLayer({
        id: "vehicle-layer",
        type: "circle",
        source: "detections",
        filter: ["==", ["get", "category"], "vehicles"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 6],
          "circle-color": "#448aff",
          "circle-opacity": 0.85,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(68,138,255,0.4)",
        },
      });

      // ── Pedestrian layer ─────────────────────────────────────
      m.addLayer({
        id: "pedestrian-layer",
        type: "circle",
        source: "detections",
        filter: ["==", ["get", "category"], "pedestrians"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 5],
          "circle-color": "#ffd600",
          "circle-opacity": 0.7,
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(255,214,0,0.3)",
        },
      });

      // ── Click popups ─────────────────────────────────────────
      for (const layerId of ["aircraft-layer", "vehicle-layer", "pedestrian-layer"]) {
        m.on("click", layerId, (e) => {
          if (!e.features?.length) return;
          const props = e.features[0].properties || {};
          const coords = (e.features[0].geometry as any).coordinates.slice();

          const rows = Object.entries(props)
            .filter(([k]) => !["source_model", "bounding_box"].includes(k))
            .map(([k, v]) => `<tr><td style="color:#7a8a9e;padding:2px 8px 2px 0;font-size:9px;text-transform:uppercase;letter-spacing:1px;font-family:'Orbitron',sans-serif">${k}</td><td style="color:#e0e6ed;padding:2px 0">${v}</td></tr>`)
            .join("");

          new maplibregl.Popup({ offset: 10, closeButton: true, maxWidth: "300px" })
            .setLngLat(coords)
            .setHTML(`<table style="border-collapse:collapse;font-family:'JetBrains Mono',monospace;font-size:11px">${rows}</table>`)
            .addTo(m);
        });

        m.on("mouseenter", layerId, () => { m.getCanvas().style.cursor = "crosshair"; });
        m.on("mouseleave", layerId, () => { m.getCanvas().style.cursor = ""; });
      }

      setMapLoaded(true);

      // Animate to the target city after a beat
      setTimeout(() => {
        m.flyTo({ center: [-118.25, 34.05], zoom: 10, pitch: 45, bearing: -15, duration: 3000 });
      }, 800);
    });

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), "bottom-right");
    map.current.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  /* ─── Severity color helper ────────────────────────────────── */
  const severityColor = (s: string) =>
    s === "critical" ? "#ff1744" : s === "high" ? "#ff9100" : s === "warning" ? "#ffd600" : "#448aff";

  const severityClass = (s: string) =>
    s === "critical" ? "severity-critical" : s === "high" ? "severity-high" : s === "warning" ? "severity-warning" : "severity-info";

  /* ─── Render ───────────────────────────────────────────────── */
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#050a12" }}>
      {/* Scanline overlay */}
      <div className="scanline-overlay" />

      {/* Map */}
      <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

      {/* ── Top bar — system header ───────────────────────────── */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 40,
        background: "linear-gradient(180deg, rgba(5,8,13,0.95) 0%, rgba(5,8,13,0.7) 80%, transparent 100%)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", zIndex: 20, borderBottom: "1px solid rgba(0,229,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo / radar icon */}
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            border: "1.5px solid rgba(0,229,255,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{
              width: 4, height: 4, borderRadius: "50%",
              background: "#00e5ff", boxShadow: "0 0 8px rgba(0,229,255,0.8)",
            }} />
            <div style={{
              position: "absolute", top: "50%", left: "50%", width: "50%", height: 1,
              background: "rgba(0,229,255,0.6)", transformOrigin: "left center",
              animation: "sweep 3s linear infinite",
            }} />
          </div>
          <span style={{
            fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700,
            letterSpacing: 4, color: "#00e5ff",
            textShadow: "0 0 20px rgba(0,229,255,0.3)",
          }}>
            GEOINT PLATFORM
          </span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 9, color: "rgba(122,138,158,0.6)",
            letterSpacing: 1, marginLeft: 4,
          }}>
            v3.0 TACTICAL
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* Connection status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className={`status-dot ${connected ? "live" : "offline"}`} />
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              color: connected ? "#39ff14" : "#ff1744",
              letterSpacing: 1,
            }}>
              {replayMode ? "REPLAY" : connected ? "LIVE FEED" : "OFFLINE"}
            </span>
          </div>

          {/* Clock */}
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)",
            display: "flex", gap: 12, letterSpacing: 0.5,
          }}>
            <span>{clock.date}</span>
            <span style={{ color: "#00e5ff" }}>{clock.utc}Z</span>
          </div>
        </div>
      </div>

      {/* ── Left panel — Command & Control ────────────────────── */}
      <div className="hud-panel panel corner-brackets" style={{
        position: "absolute", top: 56, left: 16,
        padding: 16, minWidth: 260, maxWidth: 280, zIndex: 10,
        animation: "fade-in-up 0.6s ease-out",
      }}>
        {/* City selector */}
        <div className="panel-header">AREA OF OPERATIONS</div>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="select-tactical"
          style={{ marginBottom: 16 }}
        >
          {Object.entries(cities).map(([id, cfg]) => (
            <option key={id} value={id}>{cfg.name.toUpperCase()}</option>
          ))}
        </select>

        {/* Stats */}
        <div className="panel-header" style={{ marginTop: 4 }}>ASSET TRACKING</div>

        <div className="stat-row">
          <span className="stat-label">Aircraft</span>
          <span className="stat-value" style={{ color: "#00e5ff" }}>{stats.aircraft}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Vehicles</span>
          <span className="stat-value" style={{ color: "#448aff" }}>{stats.vehicles}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Personnel</span>
          <span className="stat-value" style={{ color: "#ffd600" }}>{stats.pedestrians}</span>
        </div>

        {stats.anomalies > 0 && (
          <div className="stat-row" style={{ borderBottom: "1px solid rgba(255,145,0,0.15)" }}>
            <span className="stat-label" style={{ color: "#ff9100" }}>Anomalies</span>
            <span className="stat-value" style={{ color: "#ff9100" }}>{stats.anomalies}</span>
          </div>
        )}
        {stats.alerts > 0 && (
          <div className="stat-row" style={{ borderBottom: "1px solid rgba(255,23,68,0.15)" }}>
            <span className="stat-label" style={{ color: "#ff1744" }}>Alerts</span>
            <span className="stat-value" style={{ color: "#ff1744" }}>{stats.alerts}</span>
          </div>
        )}

        <div style={{
          marginTop: 12, paddingTop: 10,
          borderTop: "1px solid var(--border-subtle)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{
            fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 2,
            color: "var(--text-tertiary)", textTransform: "uppercase",
          }}>Total tracked</span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700,
            color: "#00e5ff", textShadow: "0 0 20px rgba(0,229,255,0.4)",
          }}>{stats.total}</span>
        </div>
      </div>

      {/* ── Layer control panel ───────────────────────────────── */}
      <div className="toggle-panel panel" style={{
        position: "absolute", top: 380, left: 16,
        padding: 14, zIndex: 10, minWidth: 200,
        animation: "fade-in-up 0.8s ease-out",
      }}>
        <div className="panel-header">LAYERS</div>

        <label className="toggle-switch">
          <input type="checkbox" checked={showHeatmap} onChange={() => setShowHeatmap(!showHeatmap)} />
          <span>HEAT SIGNATURE</span>
        </label>
        <label className="toggle-switch">
          <input type="checkbox" checked={showGeofences} onChange={() => setShowGeofences(!showGeofences)} />
          <span>GEOFENCE ZONES</span>
        </label>
        <label className="toggle-switch">
          <input type="checkbox" checked={showSatellite} onChange={() => setShowSatellite(!showSatellite)} />
          <span>SAT IMAGERY</span>
        </label>

        <button
          onClick={() => setShowAlertPanel(!showAlertPanel)}
          className={`btn-tactical ${alerts.length > 0 ? "btn-critical" : ""}`}
          style={{ width: "100%", marginTop: 10 }}
        >
          THREAT FEED {alerts.length > 0 && `[${alerts.length}]`}
        </button>
      </div>

      {/* ── Replay controls — bottom-center ───────────────────── */}
      <div className="replay-panel panel" style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
        padding: "8px 20px", display: "flex", alignItems: "center", gap: 12, zIndex: 10,
      }}>
        {!replayMode ? (
          <button onClick={startReplay} className="btn-tactical">TEMPORAL REPLAY</button>
        ) : (
          <>
            <button onClick={() => replayStep(-1)} className="btn-tactical" disabled={replayIndex <= 0}>&#9664;</button>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11, color: "#00e5ff",
              minWidth: 80, textAlign: "center", letterSpacing: 1,
            }}>
              {replayIndex + 1} / {replaySnapshots.length}
            </span>
            <button onClick={() => replayStep(1)} className="btn-tactical"
              disabled={replayIndex >= replaySnapshots.length - 1}>&#9654;</button>
            <button
              onClick={() => { setReplayMode(false); setReplaySnapshots([]); }}
              className="btn-tactical btn-critical"
            >
              EXIT
            </button>
          </>
        )}
      </div>

      {/* ── Weather intel — top-right ─────────────────────────── */}
      {weather && (
        <div className="weather-panel panel" style={{
          position: "absolute", top: 56, right: 16,
          padding: 14, zIndex: 10, minWidth: 170,
          animation: "fade-in-up 0.7s ease-out",
        }}>
          <div className="panel-header">METEOROLOGICAL</div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700,
            color: "#00e5ff", textShadow: "0 0 25px rgba(0,229,255,0.3)",
            marginBottom: 6, lineHeight: 1,
          }}>
            {weather.temp_c !== undefined ? `${weather.temp_c.toFixed(0)}°` : "—"}
          </div>
          <div style={{
            fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-secondary)",
            textTransform: "uppercase", letterSpacing: 1, marginBottom: 10,
          }}>
            {weather.description || "—"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              { label: "WIND", value: `${weather.wind_speed?.toFixed(1) ?? "—"} m/s`, color: "#448aff" },
              { label: "VIS", value: `${weather.visibility_km?.toFixed(0) ?? "—"} km`, color: "#39ff14" },
              { label: "CLOUD", value: `${weather.clouds_pct ?? "—"}%`, color: "#7a8a9e" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontFamily: "var(--font-mono)", fontSize: 10,
              }}>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 2,
                  color: "var(--text-tertiary)",
                }}>{label}</span>
                <span style={{ color, fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Alert panel — right side ──────────────────────────── */}
      {showAlertPanel && (
        <div className="alert-panel panel" style={{
          position: "absolute", top: weather ? 230 : 56, right: 16,
          padding: 14, zIndex: 20,
          maxHeight: "50vh", overflowY: "auto", width: 340,
          animation: "fade-in-up 0.4s ease-out",
          borderColor: "rgba(255,23,68,0.2)",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid rgba(255,23,68,0.15)",
          }}>
            <div className="panel-header" style={{ borderBottom: "none", marginBottom: 0, paddingBottom: 0 }}>
              THREAT INTELLIGENCE
            </div>
            <button onClick={() => setAlerts([])} className="btn-tactical" style={{ padding: "3px 8px", fontSize: 8 }}>
              PURGE
            </button>
          </div>

          {alerts.length === 0 ? (
            <div style={{
              color: "var(--text-tertiary)", textAlign: "center", padding: 24,
              fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 1,
            }}>
              NO ACTIVE THREATS
            </div>
          ) : (
            alerts.slice(0, 30).map((alert, i) => (
              <div key={i} style={{
                padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.03)",
                display: "flex", gap: 8, alignItems: "flex-start",
                animation: `data-stream 0.5s ease-out ${i * 0.05}s both`,
              }}>
                <span className={`severity-badge ${severityClass(alert.severity)}`}>
                  {alert.severity?.toUpperCase() || "INFO"}
                </span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11,
                  color: "var(--text-primary)", lineHeight: 1.4,
                }}>
                  {alert.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Camera panel */}
      <CameraPanel />

      {/* ── Bottom gradient fade ──────────────────────────────── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 60,
        background: "linear-gradient(0deg, rgba(5,8,13,0.6) 0%, transparent 100%)",
        pointerEvents: "none", zIndex: 5,
      }} />
    </div>
  );
}
