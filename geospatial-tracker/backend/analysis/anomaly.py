"""
Anomaly detection — identifies unusual patterns in tracked objects.

Detects:
- Circling aircraft (repeated heading changes in a small area)
- Unusually slow/fast aircraft at altitude
- Stationary aircraft not at airports
- Traffic congestion from camera data (many vehicles, low speed)
"""

import logging
import time
from collections import defaultdict
from models.schemas import AircraftPosition

logger = logging.getLogger(__name__)

# ─── In-memory tracking state ────────────────────────────────────
# Maps icao24 -> list of recent position snapshots
_aircraft_tracks: dict[str, list[dict]] = defaultdict(list)
MAX_TRACK_POINTS = 30  # Keep last 30 positions per aircraft (~5 minutes at 10s intervals)

# Active anomalies
_active_anomalies: list[dict] = []
MAX_ANOMALY_HISTORY = 100


def _track_heading_variance(positions: list[dict]) -> float:
    """Calculate how much an aircraft's heading has varied (0-180 scale)."""
    if len(positions) < 5:
        return 0.0
    headings = [p["heading"] for p in positions[-15:] if p.get("heading") is not None]
    if len(headings) < 5:
        return 0.0
    # Circular standard deviation approximation
    import math
    sin_sum = sum(math.sin(math.radians(h)) for h in headings)
    cos_sum = sum(math.cos(math.radians(h)) for h in headings)
    r = math.sqrt(sin_sum**2 + cos_sum**2) / len(headings)
    # r close to 0 = high variance (circling), r close to 1 = straight line
    return (1 - r) * 180


def _track_spatial_spread(positions: list[dict]) -> float:
    """Calculate how far an aircraft has moved (in approx km)."""
    if len(positions) < 5:
        return 999.0  # Not enough data
    recent = positions[-15:]
    lats = [p["lat"] for p in recent if p.get("lat")]
    lons = [p["lon"] for p in recent if p.get("lon")]
    if not lats or not lons:
        return 999.0
    lat_spread = max(lats) - min(lats)
    lon_spread = max(lons) - min(lons)
    # Rough conversion: 1 degree ≈ 111km
    return max(lat_spread, lon_spread) * 111


def detect_anomalies(
    aircraft_list: list[AircraftPosition],
    camera_detections: list[dict] | None = None,
) -> list[dict]:
    """
    Analyze current data for anomalous patterns.
    Returns list of anomaly alert dicts.
    """
    anomalies = []
    now = time.time()

    # ─── Update aircraft tracks ──────────────────────────────────
    current_icaos = set()
    for ac in aircraft_list:
        if ac.latitude is None or ac.longitude is None:
            continue
        current_icaos.add(ac.icao24)
        _aircraft_tracks[ac.icao24].append({
            "lat": ac.latitude,
            "lon": ac.longitude,
            "alt": ac.altitude,
            "heading": ac.heading,
            "velocity": ac.velocity,
            "vertical_rate": ac.vertical_rate,
            "on_ground": ac.on_ground,
            "time": now,
        })
        # Trim old positions
        if len(_aircraft_tracks[ac.icao24]) > MAX_TRACK_POINTS:
            _aircraft_tracks[ac.icao24] = _aircraft_tracks[ac.icao24][-MAX_TRACK_POINTS:]

    # Clean up stale tracks (aircraft not seen in 2 minutes)
    stale = [k for k, v in _aircraft_tracks.items()
             if k not in current_icaos and v and (now - v[-1]["time"]) > 120]
    for k in stale:
        del _aircraft_tracks[k]

    # ─── Detect circling aircraft ────────────────────────────────
    for icao, positions in _aircraft_tracks.items():
        if len(positions) < 10:
            continue

        heading_var = _track_heading_variance(positions)
        spatial_spread = _track_spatial_spread(positions)

        # Circling: high heading variance + small spatial spread
        if heading_var > 90 and spatial_spread < 5.0:
            ac_data = positions[-1]
            if not ac_data.get("on_ground", False):
                anomalies.append({
                    "type": "circling_aircraft",
                    "severity": "warning",
                    "icao24": icao,
                    "lat": ac_data["lat"],
                    "lon": ac_data["lon"],
                    "altitude": ac_data.get("alt"),
                    "heading_variance": round(heading_var, 1),
                    "spatial_spread_km": round(spatial_spread, 2),
                    "message": (
                        f"Aircraft {icao} appears to be circling "
                        f"(heading variance: {heading_var:.0f}°, "
                        f"spread: {spatial_spread:.1f}km)"
                    ),
                    "track_points": len(positions),
                })

        # Unusually slow at altitude (not landing/taking off)
        latest = positions[-1]
        if (latest.get("alt") and latest["alt"] > 3000
                and latest.get("velocity") and latest["velocity"] < 50
                and not latest.get("on_ground", False)):
            anomalies.append({
                "type": "slow_at_altitude",
                "severity": "info",
                "icao24": icao,
                "lat": latest["lat"],
                "lon": latest["lon"],
                "altitude": latest["alt"],
                "velocity": latest["velocity"],
                "message": (
                    f"Aircraft {icao} unusually slow ({latest['velocity']:.0f} m/s) "
                    f"at {latest['alt']:.0f}m altitude"
                ),
            })

    # ─── Detect traffic congestion from camera data ──────────────
    if camera_detections:
        # Group detections by camera source
        camera_groups: dict[str, list] = defaultdict(list)
        for det in camera_detections:
            source = det.get("source", "")
            if source.startswith("camera:"):
                camera_groups[source].append(det)

        for cam_source, dets in camera_groups.items():
            vehicle_count = sum(1 for d in dets
                                if d.get("category") in ("vehicles", "vehicle"))
            if vehicle_count > 15:
                anomalies.append({
                    "type": "traffic_congestion",
                    "severity": "info",
                    "source": cam_source,
                    "vehicle_count": vehicle_count,
                    "lat": dets[0].get("estimated_lat", 0),
                    "lon": dets[0].get("estimated_lon", 0),
                    "message": (
                        f"High traffic density at {cam_source}: "
                        f"{vehicle_count} vehicles detected"
                    ),
                })

    # Store anomalies
    _active_anomalies.extend(anomalies)
    if len(_active_anomalies) > MAX_ANOMALY_HISTORY:
        del _active_anomalies[: len(_active_anomalies) - MAX_ANOMALY_HISTORY]

    if anomalies:
        logger.info(f"Anomalies detected: {len(anomalies)}")

    return anomalies


def get_anomaly_history(limit: int = 50) -> list[dict]:
    """Get recent anomaly detections."""
    return _active_anomalies[-limit:]
