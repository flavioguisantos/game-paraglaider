import * as THREE from 'three';
import { decompressSync } from 'fflate';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { createUrbanScenery } from './urbanScenery.js';
import { DEFAULT_FLIGHT_LOCATION } from './flightLocations.js';

const DEFAULT_OPTIONS = {
  manifestUrl: '/mapas/processed/BRA_SUDESTE_HighRes/manifest.json',
  // Local geografico que sera mapeado para a origem do mundo (x=0, z=0).
  centerLatitude: DEFAULT_FLIGHT_LOCATION.latitude,
  centerLongitude: DEFAULT_FLIGHT_LOCATION.longitude,
  chunkSegments: 96,
  loadRadius: 1,
  unloadRadius: 2,
  // Anel de relevo distante (apenas visual): tiles reais em malha grossa entre
  // loadRadius e distantLoadRadius, sem vetores/mar/urbano e fora da fisica.
  distantLoadRadius: 2,
  distantChunkSegments: 24,
  horizontalScale: 1,
  heightScale: 1,
  referenceElevation: 0,
  fallbackHeight: 1360,
  vectorYOffset: 0.55,
  labelYOffset: 4,
  labelScale: 10,
  osmOverlayEnabled: true,
  osmVectorTileUrl: 'https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt',
  osmVectorZoom: 12,
  osmDetailZoom: 14,
  osmDetailTileRadius: 1,
  osmRequestTimeoutMs: 15000
};

const TERRAIN_ASSET_VERSION = 'terrain-rgb-binary-5';
const OSM_ATTRIBUTION_HTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const OSM_DETAIL_CATEGORIES = new Set(['osm_buildings', 'osm_poi', 'osm_landuse', 'osm_urban_areas']);
const OSM_MAJOR_ROAD_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const OSM_URBAN_COVERAGE_CELL_METERS = 96;
const OSM_VEGETATION_BLOCK_LAND_KINDS = new Set([
  'commercial',
  'brownfield',
  'construction',
  'farmyard',
  'garages',
  'greenfield',
  'hospital',
  'industrial',
  'military',
  'parking',
  'residential',
  'retail',
  'school',
  'college',
  'university'
]);
// A superficie do mar fica no nivel do mar original (y=0), como o relevo.
const OCEAN_SURFACE_HEIGHT = 0;
// Tamanho em unidades de mundo de um ciclo da textura de ondas do mar.
const SEA_WAVE_REPEAT_WORLD_UNITS = 260;
// O leito do mar e afundado na malha para separar a lamina d'agua do fundo
// alem da resolucao do depth buffer a distancia (evita z-fighting/piscar);
// de quebra, a agua translucida ganha leitura de profundidade na costa.
const SEABED_WORLD_HEIGHT = -6;
const NO_DATA_ELEVATION_THRESHOLD = -1000;
const SEA_LEVEL_ELEVATION = 0;
const COASTAL_SAND_MAX_ELEVATION = 45;
const COASTAL_SAND_SEARCH_PIXELS = 5;
const tempTile = { x: 0, y: 0 };
// Camadas vetoriais renderizadas de forma realista sobre o relevo:
// - ribbon: fita de geometria com largura real em metros drapejada no terreno
//   (estradas de asfalto, estradas de terra, ferrovias, rios).
// - area: contornos encadeados em aneis e preenchidos por triangulacao
//   (agua com superficie plana; area urbana translucida drapejada).
// - point: apenas rotulos (sem marcadores geometricos).
const VECTOR_LAYER_STYLES = {
  // Estradas/ferrovias recebem textura procedural (asfalto com faixas, terra
  // batida, dormentes) mapeada ao longo da fita; texture/metersPerRepeat
  // controlam o padrao. Agua usa material reflexivo do ceu (roughness baixa).
  city_area: { type: 'area', color: 0x9d9489, opacity: 0.5, flat: false, yOffset: 1.0 },
  water_area: { type: 'area', color: 0x2f6795, opacity: 1, flat: true, yOffset: 1.3, roughness: 0.12 },
  water_line: { type: 'ribbon', color: 0x35719f, widthMeters: 14, yOffset: 1.2, roughness: 0.3 },
  roadbig_line: { type: 'ribbon', color: 0xffffff, widthMeters: 26, yOffset: 2.0, texture: 'highway', metersPerRepeat: 24 },
  roadmedium_line: { type: 'ribbon', color: 0xffffff, widthMeters: 16, yOffset: 1.8, texture: 'asphalt', metersPerRepeat: 24 },
  roadsmall_line: { type: 'ribbon', color: 0xffffff, widthMeters: 9, yOffset: 1.5, texture: 'dirt', metersPerRepeat: 18 },
  railway_line: { type: 'ribbon', color: 0xffffff, widthMeters: 6, yOffset: 2.2, texture: 'railway', metersPerRepeat: 6 },
  city_point: { type: 'point', color: 0xffffff, opacity: 1, yOffset: 3.5 },
  town_point: { type: 'point', color: 0xffffff, opacity: 0.92, yOffset: 3.2 },
  suburb_point: { type: 'point', color: 0xf0f4f8, opacity: 0.78, yOffset: 2.8 },
  village_point: { type: 'point', color: 0xf0f4f8, opacity: 0.72, yOffset: 2.6 },
  osm_roads_major: { type: 'ribbon', color: 0xffffff, widthMeters: 26, yOffset: 3.15, texture: 'highway', metersPerRepeat: 24 },
  osm_roads: { type: 'ribbon', color: 0xffffff, widthMeters: 12, yOffset: 3.1, texture: 'asphalt', metersPerRepeat: 24 },
  osm_railways: { type: 'ribbon', color: 0xc9c1b7, widthMeters: 5, yOffset: 3.2, roughness: 0.88 },
  osm_water_lines: { type: 'ribbon', color: 0x5eb5e7, widthMeters: 10, yOffset: 2.8, roughness: 0.28 },
  osm_water_areas: { type: 'area', color: 0x4b91c7, opacity: 0.72, flat: false, yOffset: 2.3, roughness: 0.22 },
  osm_urban_areas: { type: 'area', color: 0xc9c6bd, opacity: 1, flat: false, yOffset: 2.05, roughness: 0.98 },
  osm_urban_inferred: { type: 'area', color: 0xb9b8b1, opacity: 1, flat: false, yOffset: 1.95, roughness: 0.98 },
  osm_landuse: { type: 'area', color: 0xc4b58d, opacity: 0.24, flat: false, yOffset: 1.8, roughness: 0.95 },
  osm_natural: { type: 'area', color: 0x6fa46d, opacity: 0.2, flat: false, yOffset: 1.9, roughness: 0.96 },
  osm_places: { type: 'point', color: 0xfafcff, opacity: 0.95, yOffset: 4.2 },
  osm_poi: { type: 'point', color: 0xffe8a8, opacity: 0.92, yOffset: 3.6 },
  osm_aeroway: { type: 'ribbon', color: 0xd8e0e8, widthMeters: 16, yOffset: 3.0, roughness: 0.7 },
  osm_power: { type: 'ribbon', color: 0xff9b64, widthMeters: 4, yOffset: 3.5, roughness: 0.82 },
  osm_boundaries: { type: 'ribbon', color: 0xf59ac1, widthMeters: 3, yOffset: 3.6, roughness: 0.9 },
  osm_buildings: { type: 'area', color: 0xd8cec1, opacity: 0.3, flat: false, yOffset: 2.0, roughness: 0.9 }
};

export function createTerrain(options = {}) {
  return new LocalXcmTerrain({ ...DEFAULT_OPTIONS, ...options });
}

class LocalXcmTerrain {
  constructor(config) {
    this.config = config;
    this.mesh = new THREE.Group();
    this.mesh.name = 'LocalXcmTerrain';
    this.reliefGroup = new THREE.Group();
    this.reliefGroup.name = 'XcmReliefLayer';
    this.vectorGroup = new THREE.Group();
    this.vectorGroup.name = 'XcmVectorOverlayLayer';
    this.osmOverlayGroup = new THREE.Group();
    this.osmOverlayGroup.name = 'OsmOverlayLayer';
    this.urbanScenery = createUrbanScenery({ terrain: this });
    // Lamina d'agua do mar aberto: um quad por chunk que contem pixels de
    // mar (nunca avanca sobre chunks de terra nem alem do raio carregado),
    // com UVs em coordenadas de mundo para as ondas continuarem entre chunks.
    // Ligado apenas em locais costeiros (setSeaEnabled).
    this.seaGroup = new THREE.Group();
    this.seaGroup.name = 'SeaSurface';
    this.seaGroup.visible = false;
    this.seaMaterial = null;
    this.oceanTime = 0;
    this.mesh.add(
      this.reliefGroup,
      this.vectorGroup,
      this.osmOverlayGroup,
      this.urbanScenery.group,
      this.seaGroup
    );
    this.size = 0;
    this.segments = config.chunkSegments * (config.loadRadius * 2 + 1);
    this.source = 'xcm-local-loading';
    this.manifest = null;
    this.centerPixel = null;
    this.worldUnitsPerPixelX = 1;
    this.worldUnitsPerPixelY = 1;
    this.worldUnitsPerMeter = config.horizontalScale;
    this.chunkWorldWidth = 0;
    this.chunkWorldDepth = 0;
    this.chunks = new Map();
    this.loadingChunks = new Set();
    this.failedChunks = new Set();
    // Chunks distantes ficam fora de this.chunks de proposito: getHeightAt e
    // getRenderedHeightAt (fisica/plantio) so enxergam os chunks de alta resolucao.
    this.distantChunks = new Map();
    this.loadingDistantChunks = new Set();
    this.failedDistantChunks = new Set();
    this.availableVectorTiles = new Set();
    this.vectorMaterials = new Map();
    this.labelTextureCache = new Map();
    this.layerVisibility = new Map();
    this.osmOverlayEnabled = Boolean(config.osmOverlayEnabled);
    this.osmOverlayGroup.visible = this.osmOverlayEnabled;
    this.osmDebug = {
      loadedChunks: 0,
      loadedTiles: 0,
      emptyChunks: 0,
      failedChunks: 0,
      vegetationMaskAreas: 0,
      vegetationMaskRoads: 0,
      inferredUrbanCells: 0,
      lastError: '',
      featureCounts: {}
    };
    this.osmTilePromises = new Map();
    this.centerRevision = 0;
    this.isReady = false;

    if (typeof fetch !== 'undefined' && typeof document !== 'undefined') {
      this.ready = this.loadManifest(config.manifestUrl)
        .then(() => {
          this.isReady = true;
          this.update(new THREE.Vector3(0, 0, 0));
          this.source = 'xcm-local';
        })
        .catch((error) => {
          console.warn('Nao foi possivel carregar o manifesto XCM local. Terreno fica plano.', error);
          this.source = 'flat-fallback';
        });
    } else {
      this.ready = Promise.resolve();
      this.source = 'flat-fallback';
      this.isReady = true;
    }
  }

