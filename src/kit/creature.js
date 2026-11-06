// Smooth skinned characters from a bone + shape spec, with no external tools.
// Shapes are smooth-unioned as a signed distance field, meshed with surface nets, projected
// onto the exact surface (smooth normals at any zoom) and skinned to real THREE.Bone joints.
// Skin weights blend exactly where shapes blend, so elbows, shoulders and necks bend as one
// continuous body instead of rigid parts swinging at pivots.
import * as THREE from 'three'

// Spec, in world rest pose (metres, +Y up, character faces +Z, its left side is +X):
// {
//   bones: [{ name: 'hips', at: [0, 0.5, 0] }, { name: 'chest', parent: 'hips', at: [0, 0.72, 0] }, ...],
//   parts: [
//     { bone: 'chest', capsule: [[0, 0.5, 0], [0, 0.85, 0]], r: [0.2, 0.16], color: 'fur' },
//     { bone: 'head', ellipsoid: [0, 1.05, 0], r: [0.17, 0.15, 0.16], color: 'fur' },
//     { bones: ['arm_L', 'forearm_L'], chain: [[0.12, 0.8, 0, 0.06], [0.3, 0.66, 0, 0.05], [0.45, 0.55, 0.04, 0.045]], color: 'fur' },
//     { bone: 'head', sphere: [0, 1.0, 0.15], r: 0.09, color: 'face', paint: true },   // colour only
//     { bone: 'head', ellipsoid: [0, 0.97, 0.17], r: [0.05, 0.015, 0.03], subtract: true, color: 'mouth' },
//   ],
//   palette: { fur: '#6b4026', face: '#e8b98d', mouth: '#5a2a2a' },
// }
// Shapes: sphere [c] + r, ellipsoid [c] + r[3], capsule [a, b] + r or [rA, rB] (tapered),
// box [c] + size[3] + round, chain [[x, y, z, r], ...]: one smooth tapered tube along a curve
// through the points (limbs, tails, necks, tentacles). A chain with bones: [...] gives span i to
// bones[i] and bends smoothly across each joint; flex sets how far the bend spreads (0.5 default
// for elbows and knees, 1 for tails). ellipsoid/box accept rot [x, y, z] radians.
// Optional per part: blend (smooth-union radius, default 0.35 x smallest radius), paint, subtract,
// mirror (duplicate at -X). Bones with an L segment in their name (arm_L, ear_L_1, ear.L) and the
// parts on them are mirrored to R (arm_R, ear_R_1, ear.R) automatically; earL1 or leftEar are not.
// Keep limbs that must move independently apart by more than their blend in the rest pose.
// Animate by rotating creature.bones[name] (rest rotations are identity, so axes are world axes:
// x nods / swings forward, z raises an arm sideways); rig.js keys/damp/spring/createBlink apply.

const V = (a) => new THREE.Vector3(a[0], a[1], a[2])
const LEFT = /([._])L(?=$|[._0-9])/
const isLeft = (n) => typeof n === 'string' && LEFT.test(n)
const mirrorName = (n) => (isLeft(n) ? n.replace(LEFT, '$1R') : n)
const flipX = (p) => [-p[0], p[1], p[2], ...p.slice(3)]

function expand(spec) {
  const bones = [], parts = []
  for (const b of spec.bones) {
    bones.push(b)
    if (isLeft(b.name)) bones.push({ ...b, name: mirrorName(b.name), parent: mirrorName(b.parent), at: flipX(b.at) })
  }
  const add = (p) => {
    if (!p.chain) return parts.push(p)
    // A chain is one swept tube along a Catmull-Rom curve through its points (8 samples per span).
    const pts = p.chain, sub = p.smooth === false ? 1 : 8, n = pts.length - 1
    const at = (i) => pts[Math.max(0, Math.min(n, i))]
    const cr = (i, t) => [0, 1, 2, 3].map((c) => {
      const p0 = at(i - 1)[c], p1 = at(i)[c], p2 = at(i + 1)[c], p3 = at(i + 2)[c]
      return c === 3 ? p1 + (p2 - p1) * t : 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
    })
    const samples = []
    for (let i = 0; i < n; i++) for (let s = 0; s < sub; s++) samples.push([...cr(i, s / sub), i + s / sub])
    samples.push([...pts[n].slice(0, 4), n])
    const chainBones = p.bones ?? [p.bone]
    parts.push({ ...p, samples, chainBones, bone: chainBones[0], flex: p.flex ?? 0.5, r: Math.min(...pts.map((q) => q[3])) })
  }
  for (const p of spec.parts) {
    add(p)
    if (p.mirror || isLeft(p.bone) || (p.bones || []).some(isLeft)) {
      const q = { ...p, mirror: false, bone: mirrorName(p.bone), bones: p.bones?.map(mirrorName) }
      for (const key of ['sphere', 'ellipsoid', 'box']) if (q[key]) q[key] = flipX(q[key])
      if (q.capsule) q.capsule = q.capsule.map(flipX)
      if (q.chain) q.chain = q.chain.map(flipX)
      if (q.rot) q.rot = [q.rot[0], -q.rot[1], -q.rot[2]]
      add(q)
    }
  }
  return { bones, parts }
}

