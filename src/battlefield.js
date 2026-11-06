import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { concrete, metricUV, rng } from './kit/textures.js'

function material(name, color, options = {}) {
  const value = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...options })
  value.name = name
  return value
}

function part(geometry, mat, position, scale, rotation) {
  const mesh = new THREE.Mesh(geometry, mat)
  if (position) mesh.position.set(...position)
  if (scale) mesh.scale.set(...scale)
  if (rotation) mesh.rotation.set(...rotation)
  return mesh
}

// Static ornament is batched by its real material, not flattened into one surface.
function batch(group) {
  group.updateMatrixWorld(true)
  const batches = new Map()
  group.traverse((object) => {
    if (!object.isMesh) return
    const key = object.material.uuid
    if (!batches.has(key)) batches.set(key, { material: object.material, geometries: [] })
    batches.get(key).geometries.push(object.geometry.clone().applyMatrix4(object.matrixWorld))
  })
  const result = new THREE.Group()
  result.name = group.name
  for (const { material: mat, geometries } of batches.values()) {
    const merged = mergeGeometries(geometries, false)
    const mesh = new THREE.Mesh(merged, mat)
    mesh.name = group.name
    result.add(mesh)
    geometries.forEach((geometry) => geometry.dispose())
  }
  group.traverse((object) => { if (object.isMesh) object.geometry.dispose() })
  return result
}

function rockGeometry(radius, height, seed, segments = 9, rings = 6) {
  const random = rng(seed)
  const angles = Array.from({ length: segments }, () => 0.84 + random() * 0.30)
  const vertices = [], indices = []
  for (let row = 0; row <= rings; row++) {
    const v = row / rings
    const profile = 0.80 + Math.sin(v * Math.PI) * 0.23 - v * 0.10
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2
      const r = radius * profile * angles[i] * (0.94 + random() * 0.12)
      vertices.push(Math.cos(a) * r, height * v, Math.sin(a) * r)
    }
  }
  for (let row = 0; row < rings; row++) for (let i = 0; i < segments; i++) {
    const a = row * segments + i, b = row * segments + (i + 1) % segments
    const c = a + segments, d = b + segments
    indices.push(a, b, c, b, d, c)
  }
  const top = vertices.length / 3
  vertices.push(0, height, 0)
  for (let i = 0; i < segments; i++) indices.push(top, rings * segments + (i + 1) % segments, rings * segments + i)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return metricUV(geometry, 1.2)
}

export function createRocks() {
  const group = new THREE.Group()
  group.name = '花果山 · 断崖承台'
  const textures = concrete({ seed: 63, size: 512, panel: false, ties: [0, 0] })
  const stone = material('断崖 · 青灰层岩', '#4D5252', { ...textures, roughness: 0.92, flatShading: true })
  const ledge = material('断崖 · 岩层断面', '#343C40', { ...textures, roughness: 0.96, flatShading: true })
  const pieces = [
    [2.25, 3.6, [0, -3.65, 0.25], 16],
    [1.6, 2.4, [-1.4, -2.42, -0.30], 51],
    [1.7, 2.7, [1.3, -2.75, 0.65], 25],
    [1.9, 3.5, [0.25, -3.55, 1.7], 34],
    [1.3, 1.4, [-1.75, -1.45, 1.35], 75],
  ]
  pieces.forEach(([radius, height, position, seed], index) => {
    const mesh = part(rockGeometry(radius, height, seed), index === 0 ? stone : ledge, position)
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  })
  // Small fractured ledges make the edge read as layered stone, not a single cylinder.
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * Math.PI * 2
    const mesh = part(rockGeometry(0.65, 0.16, 90 + i, 6, 1), i % 2 ? ledge : stone,
      [Math.cos(angle) * 1.4, -0.16 - (i % 3) * 0.13, Math.sin(angle) * 1.4])
    mesh.rotation.y = angle
    group.add(mesh)
  }
  return group
}

