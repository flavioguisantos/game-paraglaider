import * as THREE from 'three';

const URBAN_CONFIG = {
  maxHousesPerChunk: 280,
  maxVehiclesPerChunk: 120,
  houseSpacingMeters: 46,
  houseInsetMeters: 24,
  localStreetWidthMeters: 7,
  localStreetSpacingMeters: 190,
  vehicleYOffset: 0.15
};

// Vias que bloqueiam vegetacao, com a mesma largura usada nas fitas de
// VECTOR_LAYER_STYLES (terrain.js), mais margem para a copa nao pender
// sobre a pista.
const VEGETATION_BLOCK_ROADS = [
  { layer: 'roadbig_line', widthMeters: 26 },
  { layer: 'roadmedium_line', widthMeters: 16 },
  { layer: 'roadsmall_line', widthMeters: 9 },
  { layer: 'railway_line', widthMeters: 6 }
];
const VEGETATION_ROAD_MARGIN_METERS = 7;

// Mascara de bloqueio derivada do vectorTile de cada chunk (cache por chunk).
const blockMaskCache = new WeakMap();

const HOUSE_COLORS = [
  new THREE.Color(0xd8d1c5),
  new THREE.Color(0xc9c0b3),
  new THREE.Color(0xe2d7c2),
  new THREE.Color(0xb8bdc1),
  new THREE.Color(0xd6c3b4)
];

const ROOF_COLORS = [
  new THREE.Color(0x9f4f3d),
  new THREE.Color(0x7b5940),
  new THREE.Color(0x5f5f63),
  new THREE.Color(0xa87448)
];

export function createUrbanScenery({ terrain }) {
  return new UrbanScenery(terrain);
}

class UrbanScenery {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'UrbanScenery';
    this.chunks = new Map();
    this.vehicles = [];