  async loadManifest(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Manifest HTTP ${response.status}: ${url}`);
    }

    this.manifestUrl = url;
    this.manifestBaseUrl = url.slice(0, url.lastIndexOf('/') + 1);
    this.manifest = await response.json();
    this.availableVectorTiles = new Set(this.manifest.vectors?.available ?? []);
    this.applyCenterCoordinates(this.config.centerLatitude, this.config.centerLongitude);
  }

  setCenterCoordinates({ latitude, longitude }) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    if (
      latitude === this.config.centerLatitude
      && longitude === this.config.centerLongitude
    ) {
      return;
    }

    this.config.centerLatitude = latitude;
    this.config.centerLongitude = longitude;
    this.centerRevision += 1;

    for (const key of [...this.chunks.keys()]) {
      this.unloadChunk(key);
    }
    for (const key of [...this.distantChunks.keys()]) {
      this.unloadDistantChunk(key);
    }

    this.loadingChunks.clear();
    this.failedChunks.clear();
    this.loadingDistantChunks.clear();
    this.failedDistantChunks.clear();

    if (this.manifest) {
      this.applyCenterCoordinates(latitude, longitude);
      this.update(new THREE.Vector3(0, 0, 0));
    }
  }

  applyCenterCoordinates(latitude, longitude) {
    this.centerPixel = lonLatToPixel(
      longitude,
      latitude,
      this.manifest.source.worldFile
    );
    const pixelScale = getMetersPerPixel(latitude, this.manifest.source.worldFile);
    this.worldUnitsPerPixelX = pixelScale.x * this.config.horizontalScale;
    this.worldUnitsPerPixelY = pixelScale.y * this.config.horizontalScale;
    this.worldUnitsPerMeter = this.config.horizontalScale;
    this.chunkWorldWidth = this.worldUnitsPerPixelX * this.manifest.terrain.tileSize;
    this.chunkWorldDepth = this.worldUnitsPerPixelY * this.manifest.terrain.tileSize;
    this.size = Math.max(this.chunkWorldWidth, this.chunkWorldDepth) * (this.config.loadRadius * 2 + 1);
    this.segments = this.config.chunkSegments * (this.config.loadRadius * 2 + 1);
  }

  update(position, delta = 0) {
    if (!this.manifest || !this.centerPixel) return;

    const centerTile = this.getTileForWorld(position.x, position.z);
    const keepKeys = new Set();

    for (let y = centerTile.y - this.config.loadRadius; y <= centerTile.y + this.config.loadRadius; y += 1) {
      for (let x = centerTile.x - this.config.loadRadius; x <= centerTile.x + this.config.loadRadius; x += 1) {
        if (!this.isValidTile(x, y)) continue;
        const key = getChunkKey(x, y);
        keepKeys.add(key);
        if (!this.chunks.has(key) && !this.loadingChunks.has(key) && !this.failedChunks.has(key)) {
          this.loadChunk(x, y);
        }
      }
    }

    for (const [key, chunk] of this.chunks) {
      const distance = Math.max(
        Math.abs(chunk.tileX - centerTile.x),
        Math.abs(chunk.tileY - centerTile.y)
      );
      if (distance > this.config.unloadRadius && !keepKeys.has(key)) {
        this.unloadChunk(key);
      }
    }

    this.updateDistantChunks(centerTile);
    this.urbanScenery.update(delta);
    this.updateSeaWaves(delta);
  }

  // Mantem o anel de relevo distante em volta dos chunks completos. Um tile so
  // vira chunk distante enquanto nao existe (nem esta carregando) em alta
  // resolucao; quando o jogador se aproxima, o load normal assume e a versao
  // grossa e removida so depois que a malha completa chega (sem buracos).
  updateDistantChunks(centerTile) {
    const inner = this.config.loadRadius;
    const outer = this.config.distantLoadRadius;
    if (!(outer > inner)) return;

    for (let y = centerTile.y - outer; y <= centerTile.y + outer; y += 1) {
      for (let x = centerTile.x - outer; x <= centerTile.x + outer; x += 1) {
        const ring = Math.max(Math.abs(x - centerTile.x), Math.abs(y - centerTile.y));
        if (ring <= inner || !this.isValidTile(x, y)) continue;

        const key = getChunkKey(x, y);
        if (this.distantChunks.has(key) || this.loadingDistantChunks.has(key) || this.failedDistantChunks.has(key)) continue;
        if (this.chunks.has(key) || this.loadingChunks.has(key)) continue;
        this.loadDistantChunk(x, y);
      }
    }

    for (const [key, chunk] of this.distantChunks) {
      const distance = Math.max(
        Math.abs(chunk.tileX - centerTile.x),
        Math.abs(chunk.tileY - centerTile.y)
      );
      if (distance > outer + 1 || this.chunks.has(key)) {
        this.unloadDistantChunk(key);
      }
    }
  }

  async loadDistantChunk(tileX, tileY) {
    const key = getChunkKey(tileX, tileY);
    const revision = this.centerRevision;
    this.loadingDistantChunks.add(key);

    try {
      const imageData = await loadImageData(this.getTileUrl(tileX, tileY));
      if (revision !== this.centerRevision || this.chunks.has(key) || this.distantChunks.has(key)) return;

      const mesh = this.createChunkMesh(tileX, tileY, imageData, this.config.distantChunkSegments);
      // Longe demais para o frustum de sombra; economiza o custo do shadow pass.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // Lamina d'agua tambem no anel distante, para o mar continuar reflexivo
      // (a grade grossa so alarga a faixa de costa sem agua, ja encoberta pela nevoa).
      const seaMesh = this.createSeaMeshIfNeeded(tileX, tileY, imageData, this.config.distantChunkSegments);
      this.distantChunks.set(key, { tileX, tileY, imageData, mesh, seaMesh });
      this.reliefGroup.add(mesh);
    } catch (error) {
      if (revision === this.centerRevision) {
        this.failedDistantChunks.add(key);
        console.warn(`Nao foi possivel carregar chunk distante XCM ${key}`, error);
      }
    } finally {
      this.loadingDistantChunks.delete(key);
    }
  }

  unloadDistantChunk(key) {
    const chunk = this.distantChunks.get(key);
    if (!chunk) return;

    this.reliefGroup.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    if (chunk.seaMesh) {
      this.seaGroup.remove(chunk.seaMesh);
      // O material do mar e compartilhado; descarta apenas a geometria.
      chunk.seaMesh.geometry.dispose();
    }
    this.distantChunks.delete(key);
  }

  setSeaEnabled(enabled) {
    this.seaGroup.visible = Boolean(enabled);
  }

  setReliefVisibility(visible) {
    this.reliefGroup.visible = Boolean(visible);
  }

  isReliefVisible() {
    return this.reliefGroup.visible;
  }

  setSeaVisibility(visible) {
    this.seaGroup.visible = Boolean(visible);
  }

  isSeaVisible() {
    return this.seaGroup.visible;
  }

  setUrbanSceneryVisibility(visible) {
    this.urbanScenery.group.visible = Boolean(visible);
  }

  isUrbanSceneryVisible() {
    return this.urbanScenery.group.visible;
  }

  setOsmOverlayEnabled(enabled) {
    const nextValue = Boolean(enabled);
    if (this.osmOverlayEnabled === nextValue) return;
    this.osmOverlayEnabled = nextValue;
    this.osmOverlayGroup.visible = nextValue;

    if (!nextValue) return;

    for (const chunk of this.chunks.values()) {
      if (!chunk.osmOverlay && !chunk.loadingOsmOverlay) {
        this.loadOsmOverlayChunk(chunk, this.centerRevision);
      }
    }
  }

  getOsmAttributionHtml() {
    return OSM_ATTRIBUTION_HTML;
  }

  isOsmOverlayEnabled() {
    return this.osmOverlayEnabled;
  }

  getOsmDebugSummary() {
    const counts = this.osmDebug.featureCounts;
    const totalFeatures = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return {
      enabled: this.osmOverlayEnabled,
      loadedChunks: this.osmDebug.loadedChunks,
      loadedTiles: this.osmDebug.loadedTiles,
      emptyChunks: this.osmDebug.emptyChunks,
      failedChunks: this.osmDebug.failedChunks,
      vegetationMaskAreas: this.osmDebug.vegetationMaskAreas,
      vegetationMaskRoads: this.osmDebug.vegetationMaskRoads,
      inferredUrbanCells: this.osmDebug.inferredUrbanCells,
      lastError: this.osmDebug.lastError,
      totalFeatures,
      featureCounts: { ...counts }
    };
  }

  // As UVs dos quads de mar ja estao em coordenadas de mundo; basta a deriva
  // lenta de correnteza no offset compartilhado para animar as ondas.
  updateSeaWaves(delta) {
    if (!this.seaGroup.visible || !this.seaMaterial?.normalMap) return;

    this.oceanTime += delta;
    this.seaMaterial.normalMap.offset.set(
      this.oceanTime * 0.006,
      this.oceanTime * 0.0042
    );
  }

  getSeaMaterial() {
    if (!this.seaMaterial) {
      this.seaMaterial = new THREE.MeshStandardMaterial({
        color: 0x1d4f78,
        roughness: 0.14,
        metalness: 0,
        transparent: true,
        opacity: 0.92,
        depthWrite: true,
        envMapIntensity: 1.15
      });

      const normalTexture = createWaterNormalTexture();
      if (normalTexture) {
        this.seaMaterial.normalMap = normalTexture;
        this.seaMaterial.normalScale = new THREE.Vector2(0.7, 0.7);
      }
    }
    return this.seaMaterial;
  }

  // Superficie de mar recortada pela propria grade do chunk: so entram os
  // quads cujos 4 cantos sao mar (NoData). A agua nunca cobre terra e as
  // bordas casam entre chunks vizinhos porque a grade e o DEM sao os mesmos.
  createSeaMeshIfNeeded(tileX, tileY, imageData, segments = this.config.chunkSegments) {
    if (!tileHasSeaPixels(imageData)) return null;

    const tileSize = this.manifest.terrain.tileSize;
    const latticeSize = segments + 1;
    const seaFlags = new Uint8Array(latticeSize * latticeSize);

    for (let iz = 0; iz < latticeSize; iz += 1) {
      for (let ix = 0; ix < latticeSize; ix += 1) {
        const u = (ix / segments) * (tileSize - 1);
        const v = (iz / segments) * (tileSize - 1);
        seaFlags[iz * latticeSize + ix] = sampleTileHasNoData(imageData, u, v) ? 1 : 0;
      }
    }

    const center = this.getChunkCenterWorld(tileX, tileY);
    const positions = [];
    const uvs = [];
    const indices = [];
    const vertexIndices = new Int32Array(latticeSize * latticeSize).fill(-1);

    const getVertexIndex = (ix, iz) => {
      const key = iz * latticeSize + ix;
      if (vertexIndices[key] !== -1) return vertexIndices[key];

      const localX = (ix / segments - 0.5) * this.chunkWorldWidth;
      const localZ = (iz / segments - 0.5) * this.chunkWorldDepth;
      const index = positions.length / 3;
      positions.push(localX, 0, localZ);
      uvs.push(
        (center.x + localX) / SEA_WAVE_REPEAT_WORLD_UNITS,
        (center.z + localZ) / SEA_WAVE_REPEAT_WORLD_UNITS
      );
      vertexIndices[key] = index;
      return index;
    };

    for (let iz = 0; iz < segments; iz += 1) {
      for (let ix = 0; ix < segments; ix += 1) {
        const isFullSeaQuad = seaFlags[iz * latticeSize + ix]
          && seaFlags[iz * latticeSize + ix + 1]
          && seaFlags[(iz + 1) * latticeSize + ix]
          && seaFlags[(iz + 1) * latticeSize + ix + 1];
        if (!isFullSeaQuad) continue;

        const a = getVertexIndex(ix, iz);
        const b = getVertexIndex(ix, iz + 1);
        const c = getVertexIndex(ix + 1, iz + 1);
        const d = getVertexIndex(ix + 1, iz);
        indices.push(a, b, d, b, c, d);
      }
    }

    if (indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const normals = new Float32Array(positions.length);
    for (let index = 1; index < normals.length; index += 3) normals[index] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    const mesh = new THREE.Mesh(geometry, this.getSeaMaterial());
    mesh.name = `SeaSurfaceChunk_${tileX}_${tileY}`;
    mesh.position.set(center.x, OCEAN_SURFACE_HEIGHT, center.z);
    this.seaGroup.add(mesh);
    return mesh;
  }

  getHeightAt(x, z) {
    if (!this.manifest || !this.centerPixel || !Number.isFinite(x) || !Number.isFinite(z)) {
      return this.config.fallbackHeight;
    }

    const tile = this.getTileForWorld(x, z);
    if (!this.isValidTile(tile.x, tile.y)) return this.config.fallbackHeight;

    const chunk = this.chunks.get(getChunkKey(tile.x, tile.y));
    if (!chunk?.imageData) return this.config.fallbackHeight;

    const sample = this.getTilePixelForWorld(x, z, tile);
    const elevation = sampleTileElevation(chunk.imageData, sample.u, sample.v, this.config.referenceElevation);
    return this.elevationToWorldHeight(elevation);
  }

  hasLoadedHeightAt(x, z) {
    if (!this.manifest || !this.centerPixel || !Number.isFinite(x) || !Number.isFinite(z)) {
      return false;
    }

    const tile = this.getTileForWorld(x, z);
    if (!this.isValidTile(tile.x, tile.y)) return false;
    return Boolean(this.chunks.get(getChunkKey(tile.x, tile.y))?.imageData);
  }

  isSeaAt(x, z) {
    if (!this.manifest || !this.centerPixel || !Number.isFinite(x) || !Number.isFinite(z)) {
      return false;
    }

    const tile = this.getTileForWorld(x, z);
    if (!this.isValidTile(tile.x, tile.y)) return false;

    const chunk = this.chunks.get(getChunkKey(tile.x, tile.y));
    if (!chunk?.imageData) return false;

    const sample = this.getTilePixelForWorld(x, z, tile);
    return sampleTileHasNoData(chunk.imageData, sample.u, sample.v);
  }

  isCoastalSandAt(x, z) {
    if (!this.manifest || !this.centerPixel || !Number.isFinite(x) || !Number.isFinite(z)) {
      return false;
    }

    const tile = this.getTileForWorld(x, z);
    if (!this.isValidTile(tile.x, tile.y)) return false;

    const chunk = this.chunks.get(getChunkKey(tile.x, tile.y));
    if (!chunk?.imageData) return false;

    const sample = this.getTilePixelForWorld(x, z, tile);
    const elevation = sampleTileElevation(chunk.imageData, sample.u, sample.v, this.config.referenceElevation);
    return !sampleTileHasNoData(chunk.imageData, sample.u, sample.v)
      && isCoastalSandSample(chunk.imageData, sample.u, sample.v, elevation);
  }

  // Area urbana ou faixa de estrada/ferrovia do chunk carregado em (x, z).
  // Usado pela vegetacao para nao plantar sobre ruas, rodovias e casas.
  isUrbanBlockedAt(x, z) {
    if (!this.manifest || !this.centerPixel || !Number.isFinite(x) || !Number.isFinite(z)) {
      return false;
    }

    const tile = this.getTileForWorld(x, z);
    if (!this.isValidTile(tile.x, tile.y)) return false;

    const chunk = this.chunks.get(getChunkKey(tile.x, tile.y));
    if (!chunk?.vectorTile && !chunk?.osmVectorTile) return false;
    return this.urbanScenery.isBlockedAt(x, z, chunk);
  }

  async ensureHeightAt(x, z, timeoutMs = 6000) {
    await this.ready;

    if (this.hasLoadedHeightAt(x, z)) return true;

    this.update(new THREE.Vector3(x, 0, z));
    const startedAt = performance.now();

    while (performance.now() - startedAt < timeoutMs) {
      if (this.hasLoadedHeightAt(x, z)) return true;
      await waitForNextFrame();
    }

    return this.hasLoadedHeightAt(x, z);
  }

  // Altura da malha renderizada (lattice de vertices do chunk), que pode divergir
  // varios metros de getHeightAt() em encostas por causa do espacamento dos vertices.
  // Use para apoiar objetos visuais (ex.: arvores) exatamente sobre o relevo visivel.
  getRenderedHeightAt(x, z) {
    if (!this.manifest || !this.centerPixel || !Number.isFinite(x) || !Number.isFinite(z)) {
      return this.config.fallbackHeight;
    }

    const tile = this.getTileForWorld(x, z);
    if (!this.isValidTile(tile.x, tile.y)) return this.config.fallbackHeight;

    const chunk = this.chunks.get(getChunkKey(tile.x, tile.y));
    if (!chunk?.imageData) return this.config.fallbackHeight;

    const center = this.getChunkCenterWorld(tile.x, tile.y);
    const segments = this.config.chunkSegments;
    const gridX = ((x - center.x) / this.chunkWorldWidth + 0.5) * segments;
    const gridZ = ((z - center.z) / this.chunkWorldDepth + 0.5) * segments;
    const x0 = THREE.MathUtils.clamp(Math.floor(gridX), 0, segments - 1);
    const z0 = THREE.MathUtils.clamp(Math.floor(gridZ), 0, segments - 1);
    const fx = THREE.MathUtils.clamp(gridX - x0, 0, 1);
    const fz = THREE.MathUtils.clamp(gridZ - z0, 0, 1);

    const vertexHeight = (ix, iz) => {
      const u = (ix / segments) * (this.manifest.terrain.tileSize - 1);
      const v = (iz / segments) * (this.manifest.terrain.tileSize - 1);
      return this.elevationToWorldHeight(sampleTileElevation(chunk.imageData, u, v));
    };

    // Interpolacao identica a triangulacao da PlaneGeometry (diagonal b-d por quad),
    // para que a altura calculada coincida com a superficie que a GPU desenha.
    const heightA = vertexHeight(x0, z0);
    const heightB = vertexHeight(x0, z0 + 1);
    const heightC = vertexHeight(x0 + 1, z0 + 1);
    const heightD = vertexHeight(x0 + 1, z0);

    if (fx + fz <= 1) {
      return heightA + (heightD - heightA) * fx + (heightB - heightA) * fz;
    }
    return heightC + (heightB - heightC) * (1 - fx) + (heightD - heightC) * (1 - fz);
  }

  getTileForWorld(x, z) {
    const pixelX = this.centerPixel.x + x / this.worldUnitsPerPixelX;
    const pixelY = this.centerPixel.y + z / this.worldUnitsPerPixelY;
    tempTile.x = Math.floor(pixelX / this.manifest.terrain.tileSize);
    tempTile.y = Math.floor(pixelY / this.manifest.terrain.tileSize);
    return tempTile;
  }

  getTilePixelForWorld(x, z, tile) {
    const pixelX = this.centerPixel.x + x / this.worldUnitsPerPixelX;
    const pixelY = this.centerPixel.y + z / this.worldUnitsPerPixelY;
    return {
      u: THREE.MathUtils.clamp(pixelX - tile.x * this.manifest.terrain.tileSize, 0, this.manifest.terrain.tileSize - 1),
      v: THREE.MathUtils.clamp(pixelY - tile.y * this.manifest.terrain.tileSize, 0, this.manifest.terrain.tileSize - 1)
    };
  }

  isValidTile(x, y) {
    return x >= 0 && y >= 0 && x < this.manifest.terrain.columns && y < this.manifest.terrain.rows;
  }

  async loadChunk(tileX, tileY) {
    const key = getChunkKey(tileX, tileY);
    const revision = this.centerRevision;
    this.loadingChunks.add(key);

    try {
      // Reaproveita o DEM ja baixado pela versao distante do mesmo tile.
      const imageData = this.distantChunks.get(key)?.imageData
        ?? await loadImageData(this.getTileUrl(tileX, tileY));
      if (revision !== this.centerRevision) return;

      const chunk = {
        tileX,
        tileY,
        imageData,
        mesh: this.createChunkMesh(tileX, tileY, imageData),
        seaMesh: this.createSeaMeshIfNeeded(tileX, tileY, imageData),
        vectors: null,
        osmOverlay: null,
        loadingOsmOverlay: false
      };
      this.chunks.set(key, chunk);
      this.reliefGroup.add(chunk.mesh);
      recordTerrainDebug('chunkLoaded', { key, chunks: this.chunks.size });
      this.loadVectorChunk(chunk, revision);
      if (this.osmOverlayEnabled) this.loadOsmOverlayChunk(chunk, revision);
    } catch (error) {
      if (revision !== this.centerRevision) return;

      this.failedChunks.add(key);
      recordTerrainDebug('chunkFailed', {
        key,
        message: getErrorMessage(error),
        cause: getErrorCauseMessage(error)
      });
      console.warn(`Nao foi possivel carregar chunk XCM ${key}`, error);
    } finally {
      this.loadingChunks.delete(key);
    }
  }

  unloadChunk(key) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    this.reliefGroup.remove(chunk.mesh);
    if (chunk.seaMesh) {
      this.seaGroup.remove(chunk.seaMesh);
      // O material do mar e compartilhado; descarta apenas a geometria.
      chunk.seaMesh.geometry.dispose();
    }
    if (chunk.vectors) {
      this.vectorGroup.remove(chunk.vectors);
      disposeObject3D(chunk.vectors);
    }
    if (chunk.osmOverlay) {
      this.osmOverlayGroup.remove(chunk.osmOverlay);
      disposeObject3D(chunk.osmOverlay);
    }
    this.urbanScenery.removeChunk(key);
    chunk.mesh.geometry.dispose();
    // O material do terreno e compartilhado entre chunks; nao descartar aqui.
    this.chunks.delete(key);
  }

  getTileUrl(tileX, tileY) {
    return withVersionQuery(`${this.manifestBaseUrl}${this.manifest.terrain.urlTemplate
      .replace('{x}', tileX)
      .replace('{y}', tileY)}`);
  }

  getVectorTileUrl(tileX, tileY) {
    if (!this.manifest.vectors?.urlTemplate) return null;
    return withVersionQuery(`${this.manifestBaseUrl}${this.manifest.vectors.urlTemplate
      .replace('{x}', tileX)
      .replace('{y}', tileY)}`);
  }

  async loadVectorChunk(chunk, revision = this.centerRevision) {
    const key = getChunkKey(chunk.tileX, chunk.tileY);
    if (!this.availableVectorTiles.has(key)) return;

    try {
      const response = await fetch(this.getVectorTileUrl(chunk.tileX, chunk.tileY));
      if (!response.ok) throw new Error(`Vector HTTP ${response.status}`);
      const vectorTile = await response.json();
      if (revision !== this.centerRevision || !this.chunks.has(key)) return;

      chunk.vectorTile = vectorTile;
      // Sinaliza consumidores (ex.: vegetacao) que novas mascaras urbanas chegaram.
      this.vectorRevision = (this.vectorRevision ?? 0) + 1;
      const group = this.createVectorGroup(vectorTile, chunk);
      this.urbanScenery.addChunk(key, vectorTile, chunk);
      if (group.children.length === 0) return;

      group.name = `XcmVectorChunk_${chunk.tileX}_${chunk.tileY}`;
      chunk.vectors = group;
      this.vectorGroup.add(group);
    } catch (error) {
      console.warn(`Nao foi possivel carregar vetores XCM ${key}`, error);
    }
  }

  async loadOsmOverlayChunk(chunk, revision = this.centerRevision) {
    if (!this.osmOverlayEnabled || chunk.osmOverlay || chunk.loadingOsmOverlay || !this.manifest) return;

    chunk.loadingOsmOverlay = true;
    const key = getChunkKey(chunk.tileX, chunk.tileY);

    try {
      const vectorTile = await this.fetchOsmVectorTile(chunk);
      const overlay = this.createVectorGroup(vectorTile, chunk);
      const urbanCoverage = buildOsmUrbanCoverageGrid(vectorTile, chunk, this);
      const urbanCoverageMesh = this.createOsmUrbanCoverageMesh(urbanCoverage, chunk);
      if (urbanCoverageMesh) {
        overlay.add(this.tagVectorLayerObject(urbanCoverageMesh, 'osm_urban_inferred'));
      }
      if (revision !== this.centerRevision || !this.chunks.has(key)) {
        disposeObject3D(overlay);
        return;
      }

      chunk.osmVectorTile = vectorTile;
      chunk.osmUrbanCoverage = urbanCoverage;
      this.urbanScenery.invalidateBlockMask(chunk);
      // A vegetacao precisa replantar depois que a mascara OSM assincrona chega.
      this.vectorRevision = (this.vectorRevision ?? 0) + 1;
      const counts = summarizeVectorTileFeatures(vectorTile);
      mergeOsmFeatureCounts(this.osmDebug.featureCounts, counts);
      this.osmDebug.vegetationMaskAreas += vectorTile.vegetationMask?.areas.length ?? 0;
      this.osmDebug.vegetationMaskRoads += (vectorTile.layers?.osm_roads_major?.lines.length ?? 0)
        + (vectorTile.layers?.osm_roads?.lines.length ?? 0)
        + (vectorTile.layers?.osm_railways?.lines.length ?? 0)
        + (vectorTile.layers?.osm_aeroway?.lines.length ?? 0);
      this.osmDebug.inferredUrbanCells += urbanCoverage.count;
      this.osmDebug.loadedChunks += 1;
      if (!overlay || overlay.children.length === 0) {
        this.osmDebug.emptyChunks += 1;
        return;
      }

      overlay.name = `OsmVectorChunk_${chunk.tileX}_${chunk.tileY}`;
      chunk.osmOverlay = overlay;
      this.osmOverlayGroup.add(overlay);
    } catch (error) {
      this.osmDebug.failedChunks += 1;
      this.osmDebug.lastError = getErrorMessage(error);
      console.warn(`Nao foi possivel carregar overlay OSM ${key}`, error);
    } finally {
      chunk.loadingOsmOverlay = false;
    }
  }

  async fetchOsmVectorTile(chunk) {
    const bounds = this.getChunkLonLatBounds(chunk.tileX, chunk.tileY);
    const zoom = this.config.osmVectorZoom;
    const tileRange = getOsmTileRange(bounds, zoom);
    const vectorTiles = [];

    for (let tileY = tileRange.minY; tileY <= tileRange.maxY; tileY += 1) {
      for (let tileX = tileRange.minX; tileX <= tileRange.maxX; tileX += 1) {
        vectorTiles.push(this.fetchOsmMvtTile(tileX, tileY, zoom));
      }
    }

    const centerTileX = Math.floor(this.centerPixel.x / this.manifest.terrain.tileSize);
    const centerTileY = Math.floor(this.centerPixel.y / this.manifest.terrain.tileSize);
    if (chunk.tileX === centerTileX && chunk.tileY === centerTileY) {
      const detailZoom = this.config.osmDetailZoom;
      const detailCenter = lonLatToOsmTile(
        this.config.centerLongitude,
        this.config.centerLatitude,
        detailZoom
      );
      const detailTileX = Math.floor(detailCenter.x);
      const detailTileY = Math.floor(detailCenter.y);
      const radius = this.config.osmDetailTileRadius;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          vectorTiles.push(this.fetchOsmMvtTile(
            detailTileX + offsetX,
            detailTileY + offsetY,
            detailZoom,
            true
          ));
        }
      }
    }

    return mergeOsmVectorTiles(await Promise.all(vectorTiles));
  }

  fetchOsmMvtTile(tileX, tileY, zoom, detailOnly = false) {
    const key = `${zoom}/${tileX}/${tileY}/${detailOnly ? 'detail' : 'broad'}`;
    if (!this.osmTilePromises.has(key)) {
      const url = this.config.osmVectorTileUrl
        .replace('{z}', zoom)
        .replace('{x}', tileX)
        .replace('{y}', tileY);
      const promise = fetchWithTimeout(url, {
        headers: { Accept: 'application/vnd.mapbox-vector-tile,application/x-protobuf,*/*' }
      }, this.config.osmRequestTimeoutMs)
        .then(async (response) => {
          if (!response.ok) throw new Error(`OSM vector tile HTTP ${response.status}`);
          const tile = new VectorTile(new Pbf(await response.arrayBuffer()));
          this.osmDebug.loadedTiles += 1;
          return convertShortbreadTileToVectorTile(
            tile,
            tileX,
            tileY,
            zoom,
            this.manifest.source.worldFile,
            detailOnly
          );
        })
        .catch((error) => {
          this.osmTilePromises.delete(key);
          throw error;
        });
      this.osmTilePromises.set(key, promise);
    }
    return this.osmTilePromises.get(key);
  }

  createChunkMesh(tileX, tileY, imageData, segments = this.config.chunkSegments) {
    const geometry = new THREE.PlaneGeometry(
      this.chunkWorldWidth,
      this.chunkWorldDepth,
      segments,
      segments
    );
    geometry.rotateX(-Math.PI / 2);

    const colors = [];
    const positions = geometry.attributes.position;
    const chunkCenter = this.getChunkCenterWorld(tileX, tileY);

    for (let index = 0; index < positions.count; index += 1) {
      const localX = positions.getX(index);
      const localZ = positions.getZ(index);
      const u = ((localX / this.chunkWorldWidth) + 0.5) * (this.manifest.terrain.tileSize - 1);
      const v = ((localZ / this.chunkWorldDepth) + 0.5) * (this.manifest.terrain.tileSize - 1);
      const elevation = sampleTileElevation(imageData, u, v);
      const isSea = sampleTileHasNoData(imageData, u, v);
      const isSand = !isSea && isCoastalSandSample(imageData, u, v, elevation);
      const worldHeight = this.elevationToWorldHeight(elevation);
      const slope = sampleTileSlope(imageData, u, v, this.worldUnitsPerPixelX, this.worldUnitsPerPixelY);
      const curvature = sampleTileCurvature(imageData, u, v, elevation);
      positions.setY(index, isSea ? SEABED_WORLD_HEIGHT : worldHeight);
      addTerrainColor(colors, worldHeight, slope, chunkCenter.x + localX, chunkCenter.z + localZ, isSea, isSand, curvature);
    }

    positions.needsUpdate = true;
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, this.getTerrainMaterial());
    mesh.name = `XcmTerrainChunk_${tileX}_${tileY}`;
    mesh.position.set(chunkCenter.x, 0, chunkCenter.z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  getChunkLonLatBounds(tileX, tileY) {
    const tileSize = this.manifest.terrain.tileSize;
    const minPixelX = tileX * tileSize;
    const minPixelY = tileY * tileSize;
    const maxPixelX = minPixelX + tileSize;
    const maxPixelY = minPixelY + tileSize;
    const southWest = pixelToLonLat(minPixelX, maxPixelY, this.manifest.source.worldFile);
    const northEast = pixelToLonLat(maxPixelX, minPixelY, this.manifest.source.worldFile);
    const centerLatitude = (southWest.latitude + northEast.latitude) * 0.5;
    return {
      west: southWest.longitude,
      south: southWest.latitude,
      east: northEast.longitude,
      north: northEast.latitude,
      centerLatitude
    };
  }

  getTerrainMaterial() {
    if (!this.terrainMaterial) {
      this.terrainMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0
      });

      const detailTexture = createDetailTexture();
      if (detailTexture) {
        // Repeticao inteira mantem o padrao continuo entre chunks vizinhos.
        detailTexture.repeat.set(64, 64);
        this.terrainMaterial.map = detailTexture;
      }

      // Micro-relevo (copas de arvore, ondulacao do solo) que reage a luz,
      // visivel principalmente em voo baixo e com sol rasante.
      const normalTexture = createTerrainNormalTexture();
      if (normalTexture) {
        normalTexture.repeat.set(96, 96);
        this.terrainMaterial.normalMap = normalTexture;
        this.terrainMaterial.normalScale = new THREE.Vector2(0.45, 0.45);
      }

      applyTerrainSplatting(this.terrainMaterial);
    }

    return this.terrainMaterial;
  }

  createVectorGroup(vectorTile, chunk) {
    const group = new THREE.Group();
    const layers = vectorTile.layers ?? {};

    for (const [layerName, layer] of Object.entries(layers)) {
      const style = getVectorStyle(layerName);

      if (layer.lines?.length) {
        const object = style.type === 'area'
          ? this.createVectorAreas(layerName, layer.lines, chunk, style)
          : this.createVectorRibbons(layerName, layer.lines, chunk, style);
        if (object) group.add(this.tagVectorLayerObject(object, layerName));
      }

      if (layer.points?.length) {
        const pointGroup = this.createVectorPoints(layerName, layer.points, chunk.imageData, style);
        if (pointGroup.children.length > 0) group.add(this.tagVectorLayerObject(pointGroup, layerName));
      }
    }

    return group;
  }

  createOsmUrbanCoverageMesh(coverage, chunk) {
    if (!coverage || coverage.count === 0) return null;

    const positions = [];
    const indices = [];
    const style = getVectorStyle('osm_urban_inferred');
    const vertexCache = new Map();
    const getVertexIndex = (column, row, x, z) => {
      const key = row * (coverage.columns + 1) + column;
      if (!vertexCache.has(key)) {
        const index = positions.length / 3;
        positions.push(x, this.getVectorHeight(x, z, chunk) + style.yOffset, z);
        vertexCache.set(key, index);
      }
      return vertexCache.get(key);
    };

    for (let row = 0; row < coverage.rows; row += 1) {
      for (let column = 0; column < coverage.columns; column += 1) {
        if (coverage.cells[row * coverage.columns + column] !== 1) continue;
        const x0 = coverage.minX + column * coverage.cellSize;
        const z0 = coverage.minZ + row * coverage.cellSize;
        const x1 = Math.min(x0 + coverage.cellSize, coverage.maxX);
        const z1 = Math.min(z0 + coverage.cellSize, coverage.maxZ);
        const centerX = (x0 + x1) * 0.5;
        const centerZ = (z0 + z1) * 0.5;
        if (this.isSeaAt(centerX, centerZ)) continue;

        const topLeft = getVertexIndex(column, row, x0, z0);
        const topRight = getVertexIndex(column + 1, row, x1, z0);
        const bottomLeft = getVertexIndex(column, row + 1, x0, z1);
        const bottomRight = getVertexIndex(column + 1, row + 1, x1, z1);
        indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
      }
    }

    if (positions.length === 0) return null;
    const mesh = new THREE.Mesh(
      this.buildVectorGeometry(positions, indices),
      this.getVectorMaterial('osm_urban_inferred', style)
    );
    mesh.name = `OsmInferredUrbanCoverage_${chunk.tileX}_${chunk.tileY}`;
    mesh.receiveShadow = true;
    return mesh;
  }

  tagVectorLayerObject(object, layerName) {
    object.userData.vectorLayer = layerName;
    object.visible = this.layerVisibility.get(layerName) ?? true;
    if (layerName.startsWith('osm_')) {
      const renderOrder = getOsmLayerRenderOrder(layerName);
      object.renderOrder = renderOrder;
      object.traverse?.((child) => {
        child.renderOrder = renderOrder;
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            material.depthTest = false;
            material.depthWrite = false;
          }
        }
      });
    }
    return object;
  }

  setLayerVisibility(layerName, visible) {
    this.layerVisibility.set(layerName, visible);
    for (const group of [this.vectorGroup, this.osmOverlayGroup]) {
      group.traverse((child) => {
        if (child.userData.vectorLayer === layerName) child.visible = visible;
      });
    }
  }

  // Altura de drapejamento sobre o relevo visivel. Fallbacks em ordem:
  // altura por pixel do tile correto e, por ultimo, amostra clampada no
  // proprio chunk (pontos fora dos tiles carregados).
  getVectorHeight(worldX, worldZ, chunk) {
    const rendered = this.getRenderedHeightAt(worldX, worldZ);
    if (rendered !== this.config.fallbackHeight) return rendered;

    const pixelHeight = this.getHeightAt(worldX, worldZ);
    if (pixelHeight !== this.config.fallbackHeight) return pixelHeight;

    const tileSize = this.manifest.terrain.tileSize;
    const pixelX = this.centerPixel.x + worldX / this.worldUnitsPerPixelX;
    const pixelY = this.centerPixel.y + worldZ / this.worldUnitsPerPixelY;
    const u = THREE.MathUtils.clamp(pixelX - chunk.tileX * tileSize, 0, tileSize - 1);
    const v = THREE.MathUtils.clamp(pixelY - chunk.tileY * tileSize, 0, tileSize - 1);
    return this.elevationToWorldHeight(
      sampleTileElevation(chunk.imageData, u, v, this.config.referenceElevation)
    );
  }

  pixelToWorldXZ(pixelX, pixelY) {
    return {
      x: (pixelX - this.centerPixel.x) * this.worldUnitsPerPixelX,
      z: (pixelY - this.centerPixel.y) * this.worldUnitsPerPixelY
    };
  }

  latLongToWorldXZ(latitude, longitude) {
    if (!this.manifest || !this.centerPixel) return null;
    const pixel = lonLatToPixel(longitude, latitude, this.manifest.source.worldFile);
    return this.pixelToWorldXZ(pixel.x, pixel.y);
  }

  createVectorRibbons(layerName, lines, chunk, style) {
    const positions = [];
    const indices = [];
    const uvs = [];
    const halfWidth = (style.widthMeters * this.worldUnitsPerMeter) / 2;
    // Comprimento em metros que um ciclo da textura cobre ao longo da fita.
    const metersPerRepeat = style.metersPerRepeat ?? style.widthMeters * 2;
    // Subdivide cada segmento em passos menores que meio quad da malha do terreno,
    // para a fita acompanhar o relevo em vez de atravessar elevacoes no caminho.
    const stepLength = Math.max(20, (this.chunkWorldWidth / this.config.chunkSegments) * 0.5);

    for (const line of lines) {
      const start = this.pixelToWorldXZ(line[0], line[1]);
      const end = this.pixelToWorldXZ(line[2], line[3]);
      const dirX = end.x - start.x;
      const dirZ = end.z - start.z;
      const length = Math.hypot(dirX, dirZ);
      if (length < 0.001) continue;

      // Perpendicular para a largura; extensao nas pontas cobre juntas entre segmentos.
      const perpX = (-dirZ / length) * halfWidth;
      const perpZ = (dirX / length) * halfWidth;
      const extX = (dirX / length) * halfWidth * 0.6;
      const extZ = (dirZ / length) * halfWidth * 0.6;
      const startX = start.x - extX;
      const startZ = start.z - extZ;
      const endX = end.x + extX;
      const endZ = end.z + extZ;
      const steps = Math.max(1, Math.ceil(length / stepLength));
      const base = positions.length / 3;

      // Amostra as alturas da linha central e recorta outliers contra a mediana
      // do segmento: pixels NoData do DEM criariam cunhas de centenas de metros.
      const stepPoints = [];
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const centerX = startX + (endX - startX) * t;
        const centerZ = startZ + (endZ - startZ) * t;
        stepPoints.push({
          x: centerX,
          z: centerZ,
          height: this.getVectorHeight(centerX, centerZ, chunk)
        });
      }

      const sortedHeights = stepPoints.map((point) => point.height).sort((a, b) => a - b);
      const medianHeight = sortedHeights[Math.floor(sortedHeights.length / 2)];

      const segmentLengthMeters = Math.hypot(endX - startX, endZ - startZ) / this.worldUnitsPerMeter;

      for (let pointIndex = 0; pointIndex < stepPoints.length; pointIndex += 1) {
        const point = stepPoints[pointIndex];
        if (Math.abs(point.height - medianHeight) > 120) point.height = medianHeight;
        const height = point.height + style.yOffset;
        const along = (pointIndex / steps) * segmentLengthMeters / metersPerRepeat;
        positions.push(point.x - perpX, height, point.z - perpZ);
        positions.push(point.x + perpX, height, point.z + perpZ);
        uvs.push(0, along, 1, along);
      }

      for (let step = 0; step < steps; step += 1) {
        const row = base + step * 2;
        indices.push(row, row + 2, row + 1, row + 1, row + 2, row + 3);
      }
    }

    if (positions.length === 0) return null;

    const mesh = new THREE.Mesh(
      this.buildVectorGeometry(positions, indices, uvs),
      this.getVectorMaterial(layerName, style)
    );
    mesh.name = `XcmVectorRibbons_${layerName}`;
    mesh.receiveShadow = true;
    return mesh;
  }

  createVectorAreas(layerName, lines, chunk, style) {
    const rings = chainSegmentsIntoRings(lines);
    const positions = [];
    const indices = [];

    for (const ring of rings) {
      if (ring.length < 3) continue;

      const contour = ring.map(([px, py]) => new THREE.Vector2(px, py));
      if (Math.abs(THREE.ShapeUtils.area(contour)) < 1.5) continue;

      let triangles;
      try {
        triangles = THREE.ShapeUtils.triangulateShape(contour, []);
      } catch {
        continue;
      }
      if (triangles.length === 0) continue;

      const base = positions.length / 3;
      const worldPoints = contour.map((point) => this.pixelToWorldXZ(point.x, point.y));

      // Agua e plana: usa a mediana das alturas da margem, robusta a pixels
      // corrompidos/NoData do DEM que afundariam o lago inteiro.
      let flatHeight = 0;
      if (style.flat) {
        const heights = worldPoints
          .map((point) => this.getVectorHeight(point.x, point.z, chunk))
          .sort((a, b) => a - b);
        flatHeight = heights[Math.floor(heights.length / 2)];
      }

      for (const point of worldPoints) {
        const height = style.flat
          ? flatHeight
          : this.getVectorHeight(point.x, point.z, chunk);
        positions.push(point.x, height + style.yOffset, point.z);
      }

      for (const triangle of triangles) {
        indices.push(base + triangle[0], base + triangle[1], base + triangle[2]);
      }
    }

    if (positions.length === 0) return null;

    const mesh = new THREE.Mesh(
      this.buildVectorGeometry(positions, indices),
      this.getVectorMaterial(layerName, style)
    );
    mesh.name = `XcmVectorAreas_${layerName}`;
    mesh.receiveShadow = true;
    return mesh;
  }

  buildVectorGeometry(positions, indices, uvs = null) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    if (uvs?.length) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }

    const normals = new Float32Array(positions.length);
    for (let index = 1; index < normals.length; index += 3) normals[index] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geometry;
  }

  createVectorPoints(layerName, points, imageData, style) {
    const group = new THREE.Group();

    for (const point of points) {
      if (!point.label) continue;

      const position = this.pixelToWorld(point.x, point.y, imageData, style.yOffset);
      const label = this.createLabelSprite(point.label, style.color);
      label.position.set(position.x, position.y + this.config.labelYOffset, position.z);
      group.add(label);
    }

    group.name = `XcmVectorPoints_${layerName}`;
    return group;
  }

  pixelToWorld(pixelX, pixelY, imageData, yOffset = this.config.vectorYOffset) {
    const tileX = Math.floor(pixelX / this.manifest.terrain.tileSize);
    const tileY = Math.floor(pixelY / this.manifest.terrain.tileSize);
    const u = pixelX - tileX * this.manifest.terrain.tileSize;
    const v = pixelY - tileY * this.manifest.terrain.tileSize;
    const elevation = sampleTileElevation(imageData, u, v, this.config.referenceElevation);
    return new THREE.Vector3(
      (pixelX - this.centerPixel.x) * this.worldUnitsPerPixelX,
      this.elevationToWorldHeight(elevation) + yOffset,
      (pixelY - this.centerPixel.y) * this.worldUnitsPerPixelY
    );
  }

  getVectorMaterial(layerName, style) {
    if (!this.vectorMaterials.has(layerName)) {
      const transparent = (style.opacity ?? 1) < 1;
      const material = new THREE.MeshStandardMaterial({
        color: style.color,
        roughness: style.roughness ?? 0.92,
        metalness: 0,
        transparent,
        opacity: style.opacity ?? 1,
        depthWrite: !transparent,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });

      if (style.texture) {
        const texture = createRibbonTexture(style.texture);
        if (texture) material.map = texture;
      }

      this.vectorMaterials.set(layerName, material);
    }
    return this.vectorMaterials.get(layerName);
  }

  createLabelSprite(text, color) {
    const cacheKey = `${color}:${text}`;
    let texture = this.labelTextureCache.get(cacheKey);
    if (!texture) {
      texture = createLabelTexture(text, color);
      this.labelTextureCache.set(cacheKey, texture);
    }

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false
    });
    const sprite = new THREE.Sprite(material);
    const aspect = texture.image.width / texture.image.height;
    sprite.scale.set(this.config.labelScale * aspect, this.config.labelScale, 1);
    return sprite;
  }

  getChunkCenterWorld(tileX, tileY) {
    const tileSize = this.manifest.terrain.tileSize;
    const pixelCenterX = tileX * tileSize + tileSize / 2;
    const pixelCenterY = tileY * tileSize + tileSize / 2;
    return {
      x: (pixelCenterX - this.centerPixel.x) * this.worldUnitsPerPixelX,
      z: (pixelCenterY - this.centerPixel.y) * this.worldUnitsPerPixelY
    };
  }

  elevationToWorldHeight(elevation) {
    return (normalizeTerrainElevation(elevation) - this.config.referenceElevation) * this.config.heightScale;
  }
}

function getVectorStyle(layerName) {
  return VECTOR_LAYER_STYLES[layerName]
    ?? { type: 'ribbon', color: 0xb8b0a2, widthMeters: 4, yOffset: 1 };
}

function getOsmLayerRenderOrder(layerName) {
  if (layerName === 'osm_landuse' || layerName === 'osm_natural') return 34;
  if (layerName === 'osm_urban_areas' || layerName === 'osm_urban_inferred') return 35;
  if (layerName === 'osm_water_areas' || layerName === 'osm_water_lines') return 38;
  if (layerName === 'osm_roads_major' || layerName === 'osm_roads'
    || layerName === 'osm_railways' || layerName === 'osm_aeroway') return 42;
  if (layerName === 'osm_buildings') return 43;
  if (layerName === 'osm_places' || layerName === 'osm_poi') return 45;
  return 40;
}

// Encadeia segmentos [x1,y1,x2,y2] em polilinhas/aneis pelos pontos coincidentes.
// Aneis abertos (ex.: lago cortado na borda do tile) sao fechados na triangulacao
// pela propria ligacao fim-inicio do contorno.
function chainSegmentsIntoRings(lines) {
  const pointKey = (x, y) => `${Math.round(x * 16)}:${Math.round(y * 16)}`;
  const startMap = new Map();
  const used = new Array(lines.length).fill(false);

  for (let index = 0; index < lines.length; index += 1) {
    const key = pointKey(lines[index][0], lines[index][1]);
    if (!startMap.has(key)) startMap.set(key, []);
    startMap.get(key).push(index);
  }

  const takeSegmentStartingAt = (key) => {
    const candidates = startMap.get(key);
    if (!candidates) return -1;
    while (candidates.length > 0) {
      const index = candidates.pop();
      if (!used[index]) return index;
    }
    return -1;
  };

  const rings = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (used[index]) continue;
    used[index] = true;

    const points = [
      [lines[index][0], lines[index][1]],
      [lines[index][2], lines[index][3]]
    ];

    let guard = lines.length;
    while (guard > 0) {
      guard -= 1;
      const tail = points[points.length - 1];
      const nextIndex = takeSegmentStartingAt(pointKey(tail[0], tail[1]));
      if (nextIndex === -1) break;

      used[nextIndex] = true;
      points.push([lines[nextIndex][2], lines[nextIndex][3]]);
    }

    // Remove o ponto final duplicado quando o anel fecha no inicio.
    const head = points[0];
    const tail = points[points.length - 1];
    if (points.length > 3 && pointKey(head[0], head[1]) === pointKey(tail[0], tail[1])) {
      points.pop();
    }

    rings.push(points);
  }

  return rings;
}

// Rotulo estilo overlay de GPS: texto com halo escuro, sem caixa de fundo.
function createLabelTexture(text, color) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const fontSize = 30;
  const font = `700 ${fontSize}px Arial, sans-serif`;
  context.font = font;
  const metrics = context.measureText(text);
  canvas.width = Math.min(512, Math.ceil(metrics.width + 28));
  canvas.height = 56;

  context.font = font;
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(10, 16, 22, 0.85)';
  context.lineWidth = 7;
  context.strokeText(text, 14, 30);
  context.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  context.fillText(text, 14, 30);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function disposeObject3D(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        for (const material of child.material) material.dispose();
      } else {
        child.material.dispose();
      }
    }
  });
}

function lonLatToPixel(longitude, latitude, worldFile) {
  return {
    x: (longitude - worldFile.originX) / worldFile.pixelSizeX,
    y: (latitude - worldFile.originY) / worldFile.pixelSizeY
  };
}

function pixelToLonLat(pixelX, pixelY, worldFile) {
  return {
    longitude: worldFile.originX + pixelX * worldFile.pixelSizeX,
    latitude: worldFile.originY + pixelY * worldFile.pixelSizeY
  };
}

function getMetersPerPixel(latitude, worldFile) {
  const latitudeRadians = THREE.MathUtils.degToRad(latitude);
  const metersPerDegreeLatitude = 111132.92
    - 559.82 * Math.cos(2 * latitudeRadians)
    + 1.175 * Math.cos(4 * latitudeRadians)
    - 0.0023 * Math.cos(6 * latitudeRadians);
  const metersPerDegreeLongitude = 111412.84 * Math.cos(latitudeRadians)
    - 93.5 * Math.cos(3 * latitudeRadians)
    + 0.118 * Math.cos(5 * latitudeRadians);

  return {
    x: Math.abs(worldFile.pixelSizeX) * metersPerDegreeLongitude,
    y: Math.abs(worldFile.pixelSizeY) * metersPerDegreeLatitude
  };
}

function getChunkKey(tileX, tileY) {
  return `${tileX}:${tileY}`;
}

async function loadImageData(url) {
  try {
    const response = await fetch(url, {
      cache: 'reload',
      headers: { Accept: 'image/png,*/*;q=0.8' }
    });
    if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? 'desconhecido';
    const buffer = await response.arrayBuffer();
    return await decodePngRgbData(new Uint8Array(buffer), url, {
      status: response.status,
      contentType
    });
  } catch (error) {
    throw new Error(`Nao foi possivel decodificar PNG de relevo como dados RGB: ${url}`, {
      cause: error
    });
  }
}

function getOsmTileRange(bounds, zoom) {
  const northWest = lonLatToOsmTile(bounds.west, bounds.north, zoom);
  const southEast = lonLatToOsmTile(bounds.east, bounds.south, zoom);
  const maxTile = 2 ** zoom - 1;
  return {
    minX: THREE.MathUtils.clamp(Math.floor(northWest.x), 0, maxTile),
    maxX: THREE.MathUtils.clamp(Math.floor(southEast.x), 0, maxTile),
    minY: THREE.MathUtils.clamp(Math.floor(northWest.y), 0, maxTile),
    maxY: THREE.MathUtils.clamp(Math.floor(southEast.y), 0, maxTile)
  };
}

function lonLatToOsmTile(longitude, latitude, zoom) {
  const safeLatitude = THREE.MathUtils.clamp(latitude, -85.05112878, 85.05112878);
  const latitudeRadians = THREE.MathUtils.degToRad(safeLatitude);
  const scale = 2 ** zoom;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) * 0.5 * scale
  };
}

function convertShortbreadTileToVectorTile(tile, tileX, tileY, zoom, worldFile, detailOnly = false) {
  const layers = createEmptyOsmLayers();
  const vegetationMask = createEmptyOsmVegetationMask();

  for (const [sourceLayerName, sourceLayer] of Object.entries(tile.layers)) {
    for (let index = 0; index < sourceLayer.length; index += 1) {
      const feature = sourceLayer.feature(index);
      const category = classifyShortbreadFeature(sourceLayerName, feature.properties);
      if (!category || (detailOnly && !OSM_DETAIL_CATEGORIES.has(category))) continue;
      const geoJsonFeature = feature.toGeoJSON(tileX, tileY, zoom);
      appendGeoJsonToOsmLayer(
        layers[category],
        category,
        geoJsonFeature,
        worldFile
      );
      appendGeoJsonToOsmVegetationMask(
        vegetationMask,
        sourceLayerName,
        feature.properties,
        geoJsonFeature,
        worldFile
      );
    }
  }

  return { layers, vegetationMask };
}

function classifyShortbreadFeature(layerName, properties) {
  if (layerName === 'streets' || layerName === 'street_polygons') {
    if (properties.rail === true) return 'osm_railways';
    if (['runway', 'taxiway', 'apron'].includes(properties.kind)) return 'osm_aeroway';
    if (OSM_MAJOR_ROAD_KINDS.has(properties.kind)) return 'osm_roads_major';
    return 'osm_roads';
  }
  if (layerName === 'water_lines' || layerName === 'dam_lines' || layerName === 'pier_lines') return 'osm_water_lines';
  if (layerName === 'water_polygons' || layerName === 'ocean' || layerName === 'dam_polygons') return 'osm_water_areas';
  if (layerName === 'land' || layerName === 'sites') {
    if (OSM_VEGETATION_BLOCK_LAND_KINDS.has(properties.kind)) return 'osm_urban_areas';
    return isNaturalShortbreadKind(properties.kind) ? 'osm_natural' : 'osm_landuse';
  }
  if (layerName === 'place_labels' || layerName === 'boundary_labels') return 'osm_places';
  if (layerName === 'pois' || layerName === 'public_transport' || layerName === 'addresses') return 'osm_poi';
  if (layerName === 'boundaries') return 'osm_boundaries';
  if (layerName === 'buildings') return 'osm_buildings';
  if (layerName === 'aerialways') return 'osm_aeroway';
  return null;
}

function isNaturalShortbreadKind(kind) {
  return ['forest', 'wood', 'scrub', 'grassland', 'heath', 'wetland', 'park', 'nature_reserve'].includes(kind);
}

function appendGeoJsonToOsmLayer(target, category, geoJsonFeature, worldFile) {
  const geometry = geoJsonFeature.geometry;
  const properties = geoJsonFeature.properties ?? {};
  if (!geometry) return;

  if (geometry.type === 'Point') {
    appendOsmPoint(target, geometry.coordinates, properties, worldFile);
    return;
  }
  if (geometry.type === 'MultiPoint') {
    for (const coordinates of geometry.coordinates) appendOsmPoint(target, coordinates, properties, worldFile);
    return;
  }

  const appendLine = (coordinates, closed) => {
    const pixelPoints = coordinates
      .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude))
      .map(([longitude, latitude]) => lonLatToPixel(longitude, latitude, worldFile));
    if (pixelPoints.length < 2) return;
    if (closed && isOsmAreaCategory(category)) appendPixelRingSegments(target.lines, pixelPoints);
    else appendPixelLineSegments(target.lines, pixelPoints);
  };

  if (geometry.type === 'LineString') appendLine(geometry.coordinates, false);
  else if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates) appendLine(line, false);
  } else if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) appendLine(ring, true);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) appendLine(ring, true);
    }
  }
}

function appendOsmPoint(target, coordinates, properties, worldFile) {
  const [longitude, latitude] = coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
  const label = properties.name ?? properties.name_en ?? properties.ref ?? properties.kind;
  if (!label) return;
  const pixel = lonLatToPixel(longitude, latitude, worldFile);
  target.points.push({ x: pixel.x, y: pixel.y, label: String(label) });
}

function buildOsmUrbanCoverageGrid(vectorTile, chunk, terrain) {
  const center = terrain.getChunkCenterWorld(chunk.tileX, chunk.tileY);
  const minX = center.x - terrain.chunkWorldWidth / 2;
  const maxX = center.x + terrain.chunkWorldWidth / 2;
  const minZ = center.z - terrain.chunkWorldDepth / 2;
  const maxZ = center.z + terrain.chunkWorldDepth / 2;
  const cellSize = OSM_URBAN_COVERAGE_CELL_METERS * terrain.worldUnitsPerMeter;
  const columns = Math.ceil((maxX - minX) / cellSize);
  const rows = Math.ceil((maxZ - minZ) / cellSize);
  const roadCells = new Uint8Array(columns * rows);

  for (const layerName of ['osm_roads_major', 'osm_roads']) {
    for (const line of vectorTile.layers?.[layerName]?.lines ?? []) {
      const start = terrain.pixelToWorldXZ(line[0], line[1]);
      const end = terrain.pixelToWorldXZ(line[2], line[3]);
      if (Math.max(start.x, end.x) < minX || Math.min(start.x, end.x) > maxX
        || Math.max(start.z, end.z) < minZ || Math.min(start.z, end.z) > maxZ) continue;

      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const orientation = Math.abs(dx) >= Math.abs(dz) ? 1 : 2;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (cellSize * 0.45)));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = start.x + dx * t;
        const z = start.z + dz * t;
        if (x < minX || x >= maxX || z < minZ || z >= maxZ) continue;
        const column = Math.floor((x - minX) / cellSize);
        const row = Math.floor((z - minZ) / cellSize);
        roadCells[row * columns + column] |= orientation;
      }
    }
  }

  const denseCells = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let occupied = 0;
      let orientations = 0;
      for (let offsetRow = -2; offsetRow <= 2; offsetRow += 1) {
        const sampleRow = row + offsetRow;
        if (sampleRow < 0 || sampleRow >= rows) continue;
        for (let offsetColumn = -2; offsetColumn <= 2; offsetColumn += 1) {
          const sampleColumn = column + offsetColumn;
          if (sampleColumn < 0 || sampleColumn >= columns) continue;
          const value = roadCells[sampleRow * columns + sampleColumn];
          if (value === 0) continue;
          occupied += 1;
          orientations |= value;
        }
      }
      if (occupied >= 5 && orientations === 3) denseCells[row * columns + column] = 1;
    }
  }

  const cells = new Uint8Array(columns * rows);
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let developed = false;
      for (let offsetRow = -1; offsetRow <= 1 && !developed; offsetRow += 1) {
        const sampleRow = row + offsetRow;
        if (sampleRow < 0 || sampleRow >= rows) continue;
        for (let offsetColumn = -1; offsetColumn <= 1; offsetColumn += 1) {
          const sampleColumn = column + offsetColumn;
          if (sampleColumn < 0 || sampleColumn >= columns) continue;
          if (denseCells[sampleRow * columns + sampleColumn] === 1) {
            developed = true;
            break;
          }
        }
      }
      if (!developed) continue;
      cells[row * columns + column] = 1;
      count += 1;
    }
  }

  return { cells, count, columns, rows, cellSize, minX, maxX, minZ, maxZ };
}

function mergeOsmVectorTiles(vectorTiles) {
  const merged = {
    layers: createEmptyOsmLayers(),
    vegetationMask: createEmptyOsmVegetationMask()
  };
  for (const vectorTile of vectorTiles) {
    for (const [layerName, layer] of Object.entries(vectorTile.layers ?? {})) {
      merged.layers[layerName].lines.push(...(layer.lines ?? []));
      merged.layers[layerName].points.push(...(layer.points ?? []));
    }
    merged.vegetationMask.areas.push(...(vectorTile.vegetationMask?.areas ?? []));
  }
  return merged;
}

function createEmptyOsmVegetationMask() {
  return { areas: [] };
}

function appendGeoJsonToOsmVegetationMask(mask, layerName, properties, geoJsonFeature, worldFile) {
  const geometry = geoJsonFeature.geometry;
  if (!geometry) return;

  if (layerName === 'buildings'
    || ((layerName === 'land' || layerName === 'sites')
      && OSM_VEGETATION_BLOCK_LAND_KINDS.has(properties.kind))) {
    appendGeoJsonPolygonRings(mask.areas, geometry, worldFile);
  }
}

function appendGeoJsonPolygonRings(target, geometry, worldFile) {
  const appendOuterRing = (coordinates) => {
    const pixelRing = coordinates
      .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude))
      .map(([longitude, latitude]) => {
        const pixel = lonLatToPixel(longitude, latitude, worldFile);
        return [pixel.x, pixel.y];
      });
    if (pixelRing.length >= 3) target.push(pixelRing);
  };

  if (geometry.type === 'Polygon') appendOuterRing(geometry.coordinates[0] ?? []);
  else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) appendOuterRing(polygon[0] ?? []);
  }
}

function summarizeVectorTileFeatures(vectorTile) {
  const summary = {};
  for (const [layerName, layer] of Object.entries(vectorTile.layers ?? {})) {
    summary[layerName] = (layer.lines?.length ?? 0) + (layer.points?.length ?? 0);
  }
  return summary;
}

function mergeOsmFeatureCounts(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function createEmptyOsmLayers() {
  return {
    osm_roads_major: { lines: [], points: [] },
    osm_roads: { lines: [], points: [] },
    osm_railways: { lines: [], points: [] },
    osm_water_lines: { lines: [], points: [] },
    osm_water_areas: { lines: [], points: [] },
    osm_urban_areas: { lines: [], points: [] },
    osm_landuse: { lines: [], points: [] },
    osm_natural: { lines: [], points: [] },
    osm_places: { lines: [], points: [] },
    osm_poi: { lines: [], points: [] },
    osm_aeroway: { lines: [], points: [] },
    osm_power: { lines: [], points: [] },
    osm_boundaries: { lines: [], points: [] },
    osm_buildings: { lines: [], points: [] }
  };
}

function isOsmAreaCategory(category) {
  return category === 'osm_water_areas'
    || category === 'osm_urban_areas'
    || category === 'osm_landuse'
    || category === 'osm_natural'
    || category === 'osm_buildings';
}

function appendPixelLineSegments(target, pixelPoints) {
  for (let index = 1; index < pixelPoints.length; index += 1) {
    const previous = pixelPoints[index - 1];
    const current = pixelPoints[index];
    target.push([previous.x, previous.y, current.x, current.y]);
  }
}

function appendPixelRingSegments(target, pixelPoints) {
  const lastIndex = pixelPoints.length - 1;
  const hasDuplicateClosure = pixelDistanceSquared(pixelPoints[0], pixelPoints[lastIndex]) < 0.25;
  const effectiveLength = hasDuplicateClosure ? lastIndex : pixelPoints.length;
  if (effectiveLength < 3) return;

  for (let index = 0; index < effectiveLength; index += 1) {
    const current = pixelPoints[index];
    const next = pixelPoints[(index + 1) % effectiveLength];
    target.push([current.x, current.y, next.x, next.y]);
  }
}

function pixelDistanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function decodePngRgbData(bytes, url, responseInfo = {}) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      const foundSignature = [...bytes.slice(0, 12)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' ');
      throw new Error(
        `Assinatura PNG invalida: ${foundSignature || 'vazio'}; `
        + `status=${responseInfo.status ?? 'n/a'}; content-type=${responseInfo.contentType ?? 'n/a'}`
      );
    }
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readChunkType(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === 'IHDR') {
      width = readUint32(bytes, dataStart);
      height = readUint32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const compression = bytes[dataStart + 10];
      const filter = bytes[dataStart + 11];
      const interlace = bytes[dataStart + 12];
      if (bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error('PNG de relevo em formato nao suportado');
      }
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`PNG de relevo com colorType nao suportado: ${colorType}`);
      }
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.slice(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!width || !height || idatChunks.length === 0) {
    throw new Error('PNG de relevo incompleto');
  }

  const compressedLength = idatChunks.reduce((total, chunk) => total + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let writeOffset = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const stride = width * channels;
  const expectedInflatedLength = height * (1 + width * channels);
  const inflated = await inflatePngZlib(compressed, expectedInflatedLength, url);
  const data = new Uint8ClampedArray(width * height * 4);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  let readOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[readOffset];
    readOffset += 1;
    current.set(inflated.subarray(readOffset, readOffset + stride));
    readOffset += stride;
    unfilterPngScanline(current, previous, filter, bytesPerPixel);

    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * channels;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = current[sourceIndex];
      data[targetIndex + 1] = current[sourceIndex + 1];
      data[targetIndex + 2] = current[sourceIndex + 2];
      data[targetIndex + 3] = colorType === 6 ? current[sourceIndex + 3] : 255;
    }

    previous.set(current);
  }

  return { data, width, height };
}

async function inflatePngZlib(compressed, expectedLength, url) {
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
      const buffer = await new Response(stream).arrayBuffer();
      const inflated = new Uint8Array(buffer);
      if (inflated.length !== expectedLength) {
        throw new Error(`tamanho inflado invalido: ${inflated.length} != ${expectedLength}`);
      }
      recordTerrainDebug('inflate', { url, method: 'DecompressionStream', bytes: inflated.length });
      return inflated;
    } catch (error) {
      recordTerrainDebug('inflateNativeFailed', { url, message: getErrorMessage(error) });
    }
  }

  const inflated = decompressSync(compressed);
  if (inflated.length !== expectedLength) {
    throw new Error(`tamanho inflado invalido por fflate: ${inflated.length} != ${expectedLength}`);
  }
  recordTerrainDebug('inflate', { url, method: 'fflate', bytes: inflated.length });
  return inflated;
}

function unfilterPngScanline(scanline, previous, filter, bytesPerPixel) {
  for (let index = 0; index < scanline.length; index += 1) {
    const left = index >= bytesPerPixel ? scanline[index - bytesPerPixel] : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;

    if (filter === 1) {
      scanline[index] = (scanline[index] + left) & 0xff;
    } else if (filter === 2) {
      scanline[index] = (scanline[index] + up) & 0xff;
    } else if (filter === 3) {
      scanline[index] = (scanline[index] + Math.floor((left + up) / 2)) & 0xff;
    } else if (filter === 4) {
      scanline[index] = (scanline[index] + paethPredictor(left, up, upLeft)) & 0xff;
    } else if (filter !== 0) {
      throw new Error(`Filtro PNG nao suportado: ${filter}`);
    }
  }
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000
    + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function readChunkType(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function withVersionQuery(url) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${TERRAIN_ASSET_VERSION}`;
}

function recordTerrainDebug(type, details = {}) {
  if (typeof window === 'undefined') return;

  const debug = window.__terrainDebug ?? {
    chunkLoaded: 0,
    chunkFailed: 0,
    events: []
  };
  debug[type] = (debug[type] ?? 0) + 1;
  debug.events.push({
    type,
    ...details,
    time: Math.round(performance.now())
  });
  debug.events = debug.events.slice(-20);
  window.__terrainDebug = debug;
  updateTerrainDebugOverlay(debug);
}

function getErrorMessage(error) {
  return error?.message ?? String(error);
}

function getErrorCauseMessage(error) {
  return error?.cause?.message ?? error?.cause?.toString?.() ?? null;
}

function updateTerrainDebugOverlay(debug) {
  if (typeof document === 'undefined') return;
  if (!new URLSearchParams(window.location.search).has('terrainDebug')) return;

  let overlay = document.querySelector('[data-terrain-debug]');
  if (!overlay) {
    overlay = document.createElement('pre');
    overlay.dataset.terrainDebug = 'true';
    overlay.style.cssText = [
      'position:fixed',
      'left:8px',
      'right:8px',
      'bottom:8px',
      'z-index:20',
      'max-height:32vh',
      'overflow:auto',
      'margin:0',
      'padding:8px',
      'color:#f7fbff',
      'background:rgba(0,0,0,0.72)',
      'font:11px/1.3 monospace',
      'white-space:pre-wrap',
      'pointer-events:none'
    ].join(';');
    document.body.appendChild(overlay);
  }

  overlay.textContent = JSON.stringify(debug, null, 2);
}

function sampleTileElevation(imageData, u, v, fallbackElevation = 0) {
  if (!imageData?.data || !Number.isFinite(u) || !Number.isFinite(v)) {
    return fallbackElevation;
  }

  const x = THREE.MathUtils.clamp(u, 0, imageData.width - 1);
  const y = THREE.MathUtils.clamp(v, 0, imageData.height - 1);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallbackElevation;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, imageData.width - 1);
  const y1 = Math.min(y0 + 1, imageData.height - 1);
  const tx = x - x0;
  const ty = y - y0;
  const h00 = getPixelElevation(imageData, x0, y0);
  const h10 = getPixelElevation(imageData, x1, y0);
  const h01 = getPixelElevation(imageData, x0, y1);
  const h11 = getPixelElevation(imageData, x1, y1);
  const hx0 = THREE.MathUtils.lerp(h00, h10, tx);
  const hx1 = THREE.MathUtils.lerp(h01, h11, tx);
  return THREE.MathUtils.lerp(hx0, hx1, ty);
}

