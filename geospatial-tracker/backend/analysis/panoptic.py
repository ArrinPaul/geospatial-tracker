import asyncio
import logging
from ingestion.traffic_cams import capture_frame, CAMERA_FEEDS
from ingestion.opensky import fetch_aircraft
from analysis.gemini_client import analyze_frame

logger = logging.getLogger(__name__)


async def run_detection_cycle() -> dict:
    """
    One full detection cycle:
    1. Pull aircraft data from OpenSky (structured API — no vision needed)
    2. Capture frames from all traffic cameras
    3. Send each frame to Gemini for panoptic detection
    4. Merge all results into a single GeoJSON FeatureCollection
    """
    features = []

    # --- Aircraft data (already structured, no Gemini needed) ---
    try:
        aircraft = await fetch_aircraft()
        for ac in aircraft:
            if ac.latitude and ac.longitude:
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [ac.longitude, ac.latitude],
                    },
                    "properties": {
                        "category": "aircraft",
                        "callsign": ac.callsign,
                        "altitude": ac.altitude,
                        "velocity": ac.velocity,
                        "heading": ac.heading,
                        "vertical_rate": ac.vertical_rate,
                        "on_ground": ac.on_ground,
                        "origin_country": ac.origin_country,
                        "source": "opensky",
                    },
                })
    except Exception as e:
        logger.error(f"Aircraft fetch failed: {e}")

    # --- Traffic camera analysis via vision API (parallelized) ---
    async def capture_and_analyze(cam_id: str) -> tuple[str, list[dict]]:
        """Capture a frame and analyze it in one async task."""
        frame = await capture_frame(cam_id)
        detections = await analyze_frame(
            image_bytes=frame["image_bytes"],
            camera_lat=frame["lat"],
            camera_lon=frame["lon"],
            camera_heading=frame.get("heading", 0),
            fov_degrees=frame.get("fov", 90),
        )
        return cam_id, detections

    camera_tasks = [
        capture_and_analyze(cam_id) for cam_id in CAMERA_FEEDS.keys()
    ]

    if camera_tasks:
        results = await asyncio.gather(*camera_tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Camera pipeline failed: {result}")
                continue
            cam_id, detections = result
            for det in detections:
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [det["estimated_lon"], det["estimated_lat"]],
                    },
                    "properties": {
                        **det,
                        "source": f"camera:{cam_id}",
                    },
                })

    return {"type": "FeatureCollection", "features": features}
