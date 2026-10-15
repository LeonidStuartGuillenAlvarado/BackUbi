import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import '@maplibre/maplibre-gl-leaflet';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { configurarMaplibreWorker } from '../../core/maplibre-worker-setup';
import { iconoCaptura, iconoCapturaReciente, iconoPretexto } from '../../core/mapa-iconos';
import { SupabaseService } from '../../core/supabase.service';

interface EnlaceRow {
  id: string;
  token: string;
  etiqueta: string | null;
  activo: boolean;
  max_capturas: number;
  creado_en: string;
  expira_en: string | null;
  pretexto_lat: number;
  pretexto_lon: number;
  pretexto_etiqueta: string;
}

interface CapturaRow {
  id: string;
  enlace_id: string;
  latitud: number | null;
  longitud: number | null;
  precision_metros: number | null;
  metodo: 'gps' | 'ip';
  capturado_en: string;
}

/**
 * Home del dashboard privado (protegida por authGuard): generación de enlaces,
 * listado de los propios, y mapa en tiempo real con las capturas asociadas
 * (vía Realtime sobre ubicaciones_capturadas — ver supabase/migrations/0004_*).
 */
@Component({
  selector: 'app-home',
  imports: [FormsModule],
  templateUrl: './home.html',
})
export class Home implements AfterViewInit, OnDestroy {
  @ViewChild('mapaContainer') private mapaContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('mapaPretextoContainer') private mapaPretextoContainer?: ElementRef<HTMLDivElement>;

  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  private map?: L.Map;
  private marcadores = new Map<string, L.Marker>();
  private canalRealtime?: RealtimeChannel;
  private usuarioId: string | null = null;

  private mapaPretexto?: L.Map;
  private marcadorPretexto?: L.Marker;

  protected readonly enlaces = signal<EnlaceRow[]>([]);
  protected readonly capturas = signal<CapturaRow[]>([]);
  protected readonly creando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected nuevaEtiqueta = '';
  protected nuevoMaxCapturas = 1;
  protected nuevaExpiraEn = ''; // datetime-local; vacío = sin expiración
  protected nuevoPretextoEtiqueta = 'Un lugar interesante';

  // Punto de pretexto elegido en el mini-mapa (lo que verá el Usuario B). Default:
  // el mismo que antes estaba fijo en el código, ahora solo como valor inicial.
  // Son signals (no campos planos) porque la app es zoneless: un callback de Leaflet
  // (click/dragend) corre fuera de Angular y mutar un campo plano no refresca la vista.
  protected readonly pretextoLat = signal(-12.0464);
  protected readonly pretextoLon = signal(-77.0428);

  // --- Selección de qué ubicaciones se muestran en el mapa ---
  // Por defecto el mapa solo muestra 1 marcador (la captura más reciente); las demás
  // quedan guardadas pero ocultas, y se revelan haciendo click en la tarjeta de su
  // enlace en "Mis enlaces" (selección múltiple: se pueden activar varias a la vez).

  /** La captura más reciente con ubicación válida, por cada enlace (una por tarjeta). */
  protected readonly capturaPorEnlace = computed<Map<string, CapturaRow>>(() => {
    const mapa = new Map<string, CapturaRow>();
    for (const captura of this.capturas()) {
      if (captura.latitud == null || captura.longitud == null) {
        continue;
      }
      // capturas() viene ordenado por capturado_en desc, así que la primera que
      // encontramos para cada enlace_id ya es la más reciente de ese enlace.
      if (!mapa.has(captura.enlace_id)) {
        mapa.set(captura.enlace_id, captura);
      }
    }
    return mapa;
  });

  /** El enlace dueño de la captura más reciente entre TODOS los enlaces. */
  protected readonly ultimoEnlaceId = computed<string | null>(() => {
    const masReciente = this.capturas().find(
      (c) => c.latitud != null && c.longitud != null,
    );
    return masReciente?.enlace_id ?? null;
  });

  protected readonly enlacesSeleccionados = signal<ReadonlySet<string>>(new Set());
  private ultimoEnlaceIdVisto: string | null = null;

  constructor() {
    this.inicializar();

    // Activa automáticamente la tarjeta/marcador de la captura más reciente apenas
    // se sabe cuál es (al cargar, o cuando llega una nueva por Realtime). No toca
    // selecciones que el usuario ya haya hecho a mano, solo agrega esta.
    effect(() => {
      const actual = this.ultimoEnlaceId();
      if (actual && actual !== this.ultimoEnlaceIdVisto) {
        this.ultimoEnlaceIdVisto = actual;
        this.enlacesSeleccionados.update((set) => new Set(set).add(actual));
      }
    });

    // Redibuja los marcadores del mapa según qué enlaces estén seleccionados ahora.
    effect(() => {
      this.actualizarMarcadores(this.enlacesSeleccionados(), this.capturaPorEnlace());
    });
  }

