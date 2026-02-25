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

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
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

  // Location search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [customCoords, setCustomCoords] = useState<{ lat: number; lon: number } | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

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

  /* ─── Fetch weather on city/location change ─────────────────── */
  useEffect(() => {
    const params = new URLSearchParams({ city });
    if (customCoords) {
      params.set("lat", String(customCoords.lat));
      params.set("lon", String(customCoords.lon));
    }
    fetch(`${API_BASE}/api/weather?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          // Map backend field names to frontend interface
          setWeather({
            temp_c: data.temperature_c ?? data.temp_c,
            description: data.weather_desc ?? data.description ?? "",
            wind_speed: data.wind_speed_ms ?? data.wind_speed ?? 0,
            wind_deg: data.wind_deg ?? 0,
            visibility_km: (data.visibility_m ? data.visibility_m / 1000 : data.visibility_km) ?? 10,
            clouds_pct: data.clouds_pct ?? 0,
            icon: data.weather_icon ?? data.icon ?? "",
          });
        }
      })
      .catch(() => setWeather(null));
  }, [city, customCoords]);

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

  const { connected, lastUpdate, sendMessage } = useWebSocket({
    url: WS_URL,
    onMessage: handleMessage,
    city,
    lat: customCoords?.lat,
    lon: customCoords?.lon,
  });

  /* ─── City change — fly to new location ────────────────────── */
  useEffect(() => {
    if (!map.current) return;
    if (customCoords) {
      map.current.flyTo({
        center: [customCoords.lon, customCoords.lat],
        zoom: 11,
        duration: 2500,
        essential: true,
      });
      return;
    }
    if (!cities[city]) return;
    const cfg = cities[city];
    map.current.flyTo({ center: cfg.center, zoom: cfg.zoom, duration: 2500, essential: true });
  }, [city, cities, customCoords]);

  /* ─── Location search via Nominatim ────────────────────────── */
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (query.length < 3) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
          { headers: { "Accept-Language": "en" } }
        );
        const data = await res.json();
        setSearchResults(data);
        setShowSearchResults(data.length > 0);
      } catch {
        setSearchResults([]);
        setShowSearchResults(false);
      }
    }, 400);
  }, []);

  const selectSearchResult = useCallback((result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    setCustomCoords({ lat, lon });
    setCity(`custom_${lat.toFixed(2)}_${lon.toFixed(2)}`);
    setSearchQuery(result.display_name.split(",")[0]);
    setShowSearchResults(false);

    // Notify backend via WebSocket
    sendMessage({ lat, lon, city: result.display_name.split(",")[0] });
  }, [sendMessage]);

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
        name: "Dark Operations Globe",
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          "carto-base": {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
              "https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution: "&copy; CARTO &copy; OSM contributors",
            maxzoom: 20,
          },
          "carto-labels": {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
              "https://c.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            maxzoom: 20,
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#040506" },
          },
          {
            id: "carto-base-layer",
            type: "raster",
            source: "carto-base",
            paint: {
              "raster-opacity": 0.9,
              "raster-saturation": -1,
              "raster-brightness-max": 0.55,
              "raster-brightness-min": 0.0,
              "raster-contrast": 0.2,
            },
          },
          {
            id: "carto-labels-layer",
            type: "raster",
            source: "carto-labels",
            paint: {
              "raster-opacity": 0.85,
              "raster-saturation": -0.5,
              "raster-brightness-max": 0.7,
              "raster-brightness-min": 0.0,
            },
          },
        ],
      },
      center: [-118.25, 34.05],
      zoom: 3,
      pitch: 0,
      maxPitch: 85,
      maxZoom: 20,
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
          "sky-color": "#040506",
          "horizon-color": "#0c0e12",
          "fog-color": "#040506",
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
            0.15, "rgba(180,185,192,0.1)",
            0.3, "rgba(180,185,192,0.25)",
            0.5, "rgba(200,205,213,0.4)",
            0.7, "rgba(220,222,228,0.6)",
            0.85, "rgba(235,237,240,0.75)",
            1, "rgba(255,255,255,0.9)",
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
            "critical", "rgba(200,200,200,0.06)",
            "high", "rgba(180,180,180,0.04)",
            "rgba(160,160,160,0.03)",
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
            "critical", "#a0a0a0",
            "high", "#808080",
            "#606060",
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
          "text-color": "#808080",
          "text-halo-color": "rgba(0,0,0,0.9)",
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
            0, "rgba(200,207,216,0.2)",
            5000, "rgba(180,185,192,0.2)",
            12000, "rgba(160,165,172,0.2)",
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
            0, "#c8cfd8",
            5000, "#a0a8b2",
            12000, "#808890",
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "rgba(255,255,255,0.3)",
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
          "circle-color": "#8a929e",
          "circle-opacity": 0.85,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(138,146,158,0.3)",
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
          "circle-color": "#606870",
          "circle-opacity": 0.7,
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(96,104,112,0.3)",
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
            .map(([k, v]) => `<tr><td style="color:#505862;padding:2px 8px 2px 0;font-size:9px;text-transform:uppercase;letter-spacing:1px;font-family:'Orbitron',sans-serif">${k}</td><td style="color:#c8cfd8;padding:2px 0">${v}</td></tr>`)
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
    map.current.addControl(new maplibregl.ScaleControl({ maxWidth: 100 }), "bottom-left");

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  /* ─── Severity color helper ────────────────────────────────── */
  const severityColor = (s: string) =>
    s === "critical" ? "#b0b0b0" : s === "high" ? "#909090" : s === "warning" ? "#787878" : "#606060";

  const severityClass = (s: string) =>
    s === "critical" ? "severity-critical" : s === "high" ? "severity-high" : s === "warning" ? "severity-warning" : "severity-info";

  /* ─── Render ───────────────────────────────────────────────── */
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#040506" }}>
      {/* Scanline overlay */}
      <div className="scanline-overlay" />

      {/* Map */}
      <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

      {/* ── Top bar — system header ───────────────────────────── */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 40,
        background: "linear-gradient(180deg, rgba(4,5,6,0.96) 0%, rgba(4,5,6,0.7) 80%, transparent 100%)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", zIndex: 20, borderBottom: "1px solid rgba(200,207,216,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo / radar icon */}
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            border: "1.5px solid rgba(200,207,216,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative", overflow: "hidden",
          }}>
            <div style={{
              width: 4, height: 4, borderRadius: "50%",
              background: "#c8cfd8", boxShadow: "0 0 6px rgba(200,207,216,0.4)",
            }} />
            <div style={{
              position: "absolute", top: "50%", left: "50%", width: "50%", height: 1,
              background: "rgba(200,207,216,0.3)", transformOrigin: "left center",
              animation: "sweep 3s linear infinite",
            }} />
          </div>
          <span style={{
            fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700,
            letterSpacing: 4, color: "#c8cfd8",
            textShadow: "0 0 15px rgba(200,207,216,0.15)",
          }}>
            GEOINT PLATFORM
          </span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 9, color: "rgba(100,108,120,0.5)",
            letterSpacing: 1, marginLeft: 4,
          }}>
            v3.0
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* Connection status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: connected ? "#808890" : "#605050",
              boxShadow: connected ? "0 0 6px rgba(128,136,144,0.4)" : "none",
              animation: connected ? "indicator-pulse 2s ease-in-out infinite" : "none",
            }} />
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              color: connected ? "#8a929e" : "#706060",
              letterSpacing: 1,
            }}>
              {replayMode ? "REPLAY" : connected ? "LIVE" : "OFFLINE"}
            </span>
          </div>

          {/* Clock */}
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)",
            display: "flex", gap: 12, letterSpacing: 0.5,
          }}>
            <span>{clock.date}</span>
            <span style={{ color: "#c8cfd8" }}>{clock.utc}Z</span>
          </div>
        </div>
      </div>

      {/* ── Left panel — Command & Control ────────────────────── */}
      <div style={{
        position: "absolute", top: 56, left: 16,
        padding: 16, minWidth: 260, maxWidth: 280, zIndex: 10,
        animation: "fade-in-up 0.6s ease-out",
        background: "var(--bg-panel)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--panel-radius)",
        backdropFilter: "blur(10px)",
      }}>
        {/* Location search */}
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 3,
          color: "var(--text-tertiary)", marginBottom: 8, textTransform: "uppercase",
          borderBottom: "1px solid var(--border-subtle)", paddingBottom: 6,
        }}>AREA OF OPERATIONS</div>

        <div className="search-container" style={{ marginBottom: 10 }}>
          <div style={{
            position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
            fontSize: 12, color: "var(--text-tertiary)", zIndex: 2, pointerEvents: "none",
          }}>&#9906;</div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
            onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
            placeholder="SEARCH ANY LOCATION..."
          />
          {showSearchResults && (
            <div className="search-results">
              {searchResults.map((r, i) => (
                <div key={i} onMouseDown={() => selectSearchResult(r)}>
                  {r.display_name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preset cities */}
        <select
          value={customCoords ? "" : city}
          onChange={(e) => {
            setCustomCoords(null);
            setCity(e.target.value);
            setSearchQuery("");
          }}
          style={{
            width: "100%", marginBottom: 16,
            background: "var(--bg-input)", border: "1px solid var(--border-subtle)",
            borderRadius: 2, color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)", fontSize: 10,
            padding: "6px 8px", outline: "none", letterSpacing: 1,
            cursor: "pointer",
          }}
        >
          {customCoords && <option value="">CUSTOM LOCATION</option>}
          {Object.entries(cities).map(([id, cfg]) => (
            <option key={id} value={id}>{cfg.name.toUpperCase()}</option>
          ))}
        </select>

        {/* Stats */}
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 3,
          color: "var(--text-tertiary)", marginBottom: 8, textTransform: "uppercase",
          borderBottom: "1px solid var(--border-subtle)", paddingBottom: 6,
        }}>ASSET TRACKING</div>

        {[
          { label: "Aircraft", value: stats.aircraft, opacity: 1 },
          { label: "Vehicles", value: stats.vehicles, opacity: 0.8 },
          { label: "Personnel", value: stats.pedestrians, opacity: 0.6 },
        ].map(({ label, value, opacity }) => (
          <div key={label} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.02)",
          }}>
            <span style={{
              fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 2,
              color: "var(--text-tertiary)", textTransform: "uppercase",
            }}>{label}</span>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600,
              color: `rgba(200,207,216,${opacity})`,
            }}>{value}</span>
          </div>
        ))}

        {stats.anomalies > 0 && (
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "5px 0", borderBottom: "1px solid rgba(160,145,122,0.1)",
          }}>
            <span style={{
              fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 2,
              color: "#a0917a",
            }}>ANOMALIES</span>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600,
              color: "#a0917a",
            }}>{stats.anomalies}</span>
          </div>
        )}

        {stats.alerts > 0 && (
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "5px 0", borderBottom: "1px solid rgba(176,112,112,0.1)",
          }}>
            <span style={{
              fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 2,
              color: "#b07070",
            }}>ALERTS</span>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600,
              color: "#b07070",
            }}>{stats.alerts}</span>
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
            color: "#c8cfd8", textShadow: "0 0 12px rgba(200,207,216,0.15)",
          }}>{stats.total}</span>
        </div>
      </div>

      {/* ── Layer control panel ───────────────────────────────── */}
      <div style={{
        position: "absolute", top: 420, left: 16,
        padding: 14, zIndex: 10, minWidth: 200,
        animation: "fade-in-up 0.8s ease-out",
        background: "var(--bg-panel)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--panel-radius)",
        backdropFilter: "blur(10px)",
      }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 3,
          color: "var(--text-tertiary)", marginBottom: 10, textTransform: "uppercase",
          borderBottom: "1px solid var(--border-subtle)", paddingBottom: 6,
        }}>LAYERS</div>

        {[
          { label: "HEAT SIGNATURE", checked: showHeatmap, setter: () => setShowHeatmap(!showHeatmap) },
          { label: "GEOFENCE ZONES", checked: showGeofences, setter: () => setShowGeofences(!showGeofences) },
          { label: "SAT IMAGERY", checked: showSatellite, setter: () => setShowSatellite(!showSatellite) },
        ].map(({ label, checked, setter }) => (
          <label key={label} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 0", cursor: "pointer",
            fontFamily: "var(--font-mono)", fontSize: 10,
            color: checked ? "var(--text-primary)" : "var(--text-tertiary)",
            letterSpacing: 1, transition: "color 0.2s",
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: 2,
              border: `1px solid ${checked ? "rgba(200,207,216,0.3)" : "rgba(200,207,216,0.1)"}`,
              background: checked ? "rgba(200,207,216,0.08)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s",
            }}>
              {checked && <div style={{ width: 6, height: 6, borderRadius: 1, background: "#c8cfd8" }} />}
            </div>
            <input type="checkbox" checked={checked} onChange={setter} style={{ display: "none" }} />
            <span>{label}</span>
          </label>
        ))}

        <button
          onClick={() => setShowAlertPanel(!showAlertPanel)}
          style={{
            width: "100%", marginTop: 10, padding: "6px 10px",
            background: alerts.length > 0 ? "rgba(176,112,112,0.08)" : "var(--bg-input)",
            border: `1px solid ${alerts.length > 0 ? "rgba(176,112,112,0.2)" : "var(--border-subtle)"}`,
            borderRadius: 2, cursor: "pointer",
            fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 2,
            color: alerts.length > 0 ? "#b07070" : "var(--text-secondary)",
            textTransform: "uppercase", transition: "all 0.2s",
          }}
        >
          THREAT FEED {alerts.length > 0 && `[${alerts.length}]`}
        </button>
      </div>

      {/* ── Replay controls — bottom-center ───────────────────── */}
      <div style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
        padding: "8px 20px", display: "flex", alignItems: "center", gap: 12, zIndex: 10,
        background: "var(--bg-panel)", border: "1px solid var(--border-subtle)",
        borderRadius: "var(--panel-radius)", backdropFilter: "blur(10px)",
      }}>
        {!replayMode ? (
          <button onClick={startReplay} style={{
            background: "transparent", border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)", fontFamily: "var(--font-display)",
            fontSize: 8, letterSpacing: 2, padding: "5px 14px", cursor: "pointer",
            borderRadius: 2, transition: "all 0.2s",
          }}>TEMPORAL REPLAY</button>
        ) : (
          <>
            <button onClick={() => replayStep(-1)} style={{
              background: "transparent", border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)", padding: "4px 10px", cursor: "pointer",
              borderRadius: 2, fontSize: 12,
            }} disabled={replayIndex <= 0}>&#9664;</button>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11, color: "#c8cfd8",
              minWidth: 80, textAlign: "center", letterSpacing: 1,
            }}>
              {replayIndex + 1} / {replaySnapshots.length}
            </span>
            <button onClick={() => replayStep(1)} style={{
              background: "transparent", border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)", padding: "4px 10px", cursor: "pointer",
              borderRadius: 2, fontSize: 12,
            }} disabled={replayIndex >= replaySnapshots.length - 1}>&#9654;</button>
            <button
              onClick={() => { setReplayMode(false); setReplaySnapshots([]); }}
              style={{
                background: "rgba(176,112,112,0.06)", border: "1px solid rgba(176,112,112,0.2)",
                color: "#b07070", fontFamily: "var(--font-display)",
                fontSize: 8, letterSpacing: 2, padding: "5px 14px", cursor: "pointer",
                borderRadius: 2,
              }}
            >
              EXIT
            </button>
          </>
        )}
      </div>

      {/* ── Weather intel — top-right ─────────────────────────── */}
      {weather && (
        <div style={{
          position: "absolute", top: 56, right: 16,
          padding: 14, zIndex: 10, minWidth: 170,
          animation: "fade-in-up 0.7s ease-out",
          background: "var(--bg-panel)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--panel-radius)", backdropFilter: "blur(10px)",
        }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 3,
            color: "var(--text-tertiary)", marginBottom: 8, textTransform: "uppercase",
            borderBottom: "1px solid var(--border-subtle)", paddingBottom: 6,
          }}>METEOROLOGICAL</div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700,
            color: "#c8cfd8", textShadow: "0 0 15px rgba(200,207,216,0.1)",
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
              { label: "WIND", value: `${weather.wind_speed?.toFixed(1) ?? "—"} m/s` },
              { label: "VIS", value: `${weather.visibility_km?.toFixed(0) ?? "—"} km` },
              { label: "CLOUD", value: `${weather.clouds_pct ?? "—"}%` },
            ].map(({ label, value }) => (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontFamily: "var(--font-mono)", fontSize: 10,
              }}>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 2,
                  color: "var(--text-tertiary)",
                }}>{label}</span>
                <span style={{ color: "#8a929e", fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Alert panel — right side ──────────────────────────── */}
      {showAlertPanel && (
        <div style={{
          position: "absolute", top: weather ? 230 : 56, right: 16,
          padding: 14, zIndex: 20,
          maxHeight: "50vh", overflowY: "auto", width: 340,
          animation: "fade-in-up 0.4s ease-out",
          background: "var(--bg-panel)",
          border: "1px solid rgba(176,112,112,0.1)",
          borderRadius: "var(--panel-radius)",
          backdropFilter: "blur(10px)",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10, paddingBottom: 8,
            borderBottom: "1px solid rgba(200,207,216,0.04)",
          }}>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 3,
              color: "var(--text-tertiary)", textTransform: "uppercase",
            }}>THREAT INTELLIGENCE</div>
            <button onClick={() => setAlerts([])} style={{
              background: "transparent", border: "1px solid var(--border-subtle)",
              color: "var(--text-tertiary)", fontFamily: "var(--font-display)",
              fontSize: 7, letterSpacing: 1, padding: "3px 8px", cursor: "pointer",
              borderRadius: 2,
            }}>PURGE</button>
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
                padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.02)",
                display: "flex", gap: 8, alignItems: "flex-start",
                animation: `data-stream 0.5s ease-out ${i * 0.05}s both`,
              }}>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: 7, letterSpacing: 1,
                  padding: "2px 6px", borderRadius: 2, flexShrink: 0,
                  background: `rgba(${alert.severity === "critical" ? "176,112,112" : alert.severity === "high" ? "160,145,122" : "138,146,158"},0.1)`,
                  border: `1px solid rgba(${alert.severity === "critical" ? "176,112,112" : alert.severity === "high" ? "160,145,122" : "138,146,158"},0.2)`,
                  color: severityColor(alert.severity),
                }}>
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

      {/* ── Spinning Globe Widget — bottom-right ──────────────── */}
      <div style={{
        position: "absolute", bottom: 80, right: 16,
        width: 130, height: 130, zIndex: 10,
        animation: "fade-in-up 1s ease-out",
        background: "var(--bg-panel)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--panel-radius)",
        backdropFilter: "blur(10px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        overflow: "hidden", padding: 8,
      }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 7, letterSpacing: 3,
          color: "var(--text-tertiary)", marginBottom: 6, textTransform: "uppercase",
        }}>ORBITAL VIEW</div>
        <div style={{
          width: 90, height: 90, borderRadius: "50%",
          position: "relative", overflow: "hidden",
          border: "1px solid rgba(200,207,216,0.12)",
          boxShadow: "0 0 20px rgba(200,207,216,0.05), inset -8px -4px 12px rgba(0,0,0,0.6)",
          background: "radial-gradient(circle at 35% 35%, #1a1c22 0%, #0c0e12 50%, #040506 100%)",
        }}>
          {/* Globe grid lines (meridians & parallels) */}
          <svg viewBox="0 0 100 100" style={{
            width: "100%", height: "100%",
            position: "absolute", top: 0, left: 0,
            animation: "spin-globe 20s linear infinite",
          }}>
            {/* Equator */}
            <ellipse cx="50" cy="50" rx="48" ry="8" fill="none" stroke="rgba(200,207,216,0.12)" strokeWidth="0.5" />
            {/* Tropics */}
            <ellipse cx="50" cy="35" rx="44" ry="6" fill="none" stroke="rgba(200,207,216,0.07)" strokeWidth="0.4" />
            <ellipse cx="50" cy="65" rx="44" ry="6" fill="none" stroke="rgba(200,207,216,0.07)" strokeWidth="0.4" />
            {/* Meridians */}
            <ellipse cx="50" cy="50" rx="12" ry="48" fill="none" stroke="rgba(200,207,216,0.1)" strokeWidth="0.4" />
            <ellipse cx="50" cy="50" rx="28" ry="48" fill="none" stroke="rgba(200,207,216,0.1)" strokeWidth="0.4" />
            <ellipse cx="50" cy="50" rx="42" ry="48" fill="none" stroke="rgba(200,207,216,0.08)" strokeWidth="0.4" />
            {/* Simplified continents — abstract landmasses */}
            <path d="M35,22 Q38,18 42,20 Q46,17 50,19 Q52,22 48,26 Q44,28 40,25 Z" fill="rgba(200,207,216,0.08)" stroke="rgba(200,207,216,0.15)" strokeWidth="0.3" />
            <path d="M55,25 Q60,22 65,24 Q68,28 66,32 Q62,35 58,33 Q54,30 55,25 Z" fill="rgba(200,207,216,0.06)" stroke="rgba(200,207,216,0.12)" strokeWidth="0.3" />
            <path d="M20,40 Q24,36 32,38 Q38,42 36,48 Q30,52 24,48 Q18,44 20,40 Z" fill="rgba(200,207,216,0.07)" stroke="rgba(200,207,216,0.13)" strokeWidth="0.3" />
            <path d="M60,42 Q68,38 75,42 Q78,48 74,54 Q68,58 62,54 Q58,48 60,42 Z" fill="rgba(200,207,216,0.08)" stroke="rgba(200,207,216,0.14)" strokeWidth="0.3" />
            <path d="M42,58 Q46,55 52,56 Q56,60 54,66 Q50,70 44,68 Q40,64 42,58 Z" fill="rgba(200,207,216,0.06)" stroke="rgba(200,207,216,0.11)" strokeWidth="0.3" />
            <path d="M70,60 Q76,56 80,60 Q82,66 78,70 Q72,72 68,68 Q66,64 70,60 Z" fill="rgba(200,207,216,0.05)" stroke="rgba(200,207,216,0.1)" strokeWidth="0.3" />
            {/* Blinking points — active monitoring sites */}
            <circle cx="38" cy="24" r="1.2" fill="#c8cfd8" opacity="0.7">
              <animate attributeName="opacity" values="0.7;0.2;0.7" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="65" cy="30" r="1" fill="#c8cfd8" opacity="0.5">
              <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="28" cy="45" r="1.2" fill="#c8cfd8" opacity="0.6">
              <animate attributeName="opacity" values="0.6;0.15;0.6" dur="1.8s" repeatCount="indefinite" />
            </circle>
            <circle cx="72" cy="48" r="1" fill="#c8cfd8" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0.1;0.4" dur="3s" repeatCount="indefinite" />
            </circle>
          </svg>
          {/* Highlight arc / shine */}
          <div style={{
            position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
            borderRadius: "50%",
            background: "radial-gradient(circle at 30% 30%, rgba(200,207,216,0.06) 0%, transparent 60%)",
            pointerEvents: "none",
          }} />
        </div>
      </div>

      {/* ── Bottom gradient fade ──────────────────────────────── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 60,
        background: "linear-gradient(0deg, rgba(4,5,6,0.6) 0%, transparent 100%)",
        pointerEvents: "none", zIndex: 5,
      }} />
    </div>
  );
}
