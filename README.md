# Geospatial Tracker

Real-time geospatial tracking dashboard that combines live aircraft data from OpenSky Network, public traffic camera feeds analyzed by Gemini AI, and satellite imagery — all displayed on an interactive Mapbox map via WebSocket streaming.

## Architecture

```
geospatial-tracker/
├── backend/
│   ├── main.py              # FastAPI app + WebSocket hub
│   ├── ingestion/
│   │   ├── opensky.py        # Live aircraft positions
│   │   ├── traffic_cams.py   # Public DOT camera feeds
│   │   └── satellite.py      # Sentinel-2 tile fetcher
│   ├── analysis/
│   │   ├── gemini_client.py  # Gemini vision API wrapper
│   │   └── panoptic.py       # Detection orchestrator
│   ├── models/
│   │   └── schemas.py        # Pydantic validation models
│   └── config.py             # API keys, polling config
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── LiveMap.tsx    # Mapbox GL JS map
│   │   │   ├── PlaneLayer.tsx
│   │   │   ├── VehicleLayer.tsx
│   │   │   └── CameraPanel.tsx
│   │   └── hooks/
│   │       └── useWebSocket.ts
│   └── package.json
├── docker-compose.yml
└── .env
```

## Prerequisites

- Python 3.12+
- Node.js 20+
- A [Mapbox](https://account.mapbox.com/) access token
- A [Google AI (Gemini)](https://ai.google.dev/) API key
- *(Optional)* Sentinel Hub instance ID for satellite imagery

## Setup

### 1. Configure environment variables

Copy and edit the `.env` file in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key
MAPBOX_TOKEN=your_mapbox_token
SENTINEL_INSTANCE_ID=your_sentinel_instance_id  # optional
```

Also copy the frontend env:

```env
# frontend/.env
VITE_MAPBOX_TOKEN=your_mapbox_token
VITE_WS_URL=ws://localhost:8000/ws/live
```

### 2. Run with Docker Compose

```bash
docker-compose up --build
```

### 3. Run manually

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

### 4. Open the app

Navigate to `http://localhost:5173` in your browser.

## Data Sources

| Source | Type | Auth | Rate Limit |
|--------|------|------|------------|
| [OpenSky Network](https://opensky-network.org/) | Aircraft positions | Free (optional auth) | 5 req/10s |
| Caltrans DOT Cameras | JPEG snapshots | Public | None |
| Sentinel Hub | Satellite tiles | Free tier | 30k req/month |

## How It Works

1. **Ingestion**: The backend polls OpenSky for aircraft data and captures frames from public traffic cameras every 10 seconds.
2. **Analysis**: Camera frames are sent to Gemini's vision model for panoptic object detection (vehicles, pedestrians, etc.).
3. **Broadcast**: All results are merged into a GeoJSON FeatureCollection and pushed to connected frontends via WebSocket.
4. **Visualization**: The React frontend renders everything on a Mapbox dark map with altitude-colored aircraft, vehicle detections, and a live HUD overlay.