    // Casa em escala residencial real (~13 m de fachada) com telhado de duas
    // aguas: triangulo extrudado ao longo da cumeeira, com beiral sobrando da parede.
    this.houseGeometry = new THREE.BoxGeometry(13, 8.5, 11);
    this.houseGeometry.translate(0, 4.25, 0);
    this.houseGeometry.userData.shared = true;
    const roofProfile = new THREE.Shape([
      new THREE.Vector2(-7.6, 0),
      new THREE.Vector2(7.6, 0),
      new THREE.Vector2(0, 4.4)
    ]);
    this.roofGeometry = new THREE.ExtrudeGeometry(roofProfile, {
      depth: 12.6,
      bevelEnabled: false
    });
    this.roofGeometry.translate(0, 8.5, -6.3);
    this.roofGeometry.userData.shared = true;
    this.streetMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b8580,
      roughness: 0.94,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });
    this.streetMaterial.userData.shared = true;
    this.vehicleMaterials = [
      new THREE.MeshStandardMaterial({ color: 0xd9d6cb, roughness: 0.55, metalness: 0.05 }),
      new THREE.MeshStandardMaterial({ color: 0xb43d35, roughness: 0.58, metalness: 0.05 }),
      new THREE.MeshStandardMaterial({ color: 0x2f5f8f, roughness: 0.52, metalness: 0.05 }),
      new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.5, metalness: 0.05 })
    ];
    for (const material of this.vehicleMaterials) material.userData.shared = true;
    this.vehicleCabinMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8d0da,
      roughness: 0.35,
      metalness: 0.1
    });
    this.vehicleCabinMaterial.userData.shared = true;
    this.vehicleTireMaterial = new THREE.MeshStandardMaterial({
      color: 0x151719,
      roughness: 0.82,
      metalness: 0
    });
    this.vehicleTireMaterial.userData.shared = true;
    this.vehicleLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff2b5,
      roughness: 0.28,
      metalness: 0,
      emissive: 0xffd98c,
      emissiveIntensity: 0.25
    });
    this.vehicleLightMaterial.userData.shared = true;
    this.vehicleCargoMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9b0a1,
      roughness: 0.74,
      metalness: 0.02
    });
    this.vehicleCargoMaterial.userData.shared = true;
  }

  addChunk(key, vectorTile, chunk) {
    if (this.chunks.has(key)) return;

    const layers = vectorTile.layers ?? {};
    const cityLines = layers.city_area?.lines ?? [];
    const highwayLines = [
      ...(layers.roadbig_line?.lines ?? []).map((line) => ({ line, roadClass: 'big' })),
      ...(layers.roadmedium_line?.lines ?? []).map((line) => ({ line, roadClass: 'medium' }))
    ];
    if (cityLines.length === 0 && highwayLines.length === 0) return;

    const group = new THREE.Group();
    group.name = `UrbanScenery_${key}`;
    const cityRings = chainSegmentsIntoRings(cityLines).filter((ring) => ring.length >= 3);

    if (cityRings.length > 0) {
      this.addLocalStreets(group, cityRings, chunk);
      this.addHouses(group, cityRings, chunk);
    }

    if (highwayLines.length > 0) {
      this.addVehicles(group, highwayLines, chunk, key);
    }

    if (group.children.length === 0) return;
    this.chunks.set(key, group);
    this.group.add(group);
  }

  removeChunk(key) {
    const group = this.chunks.get(key);
    if (!group) return;

    this.group.remove(group);
    this.vehicles = this.vehicles.filter((vehicle) => {
      if (vehicle.chunkKey !== key) return true;
      disposeObject3D(vehicle.group);
      return false;
    });
    disposeObject3D(group);
    this.chunks.delete(key);
  }

  update(delta) {
    if (this.vehicles.length === 0) return;

    for (const vehicle of this.vehicles) {
      vehicle.progress = (vehicle.progress + vehicle.speedMetersPerSecond * delta) % vehicle.length;
      const t = vehicle.progress / vehicle.length;
      const laneX = vehicle.perpX * vehicle.laneOffset;
      const laneZ = vehicle.perpZ * vehicle.laneOffset;
      const x = THREE.MathUtils.lerp(vehicle.start.x, vehicle.end.x, t) + laneX;
      const z = THREE.MathUtils.lerp(vehicle.start.z, vehicle.end.z, t) + laneZ;
      const y = this.terrain.getVectorHeight(x, z, vehicle.chunk) + URBAN_CONFIG.vehicleYOffset;

      vehicle.group.position.set(x, y, z);
      vehicle.group.rotation.y = vehicle.heading;
    }
  }

  // Vegetacao nao pode nascer sobre area urbana (casas/ruas locais) nem
  // sobre/perto de estradas e ferrovias vetoriais.
  isBlockedAt(x, z, chunk) {
    const mask = this.getBlockMask(chunk);
    if (!mask) return false;

    if (mask.rings.length > 0) {
      const px = this.terrain.centerPixel.x + x / this.terrain.worldUnitsPerPixelX;
      const py = this.terrain.centerPixel.y + z / this.terrain.worldUnitsPerPixelY;
      for (const ring of mask.rings) {
        const bounds = ring.bounds;
        if (px >= bounds.minX && px <= bounds.maxX
          && py >= bounds.minY && py <= bounds.maxY
          && pointInPolygon(px, py, ring.points)) {
          return true;
        }
      }
    }

    for (const segment of mask.roads) {
      if (x < segment.minX || x > segment.maxX || z < segment.minZ || z > segment.maxZ) continue;
      if (distanceToSegment(x, z, segment.ax, segment.az, segment.bx, segment.bz) < segment.margin) {
        return true;
      }
    }
    return false;
  }

  getBlockMask(chunk) {
    if (blockMaskCache.has(chunk)) return blockMaskCache.get(chunk);

    const layers = chunk.vectorTile?.layers;
    if (!layers) return null;

    const rings = chainSegmentsIntoRings(layers.city_area?.lines ?? [])
      .filter((ring) => ring.length >= 3)
      .map((points) => ({ points, bounds: getRingBounds(points) }));

    const roads = [];
    for (const { layer, widthMeters } of VEGETATION_BLOCK_ROADS) {
      const margin = (widthMeters / 2 + VEGETATION_ROAD_MARGIN_METERS) * this.terrain.worldUnitsPerMeter;
      for (const line of layers[layer]?.lines ?? []) {
        const start = this.terrain.pixelToWorldXZ(line[0], line[1]);
        const end = this.terrain.pixelToWorldXZ(line[2], line[3]);
        roads.push({
          ax: start.x,
          az: start.z,
          bx: end.x,
          bz: end.z,
          margin,
          // Caixa expandida pela margem para rejeitar barato a maioria dos pontos.
          minX: Math.min(start.x, end.x) - margin,
          maxX: Math.max(start.x, end.x) + margin,
          minZ: Math.min(start.z, end.z) - margin,
          maxZ: Math.max(start.z, end.z) + margin
        });
      }
    }

    const mask = rings.length === 0 && roads.length === 0 ? null : { rings, roads };
    blockMaskCache.set(chunk, mask);
    return mask;
  }

  addHouses(group, cityRings, chunk) {
    const candidates = [];
    const spacing = URBAN_CONFIG.houseSpacingMeters / this.terrain.worldUnitsPerMeter;

    for (const ring of cityRings) {
      const bounds = getRingBounds(ring);
      const stepPixelsX = Math.max(1, spacing / this.terrain.worldUnitsPerPixelX);
      const stepPixelsY = Math.max(1, spacing / this.terrain.worldUnitsPerPixelY);

      for (let py = bounds.minY; py <= bounds.maxY; py += stepPixelsY) {
        for (let px = bounds.minX; px <= bounds.maxX; px += stepPixelsX) {
          const jitterX = (hash2D(px, py, 1) - 0.5) * stepPixelsX * 0.45;
          const jitterY = (hash2D(px, py, 2) - 0.5) * stepPixelsY * 0.45;
          const sampleX = px + jitterX;
          const sampleY = py + jitterY;
          if (!pointInPolygon(sampleX, sampleY, ring)) continue;
          if (hash2D(sampleX, sampleY, 3) < 0.16) continue;

          const world = this.terrain.pixelToWorldXZ(sampleX, sampleY);
          candidates.push({ px: sampleX, py: sampleY, world });
        }
      }
    }

    if (candidates.length === 0) return;

    candidates.sort((a, b) => hash2D(a.px, a.py, 4) - hash2D(b.px, b.py, 4));
    const count = Math.min(candidates.length, URBAN_CONFIG.maxHousesPerChunk);
    const wallMesh = new THREE.InstancedMesh(
      this.houseGeometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }),
      count
    );
    const roofMesh = new THREE.InstancedMesh(
      this.roofGeometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 }),
      count
    );
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let written = 0;
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates[index];
      const x = candidate.world.x;
      const z = candidate.world.z;
      if (isNearRoad(x, z, chunk, this.terrain, URBAN_CONFIG.houseInsetMeters)) continue;

      const y = this.terrain.getVectorHeight(x, z, chunk);
      const scale = 0.75 + hash2D(candidate.px, candidate.py, 5) * 0.7;
      dummy.position.set(x, y, z);
      dummy.rotation.y = hash2D(candidate.px, candidate.py, 6) * Math.PI * 2;
      dummy.scale.set(scale * (0.8 + hash2D(candidate.px, candidate.py, 7) * 0.55), scale, scale);
      dummy.updateMatrix();

      wallMesh.setMatrixAt(written, dummy.matrix);
      roofMesh.setMatrixAt(written, dummy.matrix);
      wallMesh.setColorAt(written, HOUSE_COLORS[Math.floor(hash2D(candidate.px, candidate.py, 8) * HOUSE_COLORS.length)]);
      roofMesh.setColorAt(written, ROOF_COLORS[Math.floor(hash2D(candidate.px, candidate.py, 9) * ROOF_COLORS.length)]);
      written += 1;
    }

    if (written === 0) {
      wallMesh.material.dispose();
      roofMesh.material.dispose();
      return;
    }

    for (const mesh of [wallMesh, roofMesh]) {
      mesh.count = written;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  addLocalStreets(group, cityRings, chunk) {
    const positions = [];
    const indices = [];
    const halfWidth = (URBAN_CONFIG.localStreetWidthMeters * this.terrain.worldUnitsPerMeter) / 2;
    const spacing = URBAN_CONFIG.localStreetSpacingMeters / this.terrain.worldUnitsPerMeter;

    for (const ring of cityRings) {
      const bounds = getRingBounds(ring);
      const stepY = Math.max(1, spacing / this.terrain.worldUnitsPerPixelY);
      const stepX = Math.max(1, spacing / this.terrain.worldUnitsPerPixelX);

      for (let py = bounds.minY + stepY * 0.5; py < bounds.maxY; py += stepY) {
        const start = findPolygonSpan(ring, py, 'horizontal');
        if (start) appendStreetRibbon(positions, indices, this.terrain, chunk, start.a, start.b, halfWidth);
      }

      for (let px = bounds.minX + stepX * 0.5; px < bounds.maxX; px += stepX) {
        const start = findPolygonSpan(ring, px, 'vertical');
        if (start) appendStreetRibbon(positions, indices, this.terrain, chunk, start.a, start.b, halfWidth);
      }
    }

    if (positions.length === 0) return;

    const mesh = new THREE.Mesh(buildGeometry(positions, indices), this.streetMaterial);
    mesh.name = 'UrbanLocalStreets';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  addVehicles(group, highwayLines, chunk, chunkKey) {
    const usableLines = highwayLines
      .map(({ line, roadClass }) => {
        const start = this.terrain.pixelToWorldXZ(line[0], line[1]);
        const end = this.terrain.pixelToWorldXZ(line[2], line[3]);
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const length = Math.hypot(dx, dz);
        return { start, end, dx, dz, length, line, roadClass };
      })
      .filter((entry) => entry.length > 45);

    usableLines.sort((a, b) => hash2D(a.line[0], a.line[1], 10) - hash2D(b.line[0], b.line[1], 10));
    let count = 0;

    for (let index = 0; index < usableLines.length && count < URBAN_CONFIG.maxVehiclesPerChunk; index += 1) {
      const path = usableLines[index];
      const direction = hash2D(path.line[0], path.line[1], 11) > 0.5 ? 1 : -1;
      const start = direction > 0 ? path.start : path.end;
      const end = direction > 0 ? path.end : path.start;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      const heading = Math.atan2(dx, dz);
      const laneOffset = (direction > 0 ? 5.5 : -5.5) * this.terrain.worldUnitsPerMeter;
      const perpX = -dz / length;
      const perpZ = dx / length;
      const densityLength = path.roadClass === 'big' ? 185 : 260;
      const maxPerSegment = path.roadClass === 'big' ? 5 : 3;
      const vehiclesOnLine = Math.min(maxPerSegment, Math.max(1, Math.floor(length / densityLength)));

      for (let slot = 0; slot < vehiclesOnLine && count < URBAN_CONFIG.maxVehiclesPerChunk; slot += 1) {
        const type = pickVehicleType(hash2D(path.line[0] + slot * 19.7, path.line[1], 14));
        const vehicleGroup = createVehicleMesh({
          bodyMaterial: this.vehicleMaterials[count % this.vehicleMaterials.length],
          cabinMaterial: this.vehicleCabinMaterial,
          tireMaterial: this.vehicleTireMaterial,
          lightMaterial: this.vehicleLightMaterial,
          cargoMaterial: this.vehicleCargoMaterial,
          type
        });
        const progress = ((slot + hash2D(path.line[2], path.line[3] + slot * 31.1, 12)) / vehiclesOnLine) * length;
        const baseSpeed = type === 'truck' || type === 'bus' ? 8 : 12;
        const speedMetersPerSecond = baseSpeed + hash2D(path.line[0], path.line[3] + slot, 13) * 12;

        group.add(vehicleGroup);
        this.vehicles.push({
          chunkKey,
          chunk,
          group: vehicleGroup,
          start,
          end,
          length,
          heading,
          laneOffset,
          perpX,
          perpZ,
          progress,
          speedMetersPerSecond
        });
        count += 1;
      }
    }
  }
}

function createVehicleMesh({
  bodyMaterial,
  cabinMaterial,
  tireMaterial,
  lightMaterial,
  cargoMaterial,
  type
}) {
  const group = new THREE.Group();
  // As pecas foram modeladas superdimensionadas; 0.5 traz o carro para ~9 m,
  // coerente com as casas em escala real (ainda um pouco maior para leitura aerea).
  group.scale.setScalar(0.5);

  if (type === 'truck') {
    addBox(group, new THREE.BoxGeometry(10, 5.4, 13), bodyMaterial, [0, 3.1, -11], true);
    addBox(group, new THREE.BoxGeometry(11.5, 7.2, 26), cargoMaterial, [0, 4.1, 8], true);
    addBox(group, new THREE.BoxGeometry(7.8, 2.1, 4.2), cabinMaterial, [0, 6.7, -13], false);
    addVehicleWheels(group, tireMaterial, 5.9, [-15, -7, 14], 2.25);
    addHeadlights(group, lightMaterial, 4.1, -18.1, 3.8);
    return group;
  }

  if (type === 'bus') {
    addBox(group, new THREE.BoxGeometry(11, 6.2, 34), bodyMaterial, [0, 3.8, 0], true);
    addBox(group, new THREE.BoxGeometry(9.2, 2.4, 24), cabinMaterial, [0, 6.9, -1], false);
    addVehicleWheels(group, tireMaterial, 5.6, [-13, 13], 2.35);
    addHeadlights(group, lightMaterial, 4.2, -17.5, 4.2);
    return group;
  }

  if (type === 'van') {
    addBox(group, new THREE.BoxGeometry(10, 4.8, 22), bodyMaterial, [0, 3, 0], true);
    addBox(group, new THREE.BoxGeometry(8.2, 2.6, 11), cabinMaterial, [0, 5.8, -3.2], false);
    addVehicleWheels(group, tireMaterial, 5.2, [-7.4, 7.4], 1.95);
    addHeadlights(group, lightMaterial, 3.7, -11.4, 3.1);
    return group;
  }

  addBox(group, new THREE.BoxGeometry(9, 3.5, 18), bodyMaterial, [0, 2.35, 0], true);
  addBox(group, new THREE.BoxGeometry(6.5, 2.4, 8), cabinMaterial, [0, 4.7, -1.8], false);
  addVehicleWheels(group, tireMaterial, 4.6, [-6.2, 6.2], 1.55);
  addHeadlights(group, lightMaterial, 3.1, -9.4, 2.65);
  return group;
}

function addBox(group, geometry, material, position, castsShadow) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = castsShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addVehicleWheels(group, material, halfWidth, zPositions, radius) {
  for (const z of zPositions) {
    for (const x of [-halfWidth, halfWidth]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1.35, 12), material);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, radius + 0.15, z);
      wheel.castShadow = true;
      group.add(wheel);
    }
  }
}

