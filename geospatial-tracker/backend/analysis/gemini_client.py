import google.generativeai as genai
import json
import base64
import logging
from config import GEMINI_API_KEY
from models.schemas import DetectionResponse

logger = logging.getLogger(__name__)

genai.configure(api_key=GEMINI_API_KEY)

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


async def analyze_frame(
    image_bytes: bytes,
    camera_lat: float,
    camera_lon: float,
    camera_heading: float = 0,
    fov_degrees: float = 90,
) -> list[dict]:
    """
    Sends a camera frame to Gemini for panoptic detection.
    Camera metadata helps Gemini estimate real-world coordinates.

    Returns a list of validated Detection dicts.
    """
    model = genai.GenerativeModel("gemini-2.0-flash")

    context = f"""Camera metadata:
    - Position: ({camera_lat}, {camera_lon})
    - Heading: {camera_heading}° from North
    - Field of view: {fov_degrees}°
    - Image type: Traffic camera JPEG snapshot

    Use this metadata to estimate real-world lat/lon for each detected object."""

    try:
        response = model.generate_content(
            [
                PANOPTIC_SYSTEM_PROMPT,
                context,
                {
                    "mime_type": "image/jpeg",
                    "data": base64.b64encode(image_bytes).decode(),
                },
            ],
            generation_config={"response_mime_type": "application/json"},
        )

        raw_json = json.loads(response.text)

        # Normalize: Gemini might return a list or an object with "detections"
        if isinstance(raw_json, list):
            detections_list = raw_json
        else:
            detections_list = raw_json.get("detections", [])

        # Validate through Pydantic
        validated = DetectionResponse(detections=detections_list)
        return [d.model_dump() for d in validated.detections]

    except json.JSONDecodeError as e:
        logger.error(f"Gemini returned invalid JSON: {e}")
        return []
    except Exception as e:
        logger.error(f"Gemini analysis failed: {e}")
        return []