function sampleTileHasNoData(imageData, u, v) {
  if (!imageData?.data || !Number.isFinite(u) || !Number.isFinite(v)) return false;

  const x = THREE.MathUtils.clamp(Math.round(u), 0, imageData.width - 1);
  const y = THREE.MathUtils.clamp(Math.round(v), 0, imageData.height - 1);
  return isNoDataElevation(getRawPixelElevation(imageData, x, y));
}

function isCoastalSandSample(imageData, u, v, elevation) {
  if (normalizeTerrainElevation(elevation) > COASTAL_SAND_MAX_ELEVATION) return false;
  if (!imageData?.data || !Number.isFinite(u) || !Number.isFinite(v)) return false;

  const centerX = THREE.MathUtils.clamp(Math.round(u), 0, imageData.width - 1);
  const centerY = THREE.MathUtils.clamp(Math.round(v), 0, imageData.height - 1);

  for (let y = centerY - COASTAL_SAND_SEARCH_PIXELS; y <= centerY + COASTAL_SAND_SEARCH_PIXELS; y += 1) {
    if (y < 0 || y >= imageData.height) continue;
    for (let x = centerX - COASTAL_SAND_SEARCH_PIXELS; x <= centerX + COASTAL_SAND_SEARCH_PIXELS; x += 1) {
      if (x < 0 || x >= imageData.width) continue;
      if (isNoDataElevation(getRawPixelElevation(imageData, x, y))) return true;
    }
  }

  return false;
}

