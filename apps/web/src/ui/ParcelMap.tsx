import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
export type LocationPoint = { id: string; kind: string; latitude: number | null; longitude: number | null; accuracyMeters: number | null; capturedAt: string | null; createdAt: string };
export function ParcelMap({ points, onPick }: { points: LocationPoint[]; onPick?: (latitude:number,longitude:number)=>void }) {
  const container = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [failed, setFailed] = useState(false);
  const signature = JSON.stringify(points);
  useEffect(() => {
    if (!enabled || !container.current) return;
    const valid = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    const map = L.map(container.current, { scrollWheelZoom: false });
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    tiles.on('tileerror', () => setFailed(true));
    if (onPick) map.on('click', e => onPick(e.latlng.lat, e.latlng.lng));
    const bounds: L.LatLngTuple[] = [];
    for (const p of valid) {
      const pos: L.LatLngTuple = [p.latitude!, p.longitude!]; bounds.push(pos);
      const color = p.kind === 'DESTINATION' ? '#1d4ed8' : p.kind === 'COURIER_LOCATION' ? '#047857' : '#b45309';
      const label = document.createElement('span');
      label.textContent = `${p.kind.replaceAll('_', ' ')} · ${new Date(p.capturedAt || p.createdAt).toLocaleString()} · ${p.accuracyMeters ? `accuracy ±${Math.round(p.accuracyMeters)} m` : 'manual pin; accuracy not measured'}`;
      L.circleMarker(pos, { radius: 7, color, fillOpacity: .85 }).addTo(map).bindPopup(label);
      if (p.accuracyMeters) L.circle(pos, { radius: p.accuracyMeters, color, weight: 1, fillOpacity: .04 }).addTo(map);
    }
    const route = valid.filter(p => p.kind === 'COURIER_LOCATION').reverse().map(p => [p.latitude!, p.longitude!] as L.LatLngTuple);
    if (route.length > 1) L.polyline(route, { color: '#047857', weight: 3, dashArray: '5 6' }).addTo(map);
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 16 }); else map.setView([20.59, 78.96], 4);
    return () => { map.remove(); };
  }, [enabled, signature, onPick]);
  return <section className="panel"><h2>Delivery map</h2><p>Blue: destination · Green: courier · Amber: recipient. Circles show reported accuracy. The dotted line joins recorded positions; it is not a navigation route.</p>
    {onPick && <p>Click the map to choose a destination pin, then save the selected pin below.</p>}
    {!enabled ? <><p className="field-help">Loading the map requests the visible map area from OpenStreetMap. Location sharing is controlled separately.</p><button className="button" onClick={() => setEnabled(true)}>Load interactive map</button></> : <div ref={container} style={{ height: 380, borderRadius: 12, zIndex: 0 }} aria-label="Parcel location map" />}
    {failed && <p role="status">Some map tiles could not load. Recorded coordinates remain available below.</p>}
    {!points.length && <p>No location has been shared yet. No location is inferred from an address.</p>}
    <details><summary>Location records ({points.length})</summary>{points.slice(0, 30).map(p => <p key={p.id}>{p.kind.replaceAll('_', ' ')} · {p.latitude?.toFixed(5)}, {p.longitude?.toFixed(5)} · {p.accuracyMeters ? `±${Math.round(p.accuracyMeters)} m` : 'manual pin'} · {new Date(p.capturedAt || p.createdAt).toLocaleString()}</p>)}</details>
    <small>Coordinates are reported by the device, not independent proof of physical presence. Location records expire after 30 days.</small></section>;
}
