import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(env_path)

# API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN", "")
SENTINEL_INSTANCE_ID = os.getenv("SENTINEL_INSTANCE_ID", "")

# OpenSky (optional auth for higher rate limits)
OPENSKY_USERNAME = os.getenv("OPENSKY_USERNAME", "")
OPENSKY_PASSWORD = os.getenv("OPENSKY_PASSWORD", "")

# Polling intervals (seconds)
DETECTION_CYCLE_INTERVAL = 10
AIRCRAFT_POLL_INTERVAL = 10

# Default bounding box (Los Angeles area)
DEFAULT_BBOX = {
    "lamin": 33.5,
    "lomin": -118.8,
    "lamax": 34.4,
    "lomax": -117.6,
}
