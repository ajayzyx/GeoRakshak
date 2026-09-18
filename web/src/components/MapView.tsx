import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// MapLibre resolves its worker next to its own module URL, which does not exist after Vite
// pre-bundling or production bundling. Point it at the Vite-built worker instead.
setWorkerUrl(maplibreWorkerUrl);
import type {
  Feature,
  FeatureCollection,
  HistoricalLandslideProps,
  LandcoverProps,
  LocationProps,
  Pilot,
  Report,
  RiskZoneCollection,
  RoadSegmentCollection,
  SatelliteLayer,
  SensorStationProps,
} from "../api/types";
import { severityColorExpression } from "../lib/severity";
import { landcoverColorExpression, roadColorExpression } from "../lib/labels";

export type LayerKey = "risk" | "landcover" | "landslides" | "locations" | "roads" | "stations" | "reports" | "satellite";

export type MapSelection =
  | { kind: "cell"; id: string }
  | { kind: "report"; id: string }
  | { kind: "road"; id: string }
  | { kind: "station"; id: string }
  | { kind: "location"; id: string }
  | { kind: "landslide"; id: string };

interface Props {
  pilot: Pilot;
  basemapStyleUrl: string | null;
  riskZones: RiskZoneCollection | null;
  roads: RoadSegmentCollection | null;
  locations: FeatureCollection<LocationProps> | null;
  landslides: FeatureCollection<HistoricalLandslideProps> | null;
  landcover: FeatureCollection<LandcoverProps> | null;
  stations: FeatureCollection<SensorStationProps> | null;
  reports: Report[] | null;
  satellite: SatelliteLayer[] | null;
  visible: Record<LayerKey, boolean>;
  forecast: boolean;
  selected: MapSelection | null;
  onSelect: (s: MapSelection) => void;
  /** Pan to this point when `key` changes (selection from a list rather than a map click). */
  focus?: { center: [number, number]; key: number } | null;
}

type AddLayerArg = Parameters<MlMap["addLayer"]>[0];
type MapStyle = ConstructorParameters<typeof MlMap>[0]["style"];

const EMPTY = { type: "FeatureCollection" as const, features: [] };

// MapLibre drops non-numeric top-level feature ids, so the UUID is copied into properties._id.
function withIds<P extends object>(features: Feature<P>[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({ type: "Feature", geometry: f.geometry as GeoJSON.Geometry, properties: { ...f.properties, _id: f.id ?? null } })),
  };
}

