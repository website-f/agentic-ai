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

/** P122: the person on the check-in map. */
export interface YouPoint {
  lat: number;
  lng: number;
  accuracyM: number;
  tone?: MapTone;
  label?: string;
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
  /** P122 (all optional; screens without them are unchanged): the person, with an accuracy circle, drawn on its own
   * layer and moved in place as readings come. */
  you?: YouPoint | null;
  /** Show the person as a pin that drops in (the location is taken), instead of a live dot (still searching). */
  youPin?: boolean;
  /** Glide the person's dot and shrink or grow the accuracy circle smoothly between readings. */
  animatePoint?: boolean;
  /** A ring pulsing out from the person. */
  pulse?: boolean;
  /** Fits (fitKey) and focus fly there in one smooth flight instead of a pan. */
  flyTo?: boolean;
  /** Keep the person in view as readings come: fly closer as the circle shrinks, or after them when they leave the view. */
  follow?: boolean;
  /** Fit only these on fitKey, instead of everything shown. */
  fitTo?: { lat: number; lng: number; radiusM?: number }[];
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

/** P122: the person's marker: a live dot, or a pin that drops in (CSS, checkin.css), with an optional pulsing ring. */
const youIcon = (kind: 'dot' | 'pin', col: string, pulse: boolean) =>
  L.divIcon({
    className: 'ci-you',
    html:
      `<span class="ci-you-in" data-kind="${kind}" style="--you:${col}">` +
      (pulse ? '<span class="ci-you-halo"></span>' : '') +
      (kind === 'pin' ? `<span class="ci-drop"><span class="ci-pin-dot" style="--pin:${col}"></span></span>` : '<span class="ci-you-dot"></span>') +
      '</span>',
    iconSize: kind === 'pin' ? [28, 28] : [22, 22],
    iconAnchor: kind === 'pin' ? [14, 26] : [11, 11],
    tooltipAnchor: kind === 'pin' ? [0, -26] : [0, -10],
  });

/** Ease out: fast start, gentle landing. */
const easeOut = (k: number) => 1 - (1 - k) ** 3;

export default function GeoMap({
  lines = [],
  circles = [],
  points = [],
  pin,
  onPin,
  onMapClick,
  focus,
  fitKey,
  height = 320,
  label,
  you,
  youPin = false,
  animatePoint = false,
  pulse = false,
  flyTo = false,
  follow = false,
  fitTo,
}: GeoMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pinMarker = useRef<L.Marker | null>(null);
  const pinCircle = useRef<L.Circle | null>(null);
  const youMarker = useRef<L.Marker | null>(null);
  const youCircle = useRef<L.Circle | null>(null);
  const youLook = useRef('');
  const tween = useRef(0);
  const followedAt = useRef<number | null>(null);
  const flying = useRef(false);
  const flights = useRef(0);
  const followNow = useRef<() => void>(() => undefined);
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
    // P122: a flight has landed: shapes are drawn again for the new zoom, then the person is followed if they moved on.
    m.on('moveend', () => {
      if (!flying.current) return;
      flying.current = false;
      m.getContainer().classList.remove('ci-flying');
      followNow.current();
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
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(tween.current);
      youMarker.current = null;
      youCircle.current = null;
      youLook.current = '';
      flying.current = false;
    };
  }, []);

  /**
   * P122: fit bounds in one smooth flight with `flyTo`, else the usual pan (no motion when reduced). Leaflet scales the
   * drawn shapes during a flight without redrawing them (a small circle's outline would swell into a blob), so the shapes
   * fade out while flying and are drawn again when it lands; the person's marker stays visible all the way.
   */
  const fitBounds = (m: L.Map, b: L.LatLngBounds, duration = 1.1) => {
    if (flyTo && !reduced()) {
      flying.current = true;
      const flight = ++flights.current;
      m.getContainer().classList.add('ci-flying');
      m.flyToBounds(b, { padding: [28, 28], maxZoom: 18, duration });
      // Never leave the shapes hidden, should this flight end without its moveend (and no later flight took over).
      window.setTimeout(() => {
        if (map.current === m && flying.current && flights.current === flight) m.fire('moveend');
      }, duration * 1000 + 1500);
    } else m.fitBounds(b, { padding: [24, 24], maxZoom: 18, animate: !reduced() });
  };

