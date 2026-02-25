"""
Geofencing engine — detects when aircraft enter restricted/watched zones.
Runs as part of each detection cycle to flag alerts in real-time.
"""

import logging
import math
from datetime import datetime, timezone
from models.schemas import AircraftPosition

logger = logging.getLogger(__name__)

# ─── Restricted / Watched Zones ──────────────────────────────────
# Each zone: name, center (lat, lon), radius_km, type, min_altitude_m
GEOFENCE_ZONES = [
    {
        "name": "LAX Airport TFR",
        "lat": 33.9425,
        "lon": -118.4081,
        "radius_km": 5.0,
        "type": "airport_tfr",
        "max_altitude_m": 1500,  # flag if below this altitude
        "description": "Temporary Flight Restriction around LAX",
    },
    {
        "name": "Downtown LA No-Fly",
        "lat": 34.0522,
        "lon": -118.2437,
        "radius_km": 3.0,
        "type": "restricted",
        "max_altitude_m": None,
        "description": "Downtown Los Angeles restricted airspace",
    },
    {
        "name": "Hollywood Sign Watch",
        "lat": 34.1341,
        "lon": -118.3215,
        "radius_km": 2.0,
        "type": "watch_zone",
        "max_altitude_m": 500,
        "description": "Tourist helicopter watch zone",
    },
    {
        "name": "NYC JFK TFR",
        "lat": 40.6413,
        "lon": -73.7781,
        "radius_km": 8.0,
        "type": "airport_tfr",
        "max_altitude_m": 2000,
        "description": "JFK International Airport TFR",
    },
    {
        "name": "SF Golden Gate Watch",
        "lat": 37.8199,
        "lon": -122.4783,
        "radius_km": 2.0,
        "type": "watch_zone",
        "max_altitude_m": 500,
        "description": "Golden Gate Bridge watch zone",
    },
]

# In-memory alert log (last N alerts)
_alert_history: list[dict] = []
MAX_ALERT_HISTORY = 200


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def check_geofences(aircraft_list: list[AircraftPosition]) -> list[dict]:
    """
    Check all aircraft against all geofence zones.
    Returns a list of alert dicts for any violations.
    """
    alerts = []
    now = datetime.now(timezone.utc).isoformat()

    for ac in aircraft_list:
        if ac.latitude is None or ac.longitude is None:
            continue

        for zone in GEOFENCE_ZONES:
            dist = _haversine_km(ac.latitude, ac.longitude, zone["lat"], zone["lon"])

            if dist <= zone["radius_km"]:
                # Check altitude condition
                altitude_violation = False
                if zone["max_altitude_m"] is not None and ac.altitude is not None:
                    altitude_violation = ac.altitude <= zone["max_altitude_m"]

                severity = "warning"
                if zone["type"] == "restricted":
                    severity = "critical"
                elif zone["type"] == "airport_tfr" and altitude_violation:
                    severity = "high"

                alert = {
                    "type": "geofence_alert",
                    "severity": severity,
                    "zone_name": zone["name"],
                    "zone_type": zone["type"],
                    "aircraft_callsign": ac.callsign or ac.icao24,
                    "aircraft_icao24": ac.icao24,
                    "aircraft_lat": ac.latitude,
                    "aircraft_lon": ac.longitude,
                    "aircraft_altitude": ac.altitude,
                    "distance_km": round(dist, 2),
                    "altitude_violation": altitude_violation,
                    "timestamp": now,
                    "message": (
                        f"Aircraft {ac.callsign or ac.icao24} entered "
                        f"{zone['name']} (dist: {dist:.1f}km"
                        f"{', LOW ALT' if altitude_violation else ''})"
                    ),
                }
                alerts.append(alert)

    # Store in history
    _alert_history.extend(alerts)
    if len(_alert_history) > MAX_ALERT_HISTORY:
        del _alert_history[: len(_alert_history) - MAX_ALERT_HISTORY]

    if alerts:
        logger.warning(f"Geofence alerts: {len(alerts)} violations detected")

    return alerts


def get_alert_history(limit: int = 50) -> list[dict]:
    """Get recent geofence alerts."""
    return _alert_history[-limit:]


def get_geofence_zones_geojson() -> dict:
    """Return geofence zones as GeoJSON for map overlay."""
    features = []
    for zone in GEOFENCE_ZONES:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [zone["lon"], zone["lat"]],
            },
            "properties": {
                "name": zone["name"],
                "type": zone["type"],
                "radius_km": zone["radius_km"],
                "max_altitude_m": zone["max_altitude_m"],
                "description": zone["description"],
                "category": "geofence_zone",
            },
        })
    return {"type": "FeatureCollection", "features": features}
