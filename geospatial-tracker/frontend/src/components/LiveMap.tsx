import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useWebSocket } from "../hooks/useWebSocket";
import CameraPanel from "./CameraPanel";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws/live";

interface Stats {
  aircraft: number;
  vehicles: number;
  pedestrians: number;
  total: number;
}

export default function LiveMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [stats, setStats] = useState<Stats>({ aircraft: 0, vehicles: 0, pedestrians: 0, total: 0 });

  const handleMessage = useCallback((geojson: any) => {
    const source = map.current?.getSource("detections") as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(geojson);
    }

    const features = geojson.features || [];
    setStats({
      aircraft: features.filter((f: any) => f.properties.category === "aircraft").length,
      vehicles: features.filter((f: any) => f.properties.category === "vehicles").length,
      pedestrians: features.filter((f: any) => f.properties.category === "pedestrians").length,
      total: features.length,
    });
  }, []);

  const { connected, lastUpdate } = useWebSocket({
    url: WS_URL,
    onMessage: handleMessage,
  });

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-118.25, 34.05], // Los Angeles
      zoom: 10,
      pitch: 45,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.current.on("load", () => {
      // Add empty GeoJSON source — updated via WebSocket
      map.current!.addSource("detections", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Aircraft layer — colored by altitude
      map.current!.addLayer({
        id: "aircraft-layer",
        type: "circle",
        source: "detections",
        filter: ["==", ["get", "category"], "aircraft"],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            8, 5,
            14, 12,
          ],
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

      // Vehicle layer — camera detections
      map.current!.addLayer({
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

      // Pedestrian layer
      map.current!.addLayer({
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

      // Popups on click
      for (const layerId of ["aircraft-layer", "vehicle-layer", "pedestrian-layer"]) {
        map.current!.on("click", layerId, (e) => {
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
            .addTo(map.current!);
        });

        map.current!.on("mouseenter", layerId, () => {
          map.current!.getCanvas().style.cursor = "pointer";
        });
        map.current!.on("mouseleave", layerId, () => {
          map.current!.getCanvas().style.cursor = "";
        });
      }

      setMapLoaded(true);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

      {/* HUD overlay */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          background: "rgba(0, 0, 0, 0.85)",
          color: "#0f0",
          padding: "16px 24px",
          borderRadius: 10,
          fontFamily: "'Courier New', monospace",
          fontSize: 14,
          border: "1px solid rgba(0, 255, 0, 0.3)",
          backdropFilter: "blur(10px)",
          minWidth: 260,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, letterSpacing: 2 }}>
          GEOSPATIAL TRACKER v1.0
        </div>
        <div style={{ marginBottom: 4 }}>✈ AIRCRAFT: {stats.aircraft}</div>
        <div style={{ marginBottom: 4, color: "#00d4ff" }}>🚗 VEHICLES: {stats.vehicles}</div>
        <div style={{ marginBottom: 4, color: "#ffee00" }}>🚶 PEDESTRIANS: {stats.pedestrians}</div>
        <div style={{ borderTop: "1px solid rgba(0,255,0,0.2)", paddingTop: 8, marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "#888" }}>
            TOTAL FEATURES: {stats.total}
          </div>
          <div
            style={{
              fontSize: 10,
              marginTop: 4,
              color: connected ? "#0f0" : "#f44",
            }}
          >
            {connected ? "● LIVE" : "○ DISCONNECTED"} • {lastUpdate ? `${lastUpdate.toLocaleTimeString()}` : "Waiting..."}
          </div>
        </div>
      </div>

      {/* Camera panel */}
      <CameraPanel />
    </div>
  );
}