function getPixelElevation(imageData, x, y) {
  return normalizeTerrainElevation(getRawPixelElevation(imageData, x, y));
}

function getRawPixelElevation(imageData, x, y) {
  const index = (y * imageData.width + x) * 4;
  if (!Number.isFinite(index) || index < 0 || index + 1 >= imageData.data.length) {
    return 0;
  }
  return imageData.data[index] * 256 + imageData.data[index + 1] - 32768;
}

function normalizeTerrainElevation(elevation) {
  return isNoDataElevation(elevation) ? SEA_LEVEL_ELEVATION : elevation;
}

function isNoDataElevation(elevation) {
  return elevation < NO_DATA_ELEVATION_THRESHOLD;
}

// Curvatura local: media das alturas ao redor menos a altura do ponto.
// Positiva em fundos de vale (vizinhanca mais alta), negativa em cristas.
// O efeito e atenuado junto as bordas do tile, onde o clamp das amostras
// enviesaria o valor e criaria emendas de cor entre chunks vizinhos.
function sampleTileCurvature(imageData, u, v, centerElevation) {
  const radiusPixels = 4;
  const edgeDistance = Math.min(u, v, imageData.width - 1 - u, imageData.height - 1 - v);
  const edgeFactor = THREE.MathUtils.clamp(edgeDistance / radiusPixels, 0, 1);
  if (edgeFactor <= 0) return 0;

  const neighborhood = (
    sampleTileElevation(imageData, u + radiusPixels, v, centerElevation)
    + sampleTileElevation(imageData, u - radiusPixels, v, centerElevation)
    + sampleTileElevation(imageData, u, v + radiusPixels, centerElevation)
    + sampleTileElevation(imageData, u, v - radiusPixels, centerElevation)
  ) / 4;
  return (neighborhood - normalizeTerrainElevation(centerElevation)) * edgeFactor;
}

