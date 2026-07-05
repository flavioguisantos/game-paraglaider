import * as THREE from 'three';
import { decompressSync } from 'fflate';
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
  horizontalScale: 1,
  heightScale: 1,
  referenceElevation: 0,
  fallbackHeight: 1360,
  vectorYOffset: 0.55,
  labelYOffset: 4,
  labelScale: 10
};

const TERRAIN_ASSET_VERSION = 'terrain-rgb-binary-5';
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
  city_area: { type: 'area', color: 0xb5ab9d, opacity: 0.45, flat: false, yOffset: 1.0 },
  water_area: { type: 'area', color: 0x3a76ad, opacity: 1, flat: true, yOffset: 1.3, roughness: 0.28 },
  water_line: { type: 'ribbon', color: 0x4181b2, widthMeters: 14, yOffset: 1.2 },
  roadbig_line: { type: 'ribbon', color: 0xb0b0b6, widthMeters: 26, yOffset: 2.0 },
  roadmedium_line: { type: 'ribbon', color: 0xa69d8f, widthMeters: 16, yOffset: 1.8 },
  roadsmall_line: { type: 'ribbon', color: 0xc0a577, widthMeters: 9, yOffset: 1.5 },
  railway_line: { type: 'ribbon', color: 0x57544e, widthMeters: 6, yOffset: 2.2 },
  city_point: { type: 'point', color: 0xf4e55c, opacity: 1, yOffset: 3.5 },
  town_point: { type: 'point', color: 0xf4e55c, opacity: 0.92, yOffset: 3.2 },
  suburb_point: { type: 'point', color: 0xe9de76, opacity: 0.78, yOffset: 2.8 },
  village_point: { type: 'point', color: 0xe9de76, opacity: 0.72, yOffset: 2.6 }
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
    this.urbanScenery = createUrbanScenery({ terrain: this });
    this.mesh.add(this.reliefGroup, this.vectorGroup, this.urbanScenery.group);
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
    this.availableVectorTiles = new Set();
    this.vectorMaterials = new Map();
    this.labelTextureCache = new Map();
    this.layerVisibility = new Map();
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

    this.loadingChunks.clear();
    this.failedChunks.clear();

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

    this.urbanScenery.update(delta);
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
      const imageData = await loadImageData(this.getTileUrl(tileX, tileY));
      if (revision !== this.centerRevision) return;

      const chunk = {
        tileX,
        tileY,
        imageData,
        mesh: this.createChunkMesh(tileX, tileY, imageData),
        vectors: null
      };
      this.chunks.set(key, chunk);
      this.reliefGroup.add(chunk.mesh);
      recordTerrainDebug('chunkLoaded', { key, chunks: this.chunks.size });
      this.loadVectorChunk(chunk, revision);
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
    if (chunk.vectors) {
      this.vectorGroup.remove(chunk.vectors);
      disposeObject3D(chunk.vectors);
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

  createChunkMesh(tileX, tileY, imageData) {
    const geometry = new THREE.PlaneGeometry(
      this.chunkWorldWidth,
      this.chunkWorldDepth,
      this.config.chunkSegments,
      this.config.chunkSegments
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
      positions.setY(index, worldHeight);
      addTerrainColor(colors, worldHeight, slope, chunkCenter.x + localX, chunkCenter.z + localZ, isSea, isSand);
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

  tagVectorLayerObject(object, layerName) {
    object.userData.vectorLayer = layerName;
    object.visible = this.layerVisibility.get(layerName) ?? true;
    return object;
  }

  setLayerVisibility(layerName, visible) {
    this.layerVisibility.set(layerName, visible);
    this.vectorGroup.traverse((child) => {
      if (child.userData.vectorLayer === layerName) child.visible = visible;
    });
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

  createVectorRibbons(layerName, lines, chunk, style) {
    const positions = [];
    const indices = [];
    const halfWidth = (style.widthMeters * this.worldUnitsPerMeter) / 2;
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

      for (const point of stepPoints) {
        if (Math.abs(point.height - medianHeight) > 120) point.height = medianHeight;
        const height = point.height + style.yOffset;
        positions.push(point.x - perpX, height, point.z - perpZ);
        positions.push(point.x + perpX, height, point.z + perpZ);
      }

      for (let step = 0; step < steps; step += 1) {
        const row = base + step * 2;
        indices.push(row, row + 2, row + 1, row + 1, row + 2, row + 3);
      }
    }

    if (positions.length === 0) return null;

    const mesh = new THREE.Mesh(
      this.buildVectorGeometry(positions, indices),
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

  buildVectorGeometry(positions, indices) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);

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
      this.vectorMaterials.set(layerName, new THREE.MeshStandardMaterial({
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
      }));
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
      depthWrite: false
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

function createLabelTexture(text, color) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const fontSize = 30;
  context.font = `600 ${fontSize}px Arial, sans-serif`;
  const metrics = context.measureText(text);
  canvas.width = Math.min(512, Math.ceil(metrics.width + 28));
  canvas.height = 56;

  context.font = `600 ${fontSize}px Arial, sans-serif`;
  context.fillStyle = 'rgba(12, 18, 14, 0.68)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  context.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  context.fillText(text, 14, 38);

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

function addTerrainColor(colors, height, slope, worldX, worldZ, isSea = false, isSand = false) {
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

  colors.push(color.r, color.g, color.b);
}

function terrainValueNoise(x, z) {
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
