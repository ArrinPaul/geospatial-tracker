/**
 * VehicleLayer — utility functions for vehicle detection rendering.
 */

export interface VehicleFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    category: "vehicles";
    confidence: number;
    estimated_lat: number;
    estimated_lon: number;
    attributes: Record<string, any>;
    source: string;
    source_model: string;
  };
}

/**
 * Color vehicle dots by confidence level.
 */
export function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "#00d4ff";   // High confidence — cyan
  if (confidence >= 0.5) return "#ffaa00";   // Medium — orange
  return "#ff4444";                           // Low — red
}

/**
 * Filter features to vehicles only.
 */
export function filterVehicles(features: any[]): VehicleFeature[] {
  return features.filter((f) => f.properties?.category === "vehicles");
}

export default {
  confidenceColor,
  filterVehicles,
};