function sampleTileSlope(imageData, u, v, metersPerPixelX, metersPerPixelY) {
  const center = sampleTileElevation(imageData, u, v);
  const east = sampleTileElevation(imageData, u + 1, v, center);
  const west = sampleTileElevation(imageData, u - 1, v, center);
  const north = sampleTileElevation(imageData, u, v - 1, center);
  const south = sampleTileElevation(imageData, u, v + 1, center);
  const dx = Math.abs(east - west) / Math.max(metersPerPixelX * 2, 1);
  const dz = Math.abs(south - north) / Math.max(metersPerPixelY * 2, 1);
  return Math.hypot(dx, dz);
}

const TERRAIN_PALETTE = {
  sea: new THREE.Color(0x2e668a),
  shallowSea: new THREE.Color(0x4e8ca8),
  sand: new THREE.Color(0xe7e0c4),
  paleSand: new THREE.Color(0xf3ecd2),
  lowForest: new THREE.Color(0x3c6e36),
  forest: new THREE.Color(0x5c8547),
  highForest: new THREE.Color(0x7c8460),
  dryGrass: new THREE.Color(0x9a8b5d),
  exposedSoil: new THREE.Color(0x7a6b5b),
  granite: new THREE.Color(0x8f9395),
  clearing: new THREE.Color(0x8ca065),
  mountainMist: new THREE.Color(0xb8c0c6)
};
const tempTerrainColor = new THREE.Color();