// Signed distance functions (inigo quilez). Each returns a closure p -> distance plus an AABB.
function compile(p) {
  const minR = Array.isArray(p.r) ? Math.min(...p.r) : p.r ?? Math.min(...(p.size ?? [0.1])) / 2
  const k = p.blend ?? 0.35 * minR
  const inv = p.rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rot)).invert() : null
  const box = new THREE.Box3()
  let f, axisT = null
  const local = (x, y, z, c) => {
    let lx = x - c[0], ly = y - c[1], lz = z - c[2]
    if (inv) {
      const e = inv.elements
      const tx = e[0] * lx + e[4] * ly + e[8] * lz, ty = e[1] * lx + e[5] * ly + e[9] * lz
      lz = e[2] * lx + e[6] * ly + e[10] * lz; lx = tx; ly = ty
    }
    return [lx, ly, lz]
  }
  if (p.samples) {
    // Hard union of round cones between consecutive samples: one smooth tube through every
    // sample, no rings. lastU = curve parameter of the nearest point (for chain skin weights).
    // Flat per-segment constants keep this inner loop (the hottest code here) monomorphic.
    const S = p.samples, n = S.length - 1, C = new Float64Array(n * 16)
    for (let i = 0; i < n; i++) {
      const a = S[i], b = S[i + 1], o = i * 16
      const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], l2 = bx * bx + by * by + bz * bz || 1e-12, rr = a[3] - b[3]
      const r = Math.max(a[3], b[3])
      C.set([a[0], a[1], a[2], bx, by, bz, l2, rr, l2 - rr * rr, a[3], b[3], a[4], b[4] - a[4]], o)
      C[o + 13] = Math.min(a[0], b[0]) - r; C[o + 14] = Math.min(a[1], b[1]) - r; C[o + 15] = Math.min(a[2], b[2]) - r
      box.union(new THREE.Box3(V(a), V(a)).expandByPoint(V(b)).expandByScalar(r))
    }
    const hi = new Float64Array(n * 3)
    for (let i = 0; i < n; i++) { const a = S[i], b = S[i + 1], r = Math.max(a[3], b[3]); hi[i * 3] = Math.max(a[0], b[0]) + r; hi[i * 3 + 1] = Math.max(a[1], b[1]) + r; hi[i * 3 + 2] = Math.max(a[2], b[2]) + r }
    let lastU = 0
    f = (x, y, z) => {
      let best = 1e9, bestI = -1, bestT = 0
      for (let i = 0; i < n; i++) {
        const o = i * 16, h3 = i * 3
        const ex = Math.max(C[o + 13] - x, 0, x - hi[h3]), ey = Math.max(C[o + 14] - y, 0, y - hi[h3 + 1]), ez = Math.max(C[o + 15] - z, 0, z - hi[h3 + 2])
        const lb2 = ex * ex + ey * ey + ez * ez // squared lower bound, valid outside the box
        if (lb2 > 0 && (best <= 0 || lb2 > best * best)) continue
        const pax = x - C[o], pay = y - C[o + 1], paz = z - C[o + 2], bax = C[o + 3], bay = C[o + 4], baz = C[o + 5]
        const l2 = C[o + 6], rr = C[o + 7], a2 = C[o + 8], r1 = C[o + 9], r2 = C[o + 10]
        const yy = pax * bax + pay * bay + paz * baz
        let d
        if (a2 <= 1e-12) { // one sphere contains the other
          d = rr >= 0 ? Math.sqrt(pax * pax + pay * pay + paz * paz) - r1 : Math.hypot(pax - bax, pay - bay, paz - baz) - r2
        } else {
          const zz = yy - l2, il2 = 1 / l2
          const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy
          const x2 = qx * qx + qy * qy + qz * qz, kk = (rr > 0 ? 1 : rr < 0 ? -1 : 0) * rr * rr * x2
          if ((zz > 0 ? a2 : -a2) * zz * zz * l2 > kk) d = Math.sqrt(x2 + zz * zz * l2) * il2 - r2
          else if ((yy > 0 ? a2 : -a2) * yy * yy * l2 < kk) d = Math.sqrt(x2 + yy * yy * l2) * il2 - r1
          else d = (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1
        }
        if (d < best) { best = d; bestI = o; bestT = yy / l2 }
      }
      if (bestI >= 0) lastU = C[bestI + 11] + C[bestI + 12] * Math.min(1, Math.max(0, bestT))
      return best
    }
    axisT = (x, y, z) => { f(x, y, z); return lastU }
  } else if (p.sphere) {
    const [cx, cy, cz] = p.sphere, r = p.r
    f = (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r
    box.setFromCenterAndSize(V(p.sphere), new THREE.Vector3(2 * r, 2 * r, 2 * r))
  } else if (p.ellipsoid) {
    const [rx, ry, rz] = p.r, c = p.ellipsoid
    f = (x, y, z) => {
      const [lx, ly, lz] = local(x, y, z, c)
      const k0 = Math.hypot(lx / rx, ly / ry, lz / rz), k1 = Math.hypot(lx / (rx * rx), ly / (ry * ry), lz / (rz * rz))
      return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1
    }
    const m = Math.max(rx, ry, rz)
    box.setFromCenterAndSize(V(c), new THREE.Vector3(2 * m, 2 * m, 2 * m))
  } else if (p.box) {
    const c = p.box, round = p.round ?? 0.02, h = p.size.map((s) => s / 2 - round)
    f = (x, y, z) => {
      const [lx, ly, lz] = local(x, y, z, c)
      const qx = Math.abs(lx) - h[0], qy = Math.abs(ly) - h[1], qz = Math.abs(lz) - h[2]
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - round
    }
    const m = Math.hypot(...p.size) / 2
    box.setFromCenterAndSize(V(c), new THREE.Vector3(2 * m, 2 * m, 2 * m))
  } else if (p.capsule) {
    const [a, b] = p.capsule, [r1, r2] = Array.isArray(p.r) ? p.r : [p.r, p.r]
    f = roundCone(a, b, r1, r2)
    const ra = new THREE.Vector3(r1, r1, r1), rb = new THREE.Vector3(r2, r2, r2)
    box.set(V(a).sub(ra), V(a).add(ra)).union(new THREE.Box3(V(b).sub(rb), V(b).add(rb)))
  } else throw new Error(`creature part needs a shape: ${JSON.stringify(p).slice(0, 80)}`)
  return { ...p, f, k, box, axisT }
}

