const LOCAL_FLIGHT_LOCATIONS = [
  {
    id: 'atibaia-pedra-grande',
    name: 'Atibaia / Pedra Grande',
    region: 'Atibaia - SP',
    latitude: -23.169090319406045,
    longitude: -46.52831806228563,
    launchAltitudeMeters: 24,
    liftMode: 'thermal',
    // Base de nuvem tipica de um bom dia no interior de SP.
    cloudBaseMeters: 2200
  },
  {
    id: 'sao-pedro',
    name: 'Sao Pedro',
    region: 'Sao Pedro - SP',
    latitude: -22.504721,
    longitude: -47.898368,
    launchAltitudeMeters: 24,
    liftMode: 'thermal',
    // Mesma dinamica termica de Atibaia.
    cloudBaseMeters: 2200,
    building: {
      latitude: -22.505244,
      longitude: -47.898473
    }
  },
  {
    id: 'pico-do-gaviao',
    name: 'Pico do Gaviao',
    region: 'Socorro - SP',
    latitude: -22.015356,
    longitude: -46.626470,
    launchAltitudeMeters: 24,
    liftMode: 'thermal',
    // Mesma dinamica termica de Atibaia.
    cloudBaseMeters: 2200,
    building: {
      latitude: -22.015178,
      longitude: -46.626851
    }
  },
  {
    id: 'serra-negra',
    name: 'Serra Negra',
    region: 'Serra Negra - SP',
    latitude: -22.619223,
    longitude: -46.677644,
    launchAltitudeMeters: 24,
    liftMode: 'thermal',
    // Mesma dinamica termica de Atibaia.
    cloudBaseMeters: 2200,
    building: {
      latitude: -22.619054,
      longitude: -46.677261
    }
  },
  {
    id: 'sao-vicente-itarare',
    name: 'Praia de Sao Vicente, Itarare',
    region: 'Sao Vicente - SP',
    latitude: -23.964517,
    longitude: -46.363531,
    launchAltitudeMeters: 180,
    launchHeadingRadians: 0.45 + Math.PI,
    standbyHeadingRadians: 0.45 + Math.PI,
    liftMode: 'orographic',
    // Liga a lamina d'agua reflexiva do mar aberto.
    hasSea: true,
    wind: {
      // Vento de mar em Sao Vicente: desloca a massa de ar do quadrante sudeste para o interior.
      directionRadians: 0.45,
      directionVariationDegrees: 18
    },
    orographicLift: {
      enabled: true,
      rangeMeters: 50,
      topHeightMeters: 300,
      maxLiftMetersPerSecond: 4.8
    }
  }
];

let activeFlightLocations = [...LOCAL_FLIGHT_LOCATIONS];

export const DEFAULT_FLIGHT_LOCATION = LOCAL_FLIGHT_LOCATIONS[0];

export function normalizeFlightLocation(location = {}) {
  return {
    id: location.id ?? location.launchId,
    launchId: location.launchId ?? location.id,
    name: location.name ?? 'Local de voo',
    region: location.region ?? '',
    latitude: Number(location.latitude ?? 0),
    longitude: Number(location.longitude ?? 0),
    launchAltitudeMeters: Number(location.launchAltitudeMeters ?? DEFAULT_FLIGHT_LOCATION.launchAltitudeMeters),
    launchHeadingRadians: Number(location.launchHeadingRadians ?? 0),
    standbyHeadingRadians: location.standbyHeadingRadians ?? null,
    liftMode: location.liftMode ?? 'thermal',
    cloudBaseMeters: location.cloudBaseMeters ?? null,
    hasSea: Boolean(location.hasSea),
    wind: location.wind ?? {},
    orographicLift: location.orographicLift ?? {},
    building: location.building ?? null
  };
}

export function getFlightLocations() {
  return activeFlightLocations;
}

export function setFlightLocations(locations = []) {
  if (!Array.isArray(locations) || locations.length === 0) {
    activeFlightLocations = [...LOCAL_FLIGHT_LOCATIONS];
    return activeFlightLocations;
  }

  activeFlightLocations = locations
    .map((location) => normalizeFlightLocation(location))
    .filter((location) => typeof location.id === 'string' && location.id.trim());

  if (activeFlightLocations.length === 0) {
    activeFlightLocations = [...LOCAL_FLIGHT_LOCATIONS];
  }

  return activeFlightLocations;
}

export function findFlightLocation(id) {
  return activeFlightLocations.find((location) => location.id === id) ?? activeFlightLocations[0] ?? DEFAULT_FLIGHT_LOCATION;
}
