import { useEffect, useState } from "react";

const prefersDark = () =>
  window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";
const defaultLocation = "Berlin";
const defaultLocations = ["Copenhagen", "Kyoto", "Berlin", "Dubai"];
const maxLocations = 6;

const loadLocations = () => {
  try {
    const saved = JSON.parse(localStorage.getItem("quickLocations") || "null");
    if (Array.isArray(saved)) {
      const cleaned = saved
        .map((item) => String(item).trim())
        .filter(Boolean);
      if (cleaned.length) return cleaned;
    }
  } catch {
    // Ignore malformed stored data.
  }
  return defaultLocations;
};

const loadSavedTemps = () => {
  try {
    const saved = JSON.parse(localStorage.getItem("savedTemps") || "null");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      return saved;
    }
  } catch {
    // Ignore malformed stored data.
  }
  return {};
};

const normalizeLocations = (value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxLocations);

const formatValue = (value, suffix = "") => {
  if (value === undefined || value === null) return "--";
  return `${value}${suffix}`;
};

const formatShortDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatUpdatedAt = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const getWeatherEffect = (condition) => {
  const normalized = (condition || "").toLowerCase();
  if (!normalized) return "clear";
  if (/(snow|sleet|blizzard|ice|freezing)/.test(normalized)) return "snow";
  if (/(rain|drizzle|thunder|storm)/.test(normalized)) return "rain";
  if (/(mist|fog|haze|smoke)/.test(normalized)) return "mist";
  if (/(cloud|overcast)/.test(normalized)) return "clouds";
  return "clear";
};

