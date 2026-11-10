/**
 * P81: the map for check-in places, field areas and flagged check-ins. Leaflet with OpenStreetMap tiles (the tile host is
 * allowed in the /prima/ CSP, deploy/nginx/web.conf); the browser loads tiles only, never Nominatim (the API looks up
 * addresses). Loaded on demand (lazy), so screens without a map do not carry Leaflet.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapTone = 'primary' | 'ok' | 'warn' | 'crit' | 'muted' | 'info';

export interface MapCircle {
  lat: number;
  lng: number;
  radiusM: number;
  tone?: MapTone;
  label?: string;
}

export interface MapPoint {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  tone?: MapTone;
  label?: string;
}

/** P90: a route drawn as a line (the owner's test check-in movements). */
export interface MapLine {
  path: { lat: number; lng: number }[];
  tone?: MapTone;
  label?: string;
  /** P97: dashed (a gap: no position came between the two ends) and the line's width. */
  dash?: boolean;
  weight?: number;
}

export interface GeoMapProps {
  /** Routes to draw (oldest point first). */
  lines?: MapLine[];
  /** Circles to show (offices, places, zones). */
  circles?: MapCircle[];
  /** Readings (a check-in point with its accuracy). */
  points?: MapPoint[];
  /** The pin being edited, with its radius circle. Drag it, or click the map, to move it. */
  pin?: { lat: number; lng: number; radiusM: number } | null;
  onPin?: (lat: number, lng: number) => void;
  /** A click on the map when there is no pin to move (for example, to add a field zone). */
  onMapClick?: (lat: number, lng: number) => void;
  /** Fly here when it changes (a search result). */
  focus?: { lat: number; lng: number; zoom?: number; key: string } | null;
  /** Change it to fit the map around everything shown again. */
  fitKey?: string;
  height?: number | string;
  label: string;
}

/** Peninsular Malaysia and Borneo, when there is nothing to show yet. */
const MALAYSIA: L.LatLngBoundsExpression = [
  [0.85, 99.6],
  [7.4, 119.3],
];

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function color(tone: MapTone = 'primary'): string {
  const v = { primary: '--primary', ok: '--ok', warn: '--warn', crit: '--crit', muted: '--muted', info: '--unknown' }[tone];
  const c = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() : '';
  return c || '#13895f';
}

const pinIcon = (tone: MapTone) =>
  L.divIcon({
    className: 'ci-pin',
    html: `<span class="ci-pin-dot" style="--pin:${color(tone)}"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 26],
  });

export default function GeoMap({ lines = [], circles = [], points = [], pin, onPin, onMapClick, focus, fitKey, height = 320, label }: GeoMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pinMarker = useRef<L.Marker | null>(null);
  const pinCircle = useRef<L.Circle | null>(null);
  const handlers = useRef({ onPin, onMapClick });
  handlers.current = { onPin, onMapClick };

  // The map itself, once.
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true, zoomAnimation: !reduced(), fadeAnimation: !reduced(), markerZoomAnimation: !reduced() });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.fitBounds(MALAYSIA);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const { onPin: p, onMapClick: c } = handlers.current;
      if (p) p(e.latlng.lat, e.latlng.lng);
      else c?.(e.latlng.lat, e.latlng.lng);
    });
    map.current = m;
    // The map sits in drawers and tabs that change size: keep the tiles filling it.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(box.current);
    return () => {
      ro?.disconnect();
      m.remove();
      map.current = null;
      pinMarker.current = null;
      pinCircle.current = null;
    };
  }, []);

  // Circles and readings: redrawn only when what they show changes (typing elsewhere on the screen leaves them be).
  const shapes = JSON.stringify([circles, points, lines]);
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const l of lines) {
      if (l.path.length < 2) continue;
      const route = L.polyline(
        l.path.map((p) => [p.lat, p.lng] as L.LatLngTuple),
        { color: color(l.tone), weight: l.weight ?? 4, opacity: l.dash ? 0.75 : 0.85, dashArray: l.dash ? '6 8' : undefined, lineJoin: 'round', lineCap: 'round', interactive: !!l.label },
      );
      if (l.label) route.bindTooltip(l.label, { sticky: true });
      route.addTo(g);
    }
    for (const c of circles) {
      const col = color(c.tone);
      const shape = L.circle([c.lat, c.lng], { radius: c.radiusM, color: col, weight: 2, fillColor: col, fillOpacity: 0.12, interactive: !!c.label });
      if (c.label) shape.bindTooltip(c.label, { direction: 'top' });
      shape.addTo(g);
    }
    for (const p of points) {
      const col = color(p.tone ?? 'info');
      if (p.accuracyM) L.circle([p.lat, p.lng], { radius: p.accuracyM, color: col, weight: 1, dashArray: '4 4', fillColor: col, fillOpacity: 0.08, interactive: false }).addTo(g);
      const dot = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 });
      if (p.label) dot.bindTooltip(p.label, { direction: 'top' });
      dot.addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes]);

  // The pin being edited: moved and resized in place, so the slider feels smooth.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pin) {
      pinMarker.current?.remove();
      pinCircle.current?.remove();
      pinMarker.current = null;
      pinCircle.current = null;
      return;
    }
    if (!pinMarker.current) {
      const col = color('primary');
      pinCircle.current = L.circle([pin.lat, pin.lng], { radius: pin.radiusM, color: col, weight: 2, fillColor: col, fillOpacity: 0.15, interactive: false }).addTo(m);
      const mk = L.marker([pin.lat, pin.lng], { draggable: true, icon: pinIcon('primary'), keyboard: true, title: 'Drag to move the place', autoPan: true });
      mk.on('drag', (e) => pinCircle.current?.setLatLng((e.target as L.Marker).getLatLng()));
      mk.on('dragend', (e) => {
        const ll = (e.target as L.Marker).getLatLng();
        handlers.current.onPin?.(ll.lat, ll.lng);
      });
      pinMarker.current = mk.addTo(m);
    } else {
      pinMarker.current.setLatLng([pin.lat, pin.lng]);
      pinCircle.current?.setLatLng([pin.lat, pin.lng]);
      pinCircle.current?.setRadius(pin.radiusM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.lat, pin?.lng, pin?.radiusM, !!pin]);

  // Fly to a search result.
  useEffect(() => {
    const m = map.current;
    if (!m || !focus) return;
    const z = focus.zoom ?? 17;
    if (reduced()) m.setView([focus.lat, focus.lng], z);
    else m.flyTo([focus.lat, focus.lng], z, { duration: 0.8 });
  }, [focus?.key]);

  // Fit everything shown.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const b = L.latLngBounds([]);
    for (const c of circles) b.extend(L.latLng(c.lat, c.lng).toBounds(c.radiusM * 2));
    for (const l of lines) for (const p of l.path) b.extend(L.latLng(p.lat, p.lng));
    for (const p of points) b.extend(L.latLng(p.lat, p.lng).toBounds(Math.max(60, (p.accuracyM ?? 0) * 2)));
    if (pin) b.extend(L.latLng(pin.lat, pin.lng).toBounds(pin.radiusM * 2.4));
    if (!b.isValid()) return;
    m.fitBounds(b, { padding: [24, 24], maxZoom: 18, animate: !reduced() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={box} className="ci-map" style={{ height }} role="region" aria-label={label} />;
}
