// Procedural PBR textures for Edit3D scenes (no DOM, deterministic, tileable).
// Copy into the project (e.g. src/kit/textures.js) and tune per design brief.
// Colour maps are near-neutral grey so material.color keeps the (editable) hue.
import * as THREE from 'three'

export function rng(seed = 1) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// 2D gradient noise with an integer period so textures tile. Returns ~0..1.
// periodY defaults to period; pass both to stretch noise along one axis (e.g. wood fibres).
export function makeNoise(seed = 1) {
  const r = rng(seed), p = new Uint8Array(512)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i]
  const g = (h, x, y) => ((h & 1) ? x : -x) + ((h & 2) ? y : -y)
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
  return (x, y, period = 256, periodY = period) => {
    const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y
    const xi = ((X % period) + period) % period, yi = ((Y % periodY) + periodY) % periodY
    const xi1 = (xi + 1) % period, yi1 = (yi + 1) % periodY
    const u = fade(xf), v = fade(yf)
    const a = g(p[p[xi] + yi], xf, yf), b = g(p[p[xi1] + yi], xf - 1, yf)
    const c = g(p[p[xi] + yi1], xf, yf - 1), d = g(p[p[xi1] + yi1], xf - 1, yf - 1)
    const x1 = a + u * (b - a), x2 = c + u * (d - c)
    return (x1 + v * (x2 - x1)) * 0.7 + 0.5
  }
}

// Tileable fBm over u,v in [0,1). base = noise cells across the tile.
export function fbm(noise, u, v, base = 4, octaves = 4) {
  let s = 0, a = 0.5, n = 0
  for (let o = 0; o < octaves; o++) { const f = base << o; s += a * noise(u * f, v * f, f); n += a; a *= 0.5 }
  return s / n
}

const pixelCache = new Map() // immutable pixel data may be shared; Texture objects are not

// fn(u, v) -> [r, g, b, a?] in 0..1. Data textures (normal/roughness) must pass srgb: false.
export function dataTexture(key, size, fn, { srgb = true } = {}) {
  let data = pixelCache.get(key)
  if (!data) {
    data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [r, g, b, a = 1] = fn(x / size, y / size)
      const i = (y * size + x) * 4
      data[i] = r * 255; data[i + 1] = g * 255; data[i + 2] = b * 255; data[i + 3] = a * 255
    }
    pixelCache.set(key, data)
  }
  const t = new THREE.DataTexture(data, size, size)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.needsUpdate = true
  return t
}

// Height field (Float32Array size*size, row-major) -> tangent-space normal map.
export function normalFromHeight(key, size, height, strength = 1.5) {
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)]
  return dataTexture(key, size, (u, v) => {
    const x = Math.floor(u * size), y = Math.floor(v * size)
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength
    const l = Math.hypot(dx, dy, 1)
    return [-dx / l * 0.5 + 0.5, -dy / l * 0.5 + 0.5, 1 / l * 0.5 + 0.5]
  }, { srgb: false })
}

function heightField(size, fn) {
  const h = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = fn(x / size, y / size)
  return h
}

// Set texture repeat from a surface size in metres and the tile size the texture represents.
export function repeatForMeters(textures, width, height, tileMeters = 1) {
  for (const t of Object.values(textures)) if (t?.isTexture) t.repeat.set(width / tileMeters, height / tileMeters)
  return textures
}