export default function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") return true;
    if (saved === "light") return false;
    return prefersDark();
  });
  const [quickLocations, setQuickLocations] = useState(() => loadLocations());
  const [isEditingLocations, setIsEditingLocations] = useState(false);
  const [locationsDraft, setLocationsDraft] = useState(() =>
    loadLocations().join(", ")
  );
  const [activeLocation, setActiveLocation] = useState(defaultLocation);
  const [input, setInput] = useState(defaultLocation);
  const [newLocation, setNewLocation] = useState("");
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [effectOverride, setEffectOverride] = useState("");
  const [weather, setWeather] = useState(null);
  const [weatherCache, setWeatherCache] = useState({});
  const [savedTemps, setSavedTemps] = useState(() => loadSavedTemps());
  const [loadingTemps, setLoadingTemps] = useState({});
  const [extended, setExtended] = useState(false);
  const [extendedData, setExtendedData] = useState(null);
  const [extendedCache, setExtendedCache] = useState({});
  const [extendedStatus, setExtendedStatus] = useState("idle");
  const [extendedError, setExtendedError] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem("quickLocations", JSON.stringify(quickLocations));
  }, [quickLocations]);

  useEffect(() => {
    localStorage.setItem("savedTemps", JSON.stringify(savedTemps));
  }, [savedTemps]);

  useEffect(() => {
    setExtended(false);
    setExtendedData(null);
    setExtendedStatus("idle");
    setExtendedError("");
  }, [activeLocation]);

  const recordSavedTemp = (location, data) => {
    const temp = data?.current?.temperature;
    if (temp === undefined || temp === null) return;
    const fetchedAt = data?.fetchedAt || new Date().toISOString();
    const key =
      quickLocations.find(
        (item) => item.toLowerCase() === location.toLowerCase()
      ) || location;
    setSavedTemps((prev) => ({
      ...prev,
      [key]: { temperature: temp, fetchedAt },
    }));
  };

  const fetchWeather = async (location, { force = false } = {}) => {
    const cleaned = location.trim();
    if (!cleaned) return;
    setActiveLocation(cleaned);
    if (!force && weatherCache[cleaned]) {
      const cached = weatherCache[cleaned];
      setWeather(cached);
      recordSavedTemp(cleaned, cached);
      setStatus("ready");
      setError("");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const response = await fetch(
        `${apiUrl}/api/weather?query=${encodeURIComponent(cleaned)}`
      );
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Unable to fetch weather data");
      }
      setWeather(data);
      setWeatherCache((prev) => ({ ...prev, [cleaned]: data }));
      recordSavedTemp(cleaned, data);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err.message || "Unable to fetch weather data");
    }
  };

  const fetchQuickTemperature = async (location) => {
    const cleaned = location.trim();
    if (!cleaned) return;
    setLoadingTemps((prev) => ({ ...prev, [cleaned]: true }));
    try {
      const response = await fetch(
        `${apiUrl}/api/weather?query=${encodeURIComponent(cleaned)}`
      );
      const data = await response.json();
      if (!response.ok || data?.error) {
        throw new Error(data?.error || "Unable to fetch weather data");
      }
      setWeatherCache((prev) => ({ ...prev, [cleaned]: data }));
      recordSavedTemp(cleaned, data);
    } catch {
    } finally {
      setLoadingTemps((prev) => ({ ...prev, [cleaned]: false }));
    }
  };

  const showCachedWeather = (location) => {
    const cleaned = location.trim();
    if (!cleaned) return;
    const cached = weatherCache[cleaned];
    if (!cached) return;
    setActiveLocation(cleaned);
    setWeather(cached);
    setStatus("ready");
    setError("");
  };

  const fetchExtended = async (location, { force = false } = {}) => {
    const cleaned = location.trim();
    if (!cleaned) return;
    if (!force && extendedCache[cleaned]) {
      setExtendedData(extendedCache[cleaned]);
      setExtendedStatus("ready");
      setExtendedError("");
      return;
    }
    setExtendedStatus("loading");
    setExtendedError("");
    try {
      const response = await fetch(
        `${apiUrl}/api/weather/extended?query=${encodeURIComponent(cleaned)}`
      );
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Unable to fetch extended weather data");
      }
      setExtendedData(data);
      setExtendedCache((prev) => ({ ...prev, [cleaned]: data }));
      setExtendedStatus("ready");
    } catch (err) {
      setExtendedStatus("error");
      setExtendedError(err.message || "Unable to fetch extended weather data");
    }
  };

  const locationLabel = weather?.location
    ? `${weather.location.name}, ${weather.location.country}`
    : activeLocation;
  const localTime = weather?.location?.localtime || "";
  const description = weather?.current?.weather_descriptions?.[0] || "";
  const icon = weather?.current?.weather_icons?.[0];
  const temperature = weather?.current?.temperature;
  const feelsLike = weather?.current?.feelslike;
  const humidity = weather?.current?.humidity;
  const windSpeed = weather?.current?.wind_speed;
  const windDir = weather?.current?.wind_dir;
  const pressure = weather?.current?.pressure;
  const visibility = weather?.current?.visibility;
  const precip = weather?.current?.precip;
  const lastUpdatedLabel = formatUpdatedAt(weather?.fetchedAt);
  const weatherEffect = getWeatherEffect(description);
  const activeEffect = effectOverride || weatherEffect;

  const metrics = [
    {
      label: "Wind",
      value: `${formatValue(windSpeed, " km/h")} ${windDir || ""}`.trim(),
    },
    { label: "Humidity", value: formatValue(humidity, "%") },
    { label: "Pressure", value: formatValue(pressure, " mb") },
    { label: "Visibility", value: formatValue(visibility, " km") },
    { label: "Precip", value: formatValue(precip, " mm") },
  ];
  const historyDays = extendedData?.history || [];
  const forecastDays = extendedData?.forecast || [];
  const historyNote = extendedData?.historyError || "";
  const forecastNote = extendedData?.forecastError || "";
  const isAtMaxLocations = quickLocations.length >= maxLocations;

  return (
    <div
      className={`relative min-h-screen overflow-hidden text-stone-900 transition-colors duration-300 dark:text-stone-100 weather-bg-${activeEffect}`}
    >
      <div
        className={`pointer-events-none absolute inset-0 weather-effect weather-effect--${activeEffect}`}
        aria-hidden="true"
      >
        <div className="weather-effect__layer" />
        <div className="weather-effect__layer weather-effect__layer--secondary" />
      </div>
      <div className="pointer-events-none absolute inset-0 weather-orbs">
        <div className="absolute -top-32 right-10 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl animate-pulse-soft dark:bg-amber-500/10" />
        <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-emerald-200/30 blur-3xl animate-float-slow dark:bg-emerald-400/10" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-5xl px-6 pt-8">
        <nav
          aria-label="Location switcher"
          className="flex flex-wrap items-center justify-between gap-4 rounded-full border border-stone-200 bg-white/70 px-5 py-3 text-xs uppercase tracking-[0.35em] text-stone-500 shadow-sm backdrop-blur-md animate-fade-in transition hover:-translate-y-0.5 hover:shadow-md dark:border-stone-800 dark:bg-neutral-900/70 dark:text-stone-400"
        >
          <span className="text-[10px] tracking-[0.4em]">Locations</span>
          <div className="flex flex-wrap gap-2">
            {quickLocations.map((location) => {
              const isActive = activeLocation === location;
              return (
                <button
                  key={location}
                  type="button"
                  onClick={() => {
                    setInput(location);
                    fetchWeather(location);
                  }}
                  aria-pressed={isActive}
                  className={`rounded-full px-4 py-2 text-[10px] tracking-[0.35em] transition-all duration-300 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 dark:focus-visible:outline-stone-500 ${
                    isActive
                      ? "bg-stone-900 text-stone-50 shadow-md dark:bg-stone-50 dark:text-stone-900"
                      : "border border-transparent text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                  }`}
                >
                  {location}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!isEditingLocations) {
                setLocationsDraft(quickLocations.join(", "));
              }
              setIsEditingLocations((value) => !value);
            }}
            className="rounded-full border border-stone-300 px-4 py-2 text-[10px] tracking-[0.35em] transition hover:border-stone-500 hover:text-stone-900 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400"
          >
            {isEditingLocations ? "Close" : "Edit"}
          </button>
        </nav>
        {isEditingLocations ? (
          <div className="mt-4 rounded-2xl border border-stone-200 bg-white/70 px-6 py-4 text-xs uppercase tracking-[0.3em] text-stone-500 shadow-sm backdrop-blur-md animate-fade-in dark:border-stone-800 dark:bg-neutral-900/70 dark:text-stone-400">
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-center"
              onSubmit={(event) => {
                event.preventDefault();
                const next = normalizeLocations(locationsDraft);
                const resolved = next.length ? next : defaultLocations;
                setQuickLocations(resolved);
                setLocationsDraft(resolved.join(", "));
                setIsEditingLocations(false);
              }}
            >
              <input
                type="text"
                value={locationsDraft}
                onChange={(event) => setLocationsDraft(event.target.value)}
                placeholder="Copenhagen, Kyoto, Reykjavik"
                className="w-full flex-1 rounded-full border border-stone-300 bg-white/70 px-4 py-2 text-[11px] tracking-[0.25em] text-stone-700 shadow-sm transition focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-neutral-900/60 dark:text-stone-100 dark:focus:border-stone-400"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-full bg-stone-900 px-4 py-2 text-[10px] tracking-[0.35em] text-stone-50 transition hover:bg-stone-700 dark:bg-stone-50 dark:text-stone-900 dark:hover:bg-stone-200"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuickLocations(defaultLocations);
                    setLocationsDraft(defaultLocations.join(", "));
                  }}
                  className="rounded-full border border-stone-300 px-4 py-2 text-[10px] tracking-[0.35em] transition hover:border-stone-500 hover:text-stone-900 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400"
                >
                  Reset
                </button>
              </div>
            </form>
            <p className="mt-3 text-[10px] uppercase tracking-[0.3em]">
              Up to 6 locations, comma separated.
            </p>
          </div>
        ) : null}
      </div>

        <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="group flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-stone-300 bg-white/70 shadow-sm backdrop-blur-md transition group-hover:-translate-y-0.5 dark:border-stone-700 dark:bg-neutral-900/70">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-stone-700 transition-transform duration-500 group-hover:rotate-6 dark:text-stone-200"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="3.5" />
              <path d="M4 18c1.8-2.6 4.5-3.9 8-3.9s6.2 1.3 8 3.9" />
              <path d="M7 18h10" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-sm uppercase tracking-[0.3em] text-stone-600 dark:text-stone-400">
              Weather Atlas
            </div>
            <div className="text-[10px] uppercase tracking-[0.4em] text-stone-400 dark:text-stone-500">
              Minimal Forecasts
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDarkMode((value) => !value)}
          className="rounded-full border border-stone-300 px-4 py-2 text-xs uppercase tracking-[0.25em] transition hover:border-stone-500 hover:text-stone-800 dark:border-stone-700 dark:text-stone-200 dark:hover:border-stone-400"
        >
          {darkMode ? "Light" : "Dark"}
        </button>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 pb-16 pt-6">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6 animate-fade-up">
            <p className="text-xs uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
              Live Weather
            </p>
            <h1 className="font-display text-4xl leading-tight sm:text-5xl">
              Calm forecasts for moving days.
            </h1>
            <p className="text-base leading-relaxed text-stone-600 dark:text-stone-300">
              Search any city and keep a minimal pulse on temperature, wind, and
              atmosphere. Data streams directly from WeatherAPI via the
              backend.
            </p>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const next = input.trim();
                if (next) {
                  fetchWeather(next, { force: true });
                }
              }}
            >
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Search a city"
                  className="w-full flex-1 rounded-full border border-stone-300 bg-white/70 px-5 py-3 text-sm text-stone-700 shadow-sm transition focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-neutral-900/60 dark:text-stone-100 dark:focus:border-stone-400"
                />
                <button
                  type="submit"
                  className="rounded-full bg-stone-900 px-6 py-3 text-xs uppercase tracking-[0.3em] text-stone-50 transition hover:bg-stone-700 dark:bg-stone-50 dark:text-stone-900 dark:hover:bg-stone-200"
                >
                  Update
                </button>
              </div>
              <p className="text-xs uppercase tracking-[0.3em] text-stone-500 dark:text-stone-400">
                {status === "loading" && "Gathering conditions"}
                {status === "error" && error}
                {status === "ready" && localTime && `Local time ${localTime}`}
                {status === "ready" && !localTime && "Weather updated"}
                {status === "idle" && "Pick a city to begin"}
              </p>
              {lastUpdatedLabel ? (
                <p className="text-[10px] uppercase tracking-[0.3em] text-stone-400 dark:text-stone-500">
                  Last updated {lastUpdatedLabel}
                </p>
              ) : null}
            </form>
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white/70 p-8 shadow-lg backdrop-blur-md animate-fade-in dark:border-stone-800 dark:bg-neutral-900/70">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-stone-400">
                  Current Conditions
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-stone-800 dark:text-stone-100">
                  {locationLabel}
                </h2>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                  {description || "No description yet"}
                </p>
              </div>
              {icon ? (
                <img
                  src={icon}
                  alt={description || "Weather icon"}
                  className="h-14 w-14 rounded-full bg-stone-100/70 p-2 dark:bg-stone-900/70"
                  loading="lazy"
                />
              ) : null}
            </div>
            <div className="mt-8 flex items-end justify-between">
              <div>
                <div className="text-5xl font-semibold text-stone-900 dark:text-stone-50">
                  {formatValue(temperature, " C")}
                </div>
                <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                  Feels like {formatValue(feelsLike, " C")}
                </p>
              </div>
              <div className="text-right text-sm text-stone-500 dark:text-stone-400">
                {status === "ready" ? "Updated" : "Awaiting data"}
              </div>
            </div>
            <div className="mt-8 space-y-4 text-sm text-stone-600 dark:text-stone-300">
              {metrics.map((metric) => (
                <div key={metric.label} className="flex items-center justify-between">
                  <span>{metric.label}</span>
                  <span className="text-stone-900 dark:text-stone-100">
                    {metric.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-10 border-t border-stone-200 pt-6 dark:border-stone-800">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
                <span>Extended Outlook</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!extended) {
                      setExtended(true);
                      fetchExtended(activeLocation);
                    } else {
                      setExtended(false);
                    }
                  }}
                  className="rounded-full border border-stone-300 px-3 py-2 text-[10px] tracking-[0.35em] transition hover:border-stone-500 hover:text-stone-900 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400"
                >
                  {extended ? "Hide" : "View Fullscreen"}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500 dark:text-stone-400">
            Default cities
          </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {quickLocations.map((location) => {
                const saved = savedTemps[location];
                const cached = weatherCache[location];
                const hasCachedWeather = Boolean(cached);
                const tempValue = saved?.temperature;
                const updatedLabel = formatUpdatedAt(saved?.fetchedAt);
                const isLoading = loadingTemps[location];
                return (
                  <div
                    key={location}
                    className="rounded-2xl border border-stone-200 bg-white/60 p-5 text-left text-sm text-stone-600 shadow-sm transition hover:-translate-y-1 hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-neutral-900/70 dark:text-stone-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.3em] text-stone-500 dark:text-stone-400">
                          {location}
                        </p>
                        <div className="mt-3 text-3xl font-semibold text-stone-900 dark:text-stone-100">
                          {formatValue(tempValue, " C")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setInput(location);
                          showCachedWeather(location);
                        }}
                        disabled={!hasCachedWeather}
                        className="rounded-full border border-stone-300 px-3 py-2 text-[10px] uppercase tracking-[0.3em] text-stone-600 transition hover:border-stone-500 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400"
                      >
                        View
                      </button>
                    </div>
                    <p className="mt-3 text-[10px] uppercase tracking-[0.3em] text-stone-400 dark:text-stone-500">
                      {updatedLabel ? `Last update ${updatedLabel}` : "Load to enable view"}
                    </p>
                    <button
                      type="button"
                      onClick={() => fetchQuickTemperature(location)}
                      disabled={isLoading}
                      className="mt-3 inline-flex rounded-full border border-stone-300 px-4 py-2 text-[10px] uppercase tracking-[0.35em] transition hover:border-stone-500 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400"
                    >
                      {isLoading
                        ? "Loading"
                        : tempValue === undefined || tempValue === null
                        ? "Load"
                        : "Refresh"}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={isAtMaxLocations}
                onClick={() => setIsAddingLocation((value) => !value)}
                className="rounded-full border border-stone-300 px-4 py-2 text-[10px] uppercase tracking-[0.35em] transition hover:border-stone-500 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400"
              >
                {isAddingLocation ? "Close" : "Add City"}
              </button>
              <p className="text-[10px] uppercase tracking-[0.3em] text-stone-400 dark:text-stone-500">
                {isAtMaxLocations ? "Limit reached" : `Up to ${maxLocations} cities`}
              </p>
            </div>
            {isAddingLocation && !isAtMaxLocations ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const cleaned = newLocation.trim();
                  if (!cleaned) return;
                  setQuickLocations((prev) => {
                    const exists = prev.some(
                      (item) => item.toLowerCase() === cleaned.toLowerCase()
                    );
                    if (exists) return prev;
                    return [...prev, cleaned].slice(0, maxLocations);
                  });
                  setNewLocation("");
                  setIsAddingLocation(false);
                }}
                className="flex flex-wrap items-center gap-3"
              >
                <input
                  type="text"
                  value={newLocation}
                  onChange={(event) => setNewLocation(event.target.value)}
                  placeholder="Reykjavik"
                  className="w-full flex-1 rounded-full border border-stone-300 bg-white/70 px-4 py-2 text-xs tracking-[0.2em] text-stone-700 shadow-sm transition focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-neutral-900/60 dark:text-stone-100 dark:focus:border-stone-400"
                />
                <button
                  type="submit"
                  className="rounded-full border border-stone-300 px-4 py-2 text-[10px] uppercase tracking-[0.35em] transition hover:border-stone-500 hover:text-stone-900 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400"
                >
                  Add
                </button>
              </form>
            ) : null}
        </section>

        <section className="space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500 dark:text-stone-400">
            Testing effects
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "", label: "Auto" },
              { id: "clear", label: "Clear" },
              { id: "clouds", label: "Clouds" },
              { id: "rain", label: "Rain" },
              { id: "snow", label: "Snow" },
              { id: "mist", label: "Mist" },
            ].map((effect) => (
              <button
                key={effect.label}
                type="button"
                onClick={() => setEffectOverride(effect.id)}
                className={`rounded-full border px-4 py-2 text-[10px] uppercase tracking-[0.35em] transition hover:border-stone-500 hover:text-stone-900 dark:hover:border-stone-400 ${
                  (effectOverride || "") === effect.id
                    ? "border-stone-500 text-stone-900 dark:border-stone-400 dark:text-stone-100"
                    : "border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300"
                }`}
              >
                {effect.label}
              </button>
            ))}
          </div>
        </section>
      </main>
      {extended ? (
        <div className="fixed inset-0 z-30 flex min-h-screen items-start justify-center overflow-y-auto bg-stone-950/80 px-6 py-10 text-stone-100 backdrop-blur-md">
          <div className="relative w-full max-w-6xl rounded-3xl border border-stone-800 bg-neutral-950/90 p-8 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-stone-400">
                  Extended Outlook
                </p>
                <h2 className="mt-2 text-3xl font-semibold text-stone-50">
                  {locationLabel}
                </h2>
                <p className="mt-1 text-sm text-stone-400">
                  History and forecast detail for the selected city.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => fetchExtended(activeLocation, { force: true })}
                  className="rounded-full border border-stone-700 px-4 py-2 text-[10px] uppercase tracking-[0.35em] text-stone-300 transition hover:border-stone-500 hover:text-stone-50"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setExtended(false)}
                  className="rounded-full border border-stone-700 px-4 py-2 text-[10px] uppercase tracking-[0.35em] text-stone-300 transition hover:border-stone-500 hover:text-stone-50"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="mt-8">
              {extendedStatus === "loading" ? (
                <p className="text-xs uppercase tracking-[0.3em] text-stone-400">
                  Loading extended outlook
                </p>
              ) : null}
              {extendedStatus === "error" ? (
                <p className="text-xs uppercase tracking-[0.3em] text-rose-400">
                  {extendedError}
                </p>
              ) : null}
              {extendedStatus === "ready" ? (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-3">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-stone-400">
                      History
                    </div>
                    {historyNote ? (
                      <p className="text-xs uppercase tracking-[0.3em] text-amber-400">
                        {historyNote}
                      </p>
                    ) : null}
                    {historyDays.length ? (
                      historyDays.map((day) => (
                        <div
                          key={`history-${day.date}`}
                          className="flex items-center justify-between gap-4 rounded-2xl border border-stone-800 bg-neutral-900/70 px-4 py-3 text-sm"
                        >
                          <div className="flex items-center gap-3">
                            {day.icon ? (
                              <img
                                src={day.icon}
                                alt={day.condition || "History icon"}
                                className="h-10 w-10 rounded-full bg-stone-900/70 p-1"
                                loading="lazy"
                              />
                            ) : null}
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.3em] text-stone-400">
                                {formatShortDate(day.date)}
                              </p>
                              <p className="text-sm text-stone-200">
                                {day.condition || "Muted skies"}
                              </p>
                              {day.totalPrecip !== undefined &&
                              day.totalPrecip !== null ? (
                                <p className="text-xs text-stone-400">
                                  Precip {formatValue(day.totalPrecip, " mm")}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-right text-sm text-stone-100">
                            {formatValue(day.maxTemp, " C")}
                            <span className="text-stone-500">
                              {" / "}
                              {formatValue(day.minTemp, " C")}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs uppercase tracking-[0.3em] text-stone-400">
                        No history available
                      </p>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-stone-400">
                      Forecast
                    </div>
                    {forecastNote ? (
                      <p className="text-xs uppercase tracking-[0.3em] text-amber-400">
                        {forecastNote}
                      </p>
                    ) : null}
                    {forecastDays.length ? (
                      forecastDays.map((day) => (
                        <div
                          key={`forecast-${day.date}`}
                          className="flex items-center justify-between gap-4 rounded-2xl border border-stone-800 bg-neutral-900/70 px-4 py-3 text-sm"
                        >
                          <div className="flex items-center gap-3">
                            {day.icon ? (
                              <img
                                src={day.icon}
                                alt={day.condition || "Forecast icon"}
                                className="h-10 w-10 rounded-full bg-stone-900/70 p-1"
                                loading="lazy"
                              />
                            ) : null}
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.3em] text-stone-400">
                                {formatShortDate(day.date)}
                              </p>
                              <p className="text-sm text-stone-200">
                                {day.condition || "Gentle horizon"}
                              </p>
                              {day.chanceOfRain !== undefined &&
                              day.chanceOfRain !== null ? (
                                <p className="text-xs text-stone-400">
                                  Rain chance {formatValue(day.chanceOfRain, "%")}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-right text-sm text-stone-100">
                            {formatValue(day.maxTemp, " C")}
                            <span className="text-stone-500">
                              {" / "}
                              {formatValue(day.minTemp, " C")}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs uppercase tracking-[0.3em] text-stone-400">
                        No forecast available
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
