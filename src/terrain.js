import * as THREE from 'three';
import { decompressSync } from 'fflate';

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

const TERRAIN_ASSET_VERSION = 'terrain-rgb-binary-5';
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
    this.failedChunks = new Set();
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
      const imageData = await loadImageData(this.getTileUrl(tileX, tileY));
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
      this.loadVectorChunk(chunk);
    } catch (error) {
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
    chunk.mesh.geometry.dispose();
    chunk.mesh.material.dispose();
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
