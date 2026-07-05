export const FLIGHT_LOCATIONS = [
  {
    id: 'atibaia-pedra-grande',
    name: 'Atibaia / Pedra Grande',
    region: 'Atibaia - SP',
    latitude: -23.169090319406045,
    longitude: -46.52831806228563,
    launchAltitudeMeters: 24,
    liftMode: 'thermal'
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

export const DEFAULT_FLIGHT_LOCATION = FLIGHT_LOCATIONS[0];

export function findFlightLocation(id) {
  return FLIGHT_LOCATIONS.find((location) => location.id === id) ?? DEFAULT_FLIGHT_LOCATION;
}
