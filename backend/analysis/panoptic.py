import asyncio
import logging
from ingestion.traffic_cams import capture_frame, CAMERA_FEEDS
from ingestion.opensky import fetch_aircraft
from analysis.gemini_client import analyze_frame
from analysis.geofencing import check_geofences, get_geofence_zones_geojson
from analysis.anomaly import detect_anomalies
from analysis.history import history_store
from config import CITY_CONFIGS, OPENWEATHERMAP_API_KEY

logger = logging.getLogger(__name__)


async def run_detection_cycle(city: str = "los_angeles") -> dict:
    """
    One full detection cycle:
    1. Pull aircraft data from OpenSky (structured API — no vision needed)
    2. Capture frames from all traffic cameras
    3. Send each frame to vision API for panoptic detection
    4. Run geofencing checks
    5. Run anomaly detection
    6. Fetch weather data (if API key configured)
    7. Save snapshot to history
    8. Merge all results into a single GeoJSON FeatureCollection
    """
    city_config = CITY_CONFIGS.get(city, CITY_CONFIGS["los_angeles"])
    features = []
    alerts = []
    aircraft_list = []

    # --- Aircraft data (already structured, no vision needed) ---
    try:
        aircraft_list = await fetch_aircraft(bbox=city_config["bbox"])
        for ac in aircraft_list:
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
    camera_detections_flat = []

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
                det_feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [det["estimated_lon"], det["estimated_lat"]],
                    },
                    "properties": {
                        **det,
                        "source": f"camera:{cam_id}",
                    },
                }
                features.append(det_feature)
                camera_detections_flat.append({**det, "source": f"camera:{cam_id}"})

    # --- Geofencing checks ---
    try:
        geofence_alerts = check_geofences(aircraft_list)
        alerts.extend(geofence_alerts)

        # Add geofence zones as overlay features
        zones = get_geofence_zones_geojson()
        features.extend(zones.get("features", []))
    except Exception as e:
        logger.error(f"Geofencing failed: {e}")

    # --- Anomaly detection ---
    try:
        anomalies = detect_anomalies(aircraft_list, camera_detections_flat)
        alerts.extend(anomalies)

        # Add anomaly markers as features
        for anom in anomalies:
            if anom.get("lat") and anom.get("lon"):
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [anom["lon"], anom["lat"]],
                    },
                    "properties": {
                        "category": "anomaly",
                        "anomaly_type": anom["type"],
                        "severity": anom["severity"],
                        "message": anom["message"],
                    },
                })
    except Exception as e:
        logger.error(f"Anomaly detection failed: {e}")

    # --- Weather data ---
    try:
        if OPENWEATHERMAP_API_KEY:
            from ingestion.weather import fetch_weather
            weather = await fetch_weather(city_config["lat"], city_config["lon"])
            if weather:
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [weather["lon"], weather["lat"]],
                    },
                    "properties": {
                        "category": "weather",
                        "temperature": weather["temperature_c"],
                        "wind_speed": weather["wind_speed_ms"],
                        "wind_direction": weather["wind_deg"],
                        "visibility": weather["visibility_m"],
                        "clouds": weather["clouds_pct"],
                        "condition": weather["weather_main"],
                        "description": weather["weather_desc"],
                    },
                })
    except Exception as e:
        logger.error(f"Weather fetch failed: {e}")

    geojson = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "city": city,
            "city_name": city_config["name"],
            "alert_count": len(alerts),
        },
    }

    # --- Save to history ---
    try:
        history_store.save_snapshot(geojson, city=city, alerts=alerts)
    except Exception as e:
        logger.error(f"History save failed: {e}")

    return geojson
