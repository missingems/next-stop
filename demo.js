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

// Scenery: the app's 3D trees (MapScenery, MapSceneryMesh and SceneryShaders.metal), drawn in
// the map's depth buffer so buildings and trees hide each other.

const SCENERY_RADIUS = 900;
const SCENERY_FADE = 200;
const MAXIMUM_TREES = 12000;
const STOP_CLEARANCE = 6;
const ROAD_HALF_WIDTHS = { motorway: 7, trunk: 8, primary: 8, secondary: 6, tertiary: 6, minor: 4, service: 2.5 };
const LINED_ROADS = new Set(["trunk", "primary", "secondary", "tertiary", "minor"]);
const unit3 = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const DAY_SUN = unit3([Math.cos(1.42) * 0.9, Math.max(Math.sin(1.42), 0.35), -0.35]);
const NIGHT_SUN = unit3([0.45, 0.8, -0.4]);

function sceneryHash(x, y) {
  let h = Math.imul(Math.round(x / 0.5), 73856093) ^ Math.imul(Math.round(y / 0.5), 19349663);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

class Grid {
  constructor(cell) { this.cell = cell; this.buckets = new Map(); }
  key(x, y) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`; }
  insert(item, lowX, lowY, highX, highY) {
    for (let x = Math.floor(lowX / this.cell); x <= Math.floor(highX / this.cell); x++) {
      for (let y = Math.floor(lowY / this.cell); y <= Math.floor(highY / this.cell); y++) {
        const key = `${x},${y}`;
        if (!this.buckets.has(key)) this.buckets.set(key, []);
        this.buckets.get(key).push(item);
      }
    }
  }
  nearby(x, y) {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell), found = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const bucket = this.buckets.get(`${cx + i},${cy + j}`);
      if (bucket) found.push(...bucket);
    }
    return found;
  }
}

function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance(x, y, segment) {
  const [ax, ay, bx, by] = segment;
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const t = length ? clamp(((x - ax) * dx + (y - ay) * dy) / length, 0, 1) : 0;
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

// The app's placement: real crowns from the canopy-height index, then street trees every 11 m
// along lined roads, kept clear of carriageways, buildings and other trees.
function generateTrees(frame, roads, buildings, crowns, stops) {
  const coverage = new Set();
  const cover = (lowX, lowY, highX, highY) => {
    for (let x = Math.floor(Math.max(lowX, -SCENERY_RADIUS - 60) / 120); x <= Math.floor(Math.min(highX, SCENERY_RADIUS + 60) / 120); x++) {
      for (let y = Math.floor(Math.max(lowY, -SCENERY_RADIUS - 60) / 120); y <= Math.floor(Math.min(highY, SCENERY_RADIUS + 60) / 120); y++) coverage.add(`${x},${y}`);
    }
  };
  const covered = (x, y) => coverage.has(`${Math.floor(x / 120)},${Math.floor(y / 120)}`);
  const reach = SCENERY_RADIUS + 60;

  const segments = new Grid(30), lined = [];
  for (const road of roads) {
    const points = road.points;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      if (Math.hypot(ax, ay) > reach && Math.hypot(bx, by) > reach) continue;
      const segment = [ax, ay, bx, by, road.halfWidth];
      segments.insert(segment, Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
      cover(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
      if (road.lined) lined.push(segment);
    }
  }
  const footprints = new Grid(30);
  for (const ring of buildings) {
    if (!ring.some(([x, y]) => Math.hypot(x, y) < reach)) continue;
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const low = [Math.min(...xs), Math.min(...ys)], high = [Math.max(...xs), Math.max(...ys)];
    if (Math.hypot(high[0] - low[0], high[1] - low[1]) >= 400) continue;
    footprints.insert(ring, low[0], low[1], high[0], high[1]);
    cover(low[0], low[1], high[0], high[1]);
  }
  const insideBuilding = (x, y) => footprints.nearby(x, y).some((ring) => insideRing(x, y, ring));
  const roadClearance = (x, y) => segments.nearby(x, y).reduce((best, s) => Math.min(best, segmentDistance(x, y, s) - s[4]), Infinity);
  const hash = (x, y) => sceneryHash(x + frame.absolute[0], y + frame.absolute[1]);
  const key = (x, y) => [Math.floor((x + frame.absolute[0]) / 7), Math.floor((y + frame.absolute[1]) / 7)];

  const real = [], realGrid = new Grid(10);
  for (const [x, y, height, radius] of crowns) {
    if (Math.hypot(x, y) > SCENERY_RADIUS || !covered(x, y) || roadClearance(x, y) <= 0.5 || insideBuilding(x, y)) continue;
    const scale = clamp(height / 4 / 8, 0.45, 2.4);
    real.push({ x, y, hash: hash(x, y), scale, width: clamp(radius / 4 / 3.1 / scale, 0.7, 1.8) });
    realGrid.insert([x, y], x, y, x, y);
  }
  const nearReal = (x, y, distance) => realGrid.nearby(x, y).some(([rx, ry]) => Math.hypot(rx - x, ry - y) < distance);

  const candidates = new Map();
  const offer = (x, y, scale) => {
    if (Math.hypot(x, y) >= SCENERY_RADIUS) return;
    const h = hash(x, y), k = key(x, y).join();
    const existing = candidates.get(k);
    if (existing && existing.hash <= h) return;
    candidates.set(k, { x, y, hash: h, scale, width: 1 });
  };
  for (const [ax, ay, bx, by, halfWidth] of lined) {
    const length = Math.hypot(bx - ax, by - ay);
    if (length <= 1) continue;
    const ux = (bx - ax) / length, uy = (by - ay) / length;
    for (let distance = 5.5; distance < length; distance += 11) {
      for (const side of [-1, 1]) {
        const px = ax + ux * distance - uy * side * (halfWidth + 2.2);
        const py = ay + uy * distance + ux * side * (halfWidth + 2.2);
        const jitter = (hash(px, py) % 1000) / 1000;
        const x = px + ux * (jitter - 0.5) * 3, y = py + uy * (jitter - 0.5) * 3;
        if (roadClearance(x, y) > 1.2 && !insideBuilding(x, y) && !nearReal(x, y, 8)) offer(x, y, 0.85 + jitter * 0.4);
      }
    }
  }

  let trees = [...candidates.values()].filter((tree) => {
    const [kx, ky] = key(tree.x, tree.y);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const other = (i || j) && candidates.get(`${kx + i},${ky + j}`);
      if (other && other.hash < tree.hash && Math.hypot(other.x - tree.x, other.y - tree.y) < 4.5) return false;
    }
    return true;
  }).concat(real).filter((tree) => !stops.some(([sx, sy]) => Math.hypot(sx - tree.x, sy - tree.y) < STOP_CLEARANCE));
  if (trees.length > MAXIMUM_TREES) trees = trees.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)).slice(0, MAXIMUM_TREES);
  return trees;
}

class MeshBuilder {
  constructor() { this.vertices = []; this.indices = []; }

  quad(corners, normal, material) {
    const base = this.vertices.length / 8;
    for (const c of corners) this.vertices.push(c[0], c[1], c[2], material, normal[0], normal[1], normal[2], 0);
    this.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  prism(height, bottom, top, sides, material) {
    for (let side = 0; side < sides; side++) {
      const a = side / sides * Math.PI * 2, b = (side + 1) / sides * Math.PI * 2, m = (a + b) / 2;
      this.quad([
        [Math.cos(a) * bottom, 0, Math.sin(a) * bottom], [Math.cos(a) * top, height, Math.sin(a) * top],
        [Math.cos(b) * bottom, 0, Math.sin(b) * bottom], [Math.cos(b) * top, height, Math.sin(b) * top],
      ], unit3([Math.cos(m), (bottom - top) / height, Math.sin(m)]), material);
    }
  }

  blob(center, radius, subdivisions, material) {
    const t = (1 + Math.sqrt(5)) / 2;
    const points = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(unit3);
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let level = 0; level < subdivisions; level++) {
      const midpoints = new Map();
      const midpoint = (a, b) => {
        const k = `${Math.min(a, b)},${Math.max(a, b)}`;
        if (!midpoints.has(k)) {
          points.push(unit3(points[a].map((v, i) => v + points[b][i])));
          midpoints.set(k, points.length - 1);
        }
        return midpoints.get(k);
      };
      faces = faces.flatMap(([a, b, c]) => {
        const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
      });
    }
    const base = this.vertices.length / 8;
    for (const p of points) {
      const normal = unit3(p.map((v, i) => v / radius[i]));
      this.vertices.push(center[0] + p[0] * radius[0], center[1] + p[1] * radius[1], center[2] + p[2] * radius[2], material, ...normal, 0);
    }
    for (const face of faces) this.indices.push(...face.map((i) => base + i));
  }
}

function treeMesh() {
  const builder = new MeshBuilder();
  builder.prism(4.2, 0.24, 0.14, 6, 0);
  builder.blob([0, 5.6, 0], [3.1, 2.1, 3.1], 1, 1);
  builder.blob([1.2, 6.6, -0.7], [1.9, 1.4, 1.9], 0, 1);
  builder.blob([-1.3, 6.3, 0.9], [1.7, 1.3, 1.7], 0, 1);
  return builder;
}

function treeShadowMesh() {
  const builder = new MeshBuilder();
  builder.prism(4.2, 0.24, 0.14, 5, 0);
  builder.blob([0, 5.9, 0], [3.3, 2.2, 3.3], 1, 1);
  return builder;
}

const SCENERY_COMMON = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_position;
layout(location = 1) in vec4 a_normal;
layout(location = 2) in vec4 a_placement;
layout(location = 3) in vec4 a_extra;
uniform mat4 u_matrix;
uniform vec4 u_light, u_focus, u_options, u_sky, u_wind;
vec2 rotate2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
float sceneryFade(vec2 p) { return (1.0 - smoothstep(u_focus.w, u_options.x, distance(p, u_focus.xz))) * u_options.z; }
float sceneryAppear(vec4 placement) {
  vec2 cell = floor(placement.xz * 0.37);
  float stagger = fract(sin(dot(fract(cell * 0.0137), vec2(12.9898, 78.233))) * 43758.5453);
  float progress = (u_options.w - placement.y) / 0.9;
  return smoothstep(0.0, 1.0, clamp(progress * 1.5 - stagger * 0.5, 0.0, 1.0));
}
vec3 sceneryPlace() {
  float seed = a_extra.y;
  vec3 local = a_position.xyz;
  if (a_position.w == 1.0) {
    float wobble = sin(local.x * 1.7 + seed * 40.0) * sin(local.y * 2.3 + seed * 17.0) * sin(local.z * 1.9 + seed * 29.0);
    local += a_normal.xyz * wobble * 0.45;
    local.xz *= a_extra.z;
  }
  float scale = a_extra.x;
  vec3 world = vec3(a_placement.x, local.y * scale, a_placement.z);
  world.xz += rotate2(local.xz, a_placement.w) * scale;
  float speed = length(u_wind.xy);
  if (a_position.w == 1.0 && speed > 0.5) {
    float time = u_options.w;
    float strength = clamp((speed - 3.0) / 7.0, 0.0, 1.0);
    float gust = 0.55 + 0.45 * sin(time * 0.6 + seed * 6.0);
    float sway = (0.5 + 0.5 * sin(time * 2.1 + seed * 31.0 + local.y * 0.3)) * gust;
    world.xz += u_wind.xy / speed * strength * sway * 1.8 * clamp(local.y / 8.0, 0.0, 1.0) * scale;
  }
  return world;
}
vec4 project(vec3 world) { return u_matrix * vec4(world.x, world.z, world.y, 1.0); }
`;

const SCENERY_VERTEX = SCENERY_COMMON + `
out vec3 v_normal;
out float v_material, v_seed, v_height, v_visibility;
void main() {
  gl_Position = project(sceneryPlace());
  v_normal = vec3(0.0, a_normal.y, 0.0);
  v_normal.xz = rotate2(a_normal.xz, a_placement.w);
  v_material = a_position.w;
  v_seed = a_extra.y;
  v_height = a_position.y;
  v_visibility = sceneryFade(a_placement.xz) * sceneryAppear(a_placement);
}`;

const SCENERY_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 u_light, u_sky;
in vec3 v_normal;
in float v_material, v_seed, v_height, v_visibility;
out vec4 fragColor;
vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
void main() {
  float threshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (v_visibility < 0.999 && v_visibility <= threshold) discard;
  float night = u_light.w;
  vec3 color;
  if (v_material < 0.5) {
    color = vec3(0.34, 0.26, 0.20);
  } else {
    vec3 low = mix(vec3(0.13, 0.27, 0.11), vec3(0.20, 0.33, 0.12), v_seed);
    vec3 high = mix(vec3(0.27, 0.45, 0.17), vec3(0.36, 0.50, 0.20), fract(v_seed * 7.0));
    color = mix(low, high, smoothstep(3.6, 7.8, v_height));
  }
  vec3 normal = normalize(v_normal);
  float sun = clamp(dot(normal, u_light.xyz), 0.0, 1.0);
  float sky = 0.55 + 0.45 * clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
  float daylight = 1.0 - night * 0.7;
  vec3 lit = color * (sky * mix(0.62, 0.16, night) + sun * 0.55 * daylight * u_sky.rgb);
  fragColor = vec4(encode(lit), 1.0);
}`;

const CAST_VERTEX = SCENERY_COMMON + `
out float v_opacity;
void main() {
  vec3 world = sceneryPlace();
  vec3 sun = u_light.xyz;
  vec2 ground = world.xz - sun.xz / max(sun.y, 0.45) * max(world.y, 0.0);
  gl_Position = project(vec3(ground.x, 0.03, ground.y));
  v_opacity = 0.26 * (1.0 - u_light.w * 0.85) * (1.0 - u_wind.w * 0.65) * sceneryFade(a_placement.xz) * sceneryAppear(a_placement);
}`;

const CAST_FRAGMENT = `#version 300 es
precision highp float;
in float v_opacity;
out vec4 fragColor;
void main() { fragColor = vec4(0.0, 0.0, 0.0, v_opacity); }`;

class SceneryLayer {
  constructor() {
    this.id = "scenery";
    this.type = "custom";
    this.renderingMode = "3d";
    this.count = 0;
    this.anchor = null;
    this.epoch = performance.now();
    this.wind = [0, 0];
    this.overcast = 0;
    this.dark = false;
  }

  get now() { return (performance.now() - this.epoch) / 1000; }

  onAdd(map, gl) {
    this.map = map;
    const program = (vertex, fragment) => {
      const result = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(result, shader);
      }
      gl.linkProgram(result);
      if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
      const uniforms = {};
      for (const name of ["u_matrix", "u_light", "u_focus", "u_options", "u_sky", "u_wind"]) uniforms[name] = gl.getUniformLocation(result, name);
      return { program: result, uniforms };
    };
    this.scenery = program(SCENERY_VERTEX, SCENERY_FRAGMENT);
    this.cast = program(CAST_VERTEX, CAST_FRAGMENT);
    this.instanceBuffer = gl.createBuffer();
    const mesh = (builder) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(builder.vertices), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      for (const [location, offset] of [[2, 0], [3, 16]]) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 32, offset);
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(builder.indices), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: builder.indices.length };
    };
    this.tree = mesh(treeMesh());
    this.shadow = mesh(treeShadowMesh());
    this.gl = gl;
    if (this.pending) this.upload(this.pending);
  }

  setTrees(anchor, trees, births) {
    this.anchor = anchor;
    const now = this.now;
    const data = new Float32Array(trees.length * 8);
    trees.forEach((tree, i) => {
      const seed = (tree.hash % 10000) / 10000;
      const k = `${Math.round(tree.x)},${Math.round(tree.y)}`;
      if (!births.has(k)) births.set(k, now);
      data.set([tree.x, births.get(k), tree.y, seed * Math.PI * 2, tree.scale, seed, tree.width, 0], i * 8);
    });
    if (this.gl) this.upload(data); else this.pending = data;
  }

  upload(data) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = data.length / 8;
    this.pending = null;
    this.map.triggerRepaint();
  }

  render(gl, options) {
    const zoom = this.map.getZoom();
    const grow = clamp((zoom - 14.6) / (15.2 - 14.6), 0, 1);
    if (!this.count || !this.anchor || grow <= 0) return;
    const scale = this.anchor.meterInMercatorCoordinateUnits();
    const local = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, this.anchor.x, this.anchor.y, 0, 1];
    const matrix = multiply(options.defaultProjectionData.mainMatrix, local);
    const now = this.now;
    const sun = this.dark ? NIGHT_SUN : DAY_SUN;
    const setUniforms = ({ program, uniforms }) => {
      gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.u_matrix, false, matrix);
      gl.uniform4f(uniforms.u_light, sun[0], sun[1], sun[2], this.dark ? 1 : 0);
      gl.uniform4f(uniforms.u_focus, 0, 0, 0, SCENERY_RADIUS - SCENERY_FADE);
      gl.uniform4f(uniforms.u_options, SCENERY_RADIUS, 1, grow, now);
      gl.uniform4f(uniforms.u_sky, 1, 1, 1, 0);
      gl.uniform4f(uniforms.u_wind, this.wind[0], this.wind[1], 0, this.overcast);
    };
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.DEPTH_TEST);

    setUniforms(this.cast);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.bindVertexArray(this.shadow.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.shadow.count, gl.UNSIGNED_SHORT, 0, this.count);

    setUniforms(this.scenery);
    gl.disable(gl.BLEND);
    gl.depthFunc(gl.LEQUAL);
    gl.bindVertexArray(this.tree.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.tree.count, gl.UNSIGNED_SHORT, 0, this.count);
    gl.bindVertexArray(null);

    if (now - this.latestBirth < 1.5 || Math.hypot(...this.wind) > 3) this.map.triggerRepaint();
  }
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function collectScenery(map, anchor) {
  const scale = anchor.meterInMercatorCoordinateUnits();
  const local = ([lng, lat]) => {
    const point = maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
    return [(point.x - anchor.x) / scale, (point.y - anchor.y) / scale];
  };
  const roads = [];
  for (const feature of map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" })) {
    const halfWidth = ROAD_HALF_WIDTHS[feature.properties.class];
    if (!halfWidth) continue;
    const { type, coordinates } = feature.geometry;
    const lines = type === "LineString" ? [coordinates] : type === "MultiLineString" ? coordinates : [];
    for (const line of lines) roads.push({ points: line.map(local), halfWidth, lined: LINED_ROADS.has(feature.properties.class) });
  }
  const buildings = [];
  for (const feature of map.querySourceFeatures("openmaptiles", { sourceLayer: "building" })) {
    const { type, coordinates } = feature.geometry;
    const polygons = type === "Polygon" ? [coordinates] : type === "MultiPolygon" ? coordinates : [];
    for (const polygon of polygons) buildings.push(polygon[0].map(local));
  }
  return { roads, buildings, local };
}

function updateScenery() {
  const { map, scenery } = state;
  if (!scenery || !map.getLayer("building-3d")) return;
  const anchor = maplibregl.MercatorCoordinate.fromLngLat(state.stop.lngLat);
  const { roads, buildings, local } = collectScenery(map, anchor);
  if (!roads.length) return;
  const scale = anchor.meterInMercatorCoordinateUnits();
  const frame = { absolute: [anchor.x / scale, anchor.y / scale] };
  const runs = state.crowns?.areas[state.area.key] ?? [];
  const [originLng, originLat] = state.crowns?.origin ?? [0, 0];
  const crowns = [];
  for (let i = 0; i < runs.length; i += 4) {
    const [x, y] = local([originLng + runs[i] / 1e6, originLat + runs[i + 1] / 1e6]);
    crowns.push([x, y, runs[i + 2], runs[i + 3]]);
  }
  const stops = state.area.stops.map((stop) => local(stop.lngLat));
  const trees = generateTrees(frame, roads, buildings, crowns, stops);
  if (state.sceneryKey !== state.stop.code) state.births = new Map();
  state.sceneryKey = state.stop.code;
  const before = state.births.size;
  scenery.setTrees(anchor, trees, state.births);
  if (state.births.size > before) scenery.latestBirth = scenery.now;
}

function addScenery() {
  state.scenery = new SceneryLayer();
  state.scenery.dark = state.dark;
  state.scenery.latestBirth = -Infinity;
  applySkyToScenery();
  const layers = state.map.getStyle().layers;
  const above = layers.findIndex((layer) => layer.id === "building-3d");
  state.map.addLayer(state.scenery, layers[above + 1]?.id);
  state.sceneryKey = null;
  state.sceneryDirty = true;
}

function applySkyToScenery() {
  if (!state.scenery || !state.sky) return;
  state.scenery.wind = state.sky.wind;
  state.scenery.overcast = state.sky.cloud;
  state.map.triggerRepaint();
}

// The scene: one random stop in one area, its buses and its arrivals panel, plus the weather.

const MAX_BUSES = 7;
const state = { map: null, weather: null, style: null, areas: [], area: null, stop: null, buses: [], rows: [], pins: [], youMarker: null, dark: false, sky: null, crowns: null, scenery: null, sceneryKey: null, sceneryDirty: true, births: new Map() };

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

  state.sceneryDirty = true;
  if (!sameArea || !state.pins.length) {
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
  applySkyToScenery();
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
    addScenery();
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
  fetch("data/crowns.json").then((response) => response.json()).then((crowns) => {
    state.crowns = crowns;
    state.sceneryDirty = true;
    state.map?.triggerRepaint();
  });
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
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '<a href="https://registry.opendata.aws/dataforgood-fb-forests/">Canopy height © Meta &amp; WRI, CC BY 4.0</a>' }), "bottom-right");
  state.map = map;
  state.weather = new Weather(map, document.getElementById("weather"));

  showStop(area, stop, false);
  map.on("zoom", updateBusSize);
  map.on("sourcedata", (event) => {
    if (event.sourceId === "openmaptiles" && event.isSourceLoaded) state.sceneryDirty = true;
  });
  map.on("idle", () => {
    if (!state.sceneryDirty || !state.scenery) return;
    state.sceneryDirty = false;
    updateScenery();
  });
  map.once("style.load", () => {
    addScenery();
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