// Box-project UVs in metres from vertex positions, choosing the plane by each vertex's dominant
// normal axis. One material then keeps the same texture density on a stool and on a 12 m floor,
// with texture.repeat left at 1. Call after any geometry.rotateX/translate so axes are final.
// tileMeters: metres covered by one texture tile. along: 'x' | 'y' | 'z' puts texture v (wood
// grain direction) on that axis wherever the face plane contains it, e.g. 'x' for a long table.
export function metricUV(geometry, tileMeters = 1, { along = null } = {}) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  const pos = geometry.attributes.position, nor = geometry.attributes.normal
  const uv = new Float32Array(pos.count * 2), p = [0, 0, 0], axis = { x: 0, y: 1, z: 2 }
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i); p[1] = pos.getY(i); p[2] = pos.getZ(i)
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i))
    // in-plane axes [u, v]: top/bottom -> (x, z), faces toward ±X -> (z, y), toward ±Z -> (x, y)
    let a = ay >= ax && ay >= az ? [0, 2] : ax >= az ? [2, 1] : [0, 1]
    if (along && a[0] === axis[along]) a = [a[1], a[0]]
    uv[i * 2] = p[a[0]] / tileMeters
    uv[i * 2 + 1] = p[a[1]] / tileMeters
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geometry
}

// ---------- presets: each returns { map, normalMap, roughnessMap? } ----------

// Wood with grain running along v: nearly straight growth rings with irregular spacing, narrow
// darker latewood lines, fine fibres and soft tone drift. warp ~0.2 quartersawn, ~0.6 flatsawn.
// boards > 0 splits the tile across u into planks with seams, per-plank tone and grain, and one
// staggered end joint per plank: floors, decking, panelling, tabletops. A plank is as long as the
// tile, so with metricUV pick tileMeters = boards * plank width (8 boards * 0.18 m = 1.44).
// rings = grain lines per plank (or per tile when boards = 0). contrast ~0.1 oak/ash, ~0.25 walnut.
export function wood({ seed = 3, size = null, rings = 6, contrast = 0.16, warp = 0.4, boards = 0, seam = 0.003 } = {}) {
  size ??= boards ? 1024 : 512 // floors span the view; furniture-sized pieces need less
  const n = makeNoise(seed), r = rng(seed + 31)
  const k = `wood:${seed}:${size}:${rings}:${contrast}:${warp}:${boards}:${seam}`
  const B = Math.max(1, boards), R = boards ? rings : Math.max(2, Math.round(rings / 2) * 2)
  const plank = Array.from({ length: B }, () => ({ tone: (r() - 0.5) * 0.12, phase: r() * 9, end: r() }))
  // -> { i: plank, lu: 0..1 across the plank, seam: 0..1 joint mask }
  const at = (u, v) => {
    if (!boards) return { i: 0, lu: u, seam: 0 }
    const x = u * B, i = Math.min(B - 1, Math.floor(x)), lu = x - i
    const fv = (v - plank[i].end + 1) % 1
    const s = Math.max(1 - Math.min(lu, 1 - lu) / B / seam, 1 - Math.min(fv, 1 - fv) / seam, 0)
    return { i, lu, seam: s }
  }
  const ring = (u, v, q) => {
    const P = plank[q.i]
    const bend = (fbm(n, (u + P.phase) % 1, v, 2, 3) - 0.5) * 2 * warp
    const spacing = (n(u * B * 4, v + P.phase, B * 4, 1) - 0.5) * 0.8
    const g = 0.5 + 0.5 * Math.sin((q.lu * R + P.phase + bend + spacing) * Math.PI * 2)
    return Math.pow(g, 10) * 0.8 + g * 0.2 // narrow latewood line + soft earlywood band
  }
  const fibre = (u, v) => n(u * 192, v * 6, 192, 6) * 0.6 + n(u * 48, v * 2, 48, 2) * 0.4
  const map = dataTexture(k + ':c', size, (u, v) => {
    const q = at(u, v)
    const t = 0.76 + plank[q.i].tone - ring(u, v, q) * contrast + (fibre(u, v) - 0.5) * contrast * 0.6
      + (fbm(n, u, v, 2, 3) - 0.5) * 0.06 - q.seam * 0.35
    return [t, t * 0.985, t * 0.965]
  })
  const normalMap = normalFromHeight(k + ':n', size, heightField(size, (u, v) => {
    const q = at(u, v)
    return -ring(u, v, q) * 0.2 + fibre(u, v) * 0.3 - q.seam * 1.5
  }), 1.2)
  const roughnessMap = dataTexture(k + ':r', size, (u, v) => {
    const q = at(u, v)
    const rr = 0.55 + plank[q.i].tone * 0.4 + ring(u, v, q) * 0.06 + (fibre(u, v) - 0.5) * 0.12 + q.seam * 0.35
    return [rr, rr, rr]
  }, { srgb: false })
  return { map, normalMap, roughnessMap }
}

