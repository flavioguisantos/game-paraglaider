import * as THREE from 'three';

const DEFAULT_OPTIONS = {
  manifestUrl: '/mapas/processed/BRA_SUDESTE_HighRes/manifest.json',
  // Pedra Grande, Atibaia: world origin and launch reference.
  centerLatitude: -23.169090319406045,
  centerLongitude: -46.52831806228563,
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

const tempTile = { x: 0, y: 0 };
const VECTOR_LAYER_STYLES = {
  city_area: { color: 0xdede00, opacity: 0.38, yOffset: 0.72 },
  water_area: { color: 0x55a0ff, opacity: 0.7, yOffset: 0.86 },
  water_line: { color: 0x55a0ff, opacity: 0.85, yOffset: 0.9 },
  roadbig_line: { color: 0xf04040, opacity: 0.95, yOffset: 1.05 },
  roadmedium_line: { color: 0xf07055, opacity: 0.8, yOffset: 1.0 },
  roadsmall_line: { color: 0xe7aa74, opacity: 0.58, yOffset: 0.95 },
  railway_line: { color: 0x303030, opacity: 0.8, yOffset: 1.12 },
  city_point: { color: 0xf4e55c, opacity: 1, yOffset: 3.5 },
  town_point: { color: 0xf4e55c, opacity: 0.92, yOffset: 3.2 },
  suburb_point: { color: 0xe9de76, opacity: 0.78, yOffset: 2.8 },
  village_point: { color: 0xe9de76, opacity: 0.72, yOffset: 2.6 }
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
    this.mesh.add(this.reliefGroup, this.vectorGroup);
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
    this.availableVectorTiles = new Set();
    this.vectorMaterials = new Map();
    this.labelTextureCache = new Map();
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
    this.centerPixel = lonLatToPixel(
      this.config.centerLongitude,
      this.config.centerLatitude,
      this.manifest.source.worldFile
    );
    const pixelScale = getMetersPerPixel(this.config.centerLatitude, this.manifest.source.worldFile);
    this.worldUnitsPerPixelX = pixelScale.x * this.config.horizontalScale;
    this.worldUnitsPerPixelY = pixelScale.y * this.config.horizontalScale;
    this.worldUnitsPerMeter = this.config.horizontalScale;
    this.chunkWorldWidth = this.worldUnitsPerPixelX * this.manifest.terrain.tileSize;
    this.chunkWorldDepth = this.worldUnitsPerPixelY * this.manifest.terrain.tileSize;
    this.size = Math.max(this.chunkWorldWidth, this.chunkWorldDepth) * (this.config.loadRadius * 2 + 1);
    this.segments = this.config.chunkSegments * (this.config.loadRadius * 2 + 1);
  }

  update(position) {
    if (!this.manifest || !this.centerPixel) return;

    const centerTile = this.getTileForWorld(position.x, position.z);
    const keepKeys = new Set();

    for (let y = centerTile.y - this.config.loadRadius; y <= centerTile.y + this.config.loadRadius; y += 1) {
      for (let x = centerTile.x - this.config.loadRadius; x <= centerTile.x + this.config.loadRadius; x += 1) {
        if (!this.isValidTile(x, y)) continue;
        const key = getChunkKey(x, y);
        keepKeys.add(key);
        if (!this.chunks.has(key) && !this.loadingChunks.has(key)) {
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
    this.loadingChunks.add(key);

    try {
      const image = await loadImage(this.getTileUrl(tileX, tileY));
      const imageData = getImageData(image);
      const chunk = {
        tileX,
        tileY,
        imageData,
        mesh: this.createChunkMesh(tileX, tileY, imageData),
        vectors: null
      };
      this.chunks.set(key, chunk);
      this.reliefGroup.add(chunk.mesh);
      this.loadVectorChunk(chunk);
    } catch (error) {
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
    chunk.mesh.geometry.dispose();
    chunk.mesh.material.dispose();
    this.chunks.delete(key);
  }

  getTileUrl(tileX, tileY) {
    return `${this.manifestBaseUrl}${this.manifest.terrain.urlTemplate
      .replace('{x}', tileX)
      .replace('{y}', tileY)}`;
  }

  getVectorTileUrl(tileX, tileY) {
    if (!this.manifest.vectors?.urlTemplate) return null;
    return `${this.manifestBaseUrl}${this.manifest.vectors.urlTemplate
      .replace('{x}', tileX)
      .replace('{y}', tileY)}`;
  }

  async loadVectorChunk(chunk) {
    const key = getChunkKey(chunk.tileX, chunk.tileY);
    if (!this.availableVectorTiles.has(key)) return;

    try {
      const response = await fetch(this.getVectorTileUrl(chunk.tileX, chunk.tileY));
      if (!response.ok) throw new Error(`Vector HTTP ${response.status}`);
      const vectorTile = await response.json();
      const group = this.createVectorGroup(vectorTile, chunk.imageData);
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
      const worldHeight = this.elevationToWorldHeight(elevation);
      const slope = sampleTileSlope(imageData, u, v, this.worldUnitsPerPixelX, this.worldUnitsPerPixelY);
      positions.setY(index, worldHeight);
      addTerrainColor(colors, worldHeight, slope);
    }

    positions.needsUpdate = true;
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.74,
        metalness: 0
      })
    );
    mesh.name = `XcmTerrainChunk_${tileX}_${tileY}`;
    mesh.position.set(chunkCenter.x, 0, chunkCenter.z);
    return mesh;
  }

  createVectorGroup(vectorTile, imageData) {
    const group = new THREE.Group();
    const layers = vectorTile.layers ?? {};

    for (const [layerName, layer] of Object.entries(layers)) {
      if (layer.lines?.length) {
        const lineObject = this.createVectorLines(layerName, layer.lines, imageData);
        if (lineObject) group.add(lineObject);
      }

      if (layer.points?.length) {
        const pointGroup = this.createVectorPoints(layerName, layer.points, imageData);
        if (pointGroup.children.length > 0) group.add(pointGroup);
      }
    }

    return group;
  }

  createVectorLines(layerName, lines, imageData) {
    const positions = [];
    const style = getVectorStyle(layerName);

    for (const line of lines) {
      const start = this.pixelToWorld(line[0], line[1], imageData, style.yOffset);
      const end = this.pixelToWorld(line[2], line[3], imageData, style.yOffset);
      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }

    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const object = new THREE.LineSegments(geometry, this.getVectorMaterial(layerName));
    object.name = `XcmVectorLines_${layerName}`;
    object.frustumCulled = false;
    return object;
  }

  createVectorPoints(layerName, points, imageData) {
    const group = new THREE.Group();
    const style = getVectorStyle(layerName);
    const markerGeometry = new THREE.SphereGeometry(layerName === 'city_point' ? 0.9 : 0.55, 8, 6);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity });

    for (const point of points) {
      const position = this.pixelToWorld(point.x, point.y, imageData, style.yOffset);
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.copy(position);
      group.add(marker);

      if (point.label) {
        const label = this.createLabelSprite(point.label, style.color);
        label.position.set(position.x, position.y + this.config.labelYOffset, position.z);
        group.add(label);
      }
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

  getVectorMaterial(layerName) {
    if (!this.vectorMaterials.has(layerName)) {
      const style = getVectorStyle(layerName);
      this.vectorMaterials.set(layerName, new THREE.LineBasicMaterial({
        color: style.color,
        transparent: true,
        opacity: style.opacity,
        depthWrite: false
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
    return (elevation - this.config.referenceElevation) * this.config.heightScale;
  }
}

function getVectorStyle(layerName) {
  return VECTOR_LAYER_STYLES[layerName] ?? { color: 0xffffff, opacity: 0.75, yOffset: 1 };
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

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function getImageData(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return {
    data: context.getImageData(0, 0, canvas.width, canvas.height).data,
    width: canvas.width,
    height: canvas.height
  };
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

function getPixelElevation(imageData, x, y) {
  const index = (y * imageData.width + x) * 4;
  if (!Number.isFinite(index) || index < 0 || index + 1 >= imageData.data.length) {
    return 0;
  }
  return imageData.data[index] * 256 + imageData.data[index + 1] - 32768;
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

function addTerrainColor(colors, height, slope) {
  const lowForest = new THREE.Color(0x315f32);
  const forest = new THREE.Color(0x47733a);
  const highForest = new THREE.Color(0x667849);
  const dryGrass = new THREE.Color(0x8a8153);
  const exposedSoil = new THREE.Color(0x8f7356);
  const granite = new THREE.Color(0xa49d91);
  const color = new THREE.Color();

  if (height < 750) {
    color.copy(lowForest);
  } else if (height < 1150) {
    color.copy(lowForest).lerp(forest, (height - 750) / 400);
  } else if (height < 1450) {
    color.copy(forest).lerp(highForest, (height - 1150) / 300);
  } else {
    color.copy(highForest).lerp(dryGrass, THREE.MathUtils.clamp((height - 1450) / 500, 0, 1));
  }

  const exposedFactor = THREE.MathUtils.clamp((slope - 0.14) / 0.24, 0, 1);
  const rockFactor = THREE.MathUtils.clamp((slope - 0.28) / 0.32, 0, 1);
  color.lerp(exposedSoil, exposedFactor * 0.45);
  color.lerp(granite, rockFactor * 0.55);

  colors.push(color.r, color.g, color.b);
}