// Round cone (iq): the convex hull of spheres (a, r1) and (b, r2). Exact, so a chain of them
// along a tapering line is one smooth cone (plain distance-to-segment minus a lerped radius
// bulges ~1 mm at every sample wherever the radius grows, which shades as stripes).
function roundCone(a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2]
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr
  if (a2 <= 1e-12) { // one sphere contains the other
    const [c, r] = r1 >= r2 ? [a, r1] : [b, r2]
    return (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r
  }
  const il2 = 1 / l2
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2]
    const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2
    const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2, kk = Math.sign(rr) * rr * rr * x2
    if (Math.sign(zz) * a2 * z2 > kk) return Math.sqrt(x2 + z2) * il2 - r2
    if (Math.sign(yy) * a2 * y2 < kk) return Math.sqrt(x2 + y2) * il2 - r1
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1
  }
}

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25 }
const boxDist = (b, x, y, z) => Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.y - y, 0, y - b.max.y), Math.max(b.min.z - z, 0, z - b.max.z))

export function createCreature(spec, { material, detail = 128, weightSmooth = 12, name = 'creature' } = {}) {
  const t0 = performance.now()
  const { bones: boneSpecs, parts: rawParts } = expand(spec)
  const parts = rawParts.map(compile)
  const solids = parts.filter((p) => !p.paint && !p.subtract), carves = parts.filter((p) => p.subtract)
  const sdf = (x, y, z) => {
    let d = 1e9
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i]
      const lb = boxDist(s.box, x, y, z)
      if (lb > 0 && lb - d > s.k) continue
      const di = s.f(x, y, z)
      d = d === 1e9 ? di : smin(d, di, s.k)
    }
    for (const c of carves) {
      if (boxDist(c.box, x, y, z) > c.k) continue
      const di = c.f(x, y, z)
      d = -smin(-d, di, c.k)
    }
    return d
  }

  // Sample grid.
  const bounds = new THREE.Box3()
  for (const s of solids) bounds.union(s.box)
  const size = bounds.getSize(new THREE.Vector3())
  const h = Math.max(size.x, size.y, size.z) / detail
  bounds.expandByScalar(h * 3)
  const nx = Math.ceil((bounds.max.x - bounds.min.x) / h) + 1, ny = Math.ceil((bounds.max.y - bounds.min.y) / h) + 1, nz = Math.ceil((bounds.max.z - bounds.min.z) / h) + 1
  const ox = bounds.min.x, oy = bounds.min.y, oz = bounds.min.z
  // Coarse pass every 4 cells; only blocks the surface can reach are sampled finely.
  const field = new Float32Array(nx * ny * nz), exact = new Uint8Array(nx * ny * nz)
  const B = 4, reach = B * h * Math.sqrt(3) * 0.8
  for (let bk = 0; bk < nz - 1; bk += B) for (let bj = 0; bj < ny - 1; bj += B) for (let bi = 0; bi < nx - 1; bi += B) {
    const ek = Math.min(bk + B, nz - 1), ej = Math.min(bj + B, ny - 1), ei = Math.min(bi + B, nx - 1)
    const dc = sdf(ox + (bi + ei) * h / 2, oy + (bj + ej) * h / 2, oz + (bk + ek) * h / 2)
    const fine = Math.abs(dc) < reach
    for (let k = bk; k <= ek; k++) for (let j = bj; j <= ej; j++) for (let i = bi; i <= ei; i++) {
      const n = i + nx * (j + ny * k)
      if (fine) { if (!exact[n]) { field[n] = sdf(ox + i * h, oy + j * h, oz + k * h); exact[n] = 1 } }
      else if (!exact[n]) field[n] = dc
    }
  }

  // Surface nets: one vertex per sign-changing cell, one quad per sign-changing grid edge.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1)
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k)
  const gid = (i, j, k) => i + nx * (j + ny * k)
  const verts = []
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
  const cv = new Float32Array(8)
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0
    for (let c = 0; c < 8; c++) { cv[c] = field[gid(i + corner[c][0], j + corner[c][1], k + corner[c][2])]; if (cv[c] < 0) mask |= 1 << c }
    if (mask === 0 || mask === 255) continue
    let sx = 0, sy = 0, sz = 0, cnt = 0
    for (const [a, b] of edges) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue
      const t = cv[a] / (cv[a] - cv[b])
      sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t
      sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t
      sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t
      cnt++
    }
    cellVert[cid(i, j, k)] = verts.length / 3
    verts.push(ox + (i + sx / cnt) * h, oy + (j + sy / cnt) * h, oz + (k + sz / cnt) * h)
  }
  const index = []
  const dims = [nx, ny, nz]
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const p = [i, j, k], v0 = field[gid(i, j, k)]
    for (let a = 0; a < 3; a++) {
      const q = p.slice(); q[a]++
      if (q[a] >= dims[a]) continue
      if ((v0 < 0) === (field[gid(...q)] < 0)) continue
      const b = (a + 1) % 3, c = (a + 2) % 3
      const at = (db, dc) => { const r = p.slice(); r[b] -= db; r[c] -= dc; return cellVert[cid(...r)] }
      const c00 = at(1, 1), c10 = at(0, 1), c11 = at(0, 0), c01 = at(1, 0)
      if (c00 < 0 || c10 < 0 || c11 < 0 || c01 < 0) continue
      if (v0 < 0) index.push(c00, c10, c11, c00, c11, c01)
      else index.push(c00, c11, c10, c00, c01, c11)
    }
  }

  // Project onto the exact surface and take normals from the field gradient.
  const count = verts.length / 3
  const position = new Float32Array(verts), normal = new Float32Array(count * 3)
  // Tetrahedral samples give the gradient and (their mean) the distance in 4 evaluations.
  const e = h * 0.5, tg = [0, 0, 0, 0]
  const tetra = (x, y, z) => {
    tg[0] = sdf(x + e, y - e, z - e); tg[1] = sdf(x - e, y - e, z + e); tg[2] = sdf(x - e, y + e, z - e); tg[3] = sdf(x + e, y + e, z + e)
    return [tg[0] - tg[1] - tg[2] + tg[3], -tg[0] - tg[1] + tg[2] + tg[3], -tg[0] + tg[1] - tg[2] + tg[3], (tg[0] + tg[1] + tg[2] + tg[3]) / 4]
  }
  for (let v = 0; v < count; v++) {
    let x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2], g
    for (let it = 0; it < 2; it++) {
      g = tetra(x, y, z)
      const gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2]
      if (gg < 1e-14) break
      const s = Math.max(-h, Math.min(h, (g[3] * 4 * e) / gg)) // |g| ~ 4e for a unit gradient
      x -= g[0] * s; y -= g[1] * s; z -= g[2] * s
    }
    g = tetra(x, y, z)
    const gl = Math.hypot(g[0], g[1], g[2]) || 1
    position.set([x, y, z], v * 3); normal.set([g[0] / gl, g[1] / gl, g[2] / gl], v * 3)
  }
  // Bones (identity rest rotations, so rotation axes are world axes in the rest pose).
  const boneMap = {}, boneList = [], restAt = {}
  for (const b of boneSpecs) {
    if (!Array.isArray(b.at) || b.at.length !== 3) throw new Error(`creature bone ${b.name}: at must be [x, y, z]`)
    const bone = new THREE.Bone(); bone.name = b.name
    boneMap[b.name] = bone; boneList.push(bone); restAt[b.name] = b.at
  }
  for (const b of boneSpecs) {
    const bone = boneMap[b.name], parent = b.parent && boneMap[b.parent]
    if (b.parent && !parent) throw new Error(`creature bone ${b.name}: unknown parent ${b.parent}`)
    const pa = parent ? restAt[b.parent] : [0, 0, 0]
    bone.position.set(b.at[0] - pa[0], b.at[1] - pa[1], b.at[2] - pa[2])
    if (parent) parent.add(bone)
  }
  const boneIndex = Object.fromEntries(boneList.map((b, i) => [b.name, i]))
  for (const s of parts) for (const n of s.chainBones ?? (s.paint || s.subtract ? [] : [s.bone]))
    if (boneIndex[n] === undefined) throw new Error(`creature part on unknown bone ${n}`)

  // Skin weights and colour weights from the same field: a vertex follows every shape that shaped it.
  const keysList = Object.keys(spec.palette ?? { base: '#cccccc' })
  const keyIndex = Object.fromEntries(keysList.map((n, i) => [n, i]))
  const K = keysList.length
  const colorW = new Float32Array(count * K)
  const skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4)
  const soft = h * 1.5
  const NB = boneList.length, bw = new Float32Array(NB), cw = new Float32Array(K)
  let W = new Float32Array(count * NB)
  for (let v = 0; v < count; v++) {
    const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2]
    bw.fill(0); cw.fill(0)
    const ds = solids.map((s) => (boxDist(s.box, x, y, z) > s.k * 2 + soft * 2 ? 1e9 : s.f(x, y, z)))
    const dmin = Math.min(...ds)
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i], t = (ds[i] - dmin) / Math.max(s.k * 1.5, soft)
      if (t < 1) {
        const c = (1 - t) ** 3
        if (!s.chainBones) bw[boneIndex[s.bone]] += c
        else {
          // Along a chain, weights follow the curve parameter, identical all around each ring.
          const u = s.axisT(x, y, z), n = s.chainBones.length
          const j = Math.min(n - 1, Math.max(0, Math.round(u))), f = s.flex
          const blend = j > 0 && j < n ? THREE.MathUtils.smoothstep(u - j, -f / 2, f / 2) : u >= j ? 1 : 0
          const lo = boneIndex[s.chainBones[Math.max(0, j - 1)]], hi = boneIndex[s.chainBones[j]]
          bw[lo] += c * (1 - blend); bw[hi] += c * blend
        }
      }
      const tc = (ds[i] - dmin) / Math.max(s.k * 0.6, soft)
      if (tc < 1 && s.color in keyIndex) cw[keyIndex[s.color]] += (1 - tc) ** 3
    }
    let sum = cw.reduce((a, b) => a + b, 0) || 1
    for (let c = 0; c < K; c++) cw[c] /= sum
    for (const s of parts) {
      if (!(s.paint || s.subtract) || !(s.color in keyIndex)) continue
      if (boxDist(s.box, x, y, z) > (s.soft ?? soft) + s.k) continue
      const d = s.f(x, y, z), w = s.soft ?? soft
      const alpha = s.subtract ? 1 - THREE.MathUtils.smoothstep(d, 0, w + s.k * 0.5) : 1 - THREE.MathUtils.smoothstep(d, -w, w)
      if (alpha <= 0) continue
      for (let c = 0; c < K; c++) cw[c] *= 1 - alpha
      cw[keyIndex[s.color]] += alpha
    }
    colorW.set(cw, v * K)
    let bs = 0
    for (let b = 0; b < NB; b++) bs += bw[b]
    for (let b = 0; b < NB; b++) W[v * NB + b] = bw[b] / (bs || 1)
  }

  // Diffuse skin weights over the surface (a cheap stand-in for heat weights): removes the
  // side-to-side noise of distance-based weights so bends stay smooth instead of lumpy.
  const deg = new Uint32Array(count + 1)
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) deg[index[t + e] + 1] += 2
  for (let v = 0; v < count; v++) deg[v + 1] += deg[v]
  const adj = new Uint32Array(deg[count]), fill = deg.slice(0, count)
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = index[t + e], b = index[t + (e + 1) % 3]
    adj[fill[a]++] = b; adj[fill[b]++] = a
  }
  let W2 = new Float32Array(W.length)
  for (let it = 0; it < weightSmooth; it++) {
    for (let v = 0; v < count; v++) {
      const o = v * NB, n0 = deg[v], n1 = deg[v + 1], inv = 0.5 / Math.max(1, n1 - n0)
      for (let b = 0; b < NB; b++) W2[o + b] = W[o + b] * 0.5
      for (let q = n0; q < n1; q++) { const u = adj[q] * NB; for (let b = 0; b < NB; b++) W2[o + b] += W[u + b] * inv }
    }
    const tmp = W; W = W2; W2 = tmp
  }
  for (let v = 0; v < count; v++) {
    const o = v * NB
    const top = [...Array(NB).keys()].sort((a, b) => W[o + b] - W[o + a]).slice(0, 4)
    const sum = top.reduce((a, i) => a + W[o + i], 0) || 1
    top.forEach((bi, slot) => { skinIndex[v * 4 + slot] = bi; skinWeight[v * 4 + slot] = W[o + bi] / sum })
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  geometry.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1))

  const palette = {}
  const colorAttr = geometry.attributes.color
  const recolor = () => {
    const cols = keysList.map((n) => palette[n])
    for (let v = 0; v < count; v++) {
      let r = 0, g = 0, b = 0
      for (let c = 0; c < K; c++) { const w = colorW[v * K + c]; if (w) { r += cols[c].r * w; g += cols[c].g * w; b += cols[c].b * w } }
      colorAttr.setXYZ(v, r, g, b)
    }
    colorAttr.needsUpdate = true
  }
  for (const n of keysList) palette[n] = new THREE.Color((spec.palette ?? {})[n] ?? '#cccccc')
  recolor()

  const mat = material ?? new THREE.MeshPhysicalMaterial({ roughness: 0.62, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff) })
  mat.vertexColors = true
  if (!mat.name) mat.name = name
  const mesh = new THREE.SkinnedMesh(geometry, mat)
  mesh.name = name
  mesh.castShadow = mesh.receiveShadow = true
  mesh.frustumCulled = false // posed limbs leave the rest-pose bounds
  for (const b of boneSpecs) if (!b.parent) mesh.add(boneMap[b.name])
  mesh.bind(new THREE.Skeleton(boneList))

  const object = new THREE.Group()
  object.name = name
  object.add(mesh)
  const rest = Object.fromEntries(boneList.map((b) => [b.name, b.quaternion.clone()]))
  return {
    object, mesh, bones: boneMap,
    palette: Object.fromEntries(keysList.map((n) => [n, '#' + palette[n].getHexString()])),
    // Instant recolour for registerParams colour fields.
    setColor(key, color) { if (palette[key]) { palette[key].set(color); recolor() } },
    // Put a rigid accessory (eye, tooth, horn, claw) on a bone at a world rest-pose position.
    attach(boneName, child, at = restAt[boneName]) {
      const ra = restAt[boneName]
      if (!ra) throw new Error(`creature attach: unknown bone ${boneName}`)
      child.position.set(at[0] - ra[0], at[1] - ra[1], at[2] - ra[2])
      boneMap[boneName].add(child)
      return child
    },
    // Where a ray from `from` along `dir` leaves the body (rest pose): { point, normal } or null.
    // Cast from inside the head outwards to find exactly where eyes or a nose meet the skin.
    surface(from, dir) {
      const d = V(dir).normalize(), p = V(from), max = size.length() + h * 6
      let prev = sdf(p.x, p.y, p.z), t = 0
      for (; t < max; t += h * 0.5) {
        const q = V(from).addScaledVector(d, t + h * 0.5), cur = sdf(q.x, q.y, q.z)
        if ((prev < 0) !== (cur < 0)) {
          let lo = t, hi = t + h * 0.5
          for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2, r = V(from).addScaledVector(d, m); if ((sdf(r.x, r.y, r.z) < 0) === (prev < 0)) lo = m; else hi = m }
          const point = V(from).addScaledVector(d, (lo + hi) / 2), g = tetra(point.x, point.y, point.z)
          return { point: point.toArray(), normal: new THREE.Vector3(g[0], g[1], g[2]).normalize().toArray() }
        }
        prev = cur
      }
      return null
    },
    // attach + surface: seat `child` where the ray meets the skin, sunk `sink` metres along the
    // normal (eyes: about 0.35 x their radius), its +Z turned along `dir` (eyes look that way).
    attachOnSurface(boneName, child, from, dir, sink = 0) {
      const hit = this.surface(from, dir)
      if (!hit) throw new Error(`creature attachOnSurface: ray from ${from} misses the body`)
      this.attach(boneName, child, V(hit.point).addScaledVector(V(hit.normal), -sink).toArray())
      child.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), V(dir).normalize())
      return child
    },
    reset() { for (const b of boneList) b.quaternion.copy(rest[b.name]) },
    stats: { vertices: count, triangles: index.length / 3, ms: Math.round(performance.now() - t0) },
    dispose() { geometry.dispose(); if (!material) mat.dispose() },
  }
}