// Plaster / limewash / stucco: soft cloudy value + fine trowel grain.
export function plaster({ seed = 7, size = 512, cloud = 0.18, grain = 1.2 } = {}) {
  const n = makeNoise(seed), k = `plaster:${seed}:${size}:${cloud}:${grain}`
  const map = dataTexture(k + ':c', size, (u, v) => {
    const t = 0.8 + (fbm(n, u, v, 2, 3) - 0.5) * cloud + (fbm(n, u, v, 32, 3) - 0.5) * 0.05
    return [t, t * 0.99, t * 0.97]
  })
  const normalMap = normalFromHeight(k + ':n', size, heightField(size, (u, v) => fbm(n, u, v, 16, 4) + fbm(n, u, v, 2, 2) * 0.4), grain)
  const roughnessMap = dataTexture(k + ':r', size, (u, v) => { const r = 0.85 + (fbm(n, u, v, 4, 3) - 0.5) * 0.25; return [r, r, r] }, { srgb: false })
  return { map, normalMap, roughnessMap }
}

// Cast concrete: mottling + pores; optional formwork joints and tie holes (one tile = one panel).
export function concrete({ seed = 5, size = 1024, panel = true, ties = [3, 2] } = {}) {
  const n = makeNoise(seed), r = rng(seed + 9), k = `concrete:${seed}:${size}:${panel}:${ties}`
  // stamp pores (0.5) and tie holes (1, soft edge) into one buffer instead of testing every mark per pixel
  const marks = new Float32Array(size * size)
  const stamp = (cx, cy, rad, value, soft) => {
    const R = Math.ceil(rad * size)
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const q = Math.hypot(x, y) / (rad * size)
      if (q >= 1) continue
      const i = ((Math.floor(cy * size) + y + size) % size) * size + ((Math.floor(cx * size) + x + size) % size)
      marks[i] = Math.max(marks[i], soft ? value * (1 - q) : value)
    }
  }
  for (let i = 0; i < 900; i++) stamp(r(), r(), 0.0015 + r() * 0.003, 0.5, false)
  if (panel) for (let i = 0; i < ties[0]; i++) for (let j = 0; j < ties[1]; j++) stamp((i + 0.5) / ties[0], (j + 0.5) / ties[1], 0.012, 1, true)
  const at = (u, v) => marks[Math.floor(v * size) * size + Math.floor(u * size)]
  const dent = (u, v) => (at(u, v) > 0.5 ? at(u, v) : 0)
  const poreAt = (u, v) => (at(u, v) === 0.5 ? 1 : 0)
  const joint = (u, v) => panel ? Math.max(1 - Math.min(u, 1 - u) / 0.003, 1 - Math.min(v, 1 - v) / 0.003, 0) : 0
  const map = dataTexture(k + ':c', size, (u, v) => {
    const t = 0.72 + (fbm(n, u, v, 3, 4) - 0.5) * 0.16 - joint(u, v) * 0.12 - dent(u, v) * 0.35 - poreAt(u, v) * 0.18
    return [t, t * 0.99, t * 0.97]
  })
  const normalMap = normalFromHeight(k + ':n', size, heightField(size, (u, v) => fbm(n, u, v, 32, 3) * 0.4 - joint(u, v) - dent(u, v) * 2 - poreAt(u, v)), 1.4)
  const roughnessMap = dataTexture(k + ':r', size, (u, v) => { const q = 0.82 + (fbm(n, u, v, 6, 3) - 0.5) * 0.2; return [q, q, q] }, { srgb: false })
  return { map, normalMap, roughnessMap }
}

