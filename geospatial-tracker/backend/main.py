from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import logging
from analysis.panoptic import run_detection_cycle
from config import DETECTION_CYCLE_INTERVAL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Geospatial Tracker", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

connected_clients: list[WebSocket] = []


@app.get("/health")
async def health():
    return {"status": "ok", "clients": len(connected_clients)}


@app.websocket("/ws/live")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    logger.info(f"Client connected. Total: {len(connected_clients)}")
    try:
        while True:
            await ws.receive_text()  # keep-alive
    except WebSocketDisconnect:
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


@app.on_event("startup")
async def startup():
    logger.info("Starting broadcast loop...")
    asyncio.create_task(broadcast_loop())