// Named, shareable eye materials. Create one set per character and pass it to both eyes, so the
// material panel shows one card per part and a colour change reaches both eyes. name and labels
// become user-visible material names: write them in the user's language.
export function eyeMaterials({ name = 'Eyes', iris = '#4a2c16', sclera = '#fbf8f2', pupil = '#0b0806',
  labels = { sclera: 'sclera', iris: 'iris', pupil: 'pupil', glint: 'catch light' } } = {}) {
  const glossy = (color, label) => {
    const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 })
    m.name = `${name} · ${label}`
    return m
  }
  const glint = new THREE.MeshBasicMaterial({ color: 0xffffff })
  glint.name = `${name} · ${labels.glint}`
  return { sclera: glossy(sclera, labels.sclera), iris: glossy(iris, labels.iris), pupil: glossy(pupil, labels.pupil), glint }
}

// Glossy cartoon eye: sclera + iris + pupil + catch light, looking along +Z. Rotate it to aim.
// Pass materials from eyeMaterials(); without them the eye makes its own set named after `name`.
// irisSize 0.86 / pupilSize 0.5: a big iris with a large pupil reads alive; a small iris in a ring of white
// reads startled or blank. Point both eyes mostly forward (attachOnSurface direction about [±0.35, 0.05, 1])
// and sink them 40-50% of the radius.
export function cartoonEye({ radius = 0.03, iris = '#4a2c16', irisSize = 0.86, pupilSize = 0.5, sclera = '#fbf8f2', name = 'eye', materials } = {}) {
  const mats = materials ?? eyeMaterials({ name, iris, sclera })
  const g = new THREE.Group(); g.name = name
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), mats.sclera); ball.name = 'sclera'
  const cap = (frac, r, material) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.asin(frac)), material)
    m.rotation.x = Math.PI / 2
    return m
  }
  const irisMesh = cap(irisSize * 0.7, radius * 1.004, mats.iris); irisMesh.name = 'iris'
  const pupil = cap(irisSize * pupilSize * 0.7, radius * 1.008, mats.pupil); pupil.name = 'pupil'
  const glint = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.16, 12, 8), mats.glint)
  glint.position.set(radius * 0.32, radius * 0.38, radius * 0.9); glint.name = 'glint'
  g.add(ball, irisMesh, pupil, glint)
  for (const m of [ball, irisMesh, pupil]) m.castShadow = true
  return g
}

