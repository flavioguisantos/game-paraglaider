import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

const inputPath = path.resolve(process.argv[2] ?? 'mapas/BRA_SUDESTE_HighRes.xcm');
const outputRoot = path.resolve(process.argv[3] ?? `mapas/processed/${path.basename(inputPath, path.extname(inputPath))}`);
const extractedDir = path.join(outputRoot, 'source');
const tilesDir = path.join(outputRoot, 'terrain-rgb');
const vectorsDir = path.join(outputRoot, 'vectors');
const tileSize = 256;

function main() {
  assertFile(inputPath);
  assertCommand('magick');
  fs.mkdirSync(extractedDir, { recursive: true });
  fs.mkdirSync(tilesDir, { recursive: true });
  fs.mkdirSync(vectorsDir, { recursive: true });

  extractXcm(inputPath, extractedDir);

  const terrainPath = path.join(extractedDir, 'terrain.jp2');
  const j2wPath = path.join(extractedDir, 'terrain.j2w');
  const infoPath = path.join(extractedDir, 'info.txt');
  assertFile(terrainPath);
  assertFile(j2wPath);
  assertFile(infoPath);

  const imageInfo = identifyImage(terrainPath);
  if (imageInfo.width % tileSize !== 0 || imageInfo.height % tileSize !== 0) {
    throw new Error(`Terrain dimensions must be divisible by ${tileSize}: ${imageInfo.width}x${imageInfo.height}`);
  }

  const rawPath = path.join(outputRoot, 'terrain.u16le');
  const expectedRawBytes = imageInfo.width * imageInfo.height * 2;
  if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size !== expectedRawBytes) {
    convertJp2ToRaw(terrainPath, rawPath);
  }

  const raw = fs.readFileSync(rawPath);
  if (raw.length !== expectedRawBytes) {
    throw new Error(`Unexpected RAW size: ${raw.length}, expected ${expectedRawBytes}`);
  }

  const columns = imageInfo.width / tileSize;
  const rows = imageInfo.height / tileSize;
  generateTerrainTiles(raw, imageInfo.width, imageInfo.height, columns, rows);
  const vectorSummary = generateVectorTiles(extractedDir, columns, rows, parseJ2w(fs.readFileSync(j2wPath, 'utf8')));

  const manifest = {
    name: path.basename(inputPath),
    format: 'xcm-processed-terrain-rgb-vectors',
    generatedAt: new Date().toISOString(),
    source: {
      xcm: path.relative(outputRoot, inputPath).replaceAll('\\', '/'),
      info: parseInfo(fs.readFileSync(infoPath, 'utf8')),
      worldFile: parseJ2w(fs.readFileSync(j2wPath, 'utf8'))
    },
    terrain: {
      tileSize,
      columns,
      rows,
      width: imageInfo.width,
      height: imageInfo.height,
      encoding: 'terrarium-rgb',
      elevationMeters: 'R * 256 + G - 32768',
      urlTemplate: 'terrain-rgb/{x}/{y}.png'
    },
    vectors: {
      tileSize,
      urlTemplate: 'vectors/{x}/{y}.json',
      layers: vectorSummary.layers,
      tiles: vectorSummary.tiles,
      available: vectorSummary.available
    }
  };

  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  cleanupIntermediateArtifacts(rawPath);
  console.log(JSON.stringify({
    outputRoot,
    terrainTiles: columns * rows,
    vectorTiles: vectorSummary.tiles,
    columns,
    rows,
    manifest: path.join(outputRoot, 'manifest.json')
  }, null, 2));
}

function cleanupIntermediateArtifacts(rawPath) {
  fs.rmSync(rawPath, { force: true });
  fs.rmSync(extractedDir, { recursive: true, force: true });
}

function assertFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
}

function assertCommand(command) {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error(`Required command not available: ${command}`);
  }
}