function addTerrainColor(colors, height, slope, worldX, worldZ, isSea = false, isSand = false, curvature = 0) {
  const color = tempTerrainColor;
  const palette = TERRAIN_PALETTE;

  if (isSea) {
    const waterNoise = terrainValueNoise(worldX * 0.0018, worldZ * 0.0018);
    color.copy(palette.sea).lerp(palette.shallowSea, waterNoise * 0.35);
    colors.push(color.r, color.g, color.b);
    return;
  }

  if (isSand) {
    const sandNoise = terrainValueNoise(worldX * 0.018, worldZ * 0.018);
    color.copy(palette.sand).lerp(palette.paleSand, 0.35 + sandNoise * 0.35);
    colors.push(color.r, color.g, color.b);
    return;
  }

  if (height < 750) {
    color.copy(palette.lowForest);
  } else if (height < 1150) {
    color.copy(palette.lowForest).lerp(palette.forest, (height - 750) / 400);
  } else if (height < 1450) {
    color.copy(palette.forest).lerp(palette.highForest, (height - 1150) / 300);
  } else {
    color.copy(palette.highForest).lerp(palette.dryGrass, THREE.MathUtils.clamp((height - 1450) / 500, 0, 1));
  }

  // Ruido em duas escalas quebra as faixas uniformes de altitude:
  // manchas largas (clareiras/pasto) e granulacao fina de vegetacao.
  const patchNoise = terrainValueNoise(worldX * 0.004, worldZ * 0.004);
  const grainNoise = terrainValueNoise(worldX * 0.045 + 71.3, worldZ * 0.045 - 38.7);
  color.lerp(palette.clearing, THREE.MathUtils.clamp((patchNoise - 0.62) / 0.38, 0, 1) * 0.5);
  const brightness = 1 + (patchNoise - 0.5) * 0.14 + (grainNoise - 0.5) * 0.22;
  color.multiplyScalar(THREE.MathUtils.clamp(brightness, 0.78, 1.22));

  const exposedFactor = THREE.MathUtils.clamp((slope - 0.14) / 0.24, 0, 1);
  const rockFactor = THREE.MathUtils.clamp((slope - 0.28) / 0.32, 0, 1);
  const mountainBlend = THREE.MathUtils.clamp((height - 1050) / 700, 0, 1);
  color.lerp(palette.exposedSoil, exposedFactor * 0.45);
  color.lerp(palette.granite, rockFactor * 0.55);
  color.lerp(palette.mountainMist, mountainBlend * 0.24);

  // Oclusao ambiente barata por curvatura: fundos de vale (curvatura positiva)
  // recebem menos luz do ceu; cristas ficam levemente mais claras. Vales de rio
  // tambem puxam para verde mais escuro e umido (mata ciliar).
  const valleyFactor = THREE.MathUtils.clamp(curvature / 55, 0, 1);
  const ridgeFactor = THREE.MathUtils.clamp(-curvature / 70, 0, 1);
  color.lerp(palette.lowForest, valleyFactor * 0.3);
  color.multiplyScalar(1 - valleyFactor * 0.16 + ridgeFactor * 0.08);

  colors.push(color.r, color.g, color.b);
}

