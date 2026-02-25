import httpx
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Public traffic camera feeds (JPEG snapshots)
# Mix of Caltrans and other public DOT cameras
CAMERA_FEEDS = {
    "I-405_LAX": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv316i405sar1/tv316i405sar1.jpg",
        "lat": 33.9425,
        "lon": -118.4081,
        "heading": 0,
        "fov": 90,
    },
    "I-5_Downtown_LA": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv007i005sar1/tv007i005sar1.jpg",
        "lat": 34.0522,
        "lon": -118.2437,
        "heading": 180,
        "fov": 90,
    },
    "I-10_SantaMonica": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv051i010sar1/tv051i010sar1.jpg",
        "lat": 34.0195,
        "lon": -118.4912,
        "heading": 270,
        "fov": 90,
    },
    "US-101_Hollywood": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv348us101sar1/tv348us101sar1.jpg",
        "lat": 34.1017,
        "lon": -118.3387,
        "heading": 315,
        "fov": 90,
    },
    "I-80_SF_Bay_Bridge": {
        "url": "https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv815i080sar1/tv815i080sar1.jpg",
        "lat": 37.7983,
        "lon": -122.3778,
        "heading": 90,
        "fov": 90,
    },
    "US-101_SF_Downtown": {
        "url": "https://cwwp2.dot.ca.gov/data/d4/cctv/image/tvd04us101sar1/tvd04us101sar1.jpg",
        "lat": 37.7749,
        "lon": -122.4194,
        "heading": 0,
        "fov": 90,
    },
}


def get_cameras_for_bbox(bbox: dict) -> list[str]:
    """Return camera IDs that fall within the given bounding box."""
    matching = []
    for cam_id, cam in CAMERA_FEEDS.items():
        if (bbox["lamin"] <= cam["lat"] <= bbox["lamax"] and
            bbox["lomin"] <= cam["lon"] <= bbox["lomax"]):
            matching.append(cam_id)
    return matching


async def capture_frame(camera_id: str) -> dict | None:
    """Downloads a single JPEG frame from a public traffic camera.
    Returns None if the download fails (graceful degradation)."""
    cam = CAMERA_FEEDS.get(camera_id)
    if not cam:
        logger.warning(f"Unknown camera: {camera_id}")
        return None

    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(cam["url"], headers={
                "User-Agent": "GeoTracker/3.0 (research; traffic-monitoring)",
            })
            resp.raise_for_status()

            # Verify we got actual image data (not an error page)
            content_type = resp.headers.get("content-type", "")
            if "image" not in content_type and len(resp.content) < 1000:
                logger.warning(f"Camera {camera_id}: non-image response ({content_type})")
                return None

            return {
                "camera_id": camera_id,
                "image_bytes": resp.content,
                "lat": cam["lat"],
                "lon": cam["lon"],
                "heading": cam.get("heading", 0),
                "fov": cam.get("fov", 90),
                "captured_at": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        logger.warning(f"Camera {camera_id} capture failed: {e}")
        return None


async def list_cameras() -> list[dict]:
    """Returns metadata for all configured cameras."""
    return [
        {
            "camera_id": cam_id,
            "lat": info["lat"],
            "lon": info["lon"],
            "heading": info.get("heading", 0),
        }
        for cam_id, info in CAMERA_FEEDS.items()
    ]
