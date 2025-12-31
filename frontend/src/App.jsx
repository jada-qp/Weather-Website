import { useEffect, useRef, useState } from "react";

const prefersDark = () =>
  window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";
const defaultLocation = "Berlin";
const defaultLocations = ["Copenhagen", "Kyoto", "Berlin", "Dubai"];
const maxLocations = 6;
const maxRecent = 6;
const defaultUnits = { temp: "c", speed: "kph" };
const cacheTtlMs = Number(import.meta.env.VITE_CACHE_TTL_MS) || 5 * 60 * 1000;
const throttleMs =
  Number(import.meta.env.VITE_REQUEST_THROTTLE_MS) || 1200;
const weatherCacheKey = "weatherCache";
const extendedCacheKey = "extendedCache";

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

const loadUnits = () => {
  try {
    const saved = JSON.parse(localStorage.getItem("units") || "null");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      return {
        temp: saved.temp === "f" ? "f" : "c",
        speed: saved.speed === "mph" ? "mph" : "kph",
      };
    }
  } catch {
    // Ignore malformed stored data.
  }
  return defaultUnits;
};

const loadRecentSearches = () => {
  try {
    const saved = JSON.parse(localStorage.getItem("recentSearches") || "null");
    if (Array.isArray(saved)) {
      return saved
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, maxRecent);
    }
  } catch {
    // Ignore malformed stored data.
  }
  return [];
};

