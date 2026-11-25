import type { WeatherDailyItem, WeatherHourlySlot, WeatherResponse } from './types.ts';

export const KARSIYAKA_OPEN_METEO_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=38.4556&longitude=27.1103&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=Europe%2FIstanbul&forecast_days=8';

export function describeWmoCode(code: number): string {
  if (code === 0) return 'Açık';
  if (code === 1) return 'Az Bulutlu';
  if (code === 2) return 'Parçalı Bulutlu';
  if (code === 3) return 'Bulutlu';
  if (code === 45 || code === 48) return 'Sisli';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Çisenti';
  if ([61, 63, 65, 66, 67].includes(code)) return 'Yağmurlu';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Karlı';
  if ([80, 81, 82].includes(code)) return 'Sağanak';
  if ([95, 96, 99].includes(code)) return 'Fırtınalı';
  return 'Bulutlu';
}

export function parseOpenMeteoPayload(rawInput: unknown, nowMs: number = Date.now()): WeatherResponse {
  const raw = (rawInput ?? {}) as {
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      precipitation_probability?: number[];
      weather_code?: number[];
      wind_speed_10m?: number[];
    };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      wind_speed_10m_max?: number[];
    };
  };

  const hourly: WeatherHourlySlot[] = [];
  const hTimes = raw.hourly?.time ?? [];
  for (let i = 0; i < hTimes.length; i++) {
    const t = hTimes[i];
    if (typeof t !== 'string' || t.length < 13) continue;
    const dateStr = t.slice(0, 10);
    const hour = Number(t.slice(11, 13));
    if (!Number.isInteger(hour)) continue;
    const weatherCode = Number(raw.hourly?.weather_code?.[i] ?? 0);
    hourly.push({
      dateStr,
      hour,
      tempC: Math.round(Number(raw.hourly?.temperature_2m?.[i] ?? 0)),
      weatherCode,
      conditionLabel: describeWmoCode(weatherCode),
      precipProb: Math.round(Number(raw.hourly?.precipitation_probability?.[i] ?? 0)),
      windKmh: Math.round(Number(raw.hourly?.wind_speed_10m?.[i] ?? 0)),
    });
  }

  const daily: WeatherDailyItem[] = [];
  const dTimes = raw.daily?.time ?? [];
  for (let i = 0; i < dTimes.length; i++) {
    const dateStr = dTimes[i];
    if (typeof dateStr !== 'string') continue;
    const weatherCode = Number(raw.daily?.weather_code?.[i] ?? 0);
    daily.push({
      dateStr,
      weatherCode,
      conditionLabel: describeWmoCode(weatherCode),
      tempMinC: Math.round(Number(raw.daily?.temperature_2m_min?.[i] ?? 0)),
      tempMaxC: Math.round(Number(raw.daily?.temperature_2m_max?.[i] ?? 0)),
      precipProbMax: Math.round(Number(raw.daily?.precipitation_probability_max?.[i] ?? 0)),
      windMaxKmh: Math.round(Number(raw.daily?.wind_speed_10m_max?.[i] ?? 0)),
    });
  }

  const currentCode = Number(raw.current?.weather_code ?? 0);
  return {
    available: hourly.length > 0 || daily.length > 0,
    locationLabel: 'İzmir · Karşıyaka',
    fetchedAtMs: nowMs,
    current: raw.current
      ? {
          tempC: Math.round(Number(raw.current.temperature_2m ?? 0)),
          weatherCode: currentCode,
          conditionLabel: describeWmoCode(currentCode),
          windKmh: Math.round(Number(raw.current.wind_speed_10m ?? 0)),
        }
      : null,
    daily,
    hourly,
  };
}
