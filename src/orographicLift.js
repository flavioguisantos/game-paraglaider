import * as THREE from 'three';

const DEFAULT_CONFIG = {
  enabled: false,
  rangeMeters: 50,
  upwindProbeMeters: 900,
  topHeightMeters: 300,
  fadeTopBandMeters: 80,
  maxLiftMetersPerSecond: 4.6,
  minRidgeRiseMeters: 10,
  fullRidgeRiseMeters: 85,
  minWindKmh: 8,
  fullWindKmh: 26,
  sampleStepMeters: 10,
  visualMarkerCount: 4,
  visualSearchRadiusMeters: 760,
  visualSampleStepMeters: 140,
  visualMinLiftMetersPerSecond: 0.8
};

const windDirection = new THREE.Vector3();
const rightDirection = new THREE.Vector3();
const markerProbe = new THREE.Vector3();

export function createOrographicLift(options = {}) {
  return new OrographicLift({ ...DEFAULT_CONFIG, ...options });
}

class OrographicLift {
  constructor(config) {
    this.config = config;
    this.group = new THREE.Group();
    this.group.name = 'OrographicLiftMarkers';
    this.markers = [];

    for (let index = 0; index < DEFAULT_CONFIG.visualMarkerCount; index += 1) {
      const marker = createLiftMarker(index);
      marker.visible = false;
      this.markers.push(marker);
      this.group.add(marker);
    }
  }

  configure(options = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...options,
      enabled: Boolean(options.enabled)
    };
    this.group.visible = this.config.enabled;
  }

  update(delta, { referencePosition, terrain, wind } = {}) {
    this.group.visible = this.config.enabled;
    if (!this.config.enabled || !referencePosition || !terrain || !wind) {
      this.hideMarkers();
      return;
    }

    this.updateMarkers(referencePosition, terrain, wind);
  }

  getLiftAt(position, { terrain, wind } = {}) {
    if (!this.config.enabled || !terrain || !wind) return 0;

    const windSpeedKmh = wind.speedKmh ?? wind.length() * 3.6;
    const windFactor = THREE.MathUtils.clamp(
      (windSpeedKmh - this.config.minWindKmh) / (this.config.fullWindKmh - this.config.minWindKmh),
      0,
      1
    );
    if (windFactor <= 0) return 0;

    windDirection.set(wind.x, 0, wind.z);
    if (windDirection.lengthSq() <= 0.0001) return 0;
    windDirection.normalize();

    const localGround = terrain.getHeightAt(position.x, position.z);
    const upwindLow = this.sampleUpwindLow(position, terrain, localGround);
    const downwindHigh = this.sampleDownwindHigh(position, terrain, localGround);
    const ridgeRise = Math.max(0, downwindHigh - upwindLow);
    const ridgeFactor = THREE.MathUtils.clamp(
      (ridgeRise - this.config.minRidgeRiseMeters)
        / (this.config.fullRidgeRiseMeters - this.config.minRidgeRiseMeters),
      0,
      1
    );
    if (ridgeFactor <= 0) return 0;

    const heightAboveRidge = Math.max(0, position.y - downwindHigh);
    if (heightAboveRidge >= this.config.topHeightMeters) return 0;

    const heightFactor = heightAboveRidge <= this.config.topHeightMeters - this.config.fadeTopBandMeters
      ? 1
      : 1 - ((heightAboveRidge - (this.config.topHeightMeters - this.config.fadeTopBandMeters))
        / this.config.fadeTopBandMeters);

    return this.config.maxLiftMetersPerSecond
      * windFactor
      * ridgeFactor
      * THREE.MathUtils.clamp(heightFactor, 0, 1);
  }

  sampleUpwindLow(position, terrain, fallbackHeight) {
    let low = fallbackHeight;

    for (let distance = 0; distance <= this.config.upwindProbeMeters; distance += this.config.sampleStepMeters) {
      const x = position.x - windDirection.x * distance;
      const z = position.z - windDirection.z * distance;
      low = Math.min(low, terrain.getHeightAt(x, z));
    }

    return low;
  }

  sampleDownwindHigh(position, terrain, fallbackHeight) {
    let high = fallbackHeight;

    for (let distance = 0; distance <= this.config.rangeMeters; distance += this.config.sampleStepMeters) {
      const x = position.x + windDirection.x * distance;
      const z = position.z + windDirection.z * distance;
      high = Math.max(high, terrain.getHeightAt(x, z));
    }

    return high;
  }

  updateMarkers(referencePosition, terrain, wind) {
    windDirection.set(wind.x, 0, wind.z);
    if (windDirection.lengthSq() <= 0.0001) {
      this.hideMarkers();
      return;
    }

    windDirection.normalize();
    rightDirection.set(-windDirection.z, 0, windDirection.x);

    const candidates = [];
    const radius = this.config.visualSearchRadiusMeters;
    const step = this.config.visualSampleStepMeters;
    const probeHeight = this.config.topHeightMeters * 0.45;
    const currentGroundHeight = terrain.getHeightAt(referencePosition.x, referencePosition.z);
    markerProbe.set(referencePosition.x, currentGroundHeight + probeHeight, referencePosition.z);
    const currentLift = this.getLiftAt(markerProbe, { terrain, wind });
    if (currentLift >= this.config.visualMinLiftMetersPerSecond) {
      candidates.push({
        x: referencePosition.x,
        z: referencePosition.z,
        lift: currentLift,
        groundHeight: currentGroundHeight
      });
    }

    for (let forward = -radius * 0.35; forward <= radius; forward += step) {
      for (let lateral = -radius; lateral <= radius; lateral += step) {
        markerProbe
          .copy(referencePosition)
          .addScaledVector(windDirection, forward)
          .addScaledVector(rightDirection, lateral);
        markerProbe.y = terrain.getHeightAt(markerProbe.x, markerProbe.z) + probeHeight;

        const lift = this.getLiftAt(markerProbe, { terrain, wind });
        if (lift < this.config.visualMinLiftMetersPerSecond) continue;

        candidates.push({
          x: markerProbe.x,
          z: markerProbe.z,
          lift,
          groundHeight: terrain.getHeightAt(markerProbe.x, markerProbe.z)
        });
      }
    }

    candidates.sort((a, b) => b.lift - a.lift);
    const selected = [];

    for (const candidate of candidates) {
      if (selected.length >= this.markers.length) break;
      if (selected.some((item) => Math.hypot(item.x - candidate.x, item.z - candidate.z) < step * 1.35)) continue;
      selected.push(candidate);
    }

    for (let index = 0; index < this.markers.length; index += 1) {
      const marker = this.markers[index];
      const point = selected[index];
      if (!point) {
        marker.visible = false;
        continue;
      }

      marker.visible = true;
      marker.position.set(point.x, point.groundHeight + 18, point.z);
      marker.rotation.y = wind.directionRadians ?? 0;
      marker.userData.label.element.textContent = `+${point.lift.toFixed(1)} m/s`;
      marker.userData.label.position.set(0, 92, 0);
      marker.scale.setScalar(THREE.MathUtils.clamp(0.75 + point.lift * 0.12, 0.85, 1.35));
    }
  }

  hideMarkers() {
    for (const marker of this.markers) marker.visible = false;
  }
}

