import httpx
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Public traffic camera feeds (JPEG snapshots)
# Mix of DOT cameras and public webcams
CAMERA_FEEDS = {
    "I-405_LAX": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv316i405sar1/tv316i405sar1.jpg",
        "alt_urls": [
            "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv316i405sar2/tv316i405sar2.jpg",
        ],
        "lat": 33.9425,
        "lon": -118.4081,
        "heading": 0,
        "fov": 90,
    },
    "I-5_Downtown_LA": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv007i005sar1/tv007i005sar1.jpg",
        "alt_urls": [
            "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv007i005sar2/tv007i005sar2.jpg",
        ],
        "lat": 34.0522,
        "lon": -118.2437,
        "heading": 180,
        "fov": 90,
    },
    "I-10_SantaMonica": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv051i010sar1/tv051i010sar1.jpg",
        "alt_urls": [
            "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv051i010sar2/tv051i010sar2.jpg",
        ],
        "lat": 34.0195,
        "lon": -118.4912,
        "heading": 270,
        "fov": 90,
    },
    "US-101_Hollywood": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv348us101sar1/tv348us101sar1.jpg",
        "alt_urls": [
            "https://cwwp2.dot.ca.gov/data/d7/cctv/image/tv348us101sar2/tv348us101sar2.jpg",
        ],
        "lat": 34.1017,
        "lon": -118.3387,
        "heading": 315,
        "fov": 90,
    },
    "I-80_SF_Bay_Bridge": {
        "url": "https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv815i080sar1/tv815i080sar1.jpg",
        "alt_urls": [],
        "lat": 37.7983,
        "lon": -122.3778,
        "heading": 90,
        "fov": 90,
    },
    "US-101_SF_Downtown": {
        "url": "https://cwwp2.dot.ca.gov/data/d4/cctv/image/tvd04us101sar1/tvd04us101sar1.jpg",
        "alt_urls": [],
        "lat": 37.7749,
        "lon": -122.4194,
        "heading": 0,
        "fov": 90,
    },
    # NYC DOT cameras (typically more reliable)
    "NYC_Times_Square": {
        "url": "https://webcams.nyctmc.org/api/cameras/60a0a0f4-e7db-4495-beb2-7e8cbcded403/image",
        "alt_urls": [
            "https://webcams.nyctmc.org/api/cameras/53544f5a-b5ac-4261-8e84-19ff0e80dbc3/image",
        ],
        "lat": 40.758,
        "lon": -73.9855,
        "heading": 180,
        "fov": 90,
    },
    "NYC_FDR_Drive": {
        "url": "https://webcams.nyctmc.org/api/cameras/76bf3c38-8fb1-472e-a210-6b4a763c0947/image",
        "alt_urls": [],
        "lat": 40.7614,
        "lon": -73.9577,
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
    Tries primary URL first, then alternates. Returns None on failure."""
    cam = CAMERA_FEEDS.get(camera_id)
    if not cam:
        logger.warning(f"Unknown camera: {camera_id}")
        return None

    urls_to_try = [cam["url"]] + cam.get("alt_urls", [])

    for url in urls_to_try:
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True, verify=False) as client:
                resp = await client.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://cwwp2.dot.ca.gov/",
                })

                if resp.status_code >= 400:
                    logger.debug(f"Camera {camera_id} URL {url}: HTTP {resp.status_code}")
                    continue

                # Verify we got actual image data (not an error page)
                content_type = resp.headers.get("content-type", "")
                if "image" not in content_type and len(resp.content) < 1000:
                    logger.debug(f"Camera {camera_id}: non-image response ({content_type})")
                    continue

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
            logger.debug(f"Camera {camera_id} URL {url} failed: {e}")
            continue

    logger.warning(f"Camera {camera_id}: all URLs failed")
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
