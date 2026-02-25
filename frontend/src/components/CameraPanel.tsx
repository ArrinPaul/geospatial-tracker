import { useState } from "react";

interface Camera {
  id: string;
  label: string;
  lat: number;
  lon: number;
}

const CAMERAS: Camera[] = [
  { id: "I-405_LAX", label: "I-405 @ LAX", lat: 33.9425, lon: -118.4081 },
  { id: "I-5_Downtown_LA", label: "I-5 Downtown LA", lat: 34.0522, lon: -118.2437 },
  { id: "I-10_SantaMonica", label: "I-10 Santa Monica", lat: 34.0195, lon: -118.4912 },
  { id: "US-101_Hollywood", label: "US-101 Hollywood", lat: 34.1017, lon: -118.3387 },
  { id: "I-80_SF_Bay_Bridge", label: "I-80 Bay Bridge", lat: 37.7983, lon: -122.3778 },
  { id: "US-101_SF_Downtown", label: "US-101 SF Downtown", lat: 37.7749, lon: -122.4194 },
];

export default function CameraPanel() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        minWidth: 220,
        overflow: "hidden",
        zIndex: 10,
        animation: "fade-in-up 0.9s ease-out",
        background: "var(--bg-panel)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--panel-radius)",
        backdropFilter: "blur(10px)",
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
          borderBottom: expanded ? "1px solid var(--border-subtle)" : "none",
          transition: "background 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-primary-dim)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <span style={{
          fontFamily: "var(--font-display)",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 3,
          color: "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: 1,
            background: "#808890",
            display: "inline-block",
          }} />
          ISR FEEDS
        </span>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-tertiary)",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 0.3s ease",
          display: "inline-block",
        }}>
          &#9654;
        </span>
      </div>

      {expanded && (
        <div style={{ padding: "8px 16px 12px" }}>
          {CAMERAS.map((cam, i) => (
            <div
              key={cam.id}
              style={{
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.02)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                animation: `data-stream 0.4s ease-out ${i * 0.08}s both`,
              }}
            >
              <div>
                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-primary)",
                  marginBottom: 2,
                }}>
                  {cam.label}
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: "var(--text-tertiary)",
                  letterSpacing: 0.5,
                }}>
                  {cam.lat.toFixed(4)}, {cam.lon.toFixed(4)}
                </div>
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 4,
              }}>
                <span style={{
                  width: 4, height: 4, borderRadius: "50%",
                  background: "#808890",
                  boxShadow: "0 0 4px rgba(128,136,144,0.3)",
                  animation: "indicator-pulse 2s ease-in-out infinite",
                  display: "inline-block",
                }} />
                <span style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 8,
                  letterSpacing: 1.5,
                  color: "#6a7380",
                }}>
                  ACTIVE
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
