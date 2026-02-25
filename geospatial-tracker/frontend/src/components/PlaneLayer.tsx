/**
 * PlaneLayer — renders aircraft markers with heading rotation.
 * This module provides utility functions for advanced aircraft rendering
 * if custom markers are desired instead of the circle layer in LiveMap.
 */

export interface AircraftFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    category: "aircraft";
    callsign: string;
    altitude: number | null;
    velocity: number | null;
    heading: number | null;
    origin_country: string;
    source: string;
  };
}

/**
 * Returns a color based on aircraft altitude (meters).
 */
export function altitudeColor(altitude: number | null): string {
  if (altitude === null || altitude === undefined) return "#888";
  if (altitude < 1000) return "#00ff88";    // Low altitude — green
  if (altitude < 5000) return "#ffaa00";    // Mid altitude — orange
  return "#ff0044";                          // High altitude — red
}

/**
 * Format altitude for display.
 */
export function formatAltitude(meters: number | null): string {
  if (meters === null) return "N/A";
  const feet = Math.round(meters * 3.28084);
  return `${feet.toLocaleString()} ft`;
}

/**
 * Format velocity for display.
 */
export function formatVelocity(ms: number | null): string {
  if (ms === null) return "N/A";
  const knots = Math.round(ms * 1.94384);
  return `${knots} kts`;
}

export default {
  altitudeColor,
  formatAltitude,
  formatVelocity,
};