function createLiftMarker(index) {
  const group = new THREE.Group();
  group.name = `OrographicLiftMarker_${index + 1}`;

  const stripMaterial = new THREE.MeshBasicMaterial({
    color: 0xbff6ff,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const strip = new THREE.Mesh(new THREE.PlaneGeometry(300, 72), stripMaterial);
  strip.name = 'OrographicLiftStrip';
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 1.5;
  group.add(strip);

  const curtain = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 260, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xbff6ff,
      transparent: true,
      opacity: 0.075,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  curtain.name = 'OrographicLiftCurtain';
  curtain.position.y = 130;
  group.add(curtain);

  const label = createLiftLabel();
  group.userData.label = label;
  group.add(label);
  return group;
}

function createLiftLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 224;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(116, 42, 1);
  sprite.userData.context = context;
  sprite.userData.texture = texture;
  Object.defineProperty(sprite, 'element', {
    value: {
      set textContent(value) {
        drawLiftLabel(context, texture, value);
      }
    }
  });
  drawLiftLabel(context, texture, '+0.0 m/s');
  return sprite;
}

function drawLiftLabel(context, texture, text) {
  context.clearRect(0, 0, 224, 80);
  context.fillStyle = 'rgba(16, 31, 42, 0.74)';
  roundRect(context, 8, 12, 208, 56, 14);
  context.fill();
  context.strokeStyle = 'rgba(191, 246, 255, 0.68)';
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = '#d9fbff';
  context.font = '700 32px Arial, Helvetica, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 112, 42);
  texture.needsUpdate = true;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