  protected tieneUbicacion(enlaceId: string): boolean {
    return this.capturaPorEnlace().has(enlaceId);
  }

  protected estaSeleccionado(enlaceId: string): boolean {
    return this.enlacesSeleccionados().has(enlaceId);
  }

  protected esLaUltima(enlaceId: string): boolean {
    return this.ultimoEnlaceId() === enlaceId;
  }

  /** Muestra/oculta en el mapa la ubicación capturada por este enlace (si tiene una). */
  protected toggleUbicacion(enlaceId: string): void {
    if (!this.capturaPorEnlace().has(enlaceId)) {
      return;
    }
    this.enlacesSeleccionados.update((set) => {
      const copia = new Set(set);
      if (copia.has(enlaceId)) {
        copia.delete(enlaceId);
      } else {
        copia.add(enlaceId);
      }
      return copia;
    });
  }

  async ngAfterViewInit(): Promise<void> {
    configurarMaplibreWorker();

    if (this.mapaContainer) {
      this.map = L.map(this.mapaContainer.nativeElement, {
        center: [0, 0],
        zoom: 2,
      });
      L.maplibreGL({ style: 'https://tiles.openfreemap.org/styles/liberty' }).addTo(this.map);
    }

    if (this.mapaPretextoContainer) {
      this.mapaPretexto = L.map(this.mapaPretextoContainer.nativeElement, {
        center: [this.pretextoLat(), this.pretextoLon()],
        zoom: 12,
      });
      L.maplibreGL({ style: 'https://tiles.openfreemap.org/styles/liberty' }).addTo(
        this.mapaPretexto,
      );
      this.marcadorPretexto = L.marker([this.pretextoLat(), this.pretextoLon()], {
        draggable: true,
        icon: iconoPretexto(),
      }).addTo(this.mapaPretexto);

      this.marcadorPretexto.on('dragend', () => this.actualizarPretextoDesdeMarcador());
      this.mapaPretexto.on('click', (evento: L.LeafletMouseEvent) => {
        this.marcadorPretexto?.setLatLng(evento.latlng);
        this.actualizarPretextoDesdeMarcador();
      });
    }

    // Leaflet mide el contenedor una sola vez al crear el mapa. Si la ventana
    // cambia de tamaño después (resize del navegador, rotar el celular), hay
    // que avisarle explícitamente o se queda con el tamaño viejo (mapa a medias).
    window.addEventListener('resize', this.alRedimensionar);
  }

