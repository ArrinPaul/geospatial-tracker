import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(env_path)

# ─── Vision API Keys (Fallback Chain) ────────────────────────────
# Priority: FREE first → PAID last
# Groq (free) → Together (free) → Gemini Flash (free) → OpenAI (paid)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")          # FREE — Primary provider
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY", "")  # FREE — Llama Vision Free
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")      # FREE — 2.0-flash only (NOT 3.1-pro)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")      # 💰 PAID — last resort

# ─── Map & Satellite ─────────────────────────────────────────────
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN", "")
SENTINEL_INSTANCE_ID = os.getenv("SENTINEL_INSTANCE_ID", "")

# ─── OpenSky (optional auth for higher rate limits) ──────────────
OPENSKY_USERNAME = os.getenv("OPENSKY_USERNAME", "")
OPENSKY_PASSWORD = os.getenv("OPENSKY_PASSWORD", "")

# ─── Aircraft Fallback: ADS-B Exchange / AviationStack ───────────
ADSBX_API_KEY = os.getenv("ADSBX_API_KEY", "")
AVIATIONSTACK_API_KEY = os.getenv("AVIATIONSTACK_API_KEY", "")

# ─── Polling intervals (seconds) ─────────────────────────────────
DETECTION_CYCLE_INTERVAL = int(os.getenv("DETECTION_CYCLE_INTERVAL", "10"))
AIRCRAFT_POLL_INTERVAL = int(os.getenv("AIRCRAFT_POLL_INTERVAL", "10"))

# ─── Default bounding box (Los Angeles area) ─────────────────────
DEFAULT_BBOX = {
    "lamin": 33.5,
    "lomin": -118.8,
    "lamax": 34.4,
    "lomax": -117.6,
}

# ─── Vision Provider Priority Order ──────────────────────────────
# Fallback chain: Groq (FREE) → Together (FREE) → Gemini Flash (FREE) → OpenAI (PAID)
# The system tries each provider in order. When one hits its rate limit
# or errors out, it automatically swaps to the next available provider.
# PAID providers are only used when ALL free providers are exhausted.
def get_vision_providers() -> list[dict]:
    """Returns available vision providers in fallback priority order.

    Order: FREE providers first, PAID providers last.
    - Groq:     FREE (primary)  — fastest inference, 30 RPM
    - Together:  FREE            — Llama Vision, 60 RPM
    - Gemini:    FREE (flash)    — 2.0-flash only, 15 RPM
    - OpenAI:    PAID (fallback) — gpt-4o-mini, only if all free exhausted
    """
    providers = []

    # ── FREE TIER PROVIDERS (tried first) ──

    if GROQ_API_KEY:
        providers.append({
            "name": "groq",
            "api_key": GROQ_API_KEY,
            "model": "llama-4-scout-17b-16e-instruct",
            "free_tier": True,
            "rate_limit_rpm": 30,       # Free: 30 RPM
            "daily_limit": 14400,       # Free: 14,400 req/day
        })

    if TOGETHER_API_KEY:
        providers.append({
            "name": "together",
            "api_key": TOGETHER_API_KEY,
            "model": "meta-llama/Llama-Vision-Free",
            "free_tier": True,
            "rate_limit_rpm": 60,       # Free: 60 RPM
            "daily_limit": 1000,        # Free: ~1,000 req/day
        })

    if GEMINI_API_KEY:
        providers.append({
            "name": "gemini",
            "api_key": GEMINI_API_KEY,
            "model": "gemini-2.0-flash",  # FREE model (NOT gemini-3.1-pro)
            "free_tier": True,
            "rate_limit_rpm": 15,       # Free: 15 RPM
            "daily_limit": 1500,        # Free: 1,500 req/day
        })

    # ── PAID PROVIDERS (last resort only) ──

    if OPENAI_API_KEY:
        providers.append({
            "name": "openai",
            "api_key": OPENAI_API_KEY,
            "model": "gpt-4o-mini",     # ~$0.15/M input + $0.60/M output
            "free_tier": False,
            "rate_limit_rpm": 500,
            "daily_limit": 10000,
        })

    return providers


# ─── Aircraft Provider Priority Order ────────────────────────────
def get_aircraft_providers() -> list[dict]:
    """Returns available aircraft data providers in fallback order."""
    providers = []

    # OpenSky is always available (free, no key required for anonymous)
    providers.append({
        "name": "opensky",
        "api_key": OPENSKY_USERNAME,  # optional
        "free_tier": True,
        "rate_limit": "5 req/10s anon, 1 req/5s auth",
    })

    if ADSBX_API_KEY:
        providers.append({
            "name": "adsbexchange",
            "api_key": ADSBX_API_KEY,
            "free_tier": False,
            "rate_limit": "Varies by plan",
        })

    if AVIATIONSTACK_API_KEY:
        providers.append({
            "name": "aviationstack",
            "api_key": AVIATIONSTACK_API_KEY,
            "free_tier": True,  # 100 req/month free
            "rate_limit": "100 req/month free",
        })

    return providers
