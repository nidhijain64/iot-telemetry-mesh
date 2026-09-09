import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet's default marker icons are referenced by relative URL, which breaks
// under a bundler. Small inline circle markers avoid the problem entirely and
// suit a breadcrumb trail better than full pins.
const ROUTE_COLOR = '#0e7490';

export default function DeviceMap({ points }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  // Create the map once. Leaflet manages its own DOM inside this container, so
  // React must not re-render its children — hence the empty dependency list and
  // a separate effect below for the data.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || points.length === 0) return;

    layer.clearLayers();
    const latlngs = points.map((p) => [p.lat, p.lng]);

    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: ROUTE_COLOR, weight: 3, opacity: 0.8 }).addTo(layer);
    }

    // Every fix as a small dot, so a stationary device reads as a cluster rather
    // than a single point that hides how much data there is.
    latlngs.forEach((ll) => {
      L.circleMarker(ll, { radius: 3, color: ROUTE_COLOR, weight: 1, fillOpacity: 0.5 }).addTo(layer);
    });

    // The newest fix, emphasised — this is "where the device is now".
    const last = points[points.length - 1];
    L.circleMarker([last.lat, last.lng], {
      radius: 7, color: '#fff', weight: 2, fillColor: ROUTE_COLOR, fillOpacity: 1,
    })
      .addTo(layer)
      .bindPopup(`Last seen ${last.time}<br>${last.lat.toFixed(5)}, ${last.lng.toFixed(5)}`);

    // A device that hasn't moved has a zero-area bounds, which fitBounds would
    // zoom to maximum on — pad it so the surroundings stay visible.
    const bounds = L.latLngBounds(latlngs);
    if (bounds.getNorth() === bounds.getSouth() && bounds.getEast() === bounds.getWest()) {
      map.setView(latlngs[latlngs.length - 1], 17);
    } else {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
    }
  }, [points]);

  return <div ref={containerRef} className="h-64 w-full rounded-lg overflow-hidden border border-slate-200" />;
}
