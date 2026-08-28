// src/services/weatherService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Current-weather lookups for CATOUR, backed by Open-Meteo
// (https://open-meteo.com) — free, no API key, generous rate limits, good
// enough for a mobile tourism app. If you outgrow it later (production
// scale, minute-level forecasts, severe-weather alerts) swap this file for
// OpenWeatherMap/WeatherAPI — nothing outside this file needs to change as
// long as getCurrentWeather()'s return shape stays the same.
//
// Used by:
//   AIGuide.tsx / Proximityaicontext.tsx → so ALI answers weather questions
//   with real numbers instead of letting Groq guess/hallucinate them.
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/** Default fallback — central Pasig City — used when no coords are passed. */
export const PASIG_CITY_COORDS = { lat: 14.5764, lng: 121.0851 };

/** Don't re-fetch for the same spot more than once every 10 minutes. */
const CACHE_MS = 10 * 60 * 1000;

export interface CurrentWeather {
  temperatureC: number;
  feelsLikeC: number;
  humidityPct: number;
  windKph: number;
  isRainingOrStorming: boolean;
  /** True if any of the next 3 hourly forecasts show ≥40% rain probability. */
  willRainSoon: boolean;
  condition: string;       // human-readable, e.g. "Light rain"
  weatherCode: number;     // raw WMO code, kept in case callers want it
  fetchedAt: number;
}

interface CacheEntry {
  data: CurrentWeather;
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const cacheKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

/**
 * WMO Weather interpretation codes (used by Open-Meteo) → short human text.
 * https://open-meteo.com/en/docs — "WMO Weather interpretation codes" table.
 */
function describeWeatherCode(code: number): string {
  const map: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mostly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Foggy with frost',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Heavy drizzle',
    56: 'Freezing drizzle',
    57: 'Freezing drizzle',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    66: 'Freezing rain',
    67: 'Freezing rain',
    71: 'Light snow',
    73: 'Snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Light rain showers',
    81: 'Rain showers',
    82: 'Violent rain showers',
    85: 'Snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Thunderstorm with heavy hail',
  };
  return map[code] || 'Unknown conditions';
}

/** Codes that count as "actively raining/storming" for trip-planning purposes. */
const RAIN_OR_STORM_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

/**
 * getWeatherEmoji
 * Single-glyph icon for compact UI (chips, badges) — not used in any
 * Groq-facing text, just display.
 */
export function getWeatherEmoji(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

/**
 * getCurrentWeather
 * Returns current conditions for the given coordinates (defaults to Pasig
 * City center). Cached per-location for 10 minutes. Returns null on any
 * failure (network down, API error) — callers should fall back to NOT
 * mentioning specific weather facts rather than guessing.
 */
export async function getCurrentWeather(
  lat: number = PASIG_CITY_COORDS.lat,
  lng: number = PASIG_CITY_COORDS.lng,
): Promise<CurrentWeather | null> {
  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  try {
    const url =
      `${OPEN_METEO_ENDPOINT}?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      // NEW — hourly precipitation_probability powers willRainSoon below.
      // Open-Meteo returns this starting from the current hour, so the
      // first 3 entries are "now, next hour, hour after" — good enough for
      // a "should I bring an umbrella in the next few hours" check without
      // needing a second request.
      `&hourly=precipitation_probability` +
      `&forecast_days=1&timezone=auto`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);

    const data = await response.json();
    const c = data.current;
    if (!c) throw new Error('Open-Meteo: missing current block');

    const weatherCode = c.weather_code ?? 0;

    const hourlyProbs: number[] = Array.isArray(data.hourly?.precipitation_probability)
      ? data.hourly.precipitation_probability.slice(0, 3)
      : [];
    const willRainSoon = hourlyProbs.some((p: number) => p >= 40);

    const result: CurrentWeather = {
      temperatureC: Math.round(c.temperature_2m),
      feelsLikeC: Math.round(c.apparent_temperature ?? c.temperature_2m),
      humidityPct: Math.round(c.relative_humidity_2m ?? 0),
      windKph: Math.round(c.wind_speed_10m ?? 0),
      isRainingOrStorming: RAIN_OR_STORM_CODES.has(weatherCode),
      willRainSoon,
      condition: describeWeatherCode(weatherCode),
      weatherCode,
      fetchedAt: Date.now(),
    };

    cache.set(key, { data: result, ts: Date.now() });
    return result;
  } catch (err) {
    console.warn('[weatherService] getCurrentWeather failed:', err);
    return null;
  }
}

/**
 * describeWeatherForPrompt
 * Formats a CurrentWeather reading as a single fact-line safe to inject
 * straight into a Groq system/user prompt — e.g.:
 *   "Current weather in Pasig City: 31°C (feels like 35°C), Partly cloudy,
 *    72% humidity, wind 9 km/h. It is currently NOT raining."
 * Keeping this in the service (not duplicated in every caller) means the
 * exact wording only has to be gotten right once.
 */
export function describeWeatherForPrompt(w: CurrentWeather, placeName = 'Pasig City'): string {
  const rainNote = w.isRainingOrStorming
    ? 'It is currently raining.'
    : w.willRainSoon
      ? 'It is not raining right now, but rain is likely in the next few hours — worth mentioning an umbrella.'
      : 'It is currently NOT raining and rain is not expected soon.';

  return (
    `Current weather in ${placeName}: ${w.temperatureC}°C (feels like ${w.feelsLikeC}°C), ` +
    `${w.condition}, ${w.humidityPct}% humidity, wind ${w.windKph} km/h. ${rainNote}`
  );
}