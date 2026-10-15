import { setWorkerUrl } from 'maplibre-gl';

let configurado = false;

/**
 * MapLibre GL necesita spawnear un Web Worker para parsear los tiles vectoriales
 * (sin él, el mapa se ve pero sin calles/etiquetas/fronteras — solo el fondo).
 * Por defecto calcula esa URL de forma relativa a su propio bundle vía
 * import.meta.url; el dev-server de Angular (Vite) pre-empaqueta
 * @maplibre/maplibre-gl-leaflet de una forma que rompe esa resolución
 * (error en consola: "Worker failed to load").
 *
 * Solución: apuntar explícitamente al worker ya publicado en un CDN, en la
 * misma versión que tenemos instalada (ver package.json). maplibre-gl lo
 * trae como blob cross-origin y lo corre como module worker — no depende
 * de cómo el bundler haya empaquetado nuestro propio código.
 *
 * IMPORTANTE: llamar a esto solo desde los componentes que realmente usan el
 * mapa (mapa-trampa, dashboard/home), nunca desde main.ts — si se importa ahí,
 * esbuild mete maplibre-gl entero en el bundle inicial (no en el lazy chunk de
 * la ruta), rompiendo el presupuesto de producción.
 */
export function configurarMaplibreWorker(): void {
  if (configurado) {
    return;
  }
  configurado = true;
  setWorkerUrl('https://cdn.jsdelivr.net/npm/maplibre-gl@6.14.0/dist/maplibre-gl-worker.mjs');
}