function extractXcm(filePath, targetDir) {
  const marker = path.join(targetDir, '.extracted');
  if (fs.existsSync(marker)) return;

  const result = spawnSync('tar', ['-xf', filePath, '-C', targetDir], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to extract ${filePath}`);
  }

  fs.writeFileSync(marker, new Date().toISOString());
}

function identifyImage(filePath) {
  const result = spawnSync('magick', ['identify', '-format', '%w %h %[depth] %[min] %[max]', filePath], {
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) {
    throw new Error(`ImageMagick identify failed: ${result.stderr}`);
  }

  const [width, height, depth, min, max] = result.stdout.trim().split(/\s+/).map(Number);
  return { width, height, depth, min, max };
}

function convertJp2ToRaw(inputFile, outputFile) {
  console.log(`Converting JP2 to RAW: ${outputFile}`);
  const result = spawnSync('magick', [inputFile, '-depth', '16', `gray:${outputFile}`], {
    stdio: 'inherit'
  });
  if (result.error || result.status !== 0) {
    throw new Error('ImageMagick JP2 conversion failed');
  }
}

function generateTerrainTiles(raw, width, height, columns, rows) {
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const outputDir = path.join(tilesDir, String(tileX));
      const outputFile = path.join(outputDir, `${tileY}.png`);
      if (fs.existsSync(outputFile)) continue;

      fs.mkdirSync(outputDir, { recursive: true });
      const rgb = Buffer.alloc(tileSize * tileSize * 3);
      let targetOffset = 0;

      for (let y = 0; y < tileSize; y += 1) {
        const sourceY = tileY * tileSize + y;
        for (let x = 0; x < tileSize; x += 1) {
          const sourceX = tileX * tileSize + x;
          const rawOffset = (sourceY * width + sourceX) * 2;
          const lowByte = raw[rawOffset];
          const highByte = raw[rawOffset + 1];
          rgb[targetOffset] = highByte;
          rgb[targetOffset + 1] = lowByte;
          rgb[targetOffset + 2] = 0;
          targetOffset += 3;
        }
      }

      fs.writeFileSync(outputFile, encodePngRgb(tileSize, tileSize, rgb));
    }

    console.log(`Terrain tile row ${tileY + 1}/${rows}`);
  }
}

function encodePngRgb(width, height, rgb) {
  const rowBytes = width * 3;
  const scanlines = Buffer.alloc((rowBytes + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowBytes + 1);
    scanlines[scanlineOffset] = 0;
    rgb.copy(scanlines, scanlineOffset + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', createIhdr(width, height)),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function createIhdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 2;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseInfo(text) {
  const info = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) info[match[1].trim()] = match[2].trim();
  }
  return info;
}

function parseJ2w(text) {
  const [pixelSizeX, rotationY, rotationX, pixelSizeY, originX, originY] = text
    .trim()
    .split(/\s+/)
    .map(Number);
  return { pixelSizeX, rotationY, rotationX, pixelSizeY, originX, originY };
}

function listVectorLayers(sourceDir) {
  const files = fs.readdirSync(sourceDir);
  return files
    .filter((file) => file.endsWith('.shp'))
    .map((file) => {
      const layer = path.basename(file, '.shp');
      return {
        layer,
        shp: `source/${layer}.shp`,
        dbf: files.includes(`${layer}.dbf`) ? `source/${layer}.dbf` : null,
        shx: files.includes(`${layer}.shx`) ? `source/${layer}.shx` : null,
        prj: files.includes(`${layer}.prj`) ? `source/${layer}.prj` : null
      };
    });
}

function generateVectorTiles(sourceDir, columns, rows, worldFile) {
  const layers = listVectorLayers(sourceDir);
  const topology = parseTopology(path.join(sourceDir, 'topology.tpl'));
  const tileBuckets = new Map();
  const layerSummary = [];

  for (const layerInfo of layers) {
    const layerPath = path.join(sourceDir, `${layerInfo.layer}.shp`);
    const dbfPath = path.join(sourceDir, `${layerInfo.layer}.dbf`);
    const attributes = fs.existsSync(dbfPath) ? readDbf(dbfPath) : [];
    const features = readShapefile(layerPath, attributes, worldFile);
    const style = topology[layerInfo.layer] ?? defaultVectorStyle(layerInfo.layer);
    let lineSegments = 0;
    let points = 0;

    for (const feature of features) {
      if (feature.type === 'point') {
        if (addPointToBucket(tileBuckets, columns, rows, layerInfo.layer, feature)) points += 1;
        continue;
      }

      for (const segment of feature.segments) {
        if (addSegmentToBucket(tileBuckets, columns, rows, layerInfo.layer, segment)) {
          lineSegments += 1;
        }
      }
    }

    layerSummary.push({
      layer: layerInfo.layer,
      type: features.some((feature) => feature.type === 'point') ? 'point' : 'line',
      color: style.color,
      width: style.width,
      records: features.length,
      lineSegments,
      points
    });
  }

  writeVectorTiles(tileBuckets);
  return {
    layers: layerSummary,
    tiles: tileBuckets.size,
    available: [...tileBuckets.values()].map((tile) => `${tile.x}:${tile.y}`).sort()
  };
}

function parseTopology(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const topology = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('*')) continue;
    const [layer, , , , red, green, blue, width] = trimmed.split(',');
    topology[layer] = {
      color: [Number(red), Number(green), Number(blue)],
      width: Number(width) || 1
    };
  }
  return topology;
}

function defaultVectorStyle(layer) {
  if (layer.includes('water')) return { color: [85, 160, 255], width: 1 };
  if (layer.includes('road')) return { color: [240, 64, 64], width: 1 };
  if (layer.includes('railway')) return { color: [64, 64, 64], width: 1 };
  return { color: [223, 223, 0], width: 1 };
}

function readShapefile(filePath, attributes, worldFile) {
  const buffer = fs.readFileSync(filePath);
  const fileShapeType = buffer.readInt32LE(32);
  const features = [];
  let offset = 100;
  let recordIndex = 0;

  while (offset + 8 <= buffer.length) {
    const contentBytes = buffer.readInt32BE(offset + 4) * 2;
    const contentOffset = offset + 8;
    const nextOffset = contentOffset + contentBytes;
    if (contentOffset + 4 > buffer.length || nextOffset > buffer.length) break;

    const shapeType = buffer.readInt32LE(contentOffset);
    const properties = normalizeProperties(attributes[recordIndex] ?? {});
    if (shapeType === 1) {
      const point = readPoint(buffer, contentOffset, worldFile);
      if (point) features.push({ type: 'point', point, properties });
    } else if (shapeType === 3 || shapeType === 5) {
      const segments = readLineSegments(buffer, contentOffset, shapeType, worldFile);
      if (segments.length > 0) features.push({ type: fileShapeType === 5 ? 'polygon' : 'line', segments, properties });
    }

    offset = nextOffset;
    recordIndex += 1;
  }

  return features;
}

function readPoint(buffer, offset, worldFile) {
  if (offset + 20 > buffer.length) return null;
  const longitude = buffer.readDoubleLE(offset + 4);
  const latitude = buffer.readDoubleLE(offset + 12);
  return lonLatToPixel(longitude, latitude, worldFile);
}

function readLineSegments(buffer, offset, shapeType, worldFile) {
  if (offset + 44 > buffer.length) return [];
  const numParts = buffer.readInt32LE(offset + 36);
  const numPoints = buffer.readInt32LE(offset + 40);
  const partsOffset = offset + 44;
  const pointsOffset = partsOffset + numParts * 4;
  if (numParts <= 0 || numPoints <= 0 || pointsOffset + numPoints * 16 > buffer.length) return [];

  const parts = [];
  for (let index = 0; index < numParts; index += 1) {
    parts.push(buffer.readInt32LE(partsOffset + index * 4));
  }
  parts.push(numPoints);

  const points = [];
  for (let index = 0; index < numPoints; index += 1) {
    const pointOffset = pointsOffset + index * 16;
    points.push(lonLatToPixel(buffer.readDoubleLE(pointOffset), buffer.readDoubleLE(pointOffset + 8), worldFile));
  }

  const segments = [];
  for (let partIndex = 0; partIndex < numParts; partIndex += 1) {
    const start = parts[partIndex];
    const end = parts[partIndex + 1];
    for (let pointIndex = start; pointIndex < end - 1; pointIndex += 1) {
      segments.push([points[pointIndex], points[pointIndex + 1]]);
    }

    if (shapeType === 5 && end - start > 2) {
      const first = points[start];
      const last = points[end - 1];
      if (Math.abs(first.x - last.x) > 0.0001 || Math.abs(first.y - last.y) > 0.0001) {
        segments.push([last, first]);
      }
    }
  }

  return segments;
}

function lonLatToPixel(longitude, latitude, worldFile) {
  return {
    x: (longitude - worldFile.originX) / worldFile.pixelSizeX,
    y: (latitude - worldFile.originY) / worldFile.pixelSizeY
  };
}

function addPointToBucket(tileBuckets, columns, rows, layer, feature) {
  const tile = pointToTile(feature.point);
  if (!isTileInside(tile, columns, rows)) return false;
  const bucket = getVectorLayerBucket(tileBuckets, tile.x, tile.y, layer);
  bucket.points.push({
    x: roundCoordinate(feature.point.x),
    y: roundCoordinate(feature.point.y),
    label: feature.properties.label
  });
  return true;
}

function addSegmentToBucket(tileBuckets, columns, rows, layer, segment) {
  const mid = {
    x: (segment[0].x + segment[1].x) / 2,
    y: (segment[0].y + segment[1].y) / 2
  };
  const tile = pointToTile(mid);
  if (!isTileInside(tile, columns, rows)) return false;
  const bucket = getVectorLayerBucket(tileBuckets, tile.x, tile.y, layer);
  bucket.lines.push([
    roundCoordinate(segment[0].x),
    roundCoordinate(segment[0].y),
    roundCoordinate(segment[1].x),
    roundCoordinate(segment[1].y)
  ]);
  return true;
}

function getVectorLayerBucket(tileBuckets, tileX, tileY, layer) {
  const key = `${tileX}:${tileY}`;
  if (!tileBuckets.has(key)) tileBuckets.set(key, { x: tileX, y: tileY, layers: {} });
  const tile = tileBuckets.get(key);
  if (!tile.layers[layer]) tile.layers[layer] = { lines: [], points: [] };
  return tile.layers[layer];
}

function pointToTile(point) {
  return {
    x: Math.floor(point.x / tileSize),
    y: Math.floor(point.y / tileSize)
  };
}

function isTileInside(tile, columns, rows) {
  return tile.x >= 0 && tile.y >= 0 && tile.x < columns && tile.y < rows;
}

function writeVectorTiles(tileBuckets) {
  for (const tile of tileBuckets.values()) {
    const outputDir = path.join(vectorsDir, String(tile.x));
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${tile.y}.json`), `${JSON.stringify(tile)}\n`);
  }
}

