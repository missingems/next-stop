"use strict";

const APP_STORE_URL = "https://apps.apple.com/sg/search?term=Next%20Stop%20bus";
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SINGAPORE = [[103.52, 1.13], [104.12, 1.52]];
const LATITUDE = 1.35;
const METERS_PER_DEGREE = 111_320;
const FRAME_MS = 1000 / 30;

const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

const OPERATORS = { SBST: "#662480", SMRT: "#c7141a", TTS: "#0d666b", GAS: "#1a59c7" };
const LOADS = [
  { color: "#00ab35", weight: 6 },
  { color: "#ff9300", weight: 3 },
  { color: "#de2121", weight: 1 },
];

const SKIES = {
  clear: { title: "Fair", cloud: 0, rain: 0, haze: 0, wind: [0, 0] },
  partly: { title: "Partly Cloudy", cloud: 0.4, rain: 0, haze: 0, wind: [0, 0] },
  cloudy: { title: "Cloudy", cloud: 0.75, rain: 0, haze: 0, wind: [0, 0] },
  showers: { title: "Showers", cloud: 1, rain: 0.65, haze: 0, wind: [0, 0] },
  haze: { title: "Hazy", cloud: 0, rain: 0, haze: 0.7, wind: [0, 0] },
  windy: { title: "Windy", cloud: 0.35, rain: 0, haze: 0, wind: [6.5, -5.5] },
};
const RANDOM_SKIES = ["partly", "cloudy", "showers", "haze", "windy"];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
const pixelsPerMeter = (zoom) => (2 ** zoom * 512) / (40_075_016.686 * Math.cos((LATITUDE * Math.PI) / 180));
const toLocal = ([lng, lat]) => [
  (lng - 103.82) * METERS_PER_DEGREE * Math.cos((LATITUDE * Math.PI) / 180),
  (LATITUDE - lat) * METERS_PER_DEGREE,
];
const toLngLat = ([x, y]) => [103.82 + x / (METERS_PER_DEGREE * Math.cos((LATITUDE * Math.PI) / 180)), LATITUDE - y / METERS_PER_DEGREE];

