import { useState, useEffect, useCallback } from 'react';

interface Coords {
  latitude: number;
  longitude: number;
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 300000, // 5 minutes
};

function friendlyGeoError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location access denied. Please allow location in your browser settings.';
    case err.POSITION_UNAVAILABLE:
      return 'Location information is unavailable.';
    case err.TIMEOUT:
      return 'Location request timed out. Please try again.';
    default:
      return 'Unable to detect your location.';
  }
}

export const useUserLocation = () => {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.');
      return;
    }

    setError(null); 

    const success = (position: GeolocationPosition) => {
      setCoords({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setError(null);
    };

    const failure = (err: GeolocationPositionError) => {
      setError(friendlyGeoError(err));
      console.warn('Geolocation error:', err.message);
    };

    navigator.geolocation.getCurrentPosition(success, failure, GEO_OPTIONS);
  }, [retryCount]); // re-run whenever retry is triggered

  /** Call this to prompt the browser for location again (e.g. after the user grants permission). */
  const retry = useCallback(() => {
    setRetryCount(n => n + 1);
  }, []);

  return { coords, error, retry };
};