// Exportado para a vegetacao plantar arvores exatamente onde addTerrainColor
// pinta mata (e poupar as clareiras), usando o mesmo campo de ruido.
export function terrainValueNoise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep01(x - x0);
  const tz = smoothstep01(z - z0);
  const v00 = hash2D(x0, z0);
  const v10 = hash2D(x0 + 1, z0);
  const v01 = hash2D(x0, z0 + 1);
  const v11 = hash2D(x0 + 1, z0 + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(v00, v10, tx),
    THREE.MathUtils.lerp(v01, v11, tx),
    tz
  );
}

function hash2D(x, z) {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function smoothstep01(t) {
  return t * t * (3 - 2 * t);
}

function waitForNextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

// Texturas procedurais das fitas vetoriais, mapeadas com u atraves da
// largura e v ao longo (1 repeticao = metersPerRepeat do estilo).
const ribbonTextureCache = new Map();

function createRibbonTexture(kind) {
  if (typeof document === 'undefined') return null;
  if (ribbonTextureCache.has(kind)) return ribbonTextureCache.get(kind);

  const width = 128;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (kind === 'highway') {
    // Asfalto de rodovia: bordas brancas continuas e eixo amarelo tracejado.
    fillNoisyBase(context, width, height, [98, 98, 106], 10);
    drawLaneLine(context, width * 0.055, 0, height, 3, 'rgba(232, 235, 240, 0.8)');
    drawLaneLine(context, width * 0.945, 0, height, 3, 'rgba(232, 235, 240, 0.8)');
    // Eixo tracejado: 1/3 do ciclo pintado (ex.: 8 m de faixa a cada 24 m).
    context.fillStyle = 'rgba(228, 196, 80, 0.85)';
    context.fillRect(width / 2 - 2, height * 0.33, 4, height * 0.34);
  } else if (kind === 'asphalt') {
    // Asfalto simples de pista dupla com eixo discreto.
    fillNoisyBase(context, width, height, [110, 107, 102], 12);
    context.fillStyle = 'rgba(226, 198, 96, 0.5)';
    context.fillRect(width / 2 - 2, height * 0.36, 4, height * 0.28);
  } else if (kind === 'dirt') {
    // Estrada de terra: barro claro com duas trilhas de rodagem escurecidas.
    fillNoisyBase(context, width, height, [179, 152, 108], 22);
    drawLaneLine(context, width * 0.3, 0, height, 14, 'rgba(122, 99, 66, 0.4)');
    drawLaneLine(context, width * 0.7, 0, height, 14, 'rgba(122, 99, 66, 0.4)');
  } else if (kind === 'railway') {
    // Leito de brita, dormentes transversais e dois trilhos continuos.
    fillNoisyBase(context, width, height, [111, 107, 100], 16);
    const sleepersPerRepeat = 2;
    for (let index = 0; index < sleepersPerRepeat; index += 1) {
      const y = ((index + 0.25) / sleepersPerRepeat) * height;
      context.fillStyle = 'rgba(58, 52, 46, 0.85)';
      context.fillRect(width * 0.12, y, width * 0.76, height * 0.09);
    }
    drawLaneLine(context, width * 0.34, 0, height, 5, 'rgba(150, 152, 158, 0.95)');
    drawLaneLine(context, width * 0.66, 0, height, 5, 'rgba(150, 152, 158, 0.95)');
  } else {
    return null;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  ribbonTextureCache.set(kind, texture);
  return texture;
}

function fillNoisyBase(context, width, height, [red, green, blue], noiseAmplitude) {
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const noise = (hash2D(x * 3.7, y * 2.3) - 0.5) * 2 * noiseAmplitude;
      const index = (y * width + x) * 4;
      image.data[index] = THREE.MathUtils.clamp(red + noise, 0, 255);
      image.data[index + 1] = THREE.MathUtils.clamp(green + noise, 0, 255);
      image.data[index + 2] = THREE.MathUtils.clamp(blue + noise, 0, 255);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

function drawLaneLine(context, x, top, bottom, lineWidth, style) {
  context.fillStyle = style;
  context.fillRect(x - lineWidth / 2, top, lineWidth, bottom - top);
}

// Splatting por pixel: as cores por vertice (resolucao ~230 m) viram apenas a
// base macro; o fragment shader adiciona, em coordenadas de mundo (continuas
// entre chunks), clareamento/sombreado de copas em areas verdes, afloramento
// de rocha/solo por inclinacao real da encosta e granulacao fina — os detalhes
// metricos que a malha nao tem como carregar.
function applyTerrainSplatting(material) {
  const toGlslColor = (hex) => {
    const color = new THREE.Color(hex);
    return `vec3(${color.r.toFixed(5)}, ${color.g.toFixed(5)}, ${color.b.toFixed(5)})`;
  };
  const soil = toGlslColor(0x7a6b5b);
  const granite = toGlslColor(0x8f9395);
  const darkGranite = toGlslColor(0x6d7276);

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec3 vSplatWorld;',
        'varying vec3 vSplatNormal;'
      ].join('\n'))
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'vSplatWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        // Chunks de terreno nao tem rotacao/escala: a normal do objeto ja e a de mundo.
        'vSplatNormal = normal;'
      ].join('\n'));

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec3 vSplatWorld;',
        'varying vec3 vSplatNormal;',
        // Lattice com modulo mantem o seno do hash em faixa segura de precisao
        // mesmo a dezenas de km da origem (o padrao repete a cada 1024 celulas).
        'float splatHash(vec2 p) {',
        '  p = mod(p, 1024.0);',
        '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
        '}',
        'float splatNoise(vec2 p) {',
        '  vec2 i = floor(p);',
        '  vec2 f = fract(p);',
        '  vec2 u = f * f * (3.0 - 2.0 * f);',
        '  return mix(',
        '    mix(splatHash(i), splatHash(i + vec2(1.0, 0.0)), u.x),',
        '    mix(splatHash(i + vec2(0.0, 1.0)), splatHash(i + vec2(1.0, 1.0)), u.x),',
        '    u.y);',
        '}'
      ].join('\n'))
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        '{',
        '  vec2 wxz = vSplatWorld.xz;',
        '  vec3 geoNormal = normalize(vSplatNormal);',
        // Inclinacao como tangente (rise/run), mesma medida do sombreamento por vertice.
        '  float tanSlope = length(geoNormal.xz) / max(geoNormal.y, 0.05);',
        '  float clumpNoise = splatNoise(wxz * 0.048);',
        '  float grainNoise = splatNoise(wxz * 0.17 + 37.7);',
        '  float macroNoise = splatNoise(wxz * 0.011 + 91.3);',
        // Verde = vegetacao; areia/rocha/mar tem g <= r e ficam de fora das copas.
        // Medida relativa: mantem sensibilidade tambem nos verdes escuros de altitude.
        '  float greenness = clamp((diffuseColor.g - diffuseColor.r) / max(diffuseColor.g, 0.001) * 2.5, 0.0, 1.0);',
        // Copas: aglomerados claros (topo iluminado) e vaos escuros (sub-bosque).
        '  float canopy = clumpNoise * 0.65 + grainNoise * 0.35;',
        '  diffuseColor.rgb *= 1.0 + (canopy - 0.5) * 0.62 * greenness;',
        // Afloramento de rocha/solo exposto onde a encosta e ingreme (a partir
        // de ~23 graus), com a borda quebrada por noise para nao virar faixa.
        '  float rockMask = smoothstep(0.42, 0.85, tanSlope + (macroNoise - 0.5) * 0.25 + (grainNoise - 0.5) * 0.1);',
        `  float strata = clamp(sin(vSplatWorld.y * 0.045 + clumpNoise * 3.2) * 0.5 + 0.5, 0.0, 1.0);`,
        `  vec3 rockColor = mix(mix(${soil}, ${granite}, strata), ${darkGranite}, grainNoise * 0.45);`,
        '  diffuseColor.rgb = mix(diffuseColor.rgb, rockColor * (0.82 + grainNoise * 0.36), rockMask * 0.72);',
        // Granulacao fina geral (folhagem, pedrisco, textura de pasto), com um
        // leve desvio de matiz para amarelado nos pontos altos do ruido.
        '  float grainMix = clumpNoise * 0.4 + grainNoise * 0.6;',
        '  diffuseColor.rgb *= (0.9 + grainMix * 0.2) * mix(vec3(0.985, 1.0, 1.01), vec3(1.02, 1.01, 0.975), grainMix);',
        '}'
      ].join('\n'));
  };
  material.customProgramCacheKey = () => 'terrain-splatting-1';
}