function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (let axis = 0; axis < 2; axis++) {
      let shift = 0, result = 0, byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

// Map style: the app's day and night recolouring of OpenFreeMap Liberty.

const DAY_FILLS = { park: "#d3dfcb", landcover_wood: "#cadbbf", landcover_grass: "#d6e0cf", water: "#a5cdf5", landuse_residential: "#e6e5e2", building: "#d9d8d5" };
const NIGHT_FILLS = { park: "#1a2a1f", landcover_wood: "#1d3524", landcover_grass: "#1c3123", water: "#0e2135", landuse_residential: "#181d24", building: "#22262d" };
const BUILDING_POI_CLASSES = ["rail", "railway", "lodging", "hospital", "college", "school", "museum", "stadium", "town_hall", "place_of_worship", "library", "theatre", "cinema"];
const BUILDING_POI_SUBCLASSES = ["mall", "department_store"];
const HIDDEN_LAYERS = ["highway-shield-non-us", "highway-shield-us-interstate", "road_shield_us", "airport"];
const ROAD_METERS = [["motorway_link", 8], ["_link", 8], ["motorway", 14], ["trunk_primary", 16], ["secondary_tertiary", 12], ["minor", 8], ["street", 8], ["service_track", 5]];
const CURB_METERS = 2.5;
const ASPHALT = "#cfcecb";
const CURB = "#b9b8b5";
const METRIC_ZOOM = 16;
const MAXIMUM_ZOOM = 22;

function fading(color, target) {
  const source = Array.isArray(color) && color[0] === "interpolate" ? color[color.length - 1] : color;
  return ["interpolate", ["linear"], ["zoom"], 16, source, 17.5, target];
}

function evaluateStops(stops, base, zoom) {
  if (zoom <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (zoom >= last[0]) return last[1];
  const upper = stops.findIndex(([z]) => z >= zoom);
  const [z0, v0] = stops[upper - 1], [z1, v1] = stops[upper];
  const fraction = base === 1 ? (zoom - z0) / (z1 - z0) : (base ** (zoom - z0) - 1) / (base ** (z1 - z0) - 1);
  return v0 + (v1 - v0) * fraction;
}

function metricWidth(width, meters) {
  if (!Array.isArray(width) || width[0] !== "interpolate" || width.length < 5) return width;
  const base = width[1][1] ?? 1;
  const stops = [];
  for (let i = 3; i < width.length - 1; i += 2) stops.push([width[i], width[i + 1]]);
  const start = Math.max(evaluateStops(stops, base, METRIC_ZOOM), meters * pixelsPerMeter(METRIC_ZOOM));
  const result = ["interpolate", ["exponential", 2], ["zoom"]];
  for (const [zoom, value] of stops) if (zoom < METRIC_ZOOM) result.push(zoom, value);
  result.push(METRIC_ZOOM, start, MAXIMUM_ZOOM, start * 2 ** (MAXIMUM_ZOOM - METRIC_ZOOM));
  return result;
}

function themedStyle(source, dark) {
  const style = structuredClone(source);
  for (const layer of style.layers) {
    layer.paint ??= {};
    layer.layout ??= {};
    const sourceLayer = layer["source-layer"];

    if (layer.type === "symbol" && sourceLayer === "poi") {
      const building = ["any", ["in", ["get", "class"], ["literal", BUILDING_POI_CLASSES]], ["in", ["get", "subclass"], ["literal", BUILDING_POI_SUBCLASSES]]];
      layer.filter = layer.filter ? ["all", layer.filter, building] : building;
      delete layer.layout["icon-image"];
      layer.layout["text-anchor"] = "center";
      layer.layout["text-offset"] = [0, 0];
    }
    if (HIDDEN_LAYERS.includes(layer.id)) layer.layout.visibility = "none";

    if (layer.type === "line" && sourceLayer === "transportation") {
      const id = layer.id.replace("_casing", "");
      const road = ROAD_METERS.find(([suffix]) => id.endsWith(suffix));
      if (road) {
        const casing = layer.id.endsWith("_casing");
        layer.paint["line-width"] = metricWidth(layer.paint["line-width"], casing ? road[1] + CURB_METERS : road[1]);
        layer.paint["line-color"] = fading(layer.paint["line-color"], casing ? CURB : ASPHALT);
      }
    }

    if (dark) applyNight(layer, sourceLayer); else applyDay(layer, sourceLayer);
  }
  style.light = dark ? { anchor: "viewport", color: "#a9b8d6", intensity: 0.3 } : { anchor: "map", position: [1.4, 200, 35], color: "#ffffff", intensity: 0.55 };
  return style;
}

function applyDay(layer, sourceLayer) {
  const paint = layer.paint;
  switch (layer.type) {
    case "background":
      paint["background-color"] = "#e8e7e4";
      break;
    case "fill":
      if (layer.id === "road_area_pattern") break;
      paint["fill-color"] = DAY_FILLS[layer.id] ?? "#e8e7e4";
      paint["fill-outline-color"] = paint["fill-color"];
      break;
    case "fill-extrusion":
      paint["fill-extrusion-color"] = "#dddcd9";
      paint["fill-extrusion-vertical-gradient"] = true;
      break;
    case "line":
      if (sourceLayer === "transportation") {
        const casing = layer.id.endsWith("_casing"), path = layer.id.includes("path");
        const highway = layer.id.includes("motorway") || layer.id.includes("trunk");
        const surface = highway ? (casing ? "#e2b860" : "#f9d98b") : casing ? "#d6d2cb" : path ? "#e3dfd8" : "#ffffff";
        paint["line-color"] = fading(surface, casing ? CURB : ASPHALT);
      } else if (sourceLayer === "waterway") {
        paint["line-color"] = "#a5cdf5";
      } else {
        paint["line-color"] = "#cbc7c0";
      }
      break;
    case "symbol":
      paint["text-color"] = "#4f4f53";
      paint["text-halo-color"] = "#ffffff";
      break;
  }
}

function applyNight(layer, sourceLayer) {
  const paint = layer.paint;
  switch (layer.type) {
    case "background":
      paint["background-color"] = "#11161d";
      break;
    case "raster":
      layer.layout.visibility = "none";
      break;
    case "fill":
      paint["fill-color"] = NIGHT_FILLS[layer.id] ?? "#171c23";
      paint["fill-outline-color"] = paint["fill-color"];
      if (layer.id === "road_area_pattern") paint["fill-opacity"] = 0.12;
      break;
    case "fill-extrusion":
      paint["fill-extrusion-color"] = "#2a2f37";
      break;
    case "line":
      if (sourceLayer === "transportation") {
        const casing = layer.id.endsWith("_casing"), path = layer.id.includes("path");
        paint["line-color"] = casing ? "#1b1e23" : path ? "#4a4f57" : "#3a3e45";
      } else {
        paint["line-color"] = "#2a323d";
      }
      break;
    case "symbol":
      paint["text-color"] = "#c9d1db";
      paint["text-halo-color"] = "#0b0f14";
      break;
  }
}

// Weather: the app's presets, drawn as calm screen-space overlays and ground-anchored cloud shadows.

class Weather {
  constructor(map, canvas) {
    this.map = map;
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.sky = SKIES.clear;
    this.dark = false;
    this.drops = [];
    this.motes = [];
    this.gusts = [];
    this.moteClock = 0;
    this.gustClock = 0;
    this.started = performance.now();
    this.cloudSprites = Array.from({ length: 6 }, (_, i) => cloudSprite(i * 0.173 + 0.05));
    this.shadowWindow = null;
    this.resize();
  }

  get wind() {
    const [x, y] = this.sky.wind;
    return { x, y, speed: Math.hypot(x, y) };
  }

  resize() {
    const scale = Math.min(devicePixelRatio || 1, 2);
    this.scale = scale;
    this.width = innerWidth;
    this.height = innerHeight;
    this.canvas.width = Math.round(this.width * scale);
    this.canvas.height = Math.round(this.height * scale);
    this.context.setTransform(scale, 0, 0, scale, 0, 0);
    this.streakSprite = null;
  }

  set(sky, dark) {
    this.sky = sky;
    this.dark = dark;
    this.drops = [];
    this.motes = [];
    this.gusts = [];
    this.streakSprite = null;
    this.gustSprite = null;
    const shade = document.getElementById("shade");
    shade.style.background = dark ? "#000" : "rgb(56, 69, 87)";
    shade.style.opacity = String((sky.cloud * 0.08 + sky.rain * 0.16) * (dark ? 1.3 : 1));
    const haze = document.getElementById("haze");
    const tone = sky.haze > 0
      ? dark ? [140, 128, 107, 0.4] : [240, 230, 204, 0.7]
      : dark ? [128, 128, 128, 0.35] : [247, 247, 247, 0.8];
    const end = sky.haze > 0 ? 0.12 : 0;
    haze.style.background = `linear-gradient(rgba(${tone[0]},${tone[1]},${tone[2]},${tone[3]}) 0%, rgba(${tone[0]},${tone[1]},${tone[2]},${end}) 70%)`;
    haze.style.opacity = String(Math.max(sky.haze, sky.rain * 0.5));
    this.updateShadows(true);
    this.context.clearRect(0, 0, this.width, this.height);
  }

  get active() {
    return !reduceMotion && (this.sky.rain > 0 || this.sky.haze > 0 || this.wind.speed >= 5 || this.shadowAlpha > 0.01);
  }

  get shadowAlpha() {
    return this.dark ? 0 : this.sky.cloud * 0.28;
  }

  screenAngle(x, y) {
    return Math.atan2(y, x) - (this.map.getBearing() * Math.PI) / 180;
  }

  step(now, dt) {
    if (this.shadowAlpha > 0.01) this.updateShadows(false, now);
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    if (reduceMotion) return;
    if (this.sky.rain > 0) this.drawRain(ctx, dt);
    if (this.sky.haze > 0) this.drawMotes(ctx, dt);
    if (this.wind.speed >= 5) this.drawGusts(ctx, dt, now);
  }

  drawRain(ctx, dt) {
    const { x, y, speed } = this.wind;
    const toward = speed > 0.01 ? [x / speed, y / speed] : [0.8, 0.6];
    const lean = clamp(speed / 8, 0.22, 1.2) * 0.6;
    const angle = this.screenAngle(toward[0], toward[1]);
    const direction = [Math.cos(angle) * lean, 1];
    const length = Math.hypot(direction[0], direction[1]);
    direction[0] /= length;
    direction[1] /= length;
    const key = direction[0].toFixed(2);
    if (!this.streakSprite || this.streakKey !== key) {
      this.streakKey = key;
      const color = this.dark ? "rgba(191,204,224," : "rgba(41,56,77,";
      this.streakSprite = streakSprite(direction, 46, 1.5, color, this.scale);
    }
    const count = Math.round(110 * this.sky.rain * Math.min(1, (this.width * this.height) / (1200 * 800)) + 30 * this.sky.rain);
    while (this.drops.length < count) this.drops.push(this.newDrop(true));
    const alpha = (this.dark ? 0.5 : 0.42) * (0.6 + 0.4 * this.sky.rain) * 1.7;
    const sprite = this.streakSprite;
    for (let i = 0; i < this.drops.length; i++) {
      const drop = this.drops[i];
      drop.age += dt;
      if (drop.age >= drop.life) {
        this.drops[i] = this.newDrop(false);
        continue;
      }
      const fall = drop.age / drop.life;
      const px = drop.x + direction[0] * drop.speed * drop.age;
      const py = drop.y + direction[1] * drop.speed * drop.age;
      ctx.globalAlpha = alpha * drop.alpha * smoothstep(0, 0.12, fall) * (1 - smoothstep(0.85, 1, fall));
      ctx.drawImage(sprite.image, px - sprite.size / 2, py - sprite.size / 2, sprite.size * drop.scale, sprite.size * drop.scale);
    }
    ctx.globalAlpha = 1;
  }

  newDrop(anywhere) {
    return {
      x: Math.random() * (this.width + 120) - 60,
      y: Math.random() * (this.height + 80) - 120,
      speed: 520 + Math.random() * 260,
      life: 0.45 + Math.random() * 0.4,
      age: anywhere ? Math.random() * 0.6 : 0,
      scale: 0.75 + Math.random() * 0.5,
      alpha: 0.7 + Math.random() * 0.3,
    };
  }

  drawMotes(ctx, dt) {
    const { x, y } = this.wind;
    const angle = this.screenAngle(x, y);
    const drift = Math.min(Math.hypot(x, y), 10) * 0.6;
    this.moteClock += dt * 4 * this.sky.haze;
    while (this.moteClock >= 1 && this.motes.length < 60) {
      this.moteClock -= 1;
      const heading = Math.random() * Math.PI * 2, velocity = 8 + (Math.random() * 2 - 1) * 6;
      this.motes.push({
        x: Math.random() * this.width, y: Math.random() * this.height,
        vx: Math.cos(heading) * velocity, vy: Math.sin(heading) * velocity,
        age: 0, life: 10 + (Math.random() * 2 - 1) * 3,
        scale: Math.max(0.05, 0.3 + (Math.random() * 2 - 1) * 0.25),
      });
    }
    this.moteClock = Math.min(this.moteClock, 1);
    const color = this.dark ? "179,163,138" : "255,247,230";
    const baseAlpha = this.dark ? 0.5 : 0.8;
    this.motes = this.motes.filter((mote) => (mote.age += dt) < mote.life);
    for (const mote of this.motes) {
      mote.vx += Math.cos(angle) * drift * dt;
      mote.vy += Math.sin(angle) * drift * dt;
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
      const radius = 16 * (mote.scale + 0.09 * mote.age);
      const alpha = Math.max(0, baseAlpha - 0.07 * mote.age) * smoothstep(0, 0.8, mote.age);
      if (alpha <= 0) continue;
      const gradient = ctx.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, radius);
      gradient.addColorStop(0, `rgba(${color},${alpha})`);
      gradient.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(mote.x - radius, mote.y - radius, radius * 2, radius * 2);
    }
  }

  drawGusts(ctx, dt, now) {
    const { x, y, speed } = this.wind;
    const angle = this.screenAngle(x, y);
    const key = angle.toFixed(2);
    if (!this.gustSprite || this.gustKey !== key) {
      this.gustKey = key;
      this.gustSprite = gustSprite(angle, this.scale);
    }
    const gust = clamp((speed - 3) / 4, 0.6, 2);
    const pulse = [0.2, 1, 0.35, 1.7, 0.5, 0.2];
    const phase = (((now - this.started) / 9000) % 1) * (pulse.length - 1);
    const index = Math.floor(phase);
    const rate = (pulse[index] + (pulse[index + 1] - pulse[index]) * (phase - index)) * gust * 2.4;
    this.gustClock += dt * rate;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    while (this.gustClock >= 1) {
      this.gustClock -= 1;
      const along = Math.random() * 2 - 1;
      const reach = Math.hypot(this.width, this.height) / 2 + 80;
      const cx = this.width / 2 - cos * reach - sin * along * reach;
      const cy = this.height / 2 - sin * reach + cos * along * reach;
      this.gusts.push({ x: cx, y: cy, velocity: 420 + (Math.random() * 2 - 1) * 140, age: 0, life: 3.4, scale: 1 + (Math.random() * 2 - 1) * 0.4, alpha: 1 - Math.random() * 0.3 });
    }
    this.gusts = this.gusts.filter((streak) => (streak.age += dt) < streak.life);
    const color = this.dark ? 0.35 : 0.6;
    const sprite = this.gustSprite;
    for (const streak of this.gusts) {
      const distance = streak.velocity * streak.age;
      const size = sprite.size * streak.scale;
      ctx.globalAlpha = Math.max(0, streak.alpha - 0.18 * streak.age) * color;
      ctx.drawImage(sprite.image, streak.x + cos * distance - size / 2, streak.y + sin * distance - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  // Cloud shadows live in a world-anchored image under the labels, drifting with the wind.

  updateShadows(force, now = performance.now()) {
    const map = this.map;
    if (!this.ready) return;
    const alpha = this.shadowAlpha;
    if (alpha <= 0.01) {
      if (map.getLayer("cloud-shadow")) map.setLayoutProperty("cloud-shadow", "visibility", "none");
      return;
    }
    const { x, y, speed } = this.wind;
    const toward = speed > 0.01 ? [x / speed, y / speed] : [0.8, 0.6];
    const driftSpeed = Math.min(Math.max(speed, 1) * 6, 20);
    const seconds = (now - this.started) / 1000;
    const drift = [toward[0] * driftSpeed * seconds, toward[1] * driftSpeed * seconds];
    const centre = toLocal(map.getCenter().toArray());
    const existing = this.shadowWindow;
    const span = 9000;
    const stale = !existing || force || existing.sky !== this.sky ||
      Math.hypot(centre[0] - (existing.centre[0] + drift[0] - existing.drift[0]), centre[1] - (existing.centre[1] + drift[1] - existing.drift[1])) > 2200;
    if (stale) {
      this.shadowWindow = { centre, drift, sky: this.sky, url: renderShadows(this.cloudSprites, centre, drift, span, this.sky.cloud, alpha) };
    }
    const current = this.shadowWindow;
    const offset = [drift[0] - current.drift[0], drift[1] - current.drift[1]];
    const pixels = Math.hypot(offset[0] - (current.offset?.[0] ?? 0), offset[1] - (current.offset?.[1] ?? 0)) * pixelsPerMeter(map.getZoom());
    if (!stale && pixels < 0.6) return;
    current.offset = offset;
    const half = span / 2;
    const [cx, cy] = [current.centre[0] + offset[0], current.centre[1] + offset[1]];
    const coordinates = [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]].map(toLngLat);
    const source = map.getSource("cloud-shadow");
    if (!source) {
      map.addSource("cloud-shadow", { type: "image", url: current.url, coordinates });
      const layers = map.getStyle().layers;
      const above = layers.findIndex((layer) => layer.id === "building-3d");
      map.addLayer({ id: "cloud-shadow", type: "raster", source: "cloud-shadow", paint: { "raster-fade-duration": 0, "raster-resampling": "linear" } }, layers[above + 1]?.id);
    } else if (stale) {
      source.updateImage({ url: current.url, coordinates });
    } else {
      source.setCoordinates(coordinates);
    }
    map.setLayoutProperty("cloud-shadow", "visibility", "visible");
  }
}

function hash(n) {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

function noiseField(size, seed) {
  const field = new Float32Array(size * size);
  let weight = 0.5, salt = seed * 1000;
  for (const cells of [8, 16, 32]) {
    const lattice = Array.from({ length: cells * cells }, (_, i) => hash(i * 12.9898 + salt++ * 78.233));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, fy = (y / size) * cells;
        const x0 = Math.floor(fx) % cells, y0 = Math.floor(fy) % cells;
        const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
        const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const top = lattice[y0 * cells + x0] + (lattice[y0 * cells + x1] - lattice[y0 * cells + x0]) * sx;
        const bottom = lattice[y1 * cells + x0] + (lattice[y1 * cells + x1] - lattice[y1 * cells + x0]) * sx;
        field[y * size + x] += (top + (bottom - top) * sy) * weight;
      }
    }
    weight *= 0.5;
  }
  return (u, v) => {
    const fx = ((u % 1) + 1) % 1 * size, fy = ((v % 1) + 1) % 1 * size;
    const x0 = Math.floor(fx) % size, y0 = Math.floor(fy) % size;
    const x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const top = field[y0 * size + x0] + (field[y0 * size + x1] - field[y0 * size + x0]) * tx;
    const bottom = field[y1 * size + x0] + (field[y1 * size + x1] - field[y1 * size + x0]) * tx;
    return (top + (bottom - top) * ty) / 0.875;
  };
}

let sharedNoise;
function cloudSprite(seed) {
  sharedNoise ??= noiseField(128, 1);
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const lx = (x + 0.5) / (size / 2) - 1, ly = (y + 0.5) / (size / 2) - 1;
      const u = lx * 0.22 + seed * 7, v = ly * 0.22 + seed * 7;
      const detail = sharedNoise(u, v) * 0.7 + sharedNoise(u * 2.3 + 0.37, v * 2.3 + 0.37) * 0.3;
      const body = 1 - smoothstep(0.2, 1, Math.hypot(lx, ly * 1.2));
      const shape = smoothstep(0, 1, clamp((body * 1.25 + detail * 0.7 - 0.75) * 1.5, 0, 1)) * body;
      image.data[(y * size + x) * 4 + 3] = Math.round(shape * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function renderShadows(sprites, centre, drift, span, cloud, alpha) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const field = 30000;
  const metersPerPixel = span / size;
  const count = Math.round(200 * Math.min(cloud, 1));
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const n = i + 0.5;
    const seed = [hash(n * 4.13 + 0.3) * field + drift[0], hash(n * 6.71 + 0.9) * field + drift[1]];
    const wrapped = seed.map((value, axis) => centre[axis] + ((((value - centre[axis]) / field + 0.5) % 1 + 1) % 1 - 0.5) * field);
    const radius = (900 + (2400 - 900) * hash(n * 3.3 + 1.7)) / metersPerPixel;
    const px = (wrapped[0] - centre[0] + span / 2) / metersPerPixel;
    const py = (wrapped[1] - centre[1] + span / 2) / metersPerPixel;
    if (px < -radius || py < -radius || px > size + radius || py > size + radius) continue;
    ctx.drawImage(sprites[Math.floor(hash(n * 7.7) * sprites.length)], px - radius, py - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-in";
  const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.5);
  edge.addColorStop(0, "rgba(0,0,0,1)");
  edge.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);
  return canvas.toDataURL("image/png");
}

function streakSprite(direction, length, width, color, scale) {
  const size = Math.ceil(length + 4);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil(size * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const tail = [size / 2 - direction[0] * length / 2, size / 2 - direction[1] * length / 2];
  const head = [size / 2 + direction[0] * length / 2, size / 2 + direction[1] * length / 2];
  const gradient = ctx.createLinearGradient(tail[0], tail[1], head[0], head[1]);
  gradient.addColorStop(0, `${color}0)`);
  gradient.addColorStop(1, `${color}1)`);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(...tail);
  ctx.lineTo(...head);
  ctx.stroke();
  return { image: canvas, size };
}

function gustSprite(angle, scale) {
  const length = 120;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil(length * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const tail = [length / 2 - dx * length * 0.48, length / 2 - dy * length * 0.48];
  const head = [length / 2 + dx * length * 0.48, length / 2 + dy * length * 0.48];
  const gradient = ctx.createLinearGradient(tail[0], tail[1], head[0], head[1]);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.8, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(...tail);
  ctx.lineTo(...head);
  ctx.stroke();
  return { image: canvas, size: length };
}

// Buses: simulated services gliding along their real routes towards the stop.

const BUS_LENGTH = 12;
const APPROACH_METERS = 1500;
const AVERAGE_SPEED = 6;
const BUS_SVG = (operator) => `
<svg viewBox="0 0 30 120" aria-hidden="true">
  <rect x="3" y="6" width="28" height="116" rx="6" fill="rgba(0,0,0,0.22)"/>
  <rect x="1" y="1" width="28" height="116" rx="6" fill="#5ea53a" stroke="#3d7f22" stroke-width="2"/>
  <rect x="5" y="17" width="20" height="96" rx="4" fill="#eef1ea"/>
  <path d="M4 9 Q15 1 26 9 L26 14 L4 14 Z" fill="#26313d"/>
  <rect x="8" y="30" width="14" height="18" rx="3" fill="#d6dbd1"/>
  <rect x="8" y="72" width="14" height="22" rx="3" fill="#d6dbd1"/>
  <rect x="1.5" y="20" width="3" height="10" rx="1.5" fill="${operator}"/>
</svg>`;
const TAIL_SVG = `<svg class="tail" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 0 L16 11.5 L3.4 15.1 Q0 16.3 0.9 12.7 Z"/></svg>`;

class Route {
  constructor(data) {
    this.service = data.service;
    this.operator = OPERATORS[data.operator] ?? OPERATORS.GAS;
    this.stopAt = data.stopAt;
    this.points = decodePolyline(data.line).map(toLocal);
    this.distances = [0];
    for (let i = 1; i < this.points.length; i++) {
      const [ax, ay] = this.points[i - 1], [bx, by] = this.points[i];
      this.distances.push(this.distances[i - 1] + Math.hypot(bx - ax, by - ay));
    }
    this.length = this.distances[this.distances.length - 1];
  }

  at(distance) {
    const d = clamp(distance, 0, this.length);
    let low = 0, high = this.distances.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (this.distances[mid] <= d) low = mid; else high = mid;
    }
    const span = this.distances[high] - this.distances[low] || 1;
    const t = (d - this.distances[low]) / span;
    const [ax, ay] = this.points[low], [bx, by] = this.points[high];
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  }

  heading(distance) {
    const [ax, ay] = this.at(distance - 8), [bx, by] = this.at(distance + 8);
    return (Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI;
  }
}

function randomLoad() {
  let roll = Math.random() * LOADS.reduce((sum, load) => sum + load.weight, 0);
  return LOADS.find((load) => (roll -= load.weight) < 0) ?? LOADS[0];
}

class Bus {
  constructor(map, route, lane, start) {
    this.map = map;
    this.route = route;
    this.lane = lane;
    this.cruise = 8 + Math.random() * 3;
    this.element = document.createElement("div");
    this.element.className = "bus";
    this.element.innerHTML = BUS_SVG(route.operator);
    this.marker = new maplibregl.Marker({ element: this.element, rotationAlignment: "map", pitchAlignment: "map" });
    this.bubbleElement = document.createElement("div");
    this.bubbleElement.className = "bubble-anchor";
    this.bubbleElement.innerHTML = `<div class="bubble">${TAIL_SVG}<span class="plate" style="background:${route.operator}">${route.service}</span><span class="chip"></span></div>`;
    this.bubble = this.bubbleElement.firstElementChild;
    this.chip = this.bubble.querySelector(".chip");
    this.bubbleMarker = new maplibregl.Marker({ element: this.bubbleElement, anchor: "bottom-left" });
    this.spawn(this.entry + start * Math.max(0, this.stopPoint - 80 - this.entry));
  }

  get entry() {
    return Math.max(0, this.route.stopAt - APPROACH_METERS);
  }

  get stopPoint() {
    return this.route.stopAt - this.lane * 18;
  }

  spawn(distance) {
    this.distance = distance;
    this.speed = this.cruise;
    this.state = "driving";
    this.dwell = 0;
    this.served = false;
    this.load = randomLoad();
    this.chip.style.background = this.load.color;
    this.element.style.opacity = "1";
    this.bubbleVisible = true;
    this.crowded = false;
    this.applyBubbleOpacity();
    this.updateChip();
  }

  add() {
    const position = toLngLat(this.route.at(this.distance));
    this.marker.setLngLat(position).addTo(this.map);
    this.bubbleMarker.setLngLat(position).addTo(this.map);
  }

  remove() {
    this.marker.remove();
    this.bubbleMarker.remove();
  }

  get position() {
    return this.route.at(this.distance);
  }

  step(dt, others) {
    if (this.state === "gone") {
      this.wait -= dt;
      if (this.wait <= 0) this.spawn(this.entry);
      return;
    }
    if (this.state === "dwelling") {
      this.dwell -= dt;
      this.speed = 0;
      if (this.dwell <= 0) {
        this.state = "driving";
        this.served = true;
        this.bubbleVisible = false;
        this.applyBubbleOpacity();
      }
    } else {
      let target = this.cruise;
      const toStop = this.stopPoint - this.distance;
      if (!this.served && toStop > 0) target = Math.min(target, Math.sqrt(2 * 0.9 * toStop) + 0.4);
      const [x, y] = this.position;
      const heading = (this.route.heading(this.distance) * Math.PI) / 180;
      const forward = [Math.sin(heading), -Math.cos(heading)];
      for (const other of others) {
        if (other === this || other.state === "gone") continue;
        const [ox, oy] = other.position;
        const ahead = (ox - x) * forward[0] + (oy - y) * forward[1];
        const aside = Math.abs((ox - x) * forward[1] - (oy - y) * forward[0]);
        if (ahead > 0 && ahead < 26 && aside < 4) target = Math.min(target, Math.max(0, (ahead - 16) * 0.6), other.speed);
      }
      const rate = target > this.speed ? 0.8 : 2.2;
      this.speed += clamp(target - this.speed, -rate * dt, rate * dt);
      this.distance += this.speed * dt;
      if (!this.served && toStop <= 0.6) {
        this.state = "dwelling";
        this.dwell = 3 + Math.random() * 3;
      }
      if (this.distance >= this.route.length - 1) {
        this.state = "gone";
        this.wait = 4 + Math.random() * 16;
        this.element.style.opacity = "0";
        return;
      }
    }

    this.updateChip();
    const position = toLngLat(this.position);
    this.marker.setLngLat(position).setRotation(this.route.heading(this.distance));
    this.bubbleMarker.setLngLat(position);
  }

  updateChip() {
    const remaining = this.stopPoint - this.distance;
    const arriving = this.state === "dwelling" || remaining < 140;
    const text = arriving ? "Arr" : `${Math.max(1, Math.round(remaining / (AVERAGE_SPEED * 60)))}m`;
    if (text !== this.chipText) {
      this.chipText = text;
      this.chip.textContent = text;
      this.chip.classList.toggle("arriving", arriving);
    }
  }

  applyBubbleOpacity() {
    this.bubble.style.opacity = this.bubbleVisible && !this.crowded ? "1" : "0";
  }
}

// Trees: the app's canopy trees, planted along the streets around the stop.

const TREE_ROADS = { trunk: 9, primary: 9, secondary: 7, tertiary: 7, minor: 5 };
const TREE_SPACING = 15;
const TREE_RADIUS = 650;
const TREE_GREENS = { day: ["#6c9852", "#77a35c", "#62904b"], night: ["#1f3a26", "#24422b", "#1b3322"] };

function polygon(cx, cy, radius, sides, turn) {
  const ring = [];
  for (let i = 0; i <= sides; i++) {
    const angle = turn + (i % sides) / sides * Math.PI * 2;
    ring.push(toLngLat([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]));
  }
  return [ring];
}

function plantTrees(map, centre, planted) {
  const [ox, oy] = toLocal(centre);
  const roads = map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" });
  for (const road of roads) {
    const half = TREE_ROADS[road.properties.class];
    if (!half || road.properties.brunnel === "tunnel") continue;
    const lines = road.geometry.type === "LineString" ? [road.geometry.coordinates] : road.geometry.type === "MultiLineString" ? road.geometry.coordinates : [];
    for (const line of lines) {
      const points = line.map(toLocal);
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i];
        const length = Math.hypot(bx - ax, by - ay);
        if (length < 1) continue;
        const [nx, ny] = [-(by - ay) / length, (bx - ax) / length];
        for (let d = TREE_SPACING / 2; d < length - 4; d += TREE_SPACING) {
          const t = d / length;
          for (const side of [1, -1]) {
            const x = ax + (bx - ax) * t + nx * side * (half + 4.5);
            const y = ay + (by - ay) * t + ny * side * (half + 4.5);
            if (Math.hypot(x - ox, y - oy) > TREE_RADIUS) continue;
            const key = `${Math.round(x / 11)},${Math.round(y / 11)}`;
            if (!planted.has(key)) planted.set(key, [x, y]);
          }
        }
      }
    }
  }
}

function treeFeatures(planted, dark) {
  const features = [];
  const greens = dark ? TREE_GREENS.night : TREE_GREENS.day;
  let seed = 0;
  for (const [x, y] of planted.values()) {
    const r = 3.4 + hash(x * 0.37 + y * 0.11) * 1.4;
    const tall = 10 + hash(x * 0.13 - y * 0.29) * 3.5;
    const color = greens[seed++ % greens.length];
    const turn = hash(x + y) * Math.PI;
    features.push({ type: "Feature", properties: { kind: "shadow" }, geometry: { type: "Polygon", coordinates: polygon(x + r * 0.7, y - r * 0.5, r * 1.05, 10, turn) } });
    features.push({ type: "Feature", properties: { kind: "trunk", base: 0, top: tall * 0.45, color: dark ? "#3a342c" : "#7d6c58" }, geometry: { type: "Polygon", coordinates: polygon(x, y, 0.3, 4, turn) } });
    features.push({ type: "Feature", properties: { kind: "canopy", base: tall * 0.4, top: tall * 0.8, color }, geometry: { type: "Polygon", coordinates: polygon(x, y, r, 8, turn) } });
    features.push({ type: "Feature", properties: { kind: "canopy", base: tall * 0.8, top: tall, color }, geometry: { type: "Polygon", coordinates: polygon(x + r * 0.15, y + r * 0.1, r * 0.68, 7, turn + 0.4) } });
  }
  return { type: "FeatureCollection", features };
}

function showTrees(map, planted, dark) {
  const data = treeFeatures(planted, dark);
  const source = map.getSource("trees");
  if (source) return source.setData(data);
  map.addSource("trees", { type: "geojson", data });
  const extrusion = { "fill-extrusion-color": ["get", "color"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-vertical-gradient": true };
  map.addLayer({ id: "tree-shadows", type: "fill", source: "trees", filter: ["==", ["get", "kind"], "shadow"], paint: { "fill-color": "#000", "fill-opacity": dark ? 0.18 : 0.1, "fill-antialias": false } }, "building-3d");
  map.addLayer({ id: "tree-trunks", type: "fill-extrusion", source: "trees", minzoom: 15, filter: ["==", ["get", "kind"], "trunk"], paint: extrusion });
  map.addLayer({ id: "tree-canopy", type: "fill-extrusion", source: "trees", minzoom: 14, filter: ["==", ["get", "kind"], "canopy"], paint: extrusion });
}

// The scene: one random stop in one area, its buses and its arrivals panel, plus the weather.

const MAX_BUSES = 7;
const state = { map: null, weather: null, style: null, areas: [], area: null, stop: null, buses: [], rows: [], pins: [], youMarker: null, dark: false, sky: null, trees: new Map(), treesDirty: true };

function chooseArea(except) {
  const requested = state.areas.find((area) => area.key === params.get("area") || area.stops.some((stop) => stop.code === params.get("stop")));
  if (requested && !except) return requested;
  return pick(state.areas.filter((area) => area !== except));
}

function chooseStop(area, initial) {
  const requested = area.stops.find((stop) => stop.code === params.get("stop"));
  return requested && initial ? requested : pick(area.stops);
}

function chooseSky(except) {
  const requested = SKIES[params.get("weather")];
  if (requested && !except) return requested;
  return SKIES[pick(RANDOM_SKIES.filter((key) => SKIES[key] !== except))];
}

const BUS_GLYPH = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="14" rx="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M5.5 11h13" stroke="#fff" stroke-width="2"/><circle cx="8.5" cy="14.3" r="1.1" fill="#fff"/><circle cx="15.5" cy="14.3" r="1.1" fill="#fff"/><path d="M7.5 17.5v2.5M16.5 17.5v2.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;

function pinElement(stop) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "pin";
  element.setAttribute("aria-label", stop.name);
  element.innerHTML = `<span class="square">${BUS_GLYPH}</span><span class="label"><span class="dot">${BUS_GLYPH}</span><span class="name"></span></span>`;
  element.querySelector(".name").textContent = stop.name;
  element.addEventListener("click", () => {
    if (stop !== state.stop) showStop(state.area, stop, true);
  });
  return element;
}

function youElement() {
  const element = document.createElement("div");
  element.className = "you";
  element.innerHTML = `<span class="hint">You're here</span><span class="dot"></span>`;
  return element;
}

function trayInsets() {
  const tray = document.querySelector(".tray").getBoundingClientRect();
  return innerWidth >= 768
    ? { top: 60, bottom: 60, left: tray.right + 20, right: 60 }
    : { top: 70, bottom: innerHeight - tray.top + 30, left: 30, right: 30 };
}

function showStop(area, stop, fly) {
  const sameArea = state.area === area;
  state.area = area;
  state.stop = stop;
  for (const bus of state.buses) bus.remove();

  const approaching = stop.services.filter((entry) => entry.line);
  const simulated = approaching.length > MAX_BUSES ? [...approaching].sort(() => Math.random() - 0.5).slice(0, MAX_BUSES) : approaching;
  const corridors = new Map();
  state.buses = simulated.map((entry, index) => {
    const route = new Route(entry);
    const key = route.at(route.stopAt).map((v) => Math.round(v / 30)).join();
    const lane = corridors.get(key) ?? 0;
    corridors.set(key, lane + 1);
    return new Bus(state.map, route, lane % 3, (index + 0.2 + Math.random() * 0.6) / simulated.length);
  });
  state.buses.forEach((bus) => bus.add());
  buildPanel(stop);

  state.treesDirty = true;
  if (!sameArea || !state.pins.length) {
    state.trees = new Map();
    state.pins.forEach((pin) => pin.marker.remove());
    state.pins = area.stops.map((other) => {
      const marker = new maplibregl.Marker({ element: pinElement(other), anchor: "center" }).setLngLat(other.lngLat).addTo(state.map);
      return { stop: other, marker };
    });
    state.youMarker?.remove();
    const [sx, sy] = toLocal(stop.lngLat);
    state.youMarker = new maplibregl.Marker({ element: youElement(), anchor: "bottom", offset: [0, 11] }).setLngLat(toLngLat([sx - 95, sy + 45])).addTo(state.map);
  }
  for (const pin of state.pins) pin.marker.getElement().classList.toggle("selected", pin.stop === stop);

  const camera = {
    center: stop.lngLat,
    zoom: innerWidth < 768 ? 17.5 : 18,
    pitch: innerWidth < 768 ? 50 : 55,
    bearing: sameArea ? state.map.getBearing() : Math.round(Math.random() * 40 - 20),
    padding: trayInsets(),
  };
  if (fly && !reduceMotion) state.map.flyTo({ ...camera, duration: sameArea ? 1200 : 2600, essential: false });
  else state.map.jumpTo(camera);
  updateBusSize();
}

// The tray: the app's sheet at its smallest size, the stop and a timeline of the next buses.

const TIMELINE_MINUTES = 20;
const LANE_GAP = 6;
const MAX_LANES = 2;

const timelineX = (minutes) => Math.sqrt(clamp(minutes, 0, TIMELINE_MINUTES) / TIMELINE_MINUTES);

function buildPanel(stop) {
  const card = document.getElementById("stop");
  card.querySelector("b").textContent = stop.name;
  card.querySelector("code").textContent = stop.code;
  card.querySelector("i").textContent = stop.road;

  const plates = document.getElementById("plates");
  plates.replaceChildren();
  const now = performance.now() / 1000;
  state.rows = stop.services.map((entry) => {
    const plate = document.createElement("b");
    plate.className = "plate-time";
    plate.textContent = entry.service;
    plate.style.background = OPERATORS[entry.operator] ?? OPERATORS.GAS;
    plates.append(plate);
    return {
      entry,
      plate,
      bus: state.buses.find((bus) => bus.route.service === entry.service),
      headway: 420 + Math.random() * 480,
      offset: now + Math.random() * 1100,
      lane: -1,
    };
  });
  updatePanel();
}

function firstArrival(row, now) {
  const bus = row.bus;
  if (bus) {
    if (bus.state === "dwelling") return 0;
    if (bus.state !== "gone" && !bus.served) {
      const remaining = bus.stopPoint - bus.distance;
      return remaining < 140 ? 0 : Math.max(60, remaining / AVERAGE_SPEED);
    }
    const wait = bus.state === "gone" ? Math.max(0, bus.wait) : (bus.route.length - bus.distance) / Math.max(bus.cruise, 1) + 5;
    return wait + (bus.stopPoint - bus.entry) / AVERAGE_SPEED;
  }
  return ((((row.offset - now) % row.headway) + row.headway) % row.headway) + 180;
}

function updatePanel() {
  const now = performance.now() / 1000;
  const track = document.getElementById("plates").clientWidth;
  const lanes = [];
  const placed = state.rows
    .map((row) => ({ row, minutes: firstArrival(row, now) / 60 }))
    .filter((item) => item.minutes <= TIMELINE_MINUTES)
    .sort((a, b) => a.minutes - b.minutes);
  const shown = new Set();
  for (const { row, minutes } of placed) {
    row.width ||= row.plate.offsetWidth || 44;
    const half = row.width / 2;
    const centre = clamp(timelineX(minutes) * track, half + 16, track - half);
    const lane = lanes.findIndex((right) => right + LANE_GAP <= centre - half);
    const index = lane === -1 ? lanes.length : lane;
    if (index >= MAX_LANES) continue;
    lanes[index] = centre + half;
    shown.add(row);
    row.plate.style.transform = `translate(${(centre - half).toFixed(1)}px, ${index * 100}%) translateY(${index * 4}px)`;
    if (row.lane === -1) row.plate.getBoundingClientRect();
    row.lane = index;
  }
  for (const row of state.rows) {
    row.plate.classList.toggle("shown", shown.has(row));
    if (!shown.has(row)) row.lane = -1;
  }
}

function setSky(sky) {
  state.sky = sky;
  state.weather.set(sky, state.dark);
}

function updateBusSize() {
  const zoom = state.map.getZoom();
  const floor = 34 * clamp((zoom - 13) / 2.5, 0.35, 1);
  const pixels = Math.max(BUS_LENGTH * pixelsPerMeter(zoom), floor);
  document.documentElement.style.setProperty("--bus-l", `${pixels.toFixed(1)}px`);
  document.documentElement.style.setProperty("--bus-w", `${(pixels * 0.27).toFixed(1)}px`);
  document.documentElement.classList.toggle("far", zoom < 14.5);
  const reach = pixels * 0.36;
  for (const bus of state.buses) bus.bubbleMarker.setOffset([reach * 0.4 + 4, -reach * 0.9 - 4]);
}

function updateCrowding() {
  const rects = [];
  const ordered = [...state.buses].filter((bus) => bus.state !== "gone" && bus.bubbleVisible)
    .sort((a, b) => (a.stopPoint - a.distance) - (b.stopPoint - b.distance));
  for (const bus of ordered) {
    const rect = bus.bubble.getBoundingClientRect();
    const crowded = rects.some((other) => rect.left < other.right + 2 && rect.right > other.left - 2 && rect.top < other.bottom + 2 && rect.bottom > other.top - 2);
    if (!crowded) rects.push(rect);
    if (crowded !== bus.crowded) {
      bus.crowded = crowded;
      bus.applyBubbleOpacity();
    }
  }
  for (const bus of state.buses) {
    if (!ordered.includes(bus) && bus.crowded) {
      bus.crowded = false;
      bus.applyBubbleOpacity();
    }
  }
}

function applyTheme(dark) {
  state.dark = dark;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  state.weather.ready = false;
  state.map.setStyle(themedStyle(state.style, dark));
  state.map.once("style.load", () => {
    showTrees(state.map, state.trees, dark);
    state.weather.ready = true;
    state.weather.set(state.sky, dark);
  });
}

async function start() {
  for (const link of document.querySelectorAll("[data-download]")) link.href = APP_STORE_URL;

  const [style, data] = await Promise.all([
    fetch(STYLE_URL).then((response) => response.json()),
    fetch("data/areas.json").then((response) => response.json()),
  ]);
  state.style = style;
  state.areas = data.areas.filter((area) => area.stops.length);
  const theme = params.get("theme");
  state.dark = theme ? theme === "dark" : darkQuery.matches;
  document.documentElement.dataset.theme = state.dark ? "dark" : "light";

  const area = chooseArea();
  const stop = chooseStop(area, true);
  const map = new maplibregl.Map({
    container: "map",
    style: themedStyle(style, state.dark),
    center: stop.lngLat,
    zoom: 16,
    pitch: 55,
    maxBounds: [[SINGAPORE[0][0] - 0.1, SINGAPORE[0][1] - 0.1], [SINGAPORE[1][0] + 0.1, SINGAPORE[1][1] + 0.1]],
    maxZoom: 19.5,
    minZoom: 11,
    attributionControl: false,
    maplibreLogo: false,
    fadeDuration: 0,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  state.map = map;
  state.weather = new Weather(map, document.getElementById("weather"));

  showStop(area, stop, false);
  map.on("zoom", updateBusSize);
  map.on("sourcedata", (event) => {
    if (event.sourceId === "openmaptiles" && event.isSourceLoaded) state.treesDirty = true;
  });
  map.on("idle", () => {
    if (!state.treesDirty || !map.getLayer("building-3d")) return;
    state.treesDirty = false;
    const before = state.trees.size;
    plantTrees(map, state.stop.lngLat, state.trees);
    if (state.trees.size !== before || !map.getSource("trees")) showTrees(map, state.trees, state.dark);
  });
  map.once("style.load", () => {
    state.weather.ready = true;
    setSky(chooseSky());
  });

  document.getElementById("shuffle").addEventListener("click", () => {
    const stops = state.areas.flatMap((area) => area.stops.map((stop) => [area, stop])).filter(([, stop]) => stop !== state.stop);
    const [next, stop] = pick(stops);
    showStop(next, stop, true);
    setSky(chooseSky(state.sky));
  });
  if (!theme) darkQuery.addEventListener("change", (event) => applyTheme(event.matches));
  addEventListener("resize", () => {
    state.weather.resize();
    map.setPadding(trayInsets());
  });

  let last = performance.now(), frame = 0, running = true;
  const tick = (now) => {
    if (!running) return;
    requestAnimationFrame(tick);
    if (now - last < FRAME_MS - 2) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    for (const bus of state.buses) bus.step(dt, state.buses);
    if (++frame % 6 === 0) updateCrowding();
    if (frame % 30 === 0) updatePanel();
    state.weather.step(now, dt);
  };
  requestAnimationFrame(tick);
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      last = performance.now();
      requestAnimationFrame(tick);
    }
  });
}

start().catch((error) => console.error(error));
