import httpx
from datetime import datetime, timezone

# Public Caltrans traffic camera feeds (JPEG snapshots)
# These are real public endpoints from California DOT
CAMERA_FEEDS = {
    "I-405_LAX": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/i405-lax/i405-lax.jpg",
        "lat": 33.9425,
        "lon": -118.4081,
        "heading": 0,
        "fov": 90,
    },
    "I-5_Downtown": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/i5-downtown/i5-downtown.jpg",
        "lat": 34.0522,
        "lon": -118.2437,
        "heading": 180,
        "fov": 90,
    },
    "I-10_SantaMonica": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/i10-santamonica/i10-santamonica.jpg",
        "lat": 34.0195,
        "lon": -118.4912,
        "heading": 270,
        "fov": 90,
    },
    "US-101_Hollywood": {
        "url": "https://cwwp2.dot.ca.gov/data/d7/cctv/image/us101-hollywood/us101-hollywood.jpg",
        "lat": 34.1017,
        "lon": -118.3387,
        "heading": 315,
        "fov": 90,
    },
}


async def capture_frame(camera_id: str) -> dict:
    """Downloads a single JPEG frame from a public traffic camera."""
    cam = CAMERA_FEEDS[camera_id]
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(cam["url"])
        resp.raise_for_status()
        return {
            "camera_id": camera_id,
            "image_bytes": resp.content,
            "lat": cam["lat"],
            "lon": cam["lon"],
            "heading": cam.get("heading", 0),
            "fov": cam.get("fov", 90),
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }


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