const parseCachedAt = (entry) => {
  if (!entry || typeof entry !== "object") return 0;
  if (typeof entry.cachedAt === "number") return entry.cachedAt;
  if (typeof entry.cachedAt === "string") {
    const parsed = Date.parse(entry.cachedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof entry.fetchedAt === "string") {
    const parsed = Date.parse(entry.fetchedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};

const isCacheFresh = (entry) => {
  const cachedAt = parseCachedAt(entry);
  if (!cachedAt) return false;
  return Date.now() - cachedAt < cacheTtlMs;
};

const pruneCache = (cache) => {
  if (!cache || typeof cache !== "object") return {};
  const now = Date.now();
  return Object.entries(cache).reduce((acc, [key, value]) => {
    const cachedAt = parseCachedAt(value);
    if (cachedAt && now - cachedAt < cacheTtlMs) {
      acc[key] = value;
    }
    return acc;
  }, {});
};

const loadCache = (storageKey) => {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      return pruneCache(saved);
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

const toFahrenheit = (value) => (value * 9) / 5 + 32;
const toMph = (value) => value / 1.60934;

const formatTemp = (value, unit) => {
  if (value === undefined || value === null) return "--";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "--";
  const converted = unit === "f" ? toFahrenheit(numeric) : numeric;
  return `${Math.round(converted)} ${unit.toUpperCase()}`;
};

const formatSpeed = (value, unit) => {
  if (value === undefined || value === null) return "--";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "--";
  const converted = unit === "mph" ? toMph(numeric) : numeric;
  const suffix = unit === "mph" ? "mph" : "km/h";
  return `${Math.round(converted)} ${suffix}`;
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
  const [units, setUnits] = useState(() => loadUnits());
  const [quickLocations, setQuickLocations] = useState(() => loadLocations());
  const [isEditingLocations, setIsEditingLocations] = useState(false);
  const [locationsDraft, setLocationsDraft] = useState(() =>
    loadLocations().join(", ")
  );
  const [activeLocation, setActiveLocation] = useState(defaultLocation);
  const [input, setInput] = useState(defaultLocation);
  const [recentSearches, setRecentSearches] = useState(() =>
    loadRecentSearches()
  );
  const [newLocation, setNewLocation] = useState("");
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [effectOverride, setEffectOverride] = useState("");
  const [weather, setWeather] = useState(null);
  const [weatherCache, setWeatherCache] = useState(() =>
    loadCache(weatherCacheKey)
  );
  const [savedTemps, setSavedTemps] = useState(() => loadSavedTemps());
  const [loadingTemps, setLoadingTemps] = useState({});
  const [extended, setExtended] = useState(false);
  const [extendedData, setExtendedData] = useState(null);
  const [extendedCache, setExtendedCache] = useState(() =>
    loadCache(extendedCacheKey)
  );
  const [extendedStatus, setExtendedStatus] = useState("idle");
  const [extendedError, setExtendedError] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const modalRef = useRef(null);
  const closeButtonRef = useRef(null);
  const requestCooldowns = useRef({});
  const requestInFlight = useRef({});

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
    localStorage.setItem(weatherCacheKey, JSON.stringify(weatherCache));
  }, [weatherCache]);

  useEffect(() => {
    localStorage.setItem(extendedCacheKey, JSON.stringify(extendedCache));
  }, [extendedCache]);

  useEffect(() => {
    localStorage.setItem("units", JSON.stringify(units));
  }, [units]);

  useEffect(() => {
    localStorage.setItem("recentSearches", JSON.stringify(recentSearches));
  }, [recentSearches]);

  useEffect(() => {
    setExtended(false);
    setExtendedData(null);
    setExtendedStatus("idle");
    setExtendedError("");
  }, [activeLocation]);

  useEffect(() => {
    if (!extended) return;
    const container = modalRef.current;
    const focusableSelector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExtended(false);
        return;
      }
      if (event.key !== "Tab" || !container) return;
      const focusable = Array.from(
        container.querySelectorAll(focusableSelector)
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    closeButtonRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [extended]);

  const shouldThrottle = (key, force = false) => {
    if (force) return false;
    const now = Date.now();
    const last = requestCooldowns.current[key] || 0;
    if (now - last < throttleMs) return true;
    requestCooldowns.current[key] = now;
    return false;
  };

  const isInFlight = (key) => Boolean(requestInFlight.current[key]);

  const markRequestStart = (key) => {
    requestInFlight.current[key] = true;
  };

  const markRequestEnd = (key) => {
    delete requestInFlight.current[key];
  };

  const addRecentSearch = (value) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    setRecentSearches((prev) => {
      const next = [
        cleaned,
        ...prev.filter(
          (item) => item.toLowerCase() !== cleaned.toLowerCase()
        ),
      ];
      return next.slice(0, maxRecent);
    });
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported in this browser.");
      return;
    }
    setIsLocating(true);
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const query = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        setInput(query);
        fetchWeather(query, { force: true });
        setIsLocating(false);
      },
      () => {
        setIsLocating(false);
        setGeoError("Unable to access your location. Check permissions.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  };

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
    const cached = weatherCache[cleaned];
    const isFresh = !force && cached && isCacheFresh(cached);
    if (cached && !isCacheFresh(cached)) {
      setWeatherCache((prev) => {
        if (!prev[cleaned]) return prev;
        const next = { ...prev };
        delete next[cleaned];
        return next;
      });
    }
    setGeoError("");
    setShowSuggestions(false);
    setActiveLocation(cleaned);
    if (isFresh) {
      setWeather(cached);
      recordSavedTemp(cleaned, cached);
      addRecentSearch(cleaned);
      setStatus("ready");
      setError("");
      return;
    }
    const throttleKey = `weather:${cleaned.toLowerCase()}`;
    if (isInFlight(throttleKey) || shouldThrottle(throttleKey, force)) {
      if (cached) {
        setWeather(cached);
        recordSavedTemp(cleaned, cached);
        addRecentSearch(cleaned);
        setStatus("ready");
        setError("");
      }
      return;
    }
    setStatus("loading");
    setError("");
    markRequestStart(throttleKey);
    try {
      const response = await fetch(
        `${apiUrl}/api/weather?query=${encodeURIComponent(cleaned)}`
      );
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Unable to fetch weather data");
      }
      const cachedData = { ...data, cachedAt: Date.now() };
      setWeather(cachedData);
      setWeatherCache((prev) => ({ ...prev, [cleaned]: cachedData }));
      recordSavedTemp(cleaned, cachedData);
      addRecentSearch(cleaned);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err.message || "Unable to fetch weather data");
    } finally {
      markRequestEnd(throttleKey);
    }
  };

  const fetchQuickTemperature = async (location) => {
    const cleaned = location.trim();
    if (!cleaned) return;
    const cached = weatherCache[cleaned];
    if (isCacheFresh(cached)) {
      recordSavedTemp(cleaned, cached);
      return;
    }
    const throttleKey = `quick:${cleaned.toLowerCase()}`;
    if (isInFlight(throttleKey) || shouldThrottle(throttleKey)) return;
    setLoadingTemps((prev) => ({ ...prev, [cleaned]: true }));
    markRequestStart(throttleKey);
    try {
      const response = await fetch(
        `${apiUrl}/api/weather?query=${encodeURIComponent(cleaned)}`
      );
      const data = await response.json();
      if (!response.ok || data?.error) {
        throw new Error(data?.error || "Unable to fetch weather data");
      }
      const cachedData = { ...data, cachedAt: Date.now() };
      setWeatherCache((prev) => ({ ...prev, [cleaned]: cachedData }));
      recordSavedTemp(cleaned, cachedData);
    } catch {
    } finally {
      setLoadingTemps((prev) => ({ ...prev, [cleaned]: false }));
      markRequestEnd(throttleKey);
    }
  };

  const showCachedWeather = (location) => {
    const cleaned = location.trim();
    if (!cleaned) return;
    const cached = weatherCache[cleaned];
    if (cached && isCacheFresh(cached)) {
      setActiveLocation(cleaned);
      setWeather(cached);
      addRecentSearch(cleaned);
      setStatus("ready");
      setError("");
      return;
    }
    fetchWeather(cleaned, { force: true });
  };

  const fetchExtended = async (location, { force = false } = {}) => {
    const cleaned = location.trim();
    if (!cleaned) return;
    const cached = extendedCache[cleaned];
    const isFresh = !force && cached && isCacheFresh(cached);
    if (cached && !isCacheFresh(cached)) {
      setExtendedCache((prev) => {
        if (!prev[cleaned]) return prev;
        const next = { ...prev };
        delete next[cleaned];
        return next;
      });
    }
    if (isFresh) {
      setExtendedData(cached);
      setExtendedStatus("ready");
      setExtendedError("");
      return;
    }
    const throttleKey = `extended:${cleaned.toLowerCase()}`;
    if (isInFlight(throttleKey) || shouldThrottle(throttleKey, force)) {
      if (cached) {
        setExtendedData(cached);
        setExtendedStatus("ready");
        setExtendedError("");
      }
      return;
    }
    setExtendedStatus("loading");
    setExtendedError("");
    markRequestStart(throttleKey);
    try {
      const response = await fetch(
        `${apiUrl}/api/weather/extended?query=${encodeURIComponent(cleaned)}`
      );
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Unable to fetch extended weather data");
      }
      const cachedData = { ...data, cachedAt: Date.now() };
      setExtendedData(cachedData);
      setExtendedCache((prev) => ({ ...prev, [cleaned]: cachedData }));
      setExtendedStatus("ready");
    } catch (err) {
      setExtendedStatus("error");
      setExtendedError(err.message || "Unable to fetch extended weather data");
    } finally {
      markRequestEnd(throttleKey);
    }
  };

  const locationLabel = weather?.location
    ? `${weather.location.name}, ${weather.location.country}`
    : status === "idle"
    ? "Waiting for a city"
    : activeLocation;
  const localTime = weather?.location?.localtime || "";
  const description = weather?.current?.weather_descriptions?.[0] || "";
  const descriptionLabel =
    description ||
    (status === "error"
      ? "Unable to load conditions"
      : status === "idle"
      ? "Search for a city to see live conditions."
      : "No description yet");
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
  const windValue =
    windSpeed === undefined || windSpeed === null
      ? "--"
      : `${formatSpeed(windSpeed, units.speed)} ${windDir || ""}`.trim();

  const metrics = [
    { label: "Wind", value: windValue },
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
  const statusMessage = (() => {
    if (geoError) return geoError;
    if (status === "loading") return "Gathering conditions...";
    if (status === "error")
      return `${error} Try another city or check your connection.`;
    if (status === "ready")
      return localTime ? `Local time ${localTime}` : "Weather updated";
    return "Search for a city or choose a quick location.";
  })();
  const suggestionItems = (() => {
    const needle = input.trim().toLowerCase();
    if (!needle) return [];
    const combined = [
      ...recentSearches,
      ...quickLocations,
      ...Object.keys(weatherCache),
    ];
    const seen = new Set();
    const results = [];
    for (const item of combined) {
      const cleaned = String(item).trim();
      if (!cleaned) continue;
      const lower = cleaned.toLowerCase();
      if (!lower.includes(needle) || lower === needle) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      results.push(cleaned);
      if (results.length >= 6) break;
    }
    return results;
  })();

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

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6 sm:pt-8">
        <nav
          aria-label="Location switcher"
          className="flex flex-col items-center justify-between gap-3 rounded-3xl border border-stone-200 bg-white/70 px-4 py-3 text-center text-xs uppercase tracking-[0.35em] text-stone-500 shadow-sm backdrop-blur-md animate-fade-in transition hover:-translate-y-0.5 hover:shadow-md sm:flex-row sm:items-center sm:gap-4 sm:rounded-full sm:px-5 sm:text-left dark:border-stone-800 dark:bg-neutral-900/70 dark:text-stone-400"
        >
          <span className="w-full text-[10px] tracking-[0.4em] sm:w-auto">
            Locations
          </span>
          <div className="flex w-full flex-wrap justify-center gap-2 sm:w-auto sm:justify-start">
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
            className="w-full rounded-full border border-stone-300 px-4 py-2 text-[10px] tracking-[0.35em] transition hover:border-stone-500 hover:text-stone-900 sm:w-auto dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400"
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

        <header className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-start justify-between gap-4 px-4 py-6 sm:flex-row sm:items-center sm:px-6">
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
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-2">
            <div className="flex w-full overflow-hidden rounded-full border border-stone-300 text-[10px] uppercase tracking-[0.3em] text-stone-600 dark:border-stone-700 dark:text-stone-300">
              <button
                type="button"
                onClick={() =>
                  setUnits((prev) => ({ ...prev, temp: "c" }))
                }
                aria-pressed={units.temp === "c"}
                className={`px-3 py-2 transition ${
                  units.temp === "c"
                    ? "bg-stone-900 text-stone-50 dark:bg-stone-50 dark:text-stone-900"
                    : "hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                C
              </button>
              <button
                type="button"
                onClick={() =>
                  setUnits((prev) => ({ ...prev, temp: "f" }))
                }
                aria-pressed={units.temp === "f"}
                className={`px-3 py-2 transition ${
                  units.temp === "f"
                    ? "bg-stone-900 text-stone-50 dark:bg-stone-50 dark:text-stone-900"
                    : "hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                F
              </button>
            </div>
            <div className="flex w-full overflow-hidden rounded-full border border-stone-300 text-[10px] uppercase tracking-[0.25em] text-stone-600 dark:border-stone-700 dark:text-stone-300">
              <button
                type="button"
                onClick={() =>
                  setUnits((prev) => ({ ...prev, speed: "kph" }))
                }
                aria-pressed={units.speed === "kph"}
                className={`px-3 py-2 transition ${
                  units.speed === "kph"
                    ? "bg-stone-900 text-stone-50 dark:bg-stone-50 dark:text-stone-900"
                    : "hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                km/h
              </button>
              <button
                type="button"
                onClick={() =>
                  setUnits((prev) => ({ ...prev, speed: "mph" }))
                }
                aria-pressed={units.speed === "mph"}
                className={`px-3 py-2 transition ${
                  units.speed === "mph"
                    ? "bg-stone-900 text-stone-50 dark:bg-stone-50 dark:text-stone-900"
                    : "hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                mph
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDarkMode((value) => !value)}
            className="w-full rounded-full border border-stone-300 px-4 py-2 text-xs uppercase tracking-[0.25em] transition hover:border-stone-500 hover:text-stone-800 sm:w-auto dark:border-stone-700 dark:text-stone-200 dark:hover:border-stone-400"
          >
            {darkMode ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-16 pt-4 sm:gap-16 sm:px-6 sm:pt-6">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="order-2 space-y-6 animate-fade-up lg:order-1">
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
                <div className="relative w-full flex-1">
                  <input
                    type="text"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
                    placeholder="Search a city"
                    autoComplete="off"
                    className="w-full rounded-full border border-stone-300 bg-white/70 px-5 py-3 text-sm text-stone-700 shadow-sm transition focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-neutral-900/60 dark:text-stone-100 dark:focus:border-stone-400"
                  />
                  {showSuggestions && suggestionItems.length ? (
                    <div className="absolute z-20 mt-2 w-full rounded-2xl border border-stone-200 bg-white/95 py-2 text-xs uppercase tracking-[0.2em] text-stone-600 shadow-xl backdrop-blur-md dark:border-stone-800 dark:bg-neutral-900/95 dark:text-stone-300">
                      <p className="px-4 pb-2 text-[10px] uppercase tracking-[0.3em] text-stone-400 dark:text-stone-500">
                        Suggestions
                      </p>
                      <div className="max-h-48 overflow-auto pb-1">
                        {suggestionItems.map((item) => (
                          <button
                            key={item}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setInput(item);
                              fetchWeather(item, { force: true });
                              setShowSuggestions(false);
                            }}
                            className="flex w-full items-center break-words px-4 py-2 text-left text-[10px] uppercase tracking-[0.25em] text-stone-600 transition hover:bg-stone-100/80 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800/70 dark:hover:text-stone-50"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <button
                  type="submit"
                  className="w-full rounded-full bg-stone-900 px-6 py-3 text-center text-xs uppercase tracking-[0.3em] text-stone-50 transition hover:bg-stone-700 sm:w-auto dark:bg-stone-50 dark:text-stone-900 dark:hover:bg-stone-200"
                >
                  Update
                </button>
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={isLocating}
                  className="w-full rounded-full border border-stone-300 px-5 py-3 text-center text-xs uppercase tracking-[0.3em] text-stone-600 transition hover:border-stone-500 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-400"
                >
                  {isLocating ? "Locating" : "Use my location"}
                </button>
              </div>
              <p className="text-xs uppercase tracking-[0.3em] text-stone-500 dark:text-stone-400">
                {statusMessage}
              </p>
              {lastUpdatedLabel ? (
                <p className="text-[10px] uppercase tracking-[0.3em] text-stone-400 dark:text-stone-500">
                  Last updated {lastUpdatedLabel}
                </p>
              ) : null}
              {recentSearches.length ? (
                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-stone-400 dark:text-stone-500">
                  <span>Recent</span>
                  {recentSearches.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setInput(item);
                        fetchWeather(item, { force: true });
                      }}
                      className="rounded-full border border-stone-200 px-3 py-1 text-[9px] uppercase tracking-[0.3em] text-stone-500 transition hover:border-stone-400 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-400 dark:hover:text-stone-200"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
            </form>
          </div>

          <div className="order-1 rounded-3xl border border-stone-200 bg-white/70 p-8 shadow-lg backdrop-blur-md animate-fade-in lg:order-2 dark:border-stone-800 dark:bg-neutral-900/70">
            {status === "loading" ? (
              <div className="space-y-6 animate-pulse">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-3">
                    <div className="h-3 w-36 rounded-full bg-stone-200/80 dark:bg-stone-800/70" />
                    <div className="h-6 w-48 rounded-full bg-stone-200/80 dark:bg-stone-800/70" />
                    <div className="h-4 w-40 rounded-full bg-stone-200/80 dark:bg-stone-800/70" />
                  </div>
                  <div className="h-14 w-14 rounded-full bg-stone-200/80 dark:bg-stone-800/70" />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-3">
                    <div className="h-10 w-28 rounded-full bg-stone-200/80 dark:bg-stone-800/70" />
                    <div className="h-4 w-32 rounded-full bg-stone-200/80 dark:bg-stone-800/70" />
                  </div>
                  <div className="h-4 w-20 rounded-full bg-stone-200/80 dark:bg-stone-800/70" />
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="h-3 w-24 rounded-full bg-stone-200/80 dark:bg-stone-800/70" />
                      <div className="h-3 w-16 rounded-full bg-stone-200/80 dark:bg-stone-800/70" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-stone-400">
                      Current Conditions
                    </p>
                    <h2 className="mt-3 break-words text-2xl font-semibold text-stone-800 dark:text-stone-100">
                      {locationLabel}
                    </h2>
                    <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                      {descriptionLabel}
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
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-4xl font-semibold text-stone-900 sm:text-5xl dark:text-stone-50">
                      {formatTemp(temperature, units.temp)}
                    </div>
                    <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                      Feels like {formatTemp(feelsLike, units.temp)}
                    </p>
                  </div>
                  <div className="text-right text-sm text-stone-500 dark:text-stone-400">
                    {status === "ready"
                      ? "Updated"
                      : status === "error"
                      ? "Weather unavailable"
                      : "Awaiting data"}
                  </div>
                </div>
                <div className="mt-8 space-y-4 text-sm text-stone-600 dark:text-stone-300">
                  {metrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="flex items-center justify-between"
                    >
                      <span>{metric.label}</span>
                      <span className="text-stone-900 dark:text-stone-100">
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
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
                const hasCachedWeather = Boolean(cached && isCacheFresh(cached));
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
                          {isLoading ? (
                            <div className="h-8 w-20 rounded-full bg-stone-200/80 dark:bg-stone-800/70 animate-pulse" />
                          ) : (
                            formatTemp(tempValue, units.temp)
                          )}
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
                      {isLoading
                        ? "Refreshing..."
                        : updatedLabel
                        ? `Last update ${updatedLabel}`
                        : "Load to enable view"}
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
        <div className="fixed inset-0 z-30 flex min-h-screen items-start justify-center overflow-y-auto bg-stone-950/80 px-4 py-6 text-stone-100 backdrop-blur-md sm:px-6 sm:py-10">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Extended outlook"
            className="relative w-full max-w-6xl rounded-3xl border border-stone-800 bg-neutral-950/90 p-5 shadow-2xl sm:p-8"
          >
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
                  ref={closeButtonRef}
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
                            {formatTemp(day.maxTemp, units.temp)}
                            <span className="text-stone-500">
                              {" / "}
                              {formatTemp(day.minTemp, units.temp)}
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
                            {formatTemp(day.maxTemp, units.temp)}
                            <span className="text-stone-500">
                              {" / "}
                              {formatTemp(day.minTemp, units.temp)}
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
