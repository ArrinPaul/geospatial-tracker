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
      className="panel"
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        minWidth: 220,
        overflow: "hidden",
        zIndex: 10,
        animation: "fade-in-up 0.9s ease-out",
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
            width: 6, height: 6, borderRadius: 1,
            background: "var(--accent-primary)",
            boxShadow: "0 0 8px var(--accent-primary-glow)",
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
                borderBottom: "1px solid rgba(255,255,255,0.03)",
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
                  width: 5, height: 5, borderRadius: "50%",
                  background: "#39ff14",
                  boxShadow: "0 0 6px rgba(57,255,20,0.6)",
                  animation: "indicator-pulse 1.5s ease-in-out infinite",
                  display: "inline-block",
                }} />
                <span style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 8,
                  letterSpacing: 1.5,
                  color: "#39ff14",
                }}>
                  LIVE
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