// Stone / tile floor: tiles x tiles per texture, darker rough joints, per-tile tone variation.
export function stoneTiles({ seed = 13, size = 1024, tiles = [2, 2], joint = 0.006, variation = 0.08 } = {}) {
  const n = makeNoise(seed), r = rng(seed), k = `stone:${seed}:${size}:${tiles}:${joint}:${variation}`
  const tone = Array.from({ length: tiles[0] * tiles[1] }, () => (r() - 0.5) * variation)
  const jointAt = (u, v) => {
    const fu = (u * tiles[0]) % 1, fv = (v * tiles[1]) % 1
    const d = Math.min(fu, 1 - fu, fv, 1 - fv) / tiles[0]
    return d < joint ? 1 : 0
  }
  const map = dataTexture(k + ':c', size, (u, v) => {
    const id = Math.floor(v * tiles[1]) * tiles[0] + Math.floor(u * tiles[0])
    const t = jointAt(u, v) ? 0.55 : 0.78 + tone[id] + (fbm(n, u, v, 8, 4) - 0.5) * 0.12
    return [t, t * 0.985, t * 0.96]
  })
  const normalMap = normalFromHeight(k + ':n', size, heightField(size, (u, v) => (jointAt(u, v) ? -1 : 0) + fbm(n, u, v, 24, 3) * 0.3), 1.2)
  const roughnessMap = dataTexture(k + ':r', size, (u, v) => { const q = jointAt(u, v) ? 0.95 : 0.6 + (fbm(n, u, v, 8, 2) - 0.5) * 0.2; return [q, q, q] }, { srgb: false })
  return { map, normalMap, roughnessMap }
}

// Woven fabric (linen/cotton/wool): fine weave + slubs. Use with MeshPhysicalMaterial sheen.
export function fabric({ seed = 17, size = 256, threads = 64, slub = 0.08 } = {}) {
  const n = makeNoise(seed), k = `fabric:${seed}:${size}:${threads}:${slub}`
  const weave = (u, v) => Math.sin(u * threads * Math.PI * 2) * Math.sin(v * threads * Math.PI * 2)
  const map = dataTexture(k + ':c', size, (u, v) => {
    const t = 0.8 + weave(u, v) * 0.05 + (fbm(n, u, v * 0.25 % 1, 16, 2) - 0.5) * slub
    return [t, t, t]
  })
  const normalMap = normalFromHeight(k + ':n', size, heightField(size, weave), 0.6)
  return { map, normalMap }
}

// Animated water / ripples normal map. Scroll .offset over time (two layers look best).
export function waterNormal({ seed = 11, size = 256, scale = 4, strength = 6 } = {}) {
  const n = makeNoise(seed)
  return normalFromHeight(`water:${seed}:${size}:${scale}:${strength}`, size, heightField(size, (u, v) => fbm(n, u, v, scale, 4)), strength)
}

// Alpha leaf-cluster card for foliage (use alphaTest ~0.5, side: DoubleSide). Hue comes from material.color.
export function leafCard({ seed = 21, size = 256, leaves = 9, length = 0.2, width = 0.07 } = {}) {
  const r = rng(seed)
  const L = Array.from({ length: leaves }, () => ({ x: 0.2 + r() * 0.6, y: 0.2 + r() * 0.6, a: r() * Math.PI, l: length * (0.8 + r() * 0.5), w: width * (0.8 + r() * 0.4), s: 0.75 + r() * 0.25 }))
  return dataTexture(`leaf:${seed}:${size}:${leaves}:${length}:${width}`, size, (u, v) => {
    let alpha = 0, shade = 0
    for (const f of L) {
      const dx = u - f.x, dy = v - f.y, c = Math.cos(f.a), s = Math.sin(f.a)
      const px = (dx * c + dy * s) / f.l, py = (-dx * s + dy * c) / f.w
      if (px * px + py * py < 1) { alpha = 1; shade = Math.max(shade, f.s * (0.85 + 0.15 * (1 - Math.abs(py)))) }
    }
    return [shade, shade, shade, alpha]
  })
}
