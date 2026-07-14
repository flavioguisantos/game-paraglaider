import * as THREE from 'three';

const TAG_CANVAS_WIDTH = 512;
const TAG_CANVAS_HEIGHT = 128;
const DEFAULT_TEXT = 'Piloto';

export function createPlayerNameTag(displayName, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = TAG_CANVAS_WIDTH;
  canvas.height = TAG_CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 20;
  sprite.position.set(0, options.offsetY ?? 10.8, 0);
  sprite.scale.set(options.width ?? 8.2, options.height ?? 2.05, 1);

  const tag = {
    sprite,
    setText(nextDisplayName) {
      drawPlayerNameTag(context, texture, nextDisplayName);
    },
    dispose() {
      texture.dispose();
      material.dispose();
      sprite.removeFromParent();
    }
  };

  tag.setText(displayName);
  return tag;
}

function drawPlayerNameTag(context, texture, displayName) {
  const text = normalizeDisplayName(displayName);
  context.clearRect(0, 0, TAG_CANVAS_WIDTH, TAG_CANVAS_HEIGHT);

  context.fillStyle = 'rgba(10, 18, 27, 0.74)';
  roundRect(context, 8, 16, TAG_CANVAS_WIDTH - 16, TAG_CANVAS_HEIGHT - 32, 28);
  context.fill();

  context.strokeStyle = 'rgba(255, 255, 255, 0.26)';
  context.lineWidth = 3;
  roundRect(context, 8, 16, TAG_CANVAS_WIDTH - 16, TAG_CANVAS_HEIGHT - 32, 28);
  context.stroke();

  context.fillStyle = '#f7fbff';
  context.font = '700 42px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, TAG_CANVAS_WIDTH / 2, TAG_CANVAS_HEIGHT / 2 + 1, TAG_CANVAS_WIDTH - 52);

  texture.needsUpdate = true;
}

function normalizeDisplayName(displayName) {
  const cleaned = String(displayName ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return DEFAULT_TEXT;
  if (cleaned.length <= 22) return cleaned;
  return `${cleaned.slice(0, 21)}…`;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