  // P122: follow the person: the first view comes from fitKey; after that, fly closer once the circle is half the size it
  // was fitted at, or after the person when their circle leaves the view. Never mid-flight (checked again on landing).
  followNow.current = () => {
    const m = map.current;
    if (!m || !follow || !you || flying.current) return;
    const r = Math.max(1, you.accuracyM);
    if (followedAt.current == null) {
      followedAt.current = r;
      return;
    }
    const want = L.latLng(you.lat, you.lng).toBounds(Math.max(160, r * 2.2));
    if (r < followedAt.current / 2 || !m.getBounds().contains(want)) {
      followedAt.current = r;
      fitBounds(m, want, 0.9);
    }
  };

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
    else m.flyTo([focus.lat, focus.lng], z, { duration: flyTo ? 1.1 : 0.8 });
  }, [focus?.key]);

  // Fit everything shown.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const b = L.latLngBounds([]);
    if (fitTo?.length) {
      for (const f of fitTo) b.extend(L.latLng(f.lat, f.lng).toBounds(Math.max(80, (f.radiusM ?? 0) * 2)));
    } else {
      for (const c of circles) b.extend(L.latLng(c.lat, c.lng).toBounds(c.radiusM * 2));
      for (const l of lines) for (const p of l.path) b.extend(L.latLng(p.lat, p.lng));
      for (const p of points) b.extend(L.latLng(p.lat, p.lng).toBounds(Math.max(60, (p.accuracyM ?? 0) * 2)));
      if (pin) b.extend(L.latLng(pin.lat, pin.lng).toBounds(pin.radiusM * 2.4));
      if (you) b.extend(L.latLng(you.lat, you.lng).toBounds(Math.max(80, you.accuracyM * 2)));
    }
    if (!b.isValid()) return;
    if (follow && you) followedAt.current = Math.max(1, you.accuracyM);
    fitBounds(m, b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // P122: the person, moved and resized in place: the dot glides and the accuracy circle shrinks as readings improve.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(tween.current);
    if (!you) {
      youMarker.current?.remove();
      youCircle.current?.remove();
      youMarker.current = null;
      youCircle.current = null;
      youLook.current = '';
      followedAt.current = null;
      return;
    }
    const col = color(you.tone ?? 'info');
    const kind = youPin ? 'pin' : 'dot';
    const to = L.latLng(you.lat, you.lng);
    const r1 = Math.max(1, you.accuracyM);
    const look: L.PathOptions = { color: col, weight: youPin ? 2 : 1.5, dashArray: youPin ? undefined : '5 5', fillColor: col, fillOpacity: youPin ? 0.14 : 0.1 };
    let fresh = false;
    if (!youCircle.current) {
      youCircle.current = L.circle(to, { ...look, radius: r1, interactive: false, className: 'ci-you-acc' }).addTo(m);
      fresh = true;
    } else youCircle.current.setStyle(look);
    const shape = `${kind}|${pulse}`;
    if (!youMarker.current) {
      youMarker.current = L.marker(to, { icon: youIcon(kind, col, pulse), keyboard: false, zIndexOffset: 1000 }).addTo(m);
      fresh = true;
    } else if (youLook.current !== shape) youMarker.current.setIcon(youIcon(kind, col, pulse));
    else {
      // Only the colour changed (the verdict came): recolour in place, so the pin does not drop again.
      const el = youMarker.current.getElement()?.querySelector<HTMLElement>('.ci-you-in');
      el?.style.setProperty('--you', col);
      el?.querySelector<HTMLElement>('.ci-pin-dot')?.style.setProperty('--pin', col);
    }
    youLook.current = shape;
    youMarker.current.unbindTooltip();
    if (you.label) youMarker.current.bindTooltip(you.label, { direction: 'top' });

    const mk = youMarker.current;
    const ring = youCircle.current;
    const from = mk.getLatLng();
    const r0 = Math.max(1, ring.getRadius());
    if (fresh || flying.current || !animatePoint || reduced() || typeof requestAnimationFrame !== 'function') {
      mk.setLatLng(to);
      ring.setLatLng(to);
      ring.setRadius(r1);
    } else {
      const t0 = performance.now();
      const ms = 700;
      const step = (now: number) => {
        const k = easeOut(Math.min(1, (now - t0) / ms));
        const here = L.latLng(from.lat + (to.lat - from.lat) * k, from.lng + (to.lng - from.lng) * k);
        mk.setLatLng(here);
        ring.setLatLng(here);
        // Shrinking from kilometres to metres reads best on a log scale.
        ring.setRadius(Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * k));
        if (k < 1) tween.current = requestAnimationFrame(step);
      };
      tween.current = requestAnimationFrame(step);
    }

    if (follow) followNow.current();
    else followedAt.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [you?.lat, you?.lng, you?.accuracyM, you?.tone, you?.label, youPin, pulse, follow]);

  return <div ref={box} className="ci-map" style={{ height }} role="region" aria-label={label} />;
}