function addHeadlights(group, material, halfWidth, z, y) {
  for (const x of [-halfWidth, halfWidth]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.45), material);
    light.position.set(x, y, z);
    group.add(light);
  }
}

function pickVehicleType(value) {
  if (value > 0.86) return 'truck';
  if (value > 0.74) return 'bus';
  if (value > 0.56) return 'van';
  return 'car';
}

function appendStreetRibbon(positions, indices, terrain, chunk, start, end, halfWidth) {
  start = terrain.pixelToWorldXZ(start.pixelX, start.pixelY);
  end = terrain.pixelToWorldXZ(end.pixelX, end.pixelY);
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 40) return;

  const perpX = (-dz / length) * halfWidth;
  const perpZ = (dx / length) * halfWidth;
  const steps = Math.max(1, Math.ceil(length / 90));
  const base = positions.length / 3;

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = THREE.MathUtils.lerp(start.x, end.x, t);
    const z = THREE.MathUtils.lerp(start.z, end.z, t);
    const y = terrain.getVectorHeight(x, z, chunk) + 1.85;
    positions.push(x - perpX, y, z - perpZ, x + perpX, y, z + perpZ);
  }

  for (let step = 0; step < steps; step += 1) {
    const row = base + step * 2;
    indices.push(row, row + 2, row + 1, row + 1, row + 2, row + 3);
  }
}