  private readonly alRedimensionar = (): void => {
    this.map?.invalidateSize();
    this.mapaPretexto?.invalidateSize();
  };

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.alRedimensionar);
    clearTimeout(this.temporizadorCopiado);
    this.canalRealtime?.unsubscribe();
    this.map?.remove();
    this.mapaPretexto?.remove();
  }

  private actualizarPretextoDesdeMarcador(): void {
    const posicion = this.marcadorPretexto?.getLatLng();
    if (posicion) {
      this.pretextoLat.set(posicion.lat);
      this.pretextoLon.set(posicion.lng);
    }
  }

  private async inicializar(): Promise<void> {
    const { data } = await this.supabase.client.auth.getUser();
    this.usuarioId = data.user?.id ?? null;

    await Promise.all([this.cargarEnlaces(), this.cargarCapturas()]);
    this.suscribirRealtime();
  }

  private async cargarEnlaces(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('enlaces')
      .select(
        'id, token, etiqueta, activo, max_capturas, creado_en, expira_en, pretexto_lat, pretexto_lon, pretexto_etiqueta',
      )
      .order('creado_en', { ascending: false });

    if (!error && data) {
      this.enlaces.set(data as EnlaceRow[]);
    }
  }

  private async cargarCapturas(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('ubicaciones_capturadas')
      .select('id, enlace_id, latitud, longitud, precision_metros, metodo, capturado_en')
      .order('capturado_en', { ascending: false })
      .limit(200);

    if (!error && data) {
      this.capturas.set(data as CapturaRow[]);
    }
  }

  /**
   * Realtime respeta la policy de SELECT de la tabla: solo llegan los INSERT de
   * capturas cuyo enlace le pertenece a este usuario (ver migración 0004).
   */
  private suscribirRealtime(): void {
    this.canalRealtime = this.supabase.client
      .channel('dashboard-ubicaciones')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ubicaciones_capturadas' },
        (payload) => {
          const nueva = payload.new as CapturaRow;
          this.capturas.update((lista) => [nueva, ...lista]);
        },
      )
      .subscribe();
  }

  protected async crearEnlace(): Promise<void> {
    if (!this.usuarioId) {
      return;
    }
    this.error.set(null);
    this.creando.set(true);

    const { data, error } = await this.supabase.client
      .from('enlaces')
      .insert({
        creado_por: this.usuarioId,
        etiqueta: this.nuevaEtiqueta.trim() || null,
        max_capturas: this.nuevoMaxCapturas > 0 ? this.nuevoMaxCapturas : 1,
        expira_en: this.nuevaExpiraEn ? new Date(this.nuevaExpiraEn).toISOString() : null,
        pretexto_lat: this.pretextoLat(),
        pretexto_lon: this.pretextoLon(),
        pretexto_etiqueta: this.nuevoPretextoEtiqueta.trim() || 'Un lugar interesante',
      })
      .select(
        'id, token, etiqueta, activo, max_capturas, creado_en, expira_en, pretexto_lat, pretexto_lon, pretexto_etiqueta',
      )
      .single();

    this.creando.set(false);

    if (error || !data) {
      this.error.set(error?.message ?? 'No se pudo crear el enlace.');
      return;
    }

    this.enlaces.update((lista) => [data as EnlaceRow, ...lista]);
    this.nuevaEtiqueta = '';
    this.nuevoMaxCapturas = 1;
    this.nuevaExpiraEn = '';
    this.nuevoPretextoEtiqueta = 'Un lugar interesante';
    // El punto de pretexto (pretextoLat/Lon) se deja como está: lo normal es generar
    // varios enlaces seguidos para el mismo lugar/pretexto sin tener que re-elegirlo.
  }

  protected async desactivarEnlace(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('enlaces')
      .update({ activo: false })
      .eq('id', id);

    if (!error) {
      this.enlaces.update((lista) =>
        lista.map((e) => (e.id === id ? { ...e, activo: false } : e)),
      );
    }
  }

  protected urlDe(token: string): string {
    return `${location.origin}/r/${token}`;
  }

  // Id del enlace cuyo "¡Copiado!" se está mostrando ahora mismo (null = ninguno).
  protected readonly copiadoId = signal<string | null>(null);
  private temporizadorCopiado?: ReturnType<typeof setTimeout>;

  protected async copiarUrl(enlace: EnlaceRow): Promise<void> {
    if (!enlace.activo) {
      return;
    }
    try {
      await navigator.clipboard.writeText(this.urlDe(enlace.token));
      this.copiadoId.set(enlace.id);
      clearTimeout(this.temporizadorCopiado);
      this.temporizadorCopiado = setTimeout(() => this.copiadoId.set(null), 1800);
    } catch {
      // Clipboard puede fallar por permisos del navegador; no es crítico para el flujo.
    }
  }

  /** Las claves de `marcadores` son `enlace_id` (un marcador por enlace seleccionado). */
  private actualizarMarcadores(
    seleccionados: ReadonlySet<string>,
    porEnlace: Map<string, CapturaRow>,
  ): void {
    if (!this.map) {
      return;
    }

    // Quita del mapa los marcadores de enlaces que ya no están seleccionados.
    for (const [enlaceId, marcador] of this.marcadores) {
      if (!seleccionados.has(enlaceId)) {
        marcador.remove();
        this.marcadores.delete(enlaceId);
      }
    }

    const ultimoId = this.ultimoEnlaceId();

    for (const enlaceId of seleccionados) {
      const captura = porEnlace.get(enlaceId);
      if (!captura || captura.latitud == null || captura.longitud == null) {
        continue;
      }

      const texto = this.textoPopupCaptura(captura);
      const icono = enlaceId === ultimoId ? iconoCapturaReciente() : iconoCaptura();
      const existente = this.marcadores.get(enlaceId);

      if (existente) {
        existente.setPopupContent(texto);
        existente.setIcon(icono);
        continue;
      }

      const marcador = L.marker([captura.latitud, captura.longitud], { icon: icono })
        .addTo(this.map)
        .bindPopup(texto);
      this.marcadores.set(enlaceId, marcador);
    }
  }

  /** Arma el texto del popup, agregando la etiqueta interna del enlace si se puso una. */
  private textoPopupCaptura(captura: CapturaRow): string {
    const base = `${captura.metodo.toUpperCase()} · ${new Date(captura.capturado_en).toLocaleString()}`;
    const etiqueta = this.enlaces().find((e) => e.id === captura.enlace_id)?.etiqueta;
    return etiqueta ? `${base} · ${etiqueta}` : base;
  }

  async cerrarSesion(): Promise<void> {
    await this.supabase.client.auth.signOut();
    this.router.navigateByUrl('/dashboard/login');
  }
}