function soldierGeometry() {
  const armor = material('天兵 · 远金甲', '#A79877', { metalness: 0.45, roughness: 0.6 })
  const shadow = material('天兵 · 铁黑衣甲', '#414950', { metalness: 0.3, roughness: 0.8 })
  const blade = material('天兵 · 枪刃', '#C7C3AD', { metalness: 0.65, roughness: 0.42 })
  const group = new THREE.Group()
  group.add(part(new THREE.CylinderGeometry(0.19, 0.24, 0.55, 6), armor, [0, 1.03, 0]))
  group.add(part(new THREE.SphereGeometry(0.17, 7, 5), shadow, [0, 1.48, 0]))
  group.add(part(new THREE.SphereGeometry(0.20, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.62), armor, [0, 1.55, 0]))
  group.add(part(new THREE.ConeGeometry(0.065, 0.31, 5), armor, [0, 1.86, 0]))
  for (const side of [-1, 1]) {
    group.add(part(new THREE.CylinderGeometry(0.07, 0.06, 0.63, 5), shadow, [side * 0.11, 0.42, 0], null, [0, 0, side * -0.07]))
    group.add(part(new THREE.CylinderGeometry(0.07, 0.055, 0.60, 5), armor, [side * 0.26, 1.02, 0], null, [0, 0, side * 0.12]))
  }
  group.add(part(new THREE.CylinderGeometry(0.018, 0.018, 2.75, 5), shadow, [0.37, 1.3, 0.05], null, [0, 0, -0.04]))
  group.add(part(new THREE.ConeGeometry(0.075, 0.34, 4), blade, [0.42, 2.81, 0.05], null, [0, 0, -0.04]))
  const result = batch(group)
  return { meshes: result.children, materials: [armor, shadow, blade] }
}

export function createArmy() {
  const group = new THREE.Group()
  group.name = '天兵天将 · 云海军阵'
  const { meshes } = soldierGeometry()
  const placements = []
  const random = rng(812)
  // Keep the nearest ranks beyond the hero's breathing room: the army reads as
  // a vast surrounding force without turning the lower half into a picket fence.
  for (let row = 0; row < 11; row++) {
    const z = 24 + row * 3.4
    const columns = 24 + row * 3
    for (let col = 0; col < columns; col++) {
      const x = (col - (columns - 1) / 2) * 1.38 + (row % 2) * 0.65
      placements.push({ x, y: -2.1 + Math.sin(x * 0.08) * 0.65 + row * 0.05, z, s: 0.90 + random() * 0.14, r: (random() - 0.5) * 0.14 })
    }
  }
  // Higher distant formations make the army surround the subject, not stand on a flat floor.
  for (let row = 0; row < 13; row++) {
    const z = 44 + row * 4.2
    const columns = 52 + row * 2
    for (let col = 0; col < columns; col++) {
      const x = (col - (columns - 1) / 2) * 1.65
      const y = 0.8 + row * 0.55 + Math.cos(x * 0.05) * 1.5
      placements.push({ x, y, z, s: 1.02 + random() * 0.12, r: (random() - 0.5) * 0.10 })
    }
  }
  const dummy = new THREE.Object3D()
  const instances = meshes.map((source) => {
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, placements.length)
    mesh.name = '天兵 · 实例化军阵'
    mesh.frustumCulled = false
    group.add(mesh)
    return mesh
  })
  const settings = { density: 0.72 }
  const update = () => {
    const count = Math.max(12, Math.round(placements.length * settings.density))
    // Deterministic evenly-spaced thinning keeps all ranks represented at lower density.
    for (let i = 0; i < count; i++) {
      const p = placements[Math.min(placements.length - 1, Math.floor(i / count * placements.length))]
      dummy.position.set(p.x, p.y, p.z)
      dummy.scale.setScalar(p.s)
      dummy.rotation.set(0, p.r, 0)
      dummy.updateMatrix()
      instances.forEach((mesh) => mesh.setMatrixAt(i, dummy.matrix))
    }
    instances.forEach((mesh) => { mesh.count = count; mesh.instanceMatrix.needsUpdate = true })
  }
  update()

  const flagTime = { value: 0 }
  const flagMaterial = material('战旗 · 暗红绸面', '#672C2A', { side: THREE.DoubleSide, roughness: 0.92 })
  flagMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uFlagTime = flagTime
    shader.vertexShader = `uniform float uFlagTime;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed.z += sin(position.x * 8.0 - uFlagTime * 1.8) * uv.x * 0.14;`)
  }
  flagMaterial.customProgramCacheKey = () => 'heaven-banner-v1'
  const poleMaterial = material('战旗 · 黑铁杆', '#4B4640', { metalness: 0.55, roughness: 0.6 })
  const flagGeometry = new THREE.PlaneGeometry(0.95, 1.05, 9, 5).translate(0.48, 2.20, 0)
  const poleGeometry = new THREE.CylinderGeometry(0.025, 0.035, 3.25, 6).translate(0, 1.625, 0)
  const flags = new THREE.InstancedMesh(flagGeometry, flagMaterial, 46)
  const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, 46)
  for (let i = 0; i < 46; i++) {
    const z = 27 + Math.floor(i / 5) * 8.2
    dummy.position.set((i % 5 - 2) * (7.5 + z * 0.075), -0.6 + Math.floor(i / 5) * 0.28, z)
    dummy.rotation.set(0, 0.15 + Math.sin(i) * 0.12, -0.04)
    dummy.scale.setScalar(1.15 + z * 0.004)
    dummy.updateMatrix()
    flags.setMatrixAt(i, dummy.matrix)
    poles.setMatrixAt(i, dummy.matrix)
  }
  group.add(flags, poles)
  return { group, settings, update, updateFlags: (time) => { flagTime.value = time }, count: placements.length }
}

