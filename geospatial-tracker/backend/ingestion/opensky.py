import httpx
import logging
from models.schemas import AircraftPosition
from config import DEFAULT_BBOX, OPENSKY_USERNAME, OPENSKY_PASSWORD

logger = logging.getLogger(__name__)

OPENSKY_URL = "https://opensky-network.org/api/states/all"


async def fetch_aircraft(bbox: dict | None = None) -> list[AircraftPosition]:
    """
    Fetches all live aircraft positions from OpenSky Network.

    bbox: {"lamin": 45.0, "lomin": -125.0, "lamax": 50.0, "lomax": -115.0}
    Rate limit: 5 req/10s (anonymous), 1 req/5s (authenticated)
    """
    params = bbox or DEFAULT_BBOX
    auth = None
    if OPENSKY_USERNAME and OPENSKY_PASSWORD:
        auth = (OPENSKY_USERNAME, OPENSKY_PASSWORD)

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(OPENSKY_URL, params=params, auth=auth)
        resp.raise_for_status()
        data = resp.json()

    aircraft = []
    for state in data.get("states", []):
        try:
            aircraft.append(AircraftPosition(
                icao24=state[0],
                callsign=(state[1] or "").strip(),
                origin_country=state[2],
                longitude=state[5],
                latitude=state[6],
                altitude=state[7],       # meters (barometric)
                velocity=state[9],       # m/s ground speed
                heading=state[10],       # degrees from north
                vertical_rate=state[11],
                on_ground=state[8],
                last_contact=state[4],
            ))
        except (IndexError, ValueError) as e:
            # Skip malformed state vectors
            continue
    return aircraft
