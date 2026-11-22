"use client";

import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const icon = L.divIcon({
  className: "vehicle-marker",
  html: '<div class="vehicle-marker-inner"><span></span></div>',
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

type Props = {
  latitude: number;
  longitude: number;
  name: string;
};

function FocusPosition({ latitude, longitude }: Omit<Props, "name">) {
  const map = useMap();
  map.setView([latitude, longitude], map.getZoom(), { animate: true });
  return null;
}

export default function TrackerMap({ latitude, longitude, name }: Props) {
  return (
    <MapContainer
      center={[latitude, longitude]}
      zoom={15}
      scrollWheelZoom
      className="tracker-map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FocusPosition latitude={latitude} longitude={longitude} />
      <Marker position={[latitude, longitude]} icon={icon}>
        <Popup>
          <strong>{name}</strong>
        </Popup>
      </Marker>
    </MapContainer>
  );
}