function findPolygonSpan(ring, value, axis) {
  const intersections = [];

  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const aMain = axis === 'horizontal' ? a[1] : a[0];
    const bMain = axis === 'horizontal' ? b[1] : b[0];
    if ((aMain > value) === (bMain > value)) continue;

    const t = (value - aMain) / (bMain - aMain);
    const cross = axis === 'horizontal'
      ? THREE.MathUtils.lerp(a[0], b[0], t)
      : THREE.MathUtils.lerp(a[1], b[1], t);
    intersections.push(cross);
  }

  if (intersections.length < 2) return null;
  intersections.sort((a, b) => a - b);
  const first = intersections[0];
  const last = intersections[intersections.length - 1];
  if (last - first < 0.8) return null;

  if (axis === 'horizontal') {
    return {
      a: terrainPixelToWorld(first, value),
      b: terrainPixelToWorld(last, value)
    };
  }
  return {
    a: terrainPixelToWorld(value, first),
    b: terrainPixelToWorld(value, last)
  };
}

function terrainPixelToWorld(pixelX, pixelY) {
  return { pixelX, pixelY };
}

function buildGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const normals = new Float32Array(positions.length);
  for (let index = 1; index < normals.length; index += 3) normals[index] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

function getRingBounds(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}

function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = ring[index][0];
    const yi = ring[index][1];
    const xj = ring[previous][0];
    const yj = ring[previous][1];
    const intersects = ((yi > y) !== (yj > y))
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isNearRoad(x, z, chunk, terrain, threshold) {
  const layers = chunk.vectorTile?.layers ?? {};
  const roadLayers = [
    layers.roadbig_line?.lines ?? [],
    layers.roadmedium_line?.lines ?? [],
    layers.roadsmall_line?.lines ?? []
  ];

  for (const lines of roadLayers) {
    for (const line of lines) {
      const start = terrain.pixelToWorldXZ(line[0], line[1]);
      const end = terrain.pixelToWorldXZ(line[2], line[3]);
      if (distanceToSegment(x, z, start.x, start.z, end.x, end.z) < threshold) return true;
    }
  }
  return false;
}

function distanceToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(px - ax, pz - az);
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / lengthSq, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function chainSegmentsIntoRings(lines) {
  const pointKey = (x, y) => `${Math.round(x * 16)}:${Math.round(y * 16)}`;
  const startMap = new Map();
  const used = new Array(lines.length).fill(false);

  for (let index = 0; index < lines.length; index += 1) {
    const key = pointKey(lines[index][0], lines[index][1]);
    if (!startMap.has(key)) startMap.set(key, []);
    startMap.get(key).push(index);
  }

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
      const candidates = startMap.get(pointKey(tail[0], tail[1]));
      let nextIndex = -1;
      while (candidates?.length) {
        const candidate = candidates.pop();
        if (!used[candidate]) {
          nextIndex = candidate;
          break;
        }
      }
      if (nextIndex === -1) break;
      used[nextIndex] = true;
      points.push([lines[nextIndex][2], lines[nextIndex][3]]);
    }

    rings.push(points);
  }

  return rings;
}

function hash2D(x, z, salt) {
  const value = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function disposeObject3D(object) {
  object.traverse((child) => {
    if (child.geometry && !child.geometry.userData?.shared) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material.userData?.shared) material.dispose();
      }
    }
  });
}
