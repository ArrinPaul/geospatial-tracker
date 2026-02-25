# Geospatial Tracker — Feature Documentation

## Overview

This document covers all features: what's implemented, what's possible with additional work, and what's not feasible within the current architecture.

---

## ✅ Implemented Features

### 1. Heatmap Visualization
| Status | **IMPLEMENTED** |
|--------|-----------------|
| Layer | Mapbox GL JS built-in `heatmap` layer type |
| Toggle | Checkbox in LAYERS panel (top-left) |
| Colors | Green → Cyan → Yellow → Orange → Red (density gradient) |
| Data | Uses same GeoJSON detection source — weights by `confidence` property |
| Notes | Toggles point layers off when heatmap is active |

### 2. Geofencing Alerts
| Status | **IMPLEMENTED** |
|--------|-----------------|
| Backend | `backend/analysis/geofencing.py` |
| Zones | LAX TFR (critical), Downtown LA No-Fly (high), Hollywood Watch (warning), JFK TFR (critical), SF Golden Gate (warning) |
| Algorithm | Haversine distance calculation from zone center |
| Frontend | Geofence zones rendered as fill+outline layers with dashed borders, color-coded by severity |
| Alerts | Real-time alerts shown in the Alert Panel (right side), severity indicators |
| API | `GET /api/geofences` (zone definitions), `GET /api/alerts` (recent alerts) |
| Notes | Easily extensible — add zones in `GEOFENCE_ZONES` list |

### 3. Historical Replay
| Status | **IMPLEMENTED** |
|--------|-----------------|
| Storage | SQLite database at `backend/data/history.db` (zero-config, no external DB) |
| Retention | Auto-cleanup after 48 hours |
| Frontend | Replay controls at bottom-center: ⏮ REPLAY → ◀ ▶ step through → ⏹ LIVE to return |
| API | `GET /api/history/snapshots` (list), `GET /api/history/snapshot/{id}` (full data), `GET /api/history/timeline` (aggregated) |
| Notes | Each detection cycle saves a snapshot automatically; timeline endpoint useful for charts |

### 4. Multi-City Support
| Status | **IMPLEMENTED** |
|--------|-----------------|
| Cities | Los Angeles, New York, San Francisco, Chicago |
| Config | `CITY_CONFIGS` in `backend/config.py` with center, zoom, bbox, satellite_bbox |
| Frontend | City selector dropdown in HUD panel; map flies to selected city |
| WebSocket | Accepts `city` query param on connect; supports runtime city switching via JSON message |
| Backend | Detection cycle runs per-city with correct bbox for aircraft data |
| API | `GET /api/cities` returns available cities |
| Notes | Adding cities: just add to `CITY_CONFIGS` dict, no code changes needed |

### 5. Weather Overlay
| Status | **IMPLEMENTED** |
|--------|-----------------|
| Provider | OpenWeatherMap (FREE: 1,000 calls/day) |
| Data | Temperature, description, wind speed/direction, visibility, cloud coverage |
| Frontend | Weather widget (top-right) showing current conditions for selected city |
| API | `GET /api/weather?city=los_angeles` |
| Config | Set `OPENWEATHERMAP_API_KEY` in `.env` (optional — graceful fallback if missing) |
| Notes | Updates on city change; uses city center coordinates |

### 6. Anomaly Detection
| Status | **IMPLEMENTED** |
|--------|-----------------|
| Backend | `backend/analysis/anomaly.py` |
| Patterns | **Circling aircraft** (heading variance > 90° + spatial spread < 5km), **Slow at altitude** (< 50 m/s above 3000m), **Traffic congestion** (> 15 vehicles from single camera) |
| Tracking | In-memory position history per aircraft (last 30 positions) |
| Frontend | Anomaly count in HUD, anomaly alerts in Alert Panel with severity colors |
| API | `GET /api/anomalies` returns recent anomaly detections |
| Notes | Stale aircraft tracks auto-cleaned after 2 minutes of inactivity |

### 7. Mobile Responsive
| Status | **IMPLEMENTED** |
|--------|-----------------|
| File | `frontend/src/index.css` |
| Breakpoints | 768px (tablet), 480px (phone) |
| Behavior | HUD panel stretches full-width on mobile; layer toggles / weather / alerts reposition to bottom; font sizes reduce; panels stack without overlap |
| Notes | Touch-friendly; Mapbox GL JS handles pinch-to-zoom natively |

### 8. Satellite Tile Overlay
| Status | **IMPLEMENTED** |
|--------|-----------------|
| Provider | ArcGIS World Imagery (FREE, no API key needed) |
| Frontend | Checkbox toggle in LAYERS panel |
| Behavior | Renders satellite imagery at 70% opacity beneath data layers |
| Backend | `GET /api/satellite` endpoint also available for Sentinel Hub WMS tiles (requires `SENTINEL_INSTANCE_ID`) |
| Notes | ArcGIS fallback always works; Sentinel Hub offers higher-res temporal imagery if configured |

---

## ⚠️ Possible but Not Implemented (Needs Additional Work)

### 9. Ship/Marine Tracking
| Status | **NOT IMPLEMENTED** — feasible with paid API |
|--------|------------------------------------------------|
| Why Not | No free, real-time AIS (ship tracking) API exists with sufficient coverage |
| Options | **MarineTraffic API** ($$$, enterprise pricing), **AISHub** (free but limited, requires contributing your own AIS receiver data), **VesselFinder API** (paid) |
| Effort | Medium — similar architecture to aircraft tracking (fetch positions → GeoJSON → map layer) |
| What's Needed | 1) AIS data provider API key, 2) `backend/ingestion/marine.py` fetch module, 3) Ship icon layer in frontend |
| Free Alternative | **AISHub** — free community AIS sharing network, but requires running your own AIS radio receiver to participate |
| Recommendation | Implement if a budget for MarineTraffic API is available ($50–500/month depending on coverage area) |

