// Muffin: the app's kids map style for buses (RouteBusModel, RouteBusLayer, RouteLanes and
// RouteBusShaders.metal). Each service is an animal, with a head and tail on the roof and a
// matching coat, a trail of flowers and grass behind it and paw prints ahead. The meshes are
// built here the same way the app builds them, so nothing extra is downloaded.

const Muffin = (() => {
  const BUNNY = 0, DOG = 1, SHARK = 2, FOX = 3, CAT = 4, SLOTH = 5, OTTER = 6;
  const SLOTS = [BUNNY, DOG, SHARK, FOX, CAT, SLOTH, SHARK, OTTER];

  // Linear colours per animal: fur, cream, pink, tail tip, patch.
  const PALETTE = {
    fur: [[1.0, 0.95, 0.76], [1.0, 0.63, 0.12], [0.3, 0.52, 0.98], [1.0, 0.35, 0.04], [1.0, 0.72, 0.39], [0.51, 0.39, 0.29], [0.56, 0.21, 0.1]],
    cream: [[1.0, 1.0, 0.95], [1.0, 0.92, 0.53], [1.0, 0.97, 0.92], [1.0, 0.99, 0.83], [1.0, 0.97, 0.76], [1.0, 0.88, 0.66], [1.0, 0.9, 0.69]],
    pink: [[1.0, 0.4, 0.3], [1.0, 0.32, 0.25], [1.0, 0.4, 0.32], [1.0, 0.35, 0.25], [1.0, 0.4, 0.31], [1.0, 0.4, 0.3], [1.0, 0.36, 0.26]],
    tailTip: [[1.0, 1.0, 1.0], [0.95, 0.46, 0.06], [0.26, 0.46, 0.92], [1.0, 1.0, 0.9], [0.72, 0.26, 0.09], [0.35, 0.25, 0.17], [0.35, 0.12, 0.05]],
    patch: [[1.0, 0.46, 0.35], [0.83, 0.35, 0.05], [0.16, 0.32, 0.8], [0.24, 0.09, 0.04], [0.72, 0.26, 0.09], [0.22, 0.11, 0.06], [0.3, 0.11, 0.04]],
  };

  // RouteKidsMark and RouteKidsTrail, in metres.
  const FLOWER_STEP = 5, FLOWER_REACH = 60, TRAIL_START = 9, PRINT_STEP = 3.2, PRINT_REACH = 34;
  const BUS_HALF = 6;

  // ServiceHash.value: FNV-1a then a 64-bit finaliser, so a service is always the same animal.
  const animals = new Map();
  function animal(service) {
    if (!animals.has(service)) {
      const mask = (1n << 64n) - 1n;
      let mixed = 0xcbf29ce484222325n;
      for (const byte of new TextEncoder().encode(service)) {
        mixed ^= BigInt(byte);
        mixed = (mixed * 0x100000001b3n) & mask;
      }
      mixed ^= mixed >> 33n;
      mixed = (mixed * 0xff51afd7ed558ccdn) & mask;
      mixed ^= mixed >> 33n;
      mixed = (mixed * 0xc4ceb9fe1a85ec53n) & mask;
      mixed ^= mixed >> 33n;
      animals.set(service, SLOTS[Number(mixed % BigInt(SLOTS.length))]);
    }
    return animals.get(service);
  }

  const seed = (step) => ((Math.imul(step, 2654435761 | 0) >>> 0) % 1000) / 1000;

  // Vectors and rotations.
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = (a) => Math.hypot(a[0], a[1], a[2]);
  const normalize = (a) => scale(a, 1 / (length(a) || 1));
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  function rotation(angle, [x, y, z]) {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    return [
      [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
      [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
      [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ];
  }
  const act = (m, v) => m.map((row) => dot(row, v));
  const compose = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

  // Paint slots in the decoration meshes.
  const FUR = 0, CREAM = 1, PINK = 2, INK = 3, SPARKLE = 4, TAIL_TIP = 5, PATCH = 6, EYE_WHITE = 7, MOUTH = 8;

  // RouteBusMeshBuilder: vertices are position, normal, paint and a wag weight.
  class Builder {
    constructor() {
      this.vertices = [];
      this.indices = [];
      this.wag = null;
    }

    vertex(point, normal, paint) {
      const index = this.vertices.length / 8;
      const weight = this.wag ? 1 + Math.min(length(sub(point, this.wag.base)) / this.wag.reach, 1) : 0.5;
      this.vertices.push(...point, ...normal, paint, weight);
      return index;
    }

    triangle(a, b, c, paint) {
      const normal = normalize(cross(sub(b, a), sub(c, a)));
      const first = this.vertex(a, normal, paint);
      this.indices.push(first, this.vertex(b, normal, paint), this.vertex(c, normal, paint));
    }

    ellipsoid(center, radii, paint, turn = null, rings = 10, segments = 16) {
      const start = this.vertices.length / 8;
      for (let ring = 0; ring <= rings; ring++) {
        const latitude = (ring * Math.PI) / rings;
        for (let segment = 0; segment <= segments; segment++) {
          const longitude = (segment * 2 * Math.PI) / segments;
          const unit = [Math.sin(latitude) * Math.cos(longitude), Math.cos(latitude), Math.sin(latitude) * Math.sin(longitude)];
          const normal = normalize([unit[0] / radii[0], unit[1] / radii[1], unit[2] / radii[2]]);
          if (turn) this.vertex(add(center, act(turn, mul(unit, radii))), act(turn, normal), paint);
          else this.vertex(add(center, mul(unit, radii)), normal, paint);
        }
      }
      for (let ring = 0; ring < rings; ring++) {
        for (let segment = 0; segment < segments; segment++) {
          const a = start + ring * (segments + 1) + segment, b = a + segments + 1;
          this.indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }

    tube(start, end, radius, endRadius, paint) {
      const axis = normalize(sub(end, start));
      const across = normalize(cross(axis, Math.abs(axis[1]) < 0.9 ? Y : X));
      const up = cross(axis, across);
      const first = this.vertices.length / 8, segments = 14;
      for (const [ring, size] of [[start, radius], [end, endRadius ?? radius]]) {
        for (let segment = 0; segment <= segments; segment++) {
          const angle = (segment * 2 * Math.PI) / segments;
          const normal = add(scale(across, Math.cos(angle)), scale(up, Math.sin(angle)));
          this.vertex(add(ring, scale(normal, size)), normal, paint);
        }
      }
      for (let segment = 0; segment < segments; segment++) {
        const a = first + segment, b = a + segments + 1;
        this.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
      this.ellipsoid(start, [radius, radius, radius], paint);
      const r = endRadius ?? radius;
      this.ellipsoid(end, [r, r, r], paint);
    }

    stroke(points, radius, paint = INK) {
      for (let i = 0; i < points.length - 1; i++) this.tube(points[i], points[i + 1], radius, null, paint);
    }

    pointedEar(base, width, height, depth, lean, tip, inner) {
      const apex = add(base, [lean, height, -depth * 0.2]);
      const corners = [add(base, [-width, 0, depth]), add(base, [width, 0, depth]), add(base, [width, 0, -depth]), add(base, [-width, 0, -depth])];
      const cut = 0.62;
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        const midA = add(a, scale(sub(apex, a), cut)), midB = add(b, scale(sub(apex, b), cut));
        this.triangle(a, b, midB, FUR);
        this.triangle(a, midB, midA, FUR);
        this.triangle(midA, midB, apex, tip ?? FUR);
      }
      const face = add(base, [0, 0, depth + 0.012]);
      const innerApex = add(face, [lean * 0.7, height * 0.7, -depth * 0.25]);
      this.triangle(add(face, [-width * 0.55, height * 0.08, 0]), add(face, [width * 0.55, height * 0.08, 0]), innerApex, inner);
    }

    fin(front, back, tip, halfWidth) {
      const side = [halfWidth, 0, 0];
      const middle = scale(add(add(front, back), tip), 1 / 3);
      const faces = [
        [sub(front, side), sub(back, side), tip], [add(front, side), add(back, side), tip], [sub(front, side), add(front, side), tip],
        [sub(back, side), add(back, side), tip], [sub(front, side), sub(back, side), add(back, side)], [sub(front, side), add(back, side), add(front, side)],
      ];
      for (const [a, b, c] of faces) {
        const outward = sub(scale(add(add(a, b), c), 1 / 3), middle);
        if (dot(cross(sub(b, a), sub(c, a)), outward) < 0) this.triangle(a, c, b, FUR);
        else this.triangle(a, b, c, FUR);
      }
    }

    roundEar(center, radius, inner) {
      this.ellipsoid(center, [radius, radius * 0.95, radius * 0.5], FUR);
      if (inner != null) this.ellipsoid(add(center, [0, -0.02, radius * 0.38]), [radius * 0.58, radius * 0.55, radius * 0.18], inner);
    }

    flower() {
      this.ellipsoid([0, 0.5, 0], [0.05, 0.52, 0.05], 0, null, 4, 6);
      for (const side of [-1, 1]) {
        this.ellipsoid([side * 0.17, 0.36, 0], [0.2, 0.045, 0.09], 1, rotation(side * 0.5, Z), 3, 6);
      }
      for (let petal = 0; petal < 5; petal++) {
        const angle = (petal * 2 * Math.PI) / 5;
        const turn = compose(rotation(-angle, Y), rotation(0.28, Z));
        this.ellipsoid([Math.cos(angle) * 0.29, 1.04, Math.sin(angle) * 0.29], [0.25, 0.055, 0.16], 2, turn, 3, 7);
      }
      this.ellipsoid([0, 1.08, 0], [0.16, 0.1, 0.16], 3, null, 4, 8);
    }

    grass() {
      const blades = [[0.0, 1.0], [1.1, 0.78], [2.2, 0.92], [3.2, 0.7], [4.3, 0.95], [5.3, 0.8]];
      for (const [angle, height] of blades) {
        const out = [Math.cos(angle), 0, Math.sin(angle)], across = [-Math.sin(angle), 0, Math.cos(angle)];
        const normal = normalize(add(scale(out, 0.5), [0, 0.85, 0]));
        const stops = [[0, 1], [0.45, 0.8], [0.8, 0.45], [1, 0]];
        const start = this.vertices.length / 8;
        for (const [t, width] of stops) {
          const center = add(scale(out, 0.06 + 0.3 * t * t), [0, height * t, 0]);
          this.vertex(sub(center, scale(across, 0.075 * width)), normal, 4);
          this.vertex(add(center, scale(across, 0.075 * width)), normal, 4);
        }
        for (let stop = 0; stop < stops.length - 1; stop++) {
          const a = start + stop * 2;
          this.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }

    // The exhaust treats: a soap bubble, a wrapped sweet, a lollipop and a candy-floss cloud.
    // Each puff draws the whole mesh and its shader keeps one of the four.
    treats() {
      this.ellipsoid([0, 0, 0], [0.44, 0.44, 0.44], 9, null, 6, 12);
      for (const side of [-1, 1]) this.ellipsoid([side * 0.44, 0, 0], [0.1, 0.22, 0.22], 11, null, 4, 7);
      this.ellipsoid([0, 0, 0], [0.36, 0.25, 0.25], 10, null, 6, 9);
      this.ellipsoid([0, -0.38, 0], [0.03, 0.4, 0.03], 13, null, 4, 4);
      this.ellipsoid([0, 0.05, 0], [0.08, 0.07, 0.08], 12, null, 3, 5);
      this.ellipsoid([0, 0.56, 0], [0.4, 0.5, 0.4], 12, null, 6, 12);
      for (const [center, radius] of [[[0, 0, 0], 0.5], [[0.4, 0.06, 0.1], 0.36], [[-0.38, 0.04, -0.08], 0.37], [[0.04, 0.32, -0.04], 0.34], [[-0.02, -0.02, 0.38], 0.33]]) {
        this.ellipsoid(center, [radius, radius, radius], 14, null, 6, 10);
      }
    }

    head(kind, c) {
      const r = [0.88, 0.8, 0.78];
      const surface = (u, v) => add(c, [u * r[0], v * r[1], Math.sqrt(Math.max(1 - u * u - v * v, 0)) * r[2]]);
      this.ellipsoid(c, r, FUR, null, 12, 20);
      let look = { muzzle: true, nose: INK, open: false, blush: false, whiskers: false, raise: 0 };
      const set = (changes) => (look = { ...look, ...changes });
      switch (kind) {
        case BUNNY:
          set({ muzzle: false, nose: PINK, open: true, blush: true });
          for (const side of [-1, 1]) {
            const tilt = rotation(-side * 0.18, Z);
            this.ellipsoid(add(c, [side * 0.32, r[1] + 0.5, -0.12]), [0.19, 0.62, 0.12], FUR, tilt, 8, 12);
            this.ellipsoid(add(c, [side * 0.32, r[1] + 0.52, -0.04]), [0.1, 0.48, 0.06], PINK, tilt, 6, 10);
          }
          break;
        case DOG:
          set({ open: true, blush: true });
          for (const side of [-1, 1]) {
            this.ellipsoid(add(c, [side * 0.86, 0.02, -0.08]), [0.17, 0.5, 0.34], PATCH, rotation(side * 0.22, Z), 8, 12);
          }
          break;
        case SHARK:
          set({ muzzle: false, nose: null, blush: true });
          this.ellipsoid(add(surface(0, -0.42), [0, 0, -0.24]), [0.78, 0.42, 0.28], CREAM, null, 10, 16);
          this.fin(add(c, [0, r[1] * 0.9, 0.16]), add(c, [0, r[1] * 0.8, -0.42]), add(c, [0, r[1] + 0.55, -0.52]), 0.08);
          this.ellipsoid(add(c, [0, -0.27, 0.71]), [0.17, 0.11, 0.04], MOUTH, null, 5, 10);
          this.ellipsoid(add(c, [0, -0.31, 0.735]), [0.09, 0.05, 0.02], PINK, null, 4, 8);
          for (const side of [-1, 1]) this.ellipsoid(add(c, [side * 0.07, -0.19, 0.74]), [0.035, 0.03, 0.015], EYE_WHITE, null, 4, 8);
          break;
        case FOX:
          set({ blush: false });
          for (const side of [-1, 1]) {
            this.pointedEar(add(c, [side * 0.46, r[1] * 0.72, -0.12]), 0.28, 0.62, 0.15, side * 0.1, PATCH, CREAM);
            this.ellipsoid(add(surface(side * 0.55, -0.32), [0, 0, -0.1]), [0.3, 0.22, 0.16], CREAM, null, 8, 12);
          }
          break;
        case CAT:
          set({ nose: PINK, open: true, whiskers: true });
          for (const side of [-1, 1]) this.pointedEar(add(c, [side * 0.5, r[1] * 0.72, -0.12]), 0.3, 0.5, 0.15, side * 0.08, null, PINK);
          for (const u of [-0.17, 0, 0.17]) this.ellipsoid(surface(u, 0.62), [0.045, 0.14, 0.04], PATCH, null, 4, 8);
          break;
        case SLOTH:
          set({ muzzle: false, raise: 0.07 });
          this.ellipsoid(add(surface(0, -0.08), [0, 0, -0.2]), [0.68, 0.5, 0.24], CREAM, null, 10, 16);
          for (const side of [-1, 1]) {
            this.ellipsoid(add(surface(side * 0.36, 0.06), [0, 0, 0.05]), [0.24, 0.13, 0.05], PATCH, rotation(side * -0.35, Z), 6, 10);
          }
          for (const [x, height] of [[-0.16, 0.18], [0, 0.25], [0.16, 0.18]]) {
            this.ellipsoid(add(c, [x, r[1] * 0.92 + height * 0.4, 0.05]), [0.11, height, 0.07], FUR, rotation(-x * 2, Z), 6, 8);
          }
          break;
        case OTTER:
          set({ open: true, whiskers: true });
          for (const side of [-1, 1]) this.roundEar(add(c, [side * 0.74, r[1] * 0.52, -0.1]), 0.19, PATCH);
          break;
      }
      for (const side of [-1, 1]) {
        const eye = add(surface(side * 0.34, 0.1), [0, 0, look.raise]);
        this.ellipsoid(eye, [0.1, 0.14, 0.06], INK, null, 6, 10);
        this.ellipsoid(add(eye, [-0.035, 0.05, 0.05]), [0.035, 0.04, 0.012], SPARKLE, null, 4, 8);
      }
      if (look.blush) {
        for (const side of [-1, 1]) this.ellipsoid(surface(side * 0.6, -0.2), [0.13, 0.075, 0.04], PINK, null, 4, 8);
      }
      const mouthCenter = add(look.muzzle ? add(surface(0, -0.32), [0, 0, -0.04]) : surface(0, -0.26), [0, 0, look.raise]);
      const mouthRadii = look.muzzle ? [0.32, 0.22, 0.2] : [0.3, 0.2, 0.06];
      if (look.muzzle) this.ellipsoid(mouthCenter, mouthRadii, CREAM, null, 8, 12);
      const onMouth = (x, y) => {
        const u = x / mouthRadii[0], v = y / mouthRadii[1];
        return add(mouthCenter, [x, y, Math.sqrt(Math.max(1 - u * u - v * v, 0.02)) * mouthRadii[2] + 0.008]);
      };
      if (look.nose == null) return;
      const noseY = look.muzzle ? 0.07 : 0.1;
      this.ellipsoid(onMouth(0, noseY), [0.09, 0.065, 0.05], look.nose, null, 5, 10);
      this.stroke([onMouth(0, noseY - 0.05), onMouth(0, noseY - 0.12)], 0.014);
      for (const side of [-1, 1]) {
        this.stroke([0, 1, 2, 3, 4, 5].map((step) => {
          const t = step / 5;
          return onMouth(side * 0.09 * t * 1.6, noseY - 0.12 - Math.sin(t * Math.PI) * 0.05);
        }), 0.014);
      }
      if (look.open) {
        this.ellipsoid(add(onMouth(0, noseY - 0.2), [0, 0, -0.03]), [0.075, 0.055, 0.03], MOUTH, null, 4, 8);
        this.ellipsoid(add(onMouth(0, noseY - 0.22), [0, 0, -0.02]), [0.045, 0.03, 0.03], PINK, null, 4, 8);
      }
      if (look.whiskers) {
        for (const side of [-1, 1]) {
          for (const lift of [0.03, -0.04]) {
            const root = onMouth(side * 0.22, noseY - 0.06 + lift);
            this.stroke([root, add(root, [side * 0.34, lift * 1.4, -0.06])], 0.011);
          }
        }
      }
    }

    decorate(kind, lift) {
      const roof = 3.08 + lift, front = 6.03, rear = -front;
      this.head(kind, [0, roof + 0.62, front - 1.25]);
      switch (kind) {
        case BUNNY:
          this.wag = { base: [0, 0.95, rear + 0.2], reach: 0.55 };
          this.ellipsoid([0, 0.95, rear - 0.1], [0.32, 0.3, 0.26], TAIL_TIP);
          break;
        case DOG:
          this.wag = { base: [0, roof, rear + 0.55], reach: 0.95 };
          this.tube([0, roof + 0.05, rear + 0.55], [0, roof + 0.5, rear + 0.25], 0.14, 0.12, FUR);
          this.tube([0, roof + 0.5, rear + 0.25], [0, roof + 0.78, rear + 0.38], 0.12, 0.1, TAIL_TIP);
          break;
        case SHARK:
          this.wag = { base: [0, 1.1, rear + 0.1], reach: 1.0 };
          this.fin([0, 1.45, rear + 0.05], [0, 0.95, rear + 0.05], [0, 2.0, rear - 0.95], 0.1);
          this.fin([0, 1.1, rear + 0.05], [0, 0.7, rear + 0.05], [0, 0.45, rear - 0.55], 0.09);
          break;
        case FOX: {
          this.wag = { base: [0, roof, rear + 1.3], reach: 1.9 };
          const tilt = rotation(0.55, X);
          const axis = act(tilt, [0, 0, -1]);
          const base = [0, roof + 0.05, rear + 1.3];
          this.ellipsoid(add(base, scale(axis, 0.8)), [0.5, 0.5, 0.85], FUR, tilt);
          this.ellipsoid(add(base, scale(axis, 1.42)), [0.38, 0.38, 0.4], TAIL_TIP, tilt);
          break;
        }
        case CAT: {
          this.wag = { base: [0, roof, rear + 1.0], reach: 1.3 };
          const tail = [[0, roof + 0.05, rear + 1.0], [0, roof + 0.3, rear + 0.45], [-0.1, roof + 0.75, rear + 0.2], [-0.32, roof + 1.05, rear + 0.32], [-0.42, roof + 1.12, rear + 0.6]];
          for (let i = 0; i < tail.length - 1; i++) this.tube(tail[i], tail[i + 1], 0.16, null, i >= 2 ? TAIL_TIP : FUR);
          break;
        }
        case OTTER:
          this.wag = { base: [0, 1.0, rear + 0.1], reach: 0.75 };
          this.tube([0, 1.0, rear + 0.05], [0, 0.55, rear - 0.5], 0.22, 0.08, FUR);
          break;
      }
      this.wag = null;
    }
  }

  function upload(gl, builder, instances) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(builder.vertices), gl.STATIC_DRAW);
    for (const [location, size, offset] of [[0, 3, 0], [1, 3, 12], [2, 2, 24]]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
    }
    if (instances) {
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      for (const [location, offset] of [[3, 0], [4, 16]]) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 32, offset);
        gl.vertexAttribDivisor(location, 1);
      }
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(builder.indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: builder.indices.length };
  }

  // demo.css tints the whole map canvas for Muffin (saturate 1.9, brightness 1.08, contrast 0.95,
  // hue-rotate -6deg). The app draws its animals untinted, so these colours undo that filter.
  function filterMatrices() {
    const saturate = (s) => [
      [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ];
    const hue = (degrees) => {
      const c = Math.cos((degrees * Math.PI) / 180), s = Math.sin((degrees * Math.PI) / 180);
      return [
        [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
        [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283],
        [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
      ];
    };
    const glsl = (m) => `mat3(${[0, 1, 2].flatMap((column) => m.map((row) => row[column].toFixed(6))).join(", ")})`;
    return { unhue: glsl(hue(6)), unsaturate: glsl(saturate(1 / 1.9)) };
  }
  const MATRICES = filterMatrices();
  const UNFILTER = `
vec3 unfilter(vec3 c) {
  c = ${MATRICES.unhue} * c;
  c = (c - 0.5) / 0.95 + 0.5;
  c /= 1.08;
  return clamp(${MATRICES.unsaturate} * c, 0.0, 1.0);
}`;

  const COMMON = `
uniform vec3 u_light;
uniform float u_night;
vec3 kidsLit(vec3 pigment, vec3 normal) {
  float light = smoothstep(-0.45, 0.85, dot(normal, u_light));
  float sky = smoothstep(-0.2, 0.8, normal.y);
  vec3 shade = vec3(0.67, 0.72, 0.76) + light * vec3(0.27, 0.25, 0.21) + sky * 0.08;
  return pigment * shade * mix(vec3(1.0), vec3(0.54, 0.65, 0.80), u_night);
}
${UNFILTER}
vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  c = mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
  return unfilter(c);
}`;

  const SPROUT_SCALE = `
float sproutScale(vec4 data) {
  float bloom = clamp(data.w / 3.0, 0.0, 1.0) - 1.0;
  float pop = max(1.0 + 2.70158 * bloom * bloom * bloom + 1.70158 * bloom * bloom, 0.0);
  float size = data.y > 0.5 ? mix(1.0, 1.45, fract(data.x * 7.31)) : mix(1.05, 1.6, data.x);
  return size * pop * mix(0.35, 1.0, clamp(data.z, 0.0, 1.0));
}`;

  // The head and tail, bobbing and pitching with the bus.
  const DECORATION_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_extra;
uniform mat4 u_matrix, u_model;
uniform vec4 u_play;
uniform float u_wag;
out vec3 v_normal;
flat out int v_paint;
void main() {
  vec3 position = a_position, normal = a_normal;
  if (a_extra.y > 0.95) {
    float weight = clamp(a_extra.y - 1.0, 0.0, 1.0);
    position.x += u_wag * weight * weight;
  }
  float c = cos(u_play.z), s = sin(u_play.z);
  position.yz = vec2(c * position.y - s * position.z, s * position.y + c * position.z);
  normal.yz = vec2(c * normal.y - s * normal.z, s * normal.y + c * normal.z);
  position.y += u_play.y;
  vec4 world = u_model * vec4(position, 1);
  gl_Position = u_matrix * vec4(world.x, world.z, world.y, 1);
  v_normal = normalize((u_model * vec4(normal, 0)).xyz);
  v_paint = int(a_extra.x + 0.5);
}`;

  const DECORATION_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_fur, u_cream, u_pink, u_tailTip, u_patch;
uniform float u_opacity;
in vec3 v_normal;
flat in int v_paint;
out vec4 fragColor;
${COMMON}
void main() {
  vec3 pigment = u_fur;
  if (v_paint == 1) pigment = u_cream;
  else if (v_paint == 2) pigment = u_pink;
  else if (v_paint == 3) pigment = vec3(0.054, 0.019, 0.010);
  else if (v_paint == 4) pigment = vec3(1.0, 1.0, 0.98);
  else if (v_paint == 5) pigment = u_tailTip;
  else if (v_paint == 6) pigment = u_patch;
  else if (v_paint == 7) pigment = vec3(0.98, 0.97, 0.94);
  else if (v_paint == 8) pigment = vec3(0.31, 0.05, 0.035);
  fragColor = vec4(encode(kidsLit(pigment, normalize(v_normal))) * u_opacity, u_opacity);
}`;

  // Flowers and grass tufts left behind the bus, popping up and swaying in its wake.
  const SPROUT_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_extra;
layout(location = 3) in vec4 a_mark;
layout(location = 4) in vec4 a_data;
uniform mat4 u_matrix;
uniform vec3 u_pink;
uniform float u_time, u_moving, u_size;
out vec3 v_normal;
out float v_height;
flat out int v_paint;
flat out vec3 v_petal, v_heart;
flat out float v_fade;
${SPROUT_SCALE}
void main() {
  float seed = a_data.x, behind = a_data.w;
  float scale = sproutScale(a_data) * u_size;
  float yaw = seed * 6.2832 + (1.0 - clamp(behind / 3.0, 0.0, 1.0)) * 2.4;
  float c = cos(yaw), s = sin(yaw);
  vec3 local = a_position;
  vec3 turned = vec3(c * local.x - s * local.z, local.y, s * local.x + c * local.z);
  v_normal = vec3(c * a_normal.x - s * a_normal.z, a_normal.y, s * a_normal.x + c * a_normal.z);
  vec2 forward = normalize(a_mark.zw);
  vec2 sway = vec2(0.0);
  if (u_moving > 0.5) {
    float wake = 1.0 - smoothstep(0.0, 14.0, behind);
    float rate = 1.6 + fract(seed * 13.7) * 0.9;
    sway = forward * sin(u_time * rate + seed * 40.0) * (0.06 + 0.26 * wake)
      + vec2(-forward.y, forward.x) * sin(u_time * rate * 0.7 + seed * 23.0) * 0.05;
  }
  vec3 world = turned * scale;
  world.xz += sway * local.y * local.y * scale + a_mark.xy;
  gl_Position = u_matrix * vec4(world.x, world.z, world.y, 1);
  v_height = local.y;
  v_paint = int(a_extra.x + 0.5);
  int hue = int(fract(seed * 3.71) * 6.0);
  vec3 petals[6] = vec3[6](u_pink, vec3(1.0, 0.97, 0.93), vec3(1.0, 0.55, 0.68), vec3(0.74, 0.58, 1.0), vec3(1.0, 0.84, 0.22), vec3(0.52, 0.76, 1.0));
  v_petal = petals[hue];
  v_heart = hue == 4 ? vec3(1.0, 0.5, 0.1) : vec3(1.0, 0.78, 0.16);
  v_fade = smoothstep(0.0, 0.65, a_data.z);
}`;

  const SPROUT_FRAGMENT = `#version 300 es
precision highp float;
uniform float u_opacity;
in vec3 v_normal;
in float v_height;
flat in int v_paint;
flat in vec3 v_petal, v_heart;
flat in float v_fade;
out vec4 fragColor;
${COMMON}
void main() {
  vec3 pigment;
  if (v_paint == 0) pigment = vec3(0.27, 0.55, 0.14);
  else if (v_paint == 1) pigment = vec3(0.36, 0.68, 0.18);
  else if (v_paint == 2) pigment = v_petal;
  else if (v_paint == 3) pigment = v_heart;
  else pigment = mix(vec3(0.22, 0.5, 0.12), vec3(0.6, 0.85, 0.28), clamp(v_height, 0.0, 1.0));
  float alpha = u_opacity * v_fade;
  fragColor = vec4(encode(kidsLit(pigment, normalize(v_normal))) * alpha, alpha);
}`;

  // Ground marks: a soft shadow under each flower, and the animal's paw prints ahead.
  const MARK_VERTEX = `#version 300 es
precision highp float;
layout(location = 3) in vec4 a_mark;
layout(location = 4) in vec4 a_data;
uniform mat4 u_matrix;
uniform vec3 u_light;
uniform float u_time, u_moving, u_size;
out vec2 v_uv;
flat out vec4 v_data;
flat out float v_pulse;
${SPROUT_SCALE}
void main() {
  vec2 corners[4] = vec2[4](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(1, 1));
  vec2 corner = corners[gl_VertexID];
  vec2 forward = normalize(a_mark.zw);
  float size, pulse = 1.0;
  vec2 shift = vec2(0.0);
  if (a_data.y < 0.5) {
    float scale = sproutScale(a_data) * u_size;
    size = 0.62 * scale;
    shift = -u_light.xz * 0.5 * scale;
  } else {
    float tilt = a_data.y > 1.5 ? 0.12 : -0.12;
    forward = vec2(forward.x * cos(tilt) - forward.y * sin(tilt), forward.x * sin(tilt) + forward.y * cos(tilt));
    size = 0.92 * u_size;
    if (u_moving > 0.5) {
      float walker = fract(u_time / 2.6) * 38.0 - 2.0;
      float age = walker - a_data.w;
      pulse = age < 0.0 ? 0.6 : mix(1.0, 0.6, smoothstep(0.0, 16.0, age));
      size *= 1.0 + 0.3 * (1.0 - smoothstep(0.0, 2.5, age)) * step(0.0, age);
    } else {
      pulse = 0.85;
    }
  }
  vec2 side = vec2(-forward.y, forward.x);
  vec2 position = a_mark.xy + shift + (side * corner.x + forward * corner.y) * size;
  gl_Position = u_matrix * vec4(position, 0.04, 1);
  v_uv = corner;
  v_data = a_data;
  v_pulse = pulse;
}`;

  const MARK_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 u_patch;
uniform float u_opacity, u_animal;
in vec2 v_uv;
flat in vec4 v_data;
flat in float v_pulse;
out vec4 fragColor;
${COMMON}
float ellipse(vec2 p, vec2 center, vec2 radius) { return (length((p - center) / radius) - 1.0) * min(radius.x, radius.y); }
float capsule(vec2 p, vec2 a, vec2 b, float radius) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - radius;
}
float toes(vec2 p, int count, float spread, float lift, vec2 toe) {
  float d = 1e3;
  for (int i = 0; i < count; i++) {
    float t = count > 1 ? float(i) / float(count - 1) * 2.0 - 1.0 : 0.0;
    d = min(d, ellipse(p, vec2(t * spread, lift - t * t * 0.3), toe));
  }
  return d;
}
float paw(vec2 p, int animal) {
  if (animal == 0) return min(ellipse(p, vec2(0, -0.36), vec2(0.25, 0.44)), toes(p, 4, 0.32, 0.6, vec2(0.12, 0.16)));
  if (animal == 2) return min(min(length(p - vec2(-0.18, -0.28)) - 0.34, length(p - vec2(0.32, 0.22)) - 0.22), length(p - vec2(-0.1, 0.62)) - 0.14);
  if (animal == 3) return min(ellipse(p, vec2(0, -0.3), vec2(0.32, 0.3)), toes(p, 4, 0.36, 0.38, vec2(0.13, 0.19)));
  if (animal == 4) return min(ellipse(p, vec2(0, -0.3), vec2(0.42, 0.32)), toes(p, 4, 0.46, 0.34, vec2(0.16, 0.16)));
  if (animal == 5) {
    float d = ellipse(p, vec2(0, -0.4), vec2(0.34, 0.28));
    for (int i = 0; i < 3; i++) {
      float x = (float(i) - 1.0) * 0.24;
      d = min(d, capsule(p, vec2(x, -0.25), vec2(x * 1.5 + 0.08, 0.78), 0.065));
    }
    return d;
  }
  if (animal == 6) return min(min(ellipse(p, vec2(0, -0.3), vec2(0.42, 0.3)), toes(p, 5, 0.55, 0.36, vec2(0.12, 0.13))), ellipse(p, vec2(0, 0.12), vec2(0.5, 0.3)) + 0.04);
  return min(ellipse(p, vec2(0, -0.3), vec2(0.42, 0.32)), toes(p, 4, 0.5, 0.3, vec2(0.17, 0.21)));
}
void main() {
  vec2 p = v_uv;
  if (v_data.y < 0.5) {
    float r = length(p);
    float a = 0.26 * clamp(v_data.z, 0.0, 1.0) * (1.0 - smoothstep(0.35, 1.0, r)) * (1.0 - u_night * 0.6) * u_opacity;
    fragColor = vec4(0, 0, 0, a);
    return;
  }
  vec2 q = (v_data.y > 1.5 ? p : vec2(-p.x, p.y)) * 1.15;
  float d = paw(q, int(u_animal + 0.5));
  float edge = max(fwidth(d), 1e-4);
  float fill = 1.0 - smoothstep(-edge, edge, d);
  float halo = 1.0 - smoothstep(0.05, 0.16 + edge, d);
  vec3 ink = mix(u_patch * 0.42, u_patch * 0.3, u_night);
  vec3 glow = mix(vec3(1.0, 0.98, 0.93), vec3(0.86, 0.84, 0.8), u_night);
  vec3 color = mix(glow, ink, fill);
  float alpha = clamp(v_data.z * v_pulse * u_opacity * max(fill * 0.9, halo * 0.7), 0.0, 1.0);
  fragColor = vec4(encode(color) * alpha, alpha);
}`;

  // driveModeKidsTreatVertex and driveModeKidsTreat: treats puffed from the tailpipe when a bus
  // pulls away, rising and drifting behind it.
  const TREAT_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_extra;
layout(location = 3) in vec4 a_mark;
layout(location = 4) in vec4 a_data;
uniform mat4 u_matrix;
uniform vec3 u_eye;
uniform float u_size;
out vec3 v_normal;
out float v_height;
flat out int v_paint;
flat out vec3 v_petal, v_heart;
flat out float v_fade;
vec3 hue(float h, float saturation) {
  vec3 channel = clamp(abs(fract(h + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(1.0), channel, saturation);
}
vec4 project(vec3 world) { return u_matrix * vec4(world.x, world.z, world.y, 1); }
void main() {
  vec3 local = a_position, normal = a_normal;
  int paint = int(a_extra.x + 0.5);
  float seed = a_data.x;
  float age = clamp(a_data.y, 0.0, 1.0);
  float pick = fract(seed * 7.13 + 0.31);
  int shape = pick < 0.45 ? 3 : (pick < 0.85 ? 0 : (pick < 0.93 ? 1 : 2));
  int part = paint == 14 ? 3 : (paint == 9 ? 0 : (paint < 12 ? 1 : 2));
  v_paint = paint;
  v_height = 0.0;
  v_petal = vec3(0.0);
  v_heart = vec3(0.0);
  v_fade = 0.0;
  v_normal = normal;
  if (part != shape) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 forward = normalize(a_mark.zw);
  vec2 side = vec2(-forward.y, forward.x);
  vec3 origin = vec3(a_mark.x, 0.0, a_mark.y);
  float tints[18] = float[18](1.0, 0.66, 0.78, 0.78, 0.68, 1.0, 0.58, 0.88, 0.74, 1.0, 0.86, 0.48, 0.58, 0.79, 1.0, 1.0, 0.74, 0.58);
  if (shape == 3) {
    float spin = seed * 6.2832 + age * 1.3;
    float sc = cos(spin), ss = sin(spin);
    local = vec3(sc * local.x - ss * local.z, local.y, ss * local.x + sc * local.z);
    normal = vec3(sc * normal.x - ss * normal.z, normal.y, ss * normal.x + sc * normal.z);
    float pop = 1.0 + 0.18 * sin(clamp(age * 6.0, 0.0, 1.0) * 3.1416);
    float grow = mix(0.45, 2.0, 1.0 - pow(1.0 - age, 2.2)) * mix(0.85, 1.1, seed) * pop;
    vec3 world = local * grow;
    world.y += 0.65 + age * 2.6 + grow * 0.3;
    world.xz += forward * (0.4 + age * 2.0);
    gl_Position = project(origin + world * u_size);
    v_normal = normal;
    v_height = local.y;
    float h = 0.93 + (fract(seed * 3.71) - 0.5) * 0.08;
    v_petal = hue(h, 0.5);
    v_heart = hue(h - 0.13, 0.4);
    v_fade = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.55, 1.0, age));
    return;
  }
  float appear = smoothstep(0.0, 0.14, age);
  float size = mix(0.85, 1.1, fract(seed * 5.31)) * mix(0.45, 1.0, appear);
  float rise, drift, sway, fade;
  if (shape == 0) {
    float wobble = sin(age * 17.0 + seed * 31.0) * 0.06;
    local.y *= 1.0 + wobble;
    local.xz *= 1.0 - wobble * 0.5;
    size *= 1.35 + 0.25 * smoothstep(0.84, 0.96, age);
    rise = 0.85 + age * 2.1;
    drift = 0.4 + age * 1.5;
    sway = sin(age * 6.5 + seed * 19.0) * 0.28;
    fade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.86, 0.96, age));
  } else if (shape == 1) {
    float roll = age * 6.5 + seed * 6.28;
    float rc = cos(roll), rs = sin(roll);
    local = vec3(local.x, rc * local.y - rs * local.z, rs * local.y + rc * local.z);
    normal = vec3(normal.x, rc * normal.y - rs * normal.z, rs * normal.y + rc * normal.z);
    float tilt = sin(age * 4.0 + seed * 9.0) * 0.45;
    float tc = cos(tilt), ts = sin(tilt);
    local = vec3(tc * local.x - ts * local.y, ts * local.x + tc * local.y, local.z);
    normal = vec3(tc * normal.x - ts * normal.y, ts * normal.x + tc * normal.y, normal.z);
    rise = 0.8 + age * 1.6 + sin(age * 3.1416) * 0.35;
    drift = 0.4 + age * 1.9;
    sway = sin(age * 5.0 + seed * 13.0) * 0.16;
    fade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.7, 1.0, age));
  } else {
    float tilt = sin(age * 4.2 + seed * 17.0) * 0.16;
    float tc = cos(tilt), ts = sin(tilt);
    local = vec3(tc * local.x - ts * local.y, ts * local.x + tc * local.y, local.z);
    normal = vec3(tc * normal.x - ts * normal.y, ts * normal.x + tc * normal.y, normal.z);
    rise = 1.0 + age * 1.5 + age * age * 1.3;
    drift = 0.4 + age * 1.2;
    sway = sin(age * 3.4 + seed * 11.0) * 0.3;
    fade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.72, 1.0, age));
  }
  float yaw = seed * 6.2832;
  float c = cos(yaw), s = sin(yaw);
  local = vec3(c * local.x - s * local.z, local.y, s * local.x + c * local.z);
  normal = vec3(c * normal.x - s * normal.z, normal.y, s * normal.x + c * normal.z);
  vec3 world = local * size;
  world.y += rise;
  world.xz += forward * drift + side * sway;
  world = origin + world * u_size;
  gl_Position = project(world);
  v_normal = normal;
  v_height = 1.0 - abs(dot(normalize(normal), normalize(u_eye - world)));
  int tint = int(fract(seed * 3.71) * 6.0), other = (tint + 2) % 6;
  v_petal = vec3(tints[tint * 3], tints[tint * 3 + 1], tints[tint * 3 + 2]);
  v_heart = vec3(tints[other * 3], tints[other * 3 + 1], tints[other * 3 + 2]);
  v_fade = fade;
}`;

  const TREAT_FRAGMENT = `#version 300 es
precision highp float;
uniform float u_opacity;
in vec3 v_normal;
in float v_height;
flat in int v_paint;
flat in vec3 v_petal, v_heart;
flat in float v_fade;
out vec4 fragColor;
${COMMON}
void main() {
  vec3 n = normalize(v_normal);
  float shine = pow(clamp(dot(n, normalize(u_light + vec3(0, 1.4, 0))), 0.0, 1.0), 30.0);
  vec3 color;
  float alpha;
  if (v_paint == 14) {
    float swirl = 0.5 + 0.5 * sin(v_height * 4.0 + n.x * 1.6 + n.z * 1.2);
    vec3 floss = mix(v_petal, v_heart, smoothstep(0.3, 0.8, swirl) * 0.6);
    floss = mix(floss, vec3(1.0), 0.04 + 0.16 * smoothstep(0.1, 0.9, n.y));
    color = kidsLit(floss, n) * 1.08;
    color = mix(color, vec3(1.0), clamp(shine * 0.3, 0.0, 1.0));
    alpha = 0.95;
  } else if (v_paint == 9) {
    float rim = clamp(v_height, 0.0, 1.0);
    vec3 film = mix(v_petal, v_heart, smoothstep(0.45, 1.0, rim));
    float edge = smoothstep(0.8, 0.97, rim);
    color = mix(mix(vec3(1.0), film, 0.9), vec3(1.0), clamp(shine * 1.6 + edge * 0.55, 0.0, 1.0));
    color *= mix(vec3(1.0), vec3(0.54, 0.65, 0.80), u_night);
    alpha = clamp(0.2 + 0.75 * pow(rim, 1.7) + edge * 0.25 + shine * 0.9, 0.0, 1.0);
  } else {
    vec3 pigment = v_paint == 11 ? mix(v_heart, vec3(1.0), 0.35) : (v_paint == 13 ? vec3(0.96, 0.94, 0.9) : v_petal);
    color = kidsLit(pigment, n);
    color = mix(color, vec3(1.0), clamp(shine * (v_paint == 12 ? 0.8 : 0.5), 0.0, 1.0));
    alpha = 1.0;
  }
  float a = alpha * u_opacity * v_fade;
  fragColor = vec4(encode(color) * a, a);
}`;

  // The coat painted over the bus body (driveModeKidsCoat), spliced into the bus shader.
  const COAT = `
uniform float u_kids, u_animal;
uniform vec3 u_fur, u_cream, u_patch;
float kidsNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash1(dot(i, vec2(1.0, 57.0)));
  float b = hash1(dot(i + vec2(1, 0), vec2(1.0, 57.0)));
  float c = hash1(dot(i + vec2(0, 1), vec2(1.0, 57.0)));
  float d = hash1(dot(i + vec2(1, 1), vec2(1.0, 57.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec3 kidsCoat(vec3 p, vec3 n, float blur) {
  int animal = int(u_animal + 0.5);
  vec2 plane = abs(n.y) > 0.6 ? vec2(p.z, p.x) : abs(n.x) > abs(n.z) ? vec2(p.z, p.y) : vec2(p.x, p.y);
  bool side = abs(n.y) < 0.6;
  float edge = 0.58 + 0.06 * sin(plane.x * 2.3 + p.x * 1.7);
  float under = side ? 1.0 - smoothstep(edge - 0.03, edge + 0.03, p.y) : 0.0;
  vec3 coat = u_fur;
  if (animal == 3) {
    coat = mix(u_fur, u_patch, side ? 1.0 - smoothstep(0.3, 0.36, p.y) : 0.0);
  } else if (animal == 4) {
    float stripe = sin(plane.x * 3.4 + sin(plane.y * 2.1 + p.x) * 0.8);
    coat = mix(u_fur, u_patch, smoothstep(0.5, 0.62, stripe) * (1.0 - blur));
  } else if (animal == 5) {
    coat = mix(u_fur, u_patch, smoothstep(0.55, 0.75, kidsNoise(vec2(plane.x * 1.4, plane.y * 0.6))) * 0.6);
  } else {
    coat = mix(u_fur * 1.06, u_fur * 0.94, clamp(p.y / 3.2, 0.0, 1.0));
  }
  if (animal != 3 || p.y > 0.36) coat = mix(coat, u_cream, under);
  float strands = kidsNoise(vec2(plane.x * 3.0, plane.y * 16.0));
  return coat * (1.0 + (strands - 0.5) * 0.12 * (1.0 - blur));
}
${UNFILTER}
vec3 kidsLit(vec3 pigment, vec3 normal) {
  float light = smoothstep(-0.45, 0.85, dot(normal, u_light));
  float sky = smoothstep(-0.2, 0.8, normal.y);
  vec3 shade = vec3(0.67, 0.72, 0.76) + light * vec3(0.27, 0.25, 0.21) + sky * 0.08;
  return pigment * shade * mix(vec3(1.0), vec3(0.54, 0.65, 0.80), u_night);
}`;

  let assets = null;

  function setup(gl) {
    if (assets) return assets;
    const decorations = new Map();
    const program = (vertex, fragment) => glProgram(gl, vertex, fragment);
    const instances = gl.createBuffer();
    const flower = new Builder();
    flower.flower();
    const grass = new Builder();
    grass.grass();
    const treats = new Builder();
    treats.treats();
    const marks = gl.createVertexArray();
    gl.bindVertexArray(marks);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    for (const [location, offset] of [[3, 0], [4, 16]]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 32, offset);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    assets = {
      decoration: program(DECORATION_VERTEX, DECORATION_FRAGMENT),
      sprout: program(SPROUT_VERTEX, SPROUT_FRAGMENT),
      mark: program(MARK_VERTEX, MARK_FRAGMENT),
      treat: program(TREAT_VERTEX, TREAT_FRAGMENT),
      instances,
      marks,
      flower: upload(gl, flower, instances),
      grass: upload(gl, grass, instances),
      treats: upload(gl, treats, instances),
      decorationFor(kind, lift) {
        const key = `${kind}:${lift}`;
        if (!decorations.has(key)) {
          const builder = new Builder();
          builder.decorate(kind, lift);
          decorations.set(key, upload(gl, builder, null));
        }
        return decorations.get(key);
      },
    };
    return assets;
  }

  // RouteLanes.kidsTrail and RouteKidsMark.cluster/footprint for a simulated bus. Distances
  // are metres along its route; offsets grow with the bus when it is drawn larger.
  function trail(bus, size, place) {
    const route = bus.route;
    const spacing = 2 ** Math.round(Math.log2(Math.max(size, 1)));
    const travelled = bus.distance - (bus.trailFrom ?? bus.distance);
    const reach = Math.min(TRAIL_START * size + travelled, FLOWER_REACH * size);
    const rear = bus.distance - (BUS_HALF + 1) * size;
    const front = bus.distance + (BUS_HALF + 1.5) * size;
    const ground = [], flowers = [], grass = [];
    const fade = (behind, reachUnits, jitter) => {
      const start = reachUnits * (0.45 + 0.25 * jitter);
      return 1 - clamp((behind - start) / Math.max(reachUnits - start, 1), 0, 1);
    };
    const reachUnits = reach / size;
    const flowerStep = FLOWER_STEP * spacing;
    for (let step = Math.floor(rear / flowerStep); step * flowerStep > rear - reach - 2 * size; step--) {
      const at = step * flowerStep;
      if (at < 0 || at > route.length) continue;
      const behind = (rear - at) / size;
      const [offset, forward] = place(at);
      const side = [-forward[1], forward[0]];
      const count = 3 + Math.floor(seed(step * 3 + 1) * 2);
      const turn = seed(step) * 2 * Math.PI;
      const mark = (along, across, key, isGrass) => {
        const gap = behind - along;
        if (gap >= reachUnits) return null;
        return [
          offset[0] + (forward[0] * along + side[0] * across) * size, offset[1] + (forward[1] * along + side[1] * across) * size, forward[0], forward[1],
          seed(key), isGrass ? 1 : 0, fade(gap, reachUnits, seed(key * 7 + 3)), Math.max(gap, 0),
        ];
      };
      for (let index = 0; index < count; index++) {
        const jitter = seed(step * 11 + index + 2);
        const angle = turn + (index * 2 * Math.PI) / count + (jitter - 0.5) * 0.9;
        const radius = 0.55 + jitter * 0.6;
        const flower = mark(Math.cos(angle) * radius * 1.25, Math.sin(angle) * radius * 0.85, step * 4 + index, false);
        if (flower) flowers.push(flower);
      }
      for (let index = 0; index < (step % 3 === 0 ? 1 : 2); index++) {
        const jitter = seed(step * 5 + index + 1);
        const outward = (index + step) % 2 === 0 ? 1 : -1;
        const tuft = mark((jitter - 0.5) * 2.2, outward * (1.25 + jitter * 0.3), step * 9 + index, true);
        if (tuft) grass.push(tuft);
      }
    }
    ground.push(...flowers);
    const printStep = PRINT_STEP * spacing;
    for (let step = Math.ceil(front / printStep); step * printStep < front + PRINT_REACH * size; step++) {
      const at = step * printStep;
      if (at < 0 || at > route.length) continue;
      const ahead = (at - front) / size;
      const [offset, forward] = place(at);
      const near = clamp(ahead / 2, 0, 1);
      const fadeIn = near * (1 - clamp((ahead - PRINT_REACH * 0.65) / (PRINT_REACH * 0.35), 0, 1));
      const right = step % 2 === 0;
      const lateral = right ? 0.6 * size : -0.6 * size;
      ground.push([offset[0] - forward[1] * lateral, offset[1] + forward[0] * lateral, forward[0], forward[1], seed(step), right ? 2 : 1, fadeIn, ahead]);
    }
    return { ground, flowers, grass };
  }

  // RouteBusExhaust: a bus that pulls away from a stop, or speeds up while still slow, puffs a
  // treat every 0.19 s for half a second (about a second from standing), each living 1.9 s.
  const PUFF_LIFE = 1.9, PUFF_INTERVAL = 0.19, PUFF_SAMPLE = 0.15;
  function exhaust(bus, time, size, tailpipe, forward) {
    let engine = bus.exhaust;
    if (!engine || time < engine.seen || bus.distance < engine.distance) {
      bus.exhaust = { speed: bus.speed, sampled: time, seen: time, distance: bus.distance, surge: -Infinity, puffed: -Infinity, count: 0, puffs: [] };
      return [];
    }
    engine.seen = time;
    engine.distance = bus.distance;
    const elapsed = time - engine.sampled;
    if (elapsed >= PUFF_SAMPLE) {
      const gain = (bus.speed - engine.speed) / elapsed;
      if (bus.speed < 9 && (gain > 0.35 || (engine.speed < 0.6 && bus.speed > engine.speed + 0.05))) {
        engine.surge = Math.max(engine.surge, time + (engine.speed < 0.6 ? 0.95 : 0.5));
      }
      engine.speed = bus.speed;
      engine.sampled = time;
    }
    engine.puffs = engine.puffs.filter((puff) => time - puff.born <= PUFF_LIFE);
    if (time < engine.surge && time - engine.puffed > PUFF_INTERVAL && engine.puffs.length < 10) {
      engine.count += 1;
      const seed = ((Math.imul(engine.count, 2654435761 | 0) >>> 0) % 1000) / 1000;
      const back = [-forward[0], -forward[1]];
      const across = (seed - 0.5) * 1.3;
      const drift = [back[0] - back[1] * across, back[1] + back[0] * across];
      const length = Math.hypot(drift[0], drift[1]) || 1;
      engine.puffs.push({ origin: tailpipe, drift: [drift[0] / length, drift[1] / length], born: time, seed });
      engine.puffed = time;
    }
    return engine.puffs.map((puff) => [puff.origin[0], puff.origin[1], puff.drift[0], puff.drift[1], puff.seed, (time - puff.born) / PUFF_LIFE, 0, 0]);
  }

  // MapSceneryMesh's kids shelters and stop pole, built with the page's scenery MeshBuilder.
  // Materials 12 to 27 are the app's kids materials, coloured in the scenery shader.
  const WALL = 12, ROOF = 13, TRIM = 14, WOOD = 15, WINDOW = 16, FLOWER = 17, LEAF = 18, STONE = 19, SIGN = 20;
  const ROOF_SKY = 21, CAP = 22, ROOF_BUTTER = 23, BUSH = 24, POSTER_TREAT = 25, POSTER_SUNNY = 26, LAMP_GLOW = 27;
  const SIGN_BOARD = 10;

  function shelterKit(builder) {
    const v = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const kit = {
      post(base, height, material) {
        builder.prism(height, 0.17, 0.14, 10, material, base);
        builder.blob(v(base, [0, 0.06, 0]), [0.24, 0.1, 0.24], 1, WOOD);
      },
      window(center) {
        builder.blob(center, [0.44, 0.44, 0.07], 1, TRIM);
        builder.blob(v(center, [0, 0, -0.04]), [0.33, 0.33, 0.06], 1, WINDOW);
      },
      plaque(center) {
        builder.box(v(center, [0, 0.28, 0.02]), [0.06, 0.2, 0.06], TRIM);
        builder.blob(center, [0.62, 0.3, 0.09], 1, TRIM);
        builder.blob(v(center, [0, 0, -0.06]), [0.5, 0.22, 0.06], 1, SIGN);
      },
      bench(x, z, length) {
        builder.box([x, 0.52, z], [length, 0.18, 0.6], WOOD);
        builder.box([x, 0.95, z + 0.26], [length, 0.5, 0.12], WOOD);
        for (const side of [-1, 1]) builder.box([x + side * (length / 2 - 0.3), 0.27, z], [0.2, 0.42, 0.46], WOOD);
      },
      bloom(base) {
        builder.blob(v(base, [0, 0.14, 0]), [0.24, 0.16, 0.2], 1, LEAF);
        builder.blob(v(base, [0.04, 0.32, 0.03]), [0.13, 0.11, 0.13], 1, FLOWER);
      },
      flowerBox(base) {
        builder.box(v(base, [0, 0.3, 0]), [0.55, 0.5, 1.5], WOOD);
        [-0.55, -0.2, 0.15, 0.5].forEach((z, index) => kit.bloom(v(base, [(index % 2) * 0.06, 0.48, z])));
      },
      bush(base, size) {
        builder.blob(v(base, [0, size * 0.85, 0]), [size * 1.15, size, size], 1, BUSH);
        builder.blob(v(base, [size * 0.75, size * 0.6, -size * 0.15]), [size * 0.75, size * 0.7, size * 0.75], 1, BUSH);
        builder.blob(v(base, [size * 0.3, size * 1.7, -size * 0.5]), [size * 0.2, size * 0.17, size * 0.2], 1, FLOWER);
      },
      lamp(base, cap) {
        builder.blob(v(base, [0, 0.1, 0]), [0.26, 0.14, 0.26], 1, WOOD);
        builder.prism(3.0, 0.09, 0.07, 6, TRIM, base);
        builder.blob(v(base, [0, 3.25, 0]), [0.3, 0.32, 0.3], 1, LAMP_GLOW);
        builder.blob(v(base, [0, 3.55, 0]), [0.36, 0.13, 0.36], 1, cap);
        builder.blob(v(base, [0, 3.72, 0]), [0.07, 0.07, 0.07], 1, SIGN);
      },
      poster(x, z, art) {
        for (const side of [-1, 1]) builder.prism(2.45, 0.07, 0.06, 6, TRIM, [x + side * 0.6, 0, z + 0.06]);
        builder.box([x, 1.5, z + 0.07], [1.24, 1.64, 0.1], TRIM);
        builder.box([x, 1.5, z], [1.0, 1.4, 0.06], art);
        builder.blob([x, 2.42, z + 0.05], [0.72, 0.13, 0.2], 1, ROOF);
      },
    };
    return kit;
  }

  function cottage(b, k) {
    b.box([0, 0.06, 0.2], [6.8, 0.12, 2.9], STONE);
    b.box([0, 1.3, 1.25], [6.2, 2.5, 0.3], WALL);
    for (const x of [-3.0, 3.0]) b.box([x, 1.15, 0.8], [0.3, 2.2, 1.0], WALL);
    for (const x of [-1.6, 1.6]) k.window([x, 1.7, 1.08]);
    for (const x of [-2.95, 2.95]) k.post([x, 0.1, -0.95], 2.55, TRIM);
    b.blob([0, 2.68, 0.15], [3.9, 0.17, 2.08], 2, TRIM);
    b.blob([0, 2.72, 0.15], [3.6, 1.05, 1.86], 2, ROOF);
    b.box([2.0, 3.65, 0.75], [0.42, 0.8, 0.42], WALL);
    b.box([2.0, 4.08, 0.75], [0.54, 0.1, 0.54], TRIM);
    k.plaque([0, 2.24, -1.9]);
    k.bench(0, 0.72, 3.6);
    k.flowerBox([-3.75, 0, 0.45]);
    for (const [x, size] of [[-2.4, 0.6], [-0.7, 0.5], [1.1, 0.62], [2.8, 0.5]]) k.bush([x, 0, 1.95], size);
    k.bush([4.0, 0, 1.0], 0.55);
    k.lamp([4.4, 0, -0.7], ROOF);
    k.poster(-5, -0.3, POSTER_TREAT);
  }

  function mushroom(b, k) {
    b.blob([0, 0.04, 0.25], [3.6, 0.1, 1.9], 1, STONE);
    b.box([0, 1.25, 1.2], [5.2, 2.3, 0.3], WALL);
    k.window([0, 1.75, 1.03]);
    for (const x of [-2.7, 2.7]) k.post([x, 0.05, -0.8], 2.4, WOOD);
    b.blob([0, 2.55, 0.2], [3.75, 0.16, 2.12], 2, WALL);
    b.blob([0, 2.62, 0.2], [3.5, 1.25, 1.95], 2, CAP);
    b.blob([0, 3.95, 0.2], [0.16, 0.16, 0.16], 1, SIGN);
    k.plaque([0, 2.12, -1.95]);
    for (const x of [-1.5, 0, 1.5]) {
      b.prism(0.48, 0.32, 0.3, 8, WOOD, [x, 0, 0.6]);
      b.blob([x, 0.5, 0.6], [0.31, 0.05, 0.31], 1, WALL);
    }
    for (const [x, z, size] of [[-4.0, 0.5, 0.62], [4.1, 0.9, 0.55], [-2.2, 2.0, 0.55], [0.4, 2.05, 0.6], [2.6, 1.95, 0.5]]) k.bush([x, 0, z], size);
    for (const [x, z] of [[-3.3, -0.9], [3.4, -0.6], [3.6, 0.1]]) k.bloom([x, 0, z]);
    k.lamp([-4.6, 0, -0.7], CAP);
    k.poster(5, 0, POSTER_SUNNY);
  }

  function cabin(b, k) {
    b.box([0, 0.06, 0.2], [6.8, 0.12, 2.9], STONE);
    b.box([0, 1.25, 1.25], [6.4, 2.4, 0.3], WOOD);
    for (const x of [-3.05, 3.05]) b.box([x, 1.25, 0.75], [0.3, 2.4, 1.2], WOOD);
    for (const y of [0.6, 1.2, 1.8]) b.box([0, y, 1.08], [6.0, 0.05, 0.04], WALL);
    k.window([0, 1.75, 1.08]);
    for (const x of [-3.0, 3.0]) k.post([x, 0.1, -1.0], 2.4, TRIM);
    const ridge = 3.75, eave = 2.45, front = -1.55, back = 1.95, span = 3.7;
    for (const [edge, n] of [[front, [0, 0.94, -0.33]], [back, [0, 0.94, 0.33]]]) {
      const l = Math.hypot(...n), normal = n.map((x) => x / l);
      b.quad([[-span, eave, edge], [-span, ridge, 0.2], [span, eave, edge], [span, ridge, 0.2]], normal, ROOF_SKY);
      b.quad([[-span, eave - 0.14, edge], [-span, ridge - 0.14, 0.2], [span, eave - 0.14, edge], [span, ridge - 0.14, 0.2]], normal.map((x) => -x), TRIM);
    }
    for (const x of [-3.2, 3.2]) {
      b.quad([[x, eave, front + 0.3], [x, ridge - 0.1, 0.2], [x, eave, back - 0.3], [x, ridge - 0.1, 0.2]], [x > 0 ? 1 : -1, 0, 0], WALL);
    }
    b.box([0, ridge + 0.04, 0.2], [7.6, 0.14, 0.2], TRIM);
    k.plaque([0, 2.2, -1.62]);
    k.bench(-1.3, 0.75, 2.0);
    k.bench(1.3, 0.75, 2.0);
    k.flowerBox([3.75, 0, 0.5]);
    for (const x of [-2.7, -1.0, 0.7, 2.4]) k.bush([x, 0, 1.95], 0.5);
    k.lamp([-4.3, 0, -0.8], ROOF_SKY);
    k.poster(5, -0.2, POSTER_TREAT);
  }

  function pergola(b, k) {
    b.box([0, 0.06, 0.2], [6.8, 0.12, 2.9], STONE);
    b.box([0, 0.55, 1.3], [6.2, 1.0, 0.36], WALL);
    b.box([0, 1.12, 1.3], [6.0, 0.16, 0.5], WOOD);
    for (let x = -2.6; x <= 2.6 + 1e-6; x += 0.65) k.bloom([x, 1.15, 1.3]);
    for (const x of [-3.0, 3.0]) for (const z of [-1.0, 1.3]) k.post([x, 0.1, z], 2.5, TRIM);
    for (let index = 0; index < 8; index++) {
      const x = -3.3 + index * 0.825 + 0.41;
      const material = index % 2 === 0 ? ROOF_BUTTER : WALL;
      b.box([x, 2.68, 0.15], [0.825, 0.16, 3.3], material);
      b.blob([x, 2.6, -1.5], [0.42, 0.3, 0.12], 1, material);
    }
    k.plaque([0, 2.08, -1.62]);
    k.bench(0, 0.75, 4.4);
    for (const x of [-4.3, 4.3]) {
      b.prism(1.0, 0.07, 0.06, 6, WOOD, [x, 0, 0.7]);
      b.blob([x, 0.25, 0.7], [0.42, 0.25, 0.42], 1, WOOD);
      b.blob([x, 1.35, 0.7], [0.58, 0.58, 0.58], 1, BUSH);
      k.bloom([x + 0.2, 1.62, 0.4]);
    }
    for (const [x, size] of [[-1.8, 0.55], [1.9, 0.6]]) k.bush([x, 0, 2.15], size);
    k.lamp([4.5, 0, -0.9], ROOF_BUTTER);
    k.poster(-5, -0.1, POSTER_SUNNY);
  }

  function shelterBuilders(Mesh) {
    return [cottage, mushroom, cabin, pergola].map((build) => {
      const builder = new Mesh();
      build(builder, shelterKit(builder));
      return builder;
    });
  }

  function poleBuilder(Mesh) {
    const b = new Mesh();
    b.prism(1.3, 0.13, 0.11, 10, TRIM);
    b.blob([0, 0.2, 0], [0.42, 0.24, 0.42], 1, WOOD);
    for (let angle = 0.3; angle < 6.2; angle += 1.25) {
      b.blob([Math.cos(angle) * 0.26, 0.44, Math.sin(angle) * 0.26], [0.14, 0.09, 0.14], 1, LEAF);
      b.blob([Math.cos(angle + 0.6) * 0.24, 0.55, Math.sin(angle + 0.6) * 0.24], [0.08, 0.07, 0.08], 1, FLOWER);
    }
    b.box([0, 2.13, 0], [0.6, 1.82, 0.14], SIGN_BOARD);
    for (const x of [-0.36, 0.36]) b.box([x, 2.13, 0], [0.12, 2.0, 0.2], TRIM);
    for (const y of [1.17, 3.09]) b.box([0, y, 0], [0.84, 0.12, 0.2], TRIM);
    b.blob([0, 3.24, 0], [0.56, 0.2, 0.24], 1, ROOF);
    b.blob([0, 3.5, 0], [0.1, 0.1, 0.1], 1, SIGN);
    return b;
  }

  // RouteStopLayer.variant: which of the four shelters a stop gets.
  function shelterVariant(code) {
    const number = /^\d+$/.test(code) ? Number(code) : [...code].reduce((sum, c) => (Math.imul(sum, 31) + c.codePointAt(0)) & 0xffffff, 0);
    return number % 4;
  }

  // The kids materials in SceneryShaders.metal (mapSceneryFragment), spliced into the page's
  // scenery shader. They skip the Muffin canvas filter like the buses do.
  const SCENERY_KIDS = `
${UNFILTER}
float kidsDisc(vec2 p, vec2 center, float radius) { return step(length(p - center), radius); }
vec3 kidsPoster(vec3 local, bool sunny) {
  vec2 p = vec2(fract(local.x + 0.5), (local.y - 0.8) / 1.4);
  vec3 ink = vec3(0.24, 0.18, 0.24);
  vec3 cream = vec3(1.0, 0.97, 0.92);
  vec3 color;
  if (sunny) {
    color = vec3(0.62, 0.84, 0.98);
    if (p.y < 0.36 + 0.05 * sin(p.x * 7.0 + 1.0)) color = vec3(0.56, 0.82, 0.46);
    if (p.y < 0.27 + 0.04 * sin(p.x * 9.0 + 3.0)) color = vec3(0.44, 0.74, 0.38);
    float cloud = max(max(kidsDisc(p, vec2(0.24, 0.6), 0.07), kidsDisc(p, vec2(0.33, 0.63), 0.09)), kidsDisc(p, vec2(0.42, 0.6), 0.07));
    color = mix(color, cream, cloud);
    vec2 sun = vec2(0.66, 0.74);
    float rays = step(abs(fract(atan(p.y - sun.y, p.x - sun.x) / 0.7854) - 0.5), 0.2) * step(length(p - sun), 0.2);
    color = mix(color, vec3(1.0, 0.9, 0.5), rays);
    color = mix(color, vec3(1.0, 0.82, 0.3), kidsDisc(p, sun, 0.13));
    color = mix(color, ink, max(kidsDisc(p, sun + vec2(-0.045, 0.02), 0.016), kidsDisc(p, sun + vec2(0.045, 0.02), 0.016)));
    float smile = step(abs(length(p - (sun + vec2(0, 0.01))) - 0.06), 0.008) * step(p.y, sun.y - 0.02);
    color = mix(color, ink, smile);
    color = mix(color, vec3(1.0, 0.6, 0.6), max(kidsDisc(p, sun + vec2(-0.08, -0.02), 0.018), kidsDisc(p, sun + vec2(0.08, -0.02), 0.018)));
  } else {
    color = vec3(1.0, 0.8, 0.86);
    float stripe = step(0.5, fract((p.x - p.y) * 7.0));
    color = mix(color, vec3(1.0, 0.86, 0.9), stripe * step(0.22, p.y));
    float cone = (p.y - 0.25) / 0.36;
    if (cone > 0.0 && cone < 1.0 && abs(p.x - 0.5) < 0.15 * cone) {
      float waffle = step(0.82, fract((p.x + p.y) * 22.0)) + step(0.82, fract((p.x - p.y) * 22.0));
      color = mix(vec3(0.95, 0.7, 0.42), vec3(0.82, 0.55, 0.3), clamp(waffle, 0.0, 1.0));
    }
    float scoop = max(kidsDisc(p, vec2(0.5, 0.7), 0.17), max(kidsDisc(p, vec2(0.38, 0.62), 0.07), kidsDisc(p, vec2(0.62, 0.62), 0.07)));
    color = mix(color, vec3(0.64, 0.9, 0.78), scoop);
    color = mix(color, ink, max(kidsDisc(p, vec2(0.45, 0.72), 0.018), kidsDisc(p, vec2(0.55, 0.72), 0.018)));
    color = mix(color, vec3(1.0, 0.62, 0.66), max(kidsDisc(p, vec2(0.41, 0.68), 0.02), kidsDisc(p, vec2(0.59, 0.68), 0.02)));
    float smile = step(abs(length(p - vec2(0.5, 0.7)) - 0.045), 0.008) * step(p.y, 0.68);
    color = mix(color, ink, smile);
    color = mix(color, vec3(0.95, 0.3, 0.36), kidsDisc(p, vec2(0.53, 0.9), 0.04));
  }
  float bars = step(0.06, p.y) * step(p.y, 0.11) * step(abs(p.x - 0.5), 0.34) + step(0.14, p.y) * step(p.y, 0.17) * step(abs(p.x - 0.5), 0.22);
  return mix(color, cream, clamp(bars, 0.0, 1.0));
}
float kidsHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
bool kidsMaterial(int material, vec3 local, float night, out vec3 color, out vec3 emissive) {
  emissive = vec3(0.0);
  if (material < 12) return false;
  if (material == 12) color = vec3(0.98, 0.88, 0.72);
  else if (material == 13) color = vec3(0.93, 0.47, 0.44);
  else if (material == 14) color = vec3(0.50, 0.80, 0.70);
  else if (material == 15) color = vec3(0.90, 0.62, 0.42);
  else if (material == 16) { color = vec3(0.56, 0.78, 0.95); emissive = vec3(1.1, 0.85, 0.5) * night; }
  else if (material == 17) {
    float pick = kidsHash(floor(local * 6.0) + 0.5);
    color = pick < 0.4 ? vec3(1.0, 0.5, 0.66) : pick < 0.7 ? vec3(1.0, 0.84, 0.3) : vec3(0.78, 0.6, 1.0);
  }
  else if (material == 18) color = vec3(0.38, 0.70, 0.30);
  else if (material == 19) color = vec3(0.86, 0.83, 0.78);
  else if (material == 20) { color = vec3(1.0, 0.82, 0.36); emissive = vec3(0.5, 0.4, 0.15) * night; }
  else if (material == 21) color = vec3(0.55, 0.76, 0.96);
  else if (material == 22) {
    vec3 cell = floor(local * 1.5);
    vec3 offset = fract(local * 1.5) - 0.5;
    float spot = step(length(offset), 0.26) * step(0.4, kidsHash(cell + 0.5)) * step(2.7, local.y);
    color = mix(vec3(0.76, 0.6, 0.92), vec3(1.0, 0.96, 0.9), spot);
  }
  else if (material == 23) color = vec3(1.0, 0.84, 0.42);
  else if (material == 24) color = mix(vec3(0.3, 0.6, 0.3), vec3(0.42, 0.72, 0.34), kidsHash(floor(local * 3.0) + 0.5));
  else if (material == 25) { color = kidsPoster(local, false); emissive = color * 0.55 * night; }
  else if (material == 26) { color = kidsPoster(local, true); emissive = color * 0.55 * night; }
  else { color = vec3(1.0, 0.95, 0.8); emissive = vec3(0.12, 0.1, 0.06) + vec3(2.2, 1.7, 1.0) * night; }
  return true;
}`;

  const colours = (kind) => Object.fromEntries(Object.entries(PALETTE).map(([name, list]) => [name, list[kind]]));

  return { animal, setup, trail, colours, exhaust, shelterBuilders, poleBuilder, shelterVariant, COAT, SCENERY_KIDS };
})();
