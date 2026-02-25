import { useState } from "react";

interface Camera {
  id: string;
  label: string;
  lat: number;
  lon: number;
}

const CAMERAS: Camera[] = [
  { id: "I-405_LAX", label: "I-405 @ LAX", lat: 33.9425, lon: -118.4081 },
  { id: "I-5_Downtown", label: "I-5 Downtown", lat: 34.0522, lon: -118.2437 },
  { id: "I-10_SantaMonica", label: "I-10 Santa Monica", lat: 34.0195, lon: -118.4912 },
  { id: "US-101_Hollywood", label: "US-101 Hollywood", lat: 34.1017, lon: -118.3387 },
];

export default function CameraPanel() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        background: "rgba(0, 0, 0, 0.85)",
        color: "#ccc",
        borderRadius: 10,
        fontFamily: "'Courier New', monospace",
        fontSize: 12,
        border: "1px solid rgba(0, 255, 0, 0.2)",
        backdropFilter: "blur(10px)",
        minWidth: 220,
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "10px 16px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: expanded ? "1px solid rgba(0,255,0,0.15)" : "none",
        }}
      >
        <span style={{ color: "#0f0", letterSpacing: 1 }}>📷 CAMERAS</span>
        <span style={{ fontSize: 10 }}>{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "8px 16px 12px" }}>
          {CAMERAS.map((cam) => (
            <div
              key={cam.id}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{cam.label}</span>
              <span style={{ color: "#0f0", fontSize: 10 }}>● LIVE</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