### 10. User Authentication
| Status | **NOT IMPLEMENTED** — feasible with additional infrastructure |
|--------|---------------------------------------------------------------|
| Why Not | Requires session store / database for user accounts, adds deployment complexity |
| Options | **JWT + SQLite** (simplest), **OAuth2 via Google/GitHub** (no password management), **Clerk/Auth0** (managed, free tier) |
| Effort | Medium-High — needs login/register UI, protected routes, token middleware |
| What's Needed | 1) `backend/auth/` module with JWT creation/validation, 2) User table in SQLite, 3) `@require_auth` decorator for endpoints, 4) Login page component, 5) Token storage in frontend |
| Recommendation | Use **Clerk** or **Auth0** free tier for quickest path — both offer React SDK + API middleware with zero password storage |

---

## 📊 Feature Matrix

| # | Feature | Backend | Frontend | API | Free? | Status |
|---|---------|---------|----------|-----|-------|--------|
| 1 | Heatmap | ✅ data | ✅ layer | — | ✅ | ✅ Done |
| 2 | Geofencing | ✅ engine | ✅ zones + alerts | ✅ 2 endpoints | ✅ | ✅ Done |
| 3 | Historical Replay | ✅ SQLite | ✅ controls | ✅ 3 endpoints | ✅ | ✅ Done |
| 4 | Multi-City | ✅ config | ✅ selector | ✅ 1 endpoint | ✅ | ✅ Done |
| 5 | Weather Overlay | ✅ fetch | ✅ widget | ✅ 1 endpoint | ✅ | ✅ Done |
| 6 | Anomaly Detection | ✅ engine | ✅ alerts | ✅ 1 endpoint | ✅ | ✅ Done |
| 7 | Mobile Responsive | — | ✅ CSS | — | ✅ | ✅ Done |
| 8 | Satellite Tiles | ✅ WMS | ✅ toggle | ✅ 1 endpoint | ✅ | ✅ Done |
| 9 | Ship Tracking | ❌ | ❌ | ❌ | ❌ Paid | ⚠️ Needs API |
| 10 | User Auth | ❌ | ❌ | ❌ | ✅ Possible | ⚠️ Needs work |

---

## 🔌 API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | System status + provider health |
| GET | `/api/cities` | List available cities |
| GET | `/api/detections?city=X` | REST detection data |
| GET | `/api/geofences` | Geofence zone definitions |
| GET | `/api/alerts?limit=50` | Recent geofence alerts |
| GET | `/api/anomalies?limit=50` | Recent anomaly detections |
| GET | `/api/weather?city=X` | Current weather for city |
| GET | `/api/history/snapshots?city=X` | Historical snapshot list |
| GET | `/api/history/snapshot/{id}` | Full snapshot with GeoJSON |
| GET | `/api/history/timeline?city=X` | Aggregated timeline data |
| GET | `/api/satellite?city=X` | Sentinel satellite tile params |
| WS | `/ws/live?city=X` | Live WebSocket feed |

---

## 🏗 Architecture

```
Frontend (React + Vite + Mapbox GL JS)
  ├── LiveMap.tsx — Main map with all layers, HUD, toggles, replay
  ├── CameraPanel.tsx — Camera status display
  ├── useWebSocket.ts — Auto-reconnecting WS hook with city support
  └── index.css — Mobile responsive styles

Backend (FastAPI + Python 3.12)
  ├── main.py — REST + WebSocket endpoints, broadcast loop
  ├── config.py — Env vars, city configs, provider definitions
  ├── analysis/
  │   ├── panoptic.py — Detection orchestrator (ties everything together)
  │   ├── gemini_client.py — Multi-provider vision fallback (Groq→Together→Gemini→OpenAI)
  │   ├── geofencing.py — Geofence zone engine + alerts
  │   ├── anomaly.py — Pattern anomaly detection
  │   └── history.py — SQLite snapshot store
  ├── ingestion/
  │   ├── opensky.py — Aircraft position fetcher
  │   ├── traffic_cams.py — DOT camera JPEG capture
  │   ├── satellite.py — Sentinel-2 WMS tile fetcher
  │   └── weather.py — OpenWeatherMap integration
  └── models/
      └── schemas.py — Pydantic models

Data Flow:
  OpenSky API ──┐
  Traffic Cams ──┼── panoptic.py ──► GeoJSON + metadata
  Weather API ──┘       │
                  ┌─────┴─────┐
                  │ geofencing │ anomaly │ history
                  └─────┬─────┘
                        ▼
                  WebSocket broadcast ──► React LiveMap
```

---

## 💰 Cost Summary

| Service | Cost | Usage |
|---------|------|-------|
| Groq API | FREE | Primary vision provider (30 RPM) |
| Together AI | FREE | Fallback #2 (60 RPM) |
| Gemini 2.0 Flash | FREE | Fallback #3 (15 RPM) |
| OpenAI gpt-4o-mini | ~$0.15-0.60/M tokens | Last resort (disabled by default) |
| Mapbox | FREE | 50,000 map loads/month |
| OpenSky Network | FREE | Aircraft positions (no auth needed) |
| OpenWeatherMap | FREE | 1,000 calls/day |
| ArcGIS Imagery | FREE | Satellite tile basemap |
| SQLite | FREE | Built into Python stdlib |
| Sentinel Hub | FREE tier | 30,000 tiles/month (optional) |

**Total cost to run: $0/month** (unless OpenAI fallback is triggered)
