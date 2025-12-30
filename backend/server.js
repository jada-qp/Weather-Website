import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 3001;
const weatherApiBaseUrl =
  process.env.WEATHERAPI_BASE_URL || "http://api.weatherapi.com/v1";

const normalizeIconUrl = (icon) => {
  if (!icon) return "";
  return icon.startsWith("http") ? icon : `https:${icon}`;
};

const buildWeatherUrl = (path, params) => {
  const url = new URL(`${weatherApiBaseUrl}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const requestWeather = async (url) => {
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || data?.error) {
      const message = data?.error?.message || "Weather service error";
      return { error: message };
    }
    return { data };
  } catch (error) {
    return { error: "Unable to reach weather service" };
  }
};

const formatDate = (date) => date.toISOString().slice(0, 10);

const mapForecastDay = (day) => ({
  date: day?.date || "",
  maxTemp: day?.day?.maxtemp_c,
  minTemp: day?.day?.mintemp_c,
  avgTemp: day?.day?.avgtemp_c,
  chanceOfRain: day?.day?.daily_chance_of_rain,
  condition: day?.day?.condition?.text || "",
  icon: normalizeIconUrl(day?.day?.condition?.icon),
});

const mapHistoryDay = (day) => ({
  date: day?.date || "",
  maxTemp: day?.day?.maxtemp_c,
  minTemp: day?.day?.mintemp_c,
  avgTemp: day?.day?.avgtemp_c,
  totalPrecip: day?.day?.totalprecip_mm,
  maxWind: day?.day?.maxwind_kph,
  condition: day?.day?.condition?.text || "",
  icon: normalizeIconUrl(day?.day?.condition?.icon),
});

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/api/weather", async (req, res) => {
  const query = req.query.query || req.query.location;
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter" });
  }

  const accessKey = process.env.WEATHERAPI_KEY;
  if (!accessKey) {
    return res.status(500).json({ error: "WEATHERAPI_KEY is not set" });
  }

  const url = buildWeatherUrl("current.json", {
    key: accessKey,
    q: query,
    aqi: "no",
  });

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data?.error) {
      const message = data?.error?.message || "Weather service error";
      return res.status(502).json({ error: message });
    }

    const conditionText = data?.current?.condition?.text || "";
    const iconUrl = normalizeIconUrl(data?.current?.condition?.icon);

    return res.json({
      location: {
        name: data?.location?.name || query,
        country: data?.location?.country || "",
        localtime: data?.location?.localtime || "",
      },
      current: {
        temperature: data?.current?.temp_c,
        feelslike: data?.current?.feelslike_c,
        humidity: data?.current?.humidity,
        wind_speed: data?.current?.wind_kph,
        wind_dir: data?.current?.wind_dir,
        pressure: data?.current?.pressure_mb,
        visibility: data?.current?.vis_km,
        precip: data?.current?.precip_mm,
        weather_descriptions: conditionText ? [conditionText] : [],
        weather_icons: iconUrl ? [iconUrl] : [],
      },
      request: { query },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(502).json({ error: "Unable to reach weather service" });
  }
});

app.get("/api/weather/extended", async (req, res) => {
  const query = req.query.query || req.query.location;
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter" });
  }

  const accessKey = process.env.WEATHERAPI_KEY;
  if (!accessKey) {
    return res.status(500).json({ error: "WEATHERAPI_KEY is not set" });
  }

  const forecastUrl = buildWeatherUrl("forecast.json", {
    key: accessKey,
    q: query,
    days: 3,
    aqi: "no",
    alerts: "no",
  });

  const historyDates = [1, 2].map((offset) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return formatDate(date);
  });

  const historyUrls = historyDates.map((date) =>
    buildWeatherUrl("history.json", {
      key: accessKey,
      q: query,
      dt: date,
    })
  );

  const forecastResult = await requestWeather(forecastUrl);
  if (forecastResult.error) {
    return res.status(502).json({ error: forecastResult.error });
  }

  const historyResults = await Promise.all(historyUrls.map(requestWeather));

  const historyDays = historyResults
    .map((result) => result.data?.forecast?.forecastday?.[0])
    .filter(Boolean)
    .map(mapHistoryDay);

  const historyError = historyResults.find((result) => result.error)?.error || "";
  const forecastDays =
    forecastResult.data?.forecast?.forecastday
      ?.slice(1)
      ?.map(mapForecastDay) || [];
  const forecastError = forecastDays.length ? "" : "Forecast unavailable";

  return res.json({
    location: {
      name: forecastResult.data?.location?.name || query,
      country: forecastResult.data?.location?.country || "",
      localtime: forecastResult.data?.location?.localtime || "",
    },
    history: historyDays,
    forecast: forecastDays,
    historyError,
    forecastError,
    fetchedAt: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`API listening on ${port}`);
});