function roundCoordinate(value) {
  return Math.round(value * 100) / 100;
}

function readDbf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const records = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];

  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    if (buffer[offset] === 0x0d) break;
    const name = buffer.subarray(offset, offset + 11).toString('ascii').replace(/\0.*$/, '').trim();
    const type = String.fromCharCode(buffer[offset + 11]);
    const length = buffer[offset + 16];
    fields.push({ name, type, length });
  }

  const rows = [];
  for (let record = 0; record < records; record += 1) {
    const base = headerLength + record * recordLength;
    if (base + recordLength > buffer.length || buffer[base] === 0x2a) continue;
    let position = base + 1;
    const row = {};
    for (const field of fields) {
      const raw = buffer.subarray(position, position + field.length).toString('utf8').replace(/\0/g, '').trim();
      row[field.name] = raw;
      position += field.length;
    }
    rows.push(row);
  }

  return rows;
}

function normalizeProperties(row) {
  const candidates = ['name', 'NAM', 'Lake_name', 'NAM_DESCRI', 'F_CODE_DES'];
  let label = '';
  for (const field of candidates) {
    const value = cleanDbfValue(row[field]);
    if (value) {
      label = value;
      break;
    }
  }
  return { label };
}

function cleanDbfValue(value) {
  if (!value || value === 'UNK' || value === 'No entry present' || value.includes('*')) return '';
  return value;
}

main();
