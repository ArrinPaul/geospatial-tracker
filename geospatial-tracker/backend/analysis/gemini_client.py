"""
Multi-provider vision analysis client with automatic fallback.

Fallback chain (FREE first, PAID last):
  1. Groq        (FREE)  — llama-4-scout, 30 RPM, 14,400 req/day
  2. Together AI (FREE)  — Llama Vision Free, 60 RPM
  3. Gemini      (FREE)  — 2.0-flash (NOT 3.1-pro), 15 RPM, 1,500/day
  4. OpenAI      (PAID)  — gpt-4o-mini, only if all free providers exhausted

When one provider hits its rate limit or errors, the system
automatically swaps to the next available provider.
"""

import json
import base64
import logging
import time
from dataclasses import dataclass, field
from config import get_vision_providers
from models.schemas import DetectionResponse

logger = logging.getLogger(__name__)


PANOPTIC_SYSTEM_PROMPT = """You are an advanced geospatial analyst model.
Analyze the provided image and detect ALL visible objects in these categories:
- vehicles (cars, trucks, buses, motorcycles)
- aircraft (planes, helicopters)
- pedestrians
- infrastructure (bridges, intersections)

For each detected object, return:
1. category (string)
2. estimated_lat and estimated_lon (float) — infer from camera metadata provided
3. confidence (float, 0-1)
4. bounding_box (optional, [x1, y1, x2, y2] in pixel coords)
5. attributes (color, direction, estimated_speed if moving)

Return ONLY valid JSON as an object with a "detections" key containing an array.
No markdown. No explanation."""


@dataclass
class ProviderState:
    """Tracks rate limit state for a single provider."""
    name: str
    request_count: int = 0
    minute_start: float = field(default_factory=time.time)
    daily_count: int = 0
    day_start: float = field(default_factory=time.time)
    consecutive_errors: int = 0
    disabled_until: float = 0.0
    last_error: str = ""

    def is_available(self, rpm_limit: int, daily_limit: int) -> bool:
        now = time.time()

        # Check if temporarily disabled (backoff after errors)
        if now < self.disabled_until:
            return False

        # Reset minute counter
        if now - self.minute_start > 60:
            self.request_count = 0
            self.minute_start = now

        # Reset daily counter
        if now - self.day_start > 86400:
            self.daily_count = 0
            self.day_start = now

        return self.request_count < rpm_limit and self.daily_count < daily_limit

    def record_success(self):
        self.request_count += 1
        self.daily_count += 1
        self.consecutive_errors = 0

    def record_error(self, error: str):
        self.consecutive_errors += 1
        self.last_error = error
        # Exponential backoff: 30s, 60s, 120s, 240s, max 5min
        backoff = min(30 * (2 ** (self.consecutive_errors - 1)), 300)
        self.disabled_until = time.time() + backoff
        logger.warning(
            f"Provider {self.name} error #{self.consecutive_errors}, "
            f"backing off {backoff}s: {error}"
        )