function plainStyle(): MapStyle {
  // No third-party basemap by default (decision H5): a plain background plus our own GeoJSON layers.
  return { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef1ec" } }] };
}

const LAYER_GROUPS: Record<LayerKey, string[]> = {
  risk: ["risk-fill", "risk-outline", "risk-forecast-outline"],
  landcover: ["landcover-fill"],
  landslides: ["landslides-circle"],
  locations: ["locations-circle"],
  roads: ["roads-line"],
  stations: ["stations-circle"],
  reports: ["reports-circle"],
  satellite: [],
};

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState<{ risk: number; roads: number } | null>(null);
  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;

  useEffect(() => {
    if (!container.current) return;
    const [minLon, minLat, maxLon, maxLat] = props.pilot.bbox;
    const map = new MlMap({
      container: container.current,
      style: props.basemapStyleUrl ?? plainStyle(),
      bounds: [[minLon, minLat], [maxLon, maxLat]],
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("error", (e) => console.error("[map]", e.error?.message ?? e));

    map.on("load", () => {
      const src = (id: string) => map.addSource(id, { type: "geojson", data: EMPTY });
      ["boundary", "risk", "landcover", "roads", "locations", "landslides", "stations", "reports"].forEach(src);
      if (props.pilot.boundary) {
        (map.getSource("boundary") as GeoJSONSource).setData({ type: "Feature", geometry: props.pilot.boundary as GeoJSON.Geometry, properties: {} });
      }
      const layers: AddLayerArg[] = [
        // Land cover sits under the risk fill: it is context, and risk stays readable on top.
        { id: "landcover-fill", type: "fill", source: "landcover", layout: { visibility: "none" }, paint: { "fill-color": landcoverColorExpression() as never, "fill-opacity": 0.75 } },
        { id: "risk-fill", type: "fill", source: "risk", paint: { "fill-color": severityColorExpression() as never, "fill-opacity": 0.55 } },
        { id: "risk-outline", type: "line", source: "risk", paint: { "line-color": "#ffffff", "line-width": 0.3, "line-opacity": 0.6 } },
        { id: "risk-forecast-outline", type: "line", source: "risk", layout: { visibility: "none" }, paint: { "line-color": "#37474f", "line-width": 0.6, "line-dasharray": [2, 2] } },
        { id: "risk-selected", type: "line", source: "risk", filter: ["==", ["get", "_id"], ""], paint: { "line-color": "#000000", "line-width": 2.5 } },
        { id: "boundary-line", type: "line", source: "boundary", paint: { "line-color": "#263238", "line-width": 1.5, "line-dasharray": [4, 2] } },
        { id: "roads-line", type: "line", source: "roads", layout: { "line-cap": "round" }, paint: { "line-color": roadColorExpression() as never, "line-width": 4 } },
        { id: "locations-circle", type: "circle", source: "locations", paint: { "circle-radius": 6, "circle-color": "#1565c0", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } },
        { id: "landslides-circle", type: "circle", source: "landslides", paint: { "circle-radius": 5, "circle-color": "#6d4c41", "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        { id: "stations-circle", type: "circle", source: "stations", paint: { "circle-radius": 6, "circle-color": "#00897b", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
        { id: "reports-circle", type: "circle", source: "reports", paint: { "circle-radius": 8, "circle-color": ["match", ["get", "verification_status"], "VERIFIED", "#2e7d32", "REJECTED", "#9e9e9e", "#8e24aa"] as never, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
      ];
      layers.forEach((l) => map.addLayer(l));

      const clickable: [string, MapSelection["kind"]][] = [
        ["reports-circle", "report"],
        ["stations-circle", "station"],
        ["locations-circle", "location"],
        ["landslides-circle", "landslide"],
        ["roads-line", "road"],
        ["risk-fill", "cell"],
      ];
      map.on("click", (e) => {
        const ids = clickable.map(([l]) => l).filter((l) => map.getLayer(l) && map.getLayoutProperty(l, "visibility") !== "none");
        const hits = map.queryRenderedFeatures(e.point, { layers: ids });
        for (const [layer, kind] of clickable) {
          const hit = hits.find((h) => h.layer.id === layer);
          const id = hit?.properties?._id;
          if (typeof id === "string") {
            onSelectRef.current({ kind, id } as MapSelection);
            return;
          }
        }
      });
      // Rendered-feature counts on the container let tests and smoke scripts assert real rendering.
      map.on("idle", () => {
        const count = (layer: string) => (map.getLayer(layer) ? map.queryRenderedFeatures({ layers: [layer] }).length : 0);
        setRendered((prev) => {
          const next = { risk: count("risk-fill"), roads: count("roads-line") };
          return prev && prev.risk === next.risk && prev.roads === next.roads ? prev : next;
        });
      });
      clickable.forEach(([l]) => {
        map.on("mouseenter", l, (_e: MapLayerMouseEvent) => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      });
      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // The map is created once per pilot/basemap; data updates are applied by the effects below.
  }, [props.pilot, props.basemapStyleUrl]);

  const setSource = (id: string, data: GeoJSON.FeatureCollection) => {
    const s = mapRef.current?.getSource(id) as GeoJSONSource | undefined;
    if (s) void s.setData(data);
  };

  useEffect(() => { if (ready) setSource("risk", props.riskZones ? withIds(props.riskZones.features) : EMPTY); }, [ready, props.riskZones]);
  useEffect(() => { if (ready) setSource("roads", props.roads ? withIds(props.roads.features) : EMPTY); }, [ready, props.roads]);
  useEffect(() => { if (ready) setSource("locations", props.locations ? withIds(props.locations.features) : EMPTY); }, [ready, props.locations]);
  useEffect(() => { if (ready) setSource("landslides", props.landslides ? withIds(props.landslides.features) : EMPTY); }, [ready, props.landslides]);
  useEffect(() => { if (ready) setSource("landcover", props.landcover ? withIds(props.landcover.features) : EMPTY); }, [ready, props.landcover]);
  useEffect(() => { if (ready) setSource("stations", props.stations ? withIds(props.stations.features) : EMPTY); }, [ready, props.stations]);
  useEffect(() => {
    if (!ready) return;
    const feats = (props.reports ?? []).map((r) => ({ type: "Feature" as const, id: r.id, geometry: r.location, properties: { verification_status: r.verification_status, reporter_role: r.reporter_role, category: r.category } }));
    setSource("reports", withIds(feats));
  }, [ready, props.reports]);

  // Satellite image overlays (only layers the API says are renderable; acquisition dates shown in the side panel).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const renderable = (props.satellite ?? []).filter((l) => l.display?.type === "image" && l.display.url);
    renderable.forEach((l) => {
      const sid = `sat-${l.slug}`;
      if (!l.bounds) return; // No bounds reported: nothing can be placed on the map honestly.
      const [w, s, e, n] = l.bounds;
      if (!map.getSource(sid)) {
        map.addSource(sid, { type: "image", url: l.display!.url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
        map.addLayer({ id: sid, type: "raster", source: sid, paint: { "raster-opacity": 0.7 } }, "risk-fill");
      }
      map.setLayoutProperty(sid, "visibility", props.visible.satellite ? "visible" : "none");
    });
  }, [ready, props.satellite, props.visible.satellite]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (Object.keys(LAYER_GROUPS) as LayerKey[]).forEach((k) => {
      LAYER_GROUPS[k].forEach((id) => {
        if (id === "risk-forecast-outline") {
          map.setLayoutProperty(id, "visibility", props.visible.risk && props.forecast ? "visible" : "none");
        } else if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", props.visible[k] ? "visible" : "none");
        }
      });
    });
    map.setPaintProperty("risk-fill", "fill-opacity", props.forecast ? 0.4 : 0.55);
  }, [ready, props.visible, props.forecast]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const id = props.selected?.kind === "cell" ? props.selected.id : "";
    map.setFilter("risk-selected", ["==", ["get", "_id"], id]);
  }, [ready, props.selected]);

  const focusKey = props.focus?.key;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !props.focus) return;
    map.easeTo({ center: props.focus.center, zoom: Math.max(map.getZoom(), 13), duration: 600 });
    // Only a new focus key should move the map.
  }, [ready, focusKey]);

  return (
    <div
      ref={container}
      className="map"
      role="region"
      aria-label="Risk map"
      data-testid="map"
      data-map-ready={ready ? "true" : "false"}
      data-risk-features={props.riskZones ? props.riskZones.features.length : ""}
      data-risk-rendered={rendered ? rendered.risk : ""}
      data-landcover-features={props.landcover ? props.landcover.features.length : ""}
      data-roads-rendered={rendered ? rendered.roads : ""}
    />
  );
}