// Cartoon mouth on the face, facing +Z like cartoonEye: seat it with attachOnSurface (sink 0).
// At rest it is a closed line: 'smile' (corners up) or 'cat' (ω). setOpen(0..1) opens a dark mouth
// with a tongue under the line for actions (laugh, call, surprise); keep it closed at rest, since a
// permanently open dark mouth reads as a scream. surfaceRadius bends the line back to follow the
// head (about the head's radius at the mouth). The open mouth stands out of the skin by about 0.3 x
// width so a muzzle does not swallow it. Materials are named `${name} · ${label}`.
export function cartoonMouth({ width = 0.08, shape = 'smile', curve = 0.25, thickness = width * 0.07, surfaceRadius = 0.25,
  line = '#3a2224', inner = '#5a1f28', tongue = '#d97a83', name = 'Mouth',
  labels = { line: 'line', inner: 'inside', tongue: 'tongue' } } = {}) {
  const named = (m, label) => { m.name = `${name} · ${label}`; return m }
  const lineMat = named(new THREE.MeshStandardMaterial({ color: line, roughness: 0.6 }), labels.line)
  const innerMat = named(new THREE.MeshStandardMaterial({ color: inner, roughness: 0.75 }), labels.inner)
  const tongueMat = named(new THREE.MeshStandardMaterial({ color: tongue, roughness: 0.55 }), labels.tongue)
  const w = width / 2, back = (x) => -(x * x) / (2 * surfaceRadius)
  const pts = []
  for (let i = 0; i <= 24; i++) {
    const x = -w + (2 * w * i) / 24, u = x / w
    const y = shape === 'cat'
      ? -curve * w * Math.abs(Math.sin(Math.PI * u)) // two arcs meeting at the centre
      : curve * w * (u * u - 1) // corners up
    pts.push(new THREE.Vector3(x, y, back(x)))
  }
  const g = new THREE.Group(); g.name = name
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, thickness / 2, 8), lineMat)
  const caps = [pts[0], pts[pts.length - 1]].map((p) => {
    const c = new THREE.Mesh(new THREE.SphereGeometry(thickness / 2, 10, 8), lineMat); c.position.copy(p); return c
  })
  const open = new THREE.Group(); open.visible = false
  const cavity = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), innerMat)
  cavity.scale.set(w * 0.8, w * 0.9, w * 0.3)
  const tongueMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), tongueMat)
  tongueMesh.scale.set(w * 0.5, w * 0.26, w * 0.12); tongueMesh.position.set(0, -w * 0.58, w * 0.22)
  open.add(cavity, tongueMesh); open.position.set(0, -curve * w, back(0) + 0.001)
  g.add(tube, ...caps, open)
  g.userData.setOpen = (t) => { open.visible = t > 0.02; open.scale.set(1, Math.max(0.02, t), 1) }
  g.setOpen = g.userData.setOpen
  return g
}