function createDetailTexture() {
  if (typeof document === 'undefined') return null;

  const size = 256;
  const period = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Ruido de treliça com lattice modular para a textura tilar sem emendas.
      const u = (x / size) * period;
      const v = (y / size) * period;
      const coarse = tileableValueNoise(u, v, period);
      const fine = tileableValueNoise(u * 4, v * 4, period * 4);
      const value = Math.round(235 + (coarse - 0.5) * 26 + (fine - 0.5) * 14);
      const index = (y * size + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Varre o tile com passo largo procurando pixels NoData (mar aberto).
function tileHasSeaPixels(imageData) {
  if (!imageData?.data) return false;

  const stride = 4;
  for (let y = 0; y < imageData.height; y += stride) {
    for (let x = 0; x < imageData.width; x += stride) {
      if (isNoDataElevation(getRawPixelElevation(imageData, x, y))) return true;
    }
  }
  return false;
}

function createWaterNormalTexture() {
  if (typeof document === 'undefined') return null;

  const size = 256;
  const period = 9;
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * period;
      const v = (y / size) * period;
      heights[y * size + x] = tileableValueNoise(u, v, period) * 0.65
        + tileableValueNoise(u * 3, v * 3, period * 3) * 0.35;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const strength = 3;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heights[y * size + ((x - 1 + size) % size)];
      const right = heights[y * size + ((x + 1) % size)];
      const up = heights[((y - 1 + size) % size) * size + x];
      const down = heights[((y + 1) % size) * size + x];
      const normalX = (left - right) * strength;
      const normalY = (up - down) * strength;
      const invLength = 1 / Math.hypot(normalX, normalY, 1);
      const index = (y * size + x) * 4;
      image.data[index] = Math.round((normalX * invLength * 0.5 + 0.5) * 255);
      image.data[index + 1] = Math.round((normalY * invLength * 0.5 + 0.5) * 255);
      image.data[index + 2] = Math.round((invLength * 0.5 + 0.5) * 255);
      image.data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Normal map tileavel de micro-relevo gerado do mesmo ruido do detalhe:
// gradientes do heightfield viram vetores de normal (estilo copas/ondulacao).
function createTerrainNormalTexture() {
  if (typeof document === 'undefined') return null;

  const size = 256;
  const period = 24;
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * period;
      const v = (y / size) * period;
      heights[y * size + x] = tileableValueNoise(u, v, period) * 0.7
        + tileableValueNoise(u * 3, v * 3, period * 3) * 0.3;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const strength = 2.2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heights[y * size + ((x - 1 + size) % size)];
      const right = heights[y * size + ((x + 1) % size)];
      const up = heights[((y - 1 + size) % size) * size + x];
      const down = heights[((y + 1) % size) * size + x];
      const normalX = (left - right) * strength;
      const normalY = (up - down) * strength;
      const invLength = 1 / Math.hypot(normalX, normalY, 1);
      const index = (y * size + x) * 4;
      image.data[index] = Math.round((normalX * invLength * 0.5 + 0.5) * 255);
      image.data[index + 1] = Math.round((normalY * invLength * 0.5 + 0.5) * 255);
      image.data[index + 2] = Math.round((invLength * 0.5 + 0.5) * 255);
      image.data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function tileableValueNoise(x, z, period) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep01(x - x0);
  const tz = smoothstep01(z - z0);
  const wrap = (value) => ((value % period) + period) % period;
  const v00 = hash2D(wrap(x0), wrap(z0));
  const v10 = hash2D(wrap(x0 + 1), wrap(z0));
  const v01 = hash2D(wrap(x0), wrap(z0 + 1));
  const v11 = hash2D(wrap(x0 + 1), wrap(z0 + 1));
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(v00, v10, tx),
    THREE.MathUtils.lerp(v01, v11, tx),
    tz
  );
}