class VisionFallbackClient:
    """Manages multiple vision API providers with automatic failover."""

    def __init__(self):
        self._provider_states: dict[str, ProviderState] = {}
        self._initialized = False

    def _ensure_init(self):
        if self._initialized:
            return
        providers = get_vision_providers()
        for p in providers:
            self._provider_states[p["name"]] = ProviderState(name=p["name"])
        self._initialized = True
        logger.info(
            f"Vision fallback initialized with {len(providers)} providers: "
            f"{[p['name'] for p in providers]}"
        )

    def get_active_provider(self) -> dict | None:
        """Returns the first available provider in priority order."""
        self._ensure_init()
        providers = get_vision_providers()
        for p in providers:
            state = self._provider_states.get(p["name"])
            if state and state.is_available(p["rate_limit_rpm"], p["daily_limit"]):
                return p
        logger.error("All vision providers exhausted!")
        return None

    def get_provider_status(self) -> list[dict]:
        """Returns status of all providers (for health endpoint)."""
        self._ensure_init()
        providers = get_vision_providers()
        status = []
        for p in providers:
            state = self._provider_states.get(p["name"], ProviderState(name=p["name"]))
            status.append({
                "name": p["name"],
                "model": p["model"],
                "free_tier": p["free_tier"],
                "requests_this_minute": state.request_count,
                "requests_today": state.daily_count,
                "consecutive_errors": state.consecutive_errors,
                "available": state.is_available(p["rate_limit_rpm"], p["daily_limit"]),
                "last_error": state.last_error or None,
            })
        return status

    async def analyze_frame(
        self,
        image_bytes: bytes,
        camera_lat: float,
        camera_lon: float,
        camera_heading: float = 0,
        fov_degrees: float = 90,
    ) -> list[dict]:
        """
        Sends a camera frame for panoptic detection, trying providers in order.
        Automatically falls back if a provider fails or hits rate limits.
        """
        self._ensure_init()
        providers = get_vision_providers()

        context = f"""Camera metadata:
    - Position: ({camera_lat}, {camera_lon})
    - Heading: {camera_heading}° from North
    - Field of view: {fov_degrees}°
    - Image type: Traffic camera JPEG snapshot

    Use this metadata to estimate real-world lat/lon for each detected object."""

        b64_image = base64.b64encode(image_bytes).decode()

        for provider in providers:
            state = self._provider_states.get(provider["name"])
            if not state or not state.is_available(
                provider["rate_limit_rpm"], provider["daily_limit"]
            ):
                continue

            try:
                logger.info(f"Trying vision provider: {provider['name']} ({provider['model']})")
                result = await self._call_provider(
                    provider, b64_image, context
                )
                state.record_success()
                return result

            except Exception as e:
                error_msg = str(e)
                state.record_error(error_msg)
                logger.warning(
                    f"Provider {provider['name']} failed: {error_msg}. "
                    f"Trying next provider..."
                )
                continue

        logger.error("All vision providers failed for this frame")
        return []

    async def _call_provider(
        self, provider: dict, b64_image: str, context: str
    ) -> list[dict]:
        """Dispatches to the correct provider implementation."""
        name = provider["name"]
        if name == "gemini":
            return await self._call_gemini(provider, b64_image, context)
        elif name == "groq":
            return await self._call_groq(provider, b64_image, context)
        elif name == "together":
            return await self._call_together(provider, b64_image, context)
        elif name == "openai":
            return await self._call_openai(provider, b64_image, context)
        else:
            raise ValueError(f"Unknown provider: {name}")

    async def _call_gemini(
        self, provider: dict, b64_image: str, context: str
    ) -> list[dict]:
        import google.generativeai as genai

        genai.configure(api_key=provider["api_key"])
        model = genai.GenerativeModel(provider["model"])

        response = model.generate_content(
            [
                PANOPTIC_SYSTEM_PROMPT,
                context,
                {"mime_type": "image/jpeg", "data": b64_image},
            ],
            generation_config={"response_mime_type": "application/json"},
        )
        return self._parse_response(response.text, provider["name"])

    async def _call_groq(
        self, provider: dict, b64_image: str, context: str
    ) -> list[dict]:
        import httpx

        headers = {
            "Authorization": f"Bearer {provider['api_key']}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": provider["model"],
            "messages": [
                {"role": "system", "content": PANOPTIC_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": context},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{b64_image}"
                            },
                        },
                    ],
                },
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
            "max_tokens": 4096,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"]
            return self._parse_response(text, provider["name"])

    async def _call_together(
        self, provider: dict, b64_image: str, context: str
    ) -> list[dict]:
        import httpx

        headers = {
            "Authorization": f"Bearer {provider['api_key']}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": provider["model"],
            "messages": [
                {"role": "system", "content": PANOPTIC_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": context},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{b64_image}"
                            },
                        },
                    ],
                },
            ],
            "temperature": 0.1,
            "max_tokens": 4096,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.together.xyz/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"]
            return self._parse_response(text, provider["name"])

    async def _call_openai(
        self, provider: dict, b64_image: str, context: str
    ) -> list[dict]:
        import httpx

        headers = {
            "Authorization": f"Bearer {provider['api_key']}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": provider["model"],
            "messages": [
                {"role": "system", "content": PANOPTIC_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": context},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{b64_image}"
                            },
                        },
                    ],
                },
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
            "max_tokens": 4096,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"]
            return self._parse_response(text, provider["name"])

    def _parse_response(self, text: str, provider_name: str) -> list[dict]:
        """Parse and validate JSON response from any provider."""
        try:
            raw_json = json.loads(text)
        except json.JSONDecodeError as e:
            logger.error(f"{provider_name} returned invalid JSON: {e}")
            # Try extracting JSON from markdown code blocks
            import re
            match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
            if match:
                raw_json = json.loads(match.group(1))
            else:
                return []

        # Normalize response format
        if isinstance(raw_json, list):
            detections_list = raw_json
        else:
            detections_list = raw_json.get("detections", [])

        # Validate through Pydantic
        try:
            validated = DetectionResponse(detections=detections_list)
            return [d.model_dump() for d in validated.detections]
        except Exception as e:
            logger.error(f"Validation failed for {provider_name} response: {e}")
            return []


# Global singleton instance
vision_client = VisionFallbackClient()


async def analyze_frame(
    image_bytes: bytes,
    camera_lat: float,
    camera_lon: float,
    camera_heading: float = 0,
    fov_degrees: float = 90,
) -> list[dict]:
    """Convenience function — delegates to the fallback client."""
    return await vision_client.analyze_frame(
        image_bytes, camera_lat, camera_lon, camera_heading, fov_degrees
    )
