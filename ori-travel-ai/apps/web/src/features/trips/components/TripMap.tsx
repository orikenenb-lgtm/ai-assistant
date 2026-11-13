import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import type { TripItem } from '@/lib/schemas/trips';
import { kindLabel } from '../labels';

const icon = L.divIcon({
  className: '',
  html: '<span style="display:block;width:16px;height:16px;border-radius:9999px;background:#0e7490;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0]!, 12);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
  }, [map, points]);
  return null;
}

/** Leaflet map with OSM tiles. Only mounted when the family enabled maps in settings (privacy). */
export default function TripMap({ items }: { items: TripItem[] }) {
  const located = items.filter((i) => i.latitude != null && i.longitude != null);
  const points = located.map((i) => [i.latitude as number, i.longitude as number] as [number, number]);
  if (located.length === 0) {
    return <p className="text-sm text-fg-muted">אין פריטים עם מיקום מדויק להצגה במפה. פריטים שנוספו מהצעות עם קואורדינטות יופיעו כאן.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line" dir="ltr">
      <MapContainer center={points[0]!} zoom={11} scrollWheelZoom={false} style={{ height: 280, width: '100%' }} attributionControl>
        <TileLayer attribution="© OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitBounds points={points} />
        {located.map((i) => (
          <Marker key={i.id} position={[i.latitude as number, i.longitude as number]} icon={icon}>
            <Popup>
              <strong>{i.title}</strong>
              <br />
              {kindLabel(i.kind)}
              {i.location ? ` · ${i.location}` : ''}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
