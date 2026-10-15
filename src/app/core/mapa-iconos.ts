import * as L from 'leaflet';

/**
 * Íconos propios para los marcadores del mapa (SVG inline, sin depender de los
 * PNG por defecto de Leaflet). El ícono por defecto de Leaflet se resuelve a
 * `images/marker-icon-2x.png` / `images/marker-shadow.png` relativos a su propio
 * paquete — con el bundler de Angular esas rutas no existen (404), y el navegador
 * termina mostrando un recuadro roto con el texto alternativo "Marker".
 *
 * Un L.divIcon con SVG evita el problema de raíz: no hay ninguna imagen externa
 * que pueda romperse, y el color se controla por CSS/parámetro.
 */
function crearIconoPin(color: string): L.DivIcon {
  const svg = `
    <svg viewBox="0 0 24 36" width="28" height="42" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"
        fill="${color}"
      />
      <circle cx="12" cy="12" r="5" fill="white" />
    </svg>
  `;
  return L.divIcon({
    className: 'backubi-marcador', // sin estilos propios de Leaflet (evita el recuadro gris)
    html: svg,
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -38],
  });
}

/** Marcador para el punto de pretexto (lo que decide el Usuario A, tono neutro). */
export function iconoPretexto(): L.DivIcon {
  return crearIconoPin('#475569'); // slate-600
}

/** Marcador para una ubicación real capturada (tono de alerta, distinto del pretexto). */
export function iconoCaptura(): L.DivIcon {
  return crearIconoPin('#dc2626'); // red-600
}

/** Marcador para la ubicación más reciente compartida (se distingue del resto). */
export function iconoCapturaReciente(): L.DivIcon {
  return crearIconoPin('#f59e0b'); // amber-500
}
