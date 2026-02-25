from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import logging
from analysis.panoptic import run_detection_cycle
from config import DETECTION_CYCLE_INTERVAL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

connected_clients: list[WebSocket] = []
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


app = FastAPI(title="Geospatial Tracker", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "clients": len(connected_clients)}


@app.get("/api/detections")
async def get_detections():
    """REST endpoint for initial data load (no WebSocket needed)."""
    try:
        geojson = await run_detection_cycle()
        return geojson
    except Exception as e:
        logger.error(f"REST detection error: {e}")
        return {"type": "FeatureCollection", "features": []}


@app.websocket("/ws/live")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    logger.info(f"Client connected. Total: {len(connected_clients)}")
    try:
        while True:
            await ws.receive_text()  # keep-alive
    except (WebSocketDisconnect, Exception):
        if ws in connected_clients:
            connected_clients.remove(ws)
        logger.info(f"Client disconnected. Total: {len(connected_clients)}")


async def broadcast_loop():
    """Runs on a loop — pulls data, analyzes, broadcasts GeoJSON to all clients."""
    while True:
        try:
            if connected_clients:
                logger.info(f"Running detection cycle for {len(connected_clients)} client(s)...")
                geojson = await run_detection_cycle()
                payload = json.dumps(geojson)
                logger.info(f"Broadcasting {len(geojson.get('features', []))} features")

                for client in connected_clients.copy():
                    try:
                        await client.send_text(payload)
                    except Exception:
                        connected_clients.remove(client)
            else:
                logger.debug("No clients connected, skipping cycle")
        except Exception as e:
            logger.error(f"Detection cycle error: {e}")

        await asyncio.sleep(DETECTION_CYCLE_INTERVAL)
