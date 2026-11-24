"use client";

import { useEffect } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { parseGeofenceArea } from "../lib/geofences";

type Props = {
  latitude: number;
  longitude: number;
  name: string;
  course?: number;
  state?: "moving" | "static" | "offline";
  route?: Array<[number, number]>;
  draftPoints?: Array<[number, number]>;
  geofenceAreas?: string[];
  showVehicleMarker?: boolean;
  onMapClick?: (latitude: number, longitude: number) => void;
};

function FocusPosition({ latitude, longitude }: Pick<Props, "latitude" | "longitude">) {
  const map = useMap();
  useEffect(() => {
    map.setView([latitude, longitude], map.getZoom(), { animate: true });
  }, [latitude, longitude, map]);
  return null;
}

function MapClickHandler({ onMapClick }: { onMapClick?: Props["onMapClick"] }) {
  useMapEvents({
    click(event) {
      onMapClick?.(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

export default function TrackerMap({
  latitude,
  longitude,
  name,
  course = 0,
  state = "static",
  route = [],
  draftPoints = [],
  geofenceAreas = [],
  showVehicleMarker = true,
  onMapClick,
}: Props) {
  const icon = L.divIcon({
    className: "vehicle-marker",
    html: `<div class="vehicle-marker-inner ${state}" style="transform: rotate(${course}deg)">
      <span></span>
    </div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });

  return (
    <MapContainer
      center={[latitude, longitude]}
      zoom={17}
      scrollWheelZoom
      className="tracker-map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {route.length > 1 && (
        <Polyline
          positions={route}
          pathOptions={{
            color: "#c51d29",
            weight: 5,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
      )}
      {draftPoints.map((point, index) => (
        <CircleMarker
          key={`route-point-${index}`}
          center={point}
          radius={5}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#c51d29", fillOpacity: 1 }}
        />
      ))}
      {geofenceAreas.map((area, index) => {
        const parsed = parseGeofenceArea(area);
        if (!parsed) return null;
        if (parsed.type === "circle") {
          return (
            <Circle
              key={`${area}-${index}`}
              center={parsed.center}
              radius={parsed.radius}
              pathOptions={{ color: "#c51d29", fillColor: "#c51d29", fillOpacity: 0.12, weight: 2 }}
            />
          );
        }
        return (
          <Polygon
            key={`${area}-${index}`}
            positions={parsed.points}
            pathOptions={{ color: "#c51d29", fillColor: "#c51d29", fillOpacity: 0.12, weight: 2 }}
          />
        );
      })}
      <FocusPosition latitude={latitude} longitude={longitude} />
      <MapClickHandler onMapClick={onMapClick} />
      {showVehicleMarker && (
        <Marker position={[latitude, longitude]} icon={icon}>
          <Popup>
            <strong>{name}</strong>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
