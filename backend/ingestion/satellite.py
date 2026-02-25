import httpx
from config import SENTINEL_INSTANCE_ID

SENTINEL_WMS = f"https://services.sentinel-hub.com/ogc/wms/{SENTINEL_INSTANCE_ID}"


async def fetch_satellite_tile(
    bbox: list[float],
    width: int = 1024,
    height: int = 1024,
    time_range: str = "2026-02-01/2026-02-20",
) -> bytes:
    """
    Fetches a recent Sentinel-2 satellite tile for a bounding box.

    Args:
        bbox: [min_lon, min_lat, max_lon, max_lat]
        width: Image width in pixels
        height: Image height in pixels
        time_range: Date range for imagery (ISO format)

    Returns:
        JPEG image bytes

    Notes:
        Free tier: 30,000 requests/month via Copernicus program
    """
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "LAYERS": "TRUE_COLOR",
        "BBOX": ",".join(map(str, bbox)),
        "WIDTH": width,
        "HEIGHT": height,
        "FORMAT": "image/jpeg",
        "CRS": "EPSG:4326",
        "TIME": time_range,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(SENTINEL_WMS, params=params)
        resp.raise_for_status()
        return resp.content
