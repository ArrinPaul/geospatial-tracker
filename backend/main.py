from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import logging
from analysis.panoptic import run_detection_cycle
from config import DETECTION_CYCLE_INTERVAL, CITY_CONFIGS, get_city_config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

connected_clients: list[dict] = []  # Each: {"ws": WebSocket, "city": str, "lat": float|None, "lon": float|None}
_broadcast_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Modern lifespan handler — replaces deprecated on_event."""
    global _broadcast_task
    logger.info("Starting broadcast loop...")
    _broadcast_task = asyncio.create_task(broadcast_loop())
    yield
    if _broadcast_task:
        _broadcast_task.cancel()
        try:
            await _broadcast_task
        except asyncio.CancelledError:
            pass
    logger.info("Broadcast loop stopped.")


app = FastAPI(title="Geospatial Tracker", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health & Status ─────────────────────────────────────────────

@app.get("/health")
async def health():
    from analysis.gemini_client import vision_client
    from analysis.history import history_store
    return {
        "status": "ok",
        "clients": len(connected_clients),
        "vision_providers": vision_client.get_provider_status(),
        "history_stats": history_store.get_stats(),
    }


# ─── City Configuration ─────────────────────────────────────────

@app.get("/api/cities")
async def get_cities():
    """List available cities and their configs."""
    return {
        city_id: {
            "name": cfg["name"],
            "center": cfg["center"],
            "zoom": cfg["zoom"],
        }
        for city_id, cfg in CITY_CONFIGS.items()
    }


# ─── Detections ──────────────────────────────────────────────────

@app.get("/api/detections")
async def get_detections(
    city: str = Query("los_angeles"),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
):
    """REST endpoint for initial data load. Accepts city name or lat/lon."""
    try:
        geojson = await run_detection_cycle(city=city, lat=lat, lon=lon)
        return geojson
    except Exception as e:
        logger.error(f"REST detection error: {e}")
        return {"type": "FeatureCollection", "features": []}


# ─── Geofencing ──────────────────────────────────────────────────

@app.get("/api/geofences")
async def get_geofences():
    """Get all configured geofence zones."""
    from analysis.geofencing import get_geofence_zones_geojson
    return get_geofence_zones_geojson()


@app.get("/api/alerts")
async def get_alerts(limit: int = Query(50, le=200)):
    """Get recent geofence alerts."""
    from analysis.geofencing import get_alert_history
    return {"alerts": get_alert_history(limit)}


# ─── Anomalies ───────────────────────────────────────────────────

@app.get("/api/anomalies")
async def get_anomalies(limit: int = Query(50, le=200)):
    """Get recent anomaly detections."""
    from analysis.anomaly import get_anomaly_history
    return {"anomalies": get_anomaly_history(limit)}


# ─── Historical Replay ──────────────────────────────────────────

@app.get("/api/history/snapshots")
async def get_history_snapshots(
    city: str = Query("los_angeles"),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    """Get historical snapshot list (metadata only)."""
    from analysis.history import history_store
    return {"snapshots": history_store.get_snapshots(city, limit, offset)}


@app.get("/api/history/snapshot/{snapshot_id}")
async def get_history_snapshot(snapshot_id: int):
    """Get a full historical snapshot with GeoJSON data."""
    from analysis.history import history_store
    snapshot = history_store.get_snapshot_by_id(snapshot_id)
    if snapshot:
        return snapshot
    return {"error": "Snapshot not found"}


@app.get("/api/history/timeline")
async def get_history_timeline(
    city: str = Query("los_angeles"),
    hours: int = Query(24, le=48),
):
    """Get aggregated timeline data for charts."""
    from analysis.history import history_store
    return {"timeline": history_store.get_timeline(city, hours)}


# ─── Weather ─────────────────────────────────────────────────────

@app.get("/api/weather")
async def get_weather(
    city: str = Query("los_angeles"),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
):
    """Get weather data for a city or coordinates."""
    from ingestion.weather import fetch_weather
    cfg = get_city_config(city=city, lat=lat, lon=lon)
    weather = await fetch_weather(cfg["lat"], cfg["lon"])
    if weather:
        return weather
    return {"error": "Weather data unavailable (check OPENWEATHERMAP_API_KEY)"}


# ─── Satellite ───────────────────────────────────────────────────

@app.get("/api/satellite")
async def get_satellite_tile(
    city: str = Query("los_angeles"),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
):
    """Get Sentinel satellite tile URL params."""
    from config import SENTINEL_INSTANCE_ID
    cfg = get_city_config(city=city, lat=lat, lon=lon)
    if not SENTINEL_INSTANCE_ID:
        return {"error": "SENTINEL_INSTANCE_ID not configured"}
    return {
        "wms_url": f"https://services.sentinel-hub.com/ogc/wms/{SENTINEL_INSTANCE_ID}",
        "bbox": cfg["satellite_bbox"],
        "layers": "TRUE_COLOR",
        "crs": "EPSG:4326",
    }


# ─── WebSocket ───────────────────────────────────────────────────

@app.websocket("/ws/live")
async def websocket_endpoint(
    ws: WebSocket,
    city: str = Query("los_angeles"),
    lat: float | None = Query(None),
    lon: float | None = Query(None),
):
    await ws.accept()
    client = {"ws": ws, "city": city, "lat": lat, "lon": lon}
    connected_clients.append(client)
    logger.info(f"Client connected (city={city}, lat={lat}, lon={lon}). Total: {len(connected_clients)}")
    try:
        while True:
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
                # Accept city name OR lat/lon coordinates
                if "lat" in data and "lon" in data:
                    client["lat"] = float(data["lat"])
                    client["lon"] = float(data["lon"])
                    client["city"] = data.get("city", f"custom_{data['lat']:.2f}_{data['lon']:.2f}")
                    logger.info(f"Client switched to coords: {client['lat']}, {client['lon']}")
                elif "city" in data:
                    if data["city"] in CITY_CONFIGS:
                        client["city"] = data["city"]
                        client["lat"] = None
                        client["lon"] = None
                        logger.info(f"Client switched to city: {data['city']}")
                    else:
                        client["city"] = data["city"]
                        logger.info(f"Client switched to custom city: {data['city']}")
            except (json.JSONDecodeError, KeyError, ValueError):
                pass  # keep-alive ping
    except (WebSocketDisconnect, Exception):
        if client in connected_clients:
            connected_clients.remove(client)
        logger.info(f"Client disconnected. Total: {len(connected_clients)}")


async def broadcast_loop():
    """Runs on a loop — pulls data per unique location, broadcasts to matching clients."""
    while True:
        try:
            if connected_clients:
                # Group clients by unique location key
                location_groups: dict[str, list[dict]] = {}
                for client in connected_clients.copy():
                    if client.get("lat") is not None and client.get("lon") is not None:
                        key = f"coords_{client['lat']:.2f}_{client['lon']:.2f}"
                    else:
                        key = client.get("city", "los_angeles")
                    location_groups.setdefault(key, []).append(client)

                for location_key, clients in location_groups.items():
                    try:
                        sample = clients[0]
                        lat = sample.get("lat")
                        lon = sample.get("lon")
                        city = sample.get("city", "los_angeles")

                        logger.info(f"Detection cycle: {location_key} ({len(clients)} client(s))")
                        geojson = await run_detection_cycle(city=city, lat=lat, lon=lon)
                        payload = json.dumps(geojson)
                        logger.info(
                            f"Broadcasting {len(geojson.get('features', []))} "
                            f"features to {location_key}"
                        )

                        for client in clients:
                            try:
                                await client["ws"].send_text(payload)
                            except Exception:
                                if client in connected_clients:
                                    connected_clients.remove(client)
                    except Exception as e:
                        logger.error(f"Detection cycle error for {location_key}: {e}")
            else:
                logger.debug("No clients connected, skipping cycle")
        except Exception as e:
            logger.error(f"Broadcast loop error: {e}")

        await asyncio.sleep(DETECTION_CYCLE_INTERVAL)
