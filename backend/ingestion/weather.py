"""
Weather overlay ingestion — fetches weather data from OpenWeatherMap.
Free tier: 1,000 API calls/day, current weather + 3-hour forecast.
"""

import httpx
import logging
from config import OPENWEATHERMAP_API_KEY

logger = logging.getLogger(__name__)

OWM_CURRENT_URL = "https://api.openweathermap.org/data/2.5/weather"
OWM_ONECALL_URL = "https://api.openweathermap.org/data/3.0/onecall"


async def fetch_weather(lat: float, lon: float) -> dict | None:
    """
    Fetch current weather for a location.
    Returns structured weather data or None on failure.
    """
    if not OPENWEATHERMAP_API_KEY:
        return None

    params = {
        "lat": lat,
        "lon": lon,
        "appid": OPENWEATHERMAP_API_KEY,
        "units": "metric",
    }

    try:
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
            resp = await client.get(OWM_CURRENT_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        return {
            "lat": lat,
            "lon": lon,
            "temperature_c": data["main"]["temp"],
            "feels_like_c": data["main"]["feels_like"],
            "humidity": data["main"]["humidity"],
            "pressure_hpa": data["main"]["pressure"],
            "wind_speed_ms": data["wind"]["speed"],
            "wind_deg": data["wind"].get("deg", 0),
            "wind_gust_ms": data["wind"].get("gust"),
            "visibility_m": data.get("visibility", 10000),
            "clouds_pct": data["clouds"]["all"],
            "weather_main": data["weather"][0]["main"],
            "weather_desc": data["weather"][0]["description"],
            "weather_icon": data["weather"][0]["icon"],
        }
    except Exception as e:
        logger.error(f"Weather fetch failed for ({lat}, {lon}): {e}")
        return None


async def fetch_weather_for_cities(cities: list[dict]) -> list[dict]:
    """Fetch weather for multiple city centers."""
    results = []
    for city in cities:
        weather = await fetch_weather(city["lat"], city["lon"])
        if weather:
            weather["city_name"] = city["name"]
            results.append(weather)
    return results


def weather_to_geojson(weather_list: list[dict]) -> dict:
    """Convert weather data to GeoJSON features for map overlay."""
    features = []
    for w in weather_list:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [w["lon"], w["lat"]],
            },
            "properties": {
                "category": "weather",
                "city": w.get("city_name", "Unknown"),
                "temperature": w["temperature_c"],
                "wind_speed": w["wind_speed_ms"],
                "wind_direction": w["wind_deg"],
                "visibility": w["visibility_m"],
                "clouds": w["clouds_pct"],
                "condition": w["weather_main"],
                "description": w["weather_desc"],
                "icon": w["weather_icon"],
            },
        })
    return {"type": "FeatureCollection", "features": features}
