import * as THREE from 'three';
import { setParagliderLandedPose } from './paragliderModel.js';
import { getVehicleProfile } from './player.js?v=fp-cam-6';

export class RemotePlayer {
  constructor({ playerId, displayName, vehicleType, canopyColor, terrain }) {
    this.playerId = playerId;
    this.displayName = displayName ?? 'Piloto';
    this.vehicleType = vehicleType ?? 'paraglider';
    this.terrain = terrain;
    this.group = buildRemoteGroup(this.vehicleType, canopyColor);
    this.targetPosition = new THREE.Vector3();
    this.targetHeading = 0;
    this.status = 'connected';
    this.metrics = {};
    this.position = this.group.position;
  }

  updateFromSnapshot(player) {
    this.status = player.status ?? this.status;
    this.metrics = player.metrics ?? this.metrics;
    this.targetPosition.set(
      Number(player.position?.x ?? 0),
      Number(player.position?.y ?? 0),
      Number(player.position?.z ?? 0)
    );
    this.targetHeading = Number(player.headingRadians ?? 0);
    if (this.vehicleType !== (player.vehicleType ?? this.vehicleType)) {
      this.vehicleType = player.vehicleType;
    }
  }

  update(delta) {
    const positionLerp = 1 - Math.exp(-delta * 8);
    const rotationLerp = 1 - Math.exp(-delta * 10);
    this.position.lerp(this.targetPosition, positionLerp);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, this.targetHeading, rotationLerp);

    if (this.status === 'landed' || this.status === 'crashed' || this.status === 'disconnected') {
      applyRemoteLandingPose(this);
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}

function buildRemoteGroup(vehicleType, canopyColor) {
  const profile = getVehicleProfile(vehicleType);
  const accentColor = parseCanopyColor(canopyColor);
  const group = profile.createModel(accentColor);
  group.userData.isRemotePlayer = true;
  return group;
}

function applyRemoteLandingPose(remotePlayer) {
  if (remotePlayer.vehicleType === 'drone') return;

  const groundHeight = remotePlayer.terrain.getRenderedHeightAt
    ? remotePlayer.terrain.getRenderedHeightAt(remotePlayer.position.x, remotePlayer.position.z)
    : remotePlayer.terrain.getHeightAt(remotePlayer.position.x, remotePlayer.position.z);
  setParagliderLandedPose(remotePlayer.group, { groundHeight });
}

function parseCanopyColor(color) {
  if (typeof color === 'string' && color.trim()) {
    const normalized = color.trim().replace(/^#/, '');
    const parsed = Number.parseInt(normalized.replace(/^0x/i, ''), 16);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0x53d17a;
}