function roof(width, depth, height, mat, trim) {
  const group = new THREE.Group()
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, 0.12)
  shape.quadraticCurveTo(-width * 0.35, -height * 0.12, -width * 0.20, height * 0.67)
  shape.quadraticCurveTo(0, height, width * 0.20, height * 0.67)
  shape.quadraticCurveTo(width * 0.35, -height * 0.12, width / 2, 0.12)
  shape.lineTo(width / 2, -0.08)
  shape.quadraticCurveTo(width * 0.30, -height * 0.28, 0, height * 0.72)
  shape.quadraticCurveTo(-width * 0.30, -height * 0.28, -width / 2, -0.08)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 })
  geometry.translate(0, 0, -depth / 2)
  group.add(part(geometry, mat))
  for (const z of [-depth / 2, depth / 2]) {
    group.add(part(new THREE.CylinderGeometry(0.07, 0.07, width * 0.94, 6), trim, [0, 0.01, z], null, [0, 0, Math.PI / 2]))
    for (const side of [-1, 1]) group.add(part(new THREE.ConeGeometry(0.12, 0.6, 5), trim, [side * width * 0.47, 0.26, z], null, [0, 0, side * -0.6]))
  }
  group.add(part(new THREE.CylinderGeometry(0.075, 0.075, depth * 1.06, 6), trim, [0, height * 0.84, 0], null, [Math.PI / 2, 0, 0]))
  return group
}

function hall(width, height, depth, mats) {
  const group = new THREE.Group()
  group.add(part(new THREE.BoxGeometry(width * 0.91, 0.20, depth * 0.93), mats.stone, [0, 0.1, 0]))
  group.add(part(new THREE.BoxGeometry(width * 0.80, height * 0.74, depth * 0.72), mats.shadow, [0, height * 0.46, 0]))
  const columns = Math.round(width / 1.4)
  for (let i = 0; i < columns; i++) {
    const x = (i / (columns - 1) - 0.5) * width * 0.79
    for (const z of [-depth * 0.39, depth * 0.39]) {
      group.add(part(new THREE.CylinderGeometry(0.10, 0.13, height * 0.86, 8), mats.pillar, [x, height * 0.5, z]))
      group.add(part(new THREE.BoxGeometry(0.35, 0.13, 0.35), mats.trim, [x, height * 0.91, z]))
    }
  }
  const top = roof(width * 1.13, depth * 1.16, width * 0.20, mats.roof, mats.trim)
  top.position.y = height * 0.92
  group.add(top)
  return group
}

export function createPalace() {
  const group = new THREE.Group()
  group.name = '天宫 · 凌霄剪影'
  const mats = {
    stone: material('天宫 · 玉石台阶', '#AAA38E', { roughness: 0.82 }),
    pillar: material('天宫 · 朱金立柱', '#7F6050', { roughness: 0.63 }),
    roof: material('天宫 · 琉璃殿瓦', '#7F8989', { metalness: 0.32, roughness: 0.48 }),
    trim: material('天宫 · 檐口金饰', '#BAA06D', { metalness: 0.62, roughness: 0.46 }),
    shadow: material('天宫 · 殿内暗部', '#444B51', { roughness: 0.86 }),
  }
  for (let i = 0; i < 4; i++) group.add(part(new THREE.BoxGeometry(20 - i * 0.6, 0.30, 9 - i * 0.40), mats.stone, [0, i * 0.30, 0]))
  const center = hall(10, 5.2, 5, mats)
  center.position.y = 1.2
  group.add(center)
  const crown = hall(6.8, 3.3, 4, mats)
  crown.position.y = 7.15
  group.add(crown)
  for (const side of [-1, 1]) {
    const wing = hall(5.8, 3.0, 4, mats)
    wing.position.set(side * 8.0, 0.8, 0.4)
    group.add(wing)
    const tower = hall(2.6, 4.2, 2.6, mats)
    tower.position.set(side * 11, 0.2, 1)
    group.add(tower)
  }
  const result = batch(group)
  // With the camera facing +Z, negative world X is screen-right.
  result.position.set(-28, 13, 100)
  result.scale.setScalar(1.2)
  return result
}

function mountainGeometry(radius, height, seed) {
  const random = rng(seed)
  const segments = 9
  const vertices = [], indices = []
  const profile = [1, 0.72, 0.34, 0.018]
  const driftX = (random() - 0.5) * radius * 0.65
  const driftZ = (random() - 0.5) * radius * 0.45
  const angles = Array.from({ length: segments }, () => 0.76 + random() * 0.46)
  for (let row = 0; row < profile.length; row++) {
    const v = row / (profile.length - 1)
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2
      const r = radius * profile[row] * angles[i] * (0.86 + random() * 0.24)
      const ridge = row === 0 ? 0 : (random() - 0.5) * height * 0.075 * (1 - v)
      vertices.push(Math.cos(a) * r + driftX * v, height * v + ridge, Math.sin(a) * r + driftZ * v)
    }
  }
  for (let row = 0; row < profile.length - 1; row++) for (let i = 0; i < segments; i++) {
    const a = row * segments + i, b = row * segments + (i + 1) % segments
    const c = a + segments, d = b + segments
    indices.push(a, b, c, b, d, c)
  }
  const top = vertices.length / 3
  vertices.push(driftX, height, driftZ)
  for (let i = 0; i < segments; i++) indices.push(top, 3 * segments + (i + 1) % segments, 3 * segments + i)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return metricUV(geometry, 2)
}

export function createMountains() {
  const group = new THREE.Group()
  group.name = '远山 · 云海群峰'
  const mats = [
    material('远山 · 青蓝剪影', '#506371', { roughness: 1, flatShading: true }),
    material('远山 · 灰青剪影', '#718088', { roughness: 1, flatShading: true }),
  ]
  const random = rng(492)
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < 15; i++) {
      const radius = 6 + random() * 9, height = 13 + random() * 25
      const mesh = part(mountainGeometry(radius, height, 500 + layer * 30 + i), mats[layer % 2],
        [(i - 7) * 16 + layer * 7 + (random() - 0.5) * 6, -11 - layer * 2, 128 + layer * 42 + random() * 17])
      mesh.scale.z = 0.8 + random() * 0.65
      group.add(mesh)
    }
  }
  return group
}

const cloudVertex = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`
const cloudFragment = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float value = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) { value += noise(p) * amp; p = p * 2.03 + 4.17; amp *= 0.5; }
  return value;
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float edge = smoothstep(1.0, 0.30, length(p * vec2(0.88, 1.18)));
  float cloud = fbm(vUv * vec2(5.0, 3.4) + vec2(uTime * 0.009, 0.0));
  float alpha = edge * smoothstep(0.24, 0.72, cloud) * uOpacity;
  gl_FragColor = vec4(uColor * (0.84 + cloud * 0.28), alpha);
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function createCloudSea() {
  const group = new THREE.Group()
  group.name = '云海 · 流动薄雾'
  const time = { value: 0 }
  const mat = new THREE.ShaderMaterial({
    name: '云海 · 冷灰体积雾层', vertexShader: cloudVertex, fragmentShader: cloudFragment,
    uniforms: { uTime: time, uColor: { value: new THREE.Color('#A2B0BA') }, uOpacity: { value: 0.55 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })
  const random = rng(66)
  const layers = [
    { z: 13, y: -1.3, count: 8, width: 13, height: 4 },
    { z: 43, y: 1.5, count: 10, width: 23, height: 6 },
    { z: 96, y: 6.0, count: 12, width: 36, height: 10 },
  ]
  const dummy = new THREE.Object3D()
  for (const layer of layers) {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, layer.count)
    mesh.name = '云海 · 分层雾带'
    mesh.renderOrder = 3
    mesh.frustumCulled = false
    for (let i = 0; i < layer.count; i++) {
      dummy.position.set((i - (layer.count - 1) / 2) * layer.width * 0.61, layer.y + random() * 2.0, layer.z + random() * 5)
      dummy.scale.set(layer.width * (0.9 + random() * 0.5), layer.height * (0.8 + random() * 0.4), 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    group.add(mesh)
  }
  return { group, update: (t) => { time.value = t } }
}
