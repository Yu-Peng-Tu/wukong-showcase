import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createCreature } from './kit/creature.js'
import { fabric } from './kit/textures.js'

function namedMaterial(name, options, physical = false) {
  const Material = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial
  const material = new Material(options)
  material.name = name
  return material
}

function mesh(geometry, material, name, position = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, material)
  object.name = name
  object.position.set(...position)
  object.castShadow = true
  object.receiveShadow = true
  return object
}

function makeBackPlate(material) {
  const shape = new THREE.Shape()
  shape.moveTo(-0.25, 1.49)
  shape.lineTo(-0.33, 1.33)
  shape.lineTo(-0.27, 1.10)
  shape.lineTo(-0.15, 0.98)
  shape.lineTo(0.15, 0.98)
  shape.lineTo(0.27, 1.10)
  shape.lineTo(0.33, 1.33)
  shape.lineTo(0.25, 1.49)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.055,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.018,
    bevelSegments: 3,
    curveSegments: 8,
  })
  return mesh(geometry, material, '背甲 · 主体', [0, 0, -0.285])
}

function makeScroll(material, side = 1) {
  const points = [
    [0.02 * side, 1.40, -0.345],
    [0.14 * side, 1.45, -0.35],
    [0.24 * side, 1.38, -0.35],
    [0.20 * side, 1.28, -0.35],
    [0.09 * side, 1.27, -0.35],
    [0.07 * side, 1.34, -0.35],
    [0.14 * side, 1.36, -0.35],
  ].map((p) => new THREE.Vector3(...p))
  const curve = new THREE.CatmullRomCurve3(points)
  return mesh(new THREE.TubeGeometry(curve, 40, 0.012, 7, false), material, '背甲 · 对称卷云纹')
}

function createCape(material) {
  const columns = 36
  const rows = 24
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3)
  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2)
  const indices = []
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= columns; x++) {
      const i = y * (columns + 1) + x
      uvs[i * 2] = x / columns
      uvs[i * 2 + 1] = y / rows
      if (x < columns && y < rows) {
        const a = i
        const b = i + 1
        const c = i + columns + 1
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  const cape = mesh(geometry, material, '披风 · 动态织物')
  cape.frustumCulled = false

  const update = (time = 0, wind = 0.65) => {
    for (let y = 0; y <= rows; y++) {
      const v = y / rows
      for (let x = 0; x <= columns; x++) {
        const u = x / columns
        const i = y * (columns + 1) + x
        const wave = Math.sin(u * 8.5 + v * 3.2 - time * 1.4)
        const ripple = Math.sin(u * 18 - v * 5 + time * 1.9) * 0.35
        const anchored = v * v
        positions[i * 3] = (u - 0.5) * (0.56 + v * 0.85) - anchored * (1.05 + wind * 0.55)
        positions[i * 3 + 1] = 1.51 - v * 0.44 + Math.sin(v * Math.PI) * 0.21 + (wave + ripple) * 0.085 * v * wind
        positions[i * 3 + 2] = -0.19 - v * (0.36 + wind * 0.28) + Math.cos(u * 7 + time) * 0.065 * v * wind
      }
    }
    geometry.attributes.position.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
  }
  update(0)
  return { cape, update }
}

function createStaff(materials) {
  const group = new THREE.Group()
  group.name = '金箍棒 · 原创基础形'
  const shaft = mesh(new THREE.CylinderGeometry(0.024, 0.027, 2.5, 18), materials.staff, '棒身')
  group.add(shaft)
  for (const y of [-1.17, 1.17]) {
    const band = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.24, 18), materials.gold, '棒首 · 金属纹环', [0, y, 0])
    group.add(band)
    for (const offset of [-0.09, 0, 0.09]) {
      const ring = mesh(new THREE.TorusGeometry(0.037, 0.006, 6, 18), materials.gold, '棒首 · 细环', [0, y + offset, 0])
      ring.rotation.x = Math.PI / 2
      group.add(ring)
    }
  }
  group.position.set(0.52, 1.02, -0.08)
  group.rotation.z = -0.29
  group.rotation.x = -0.08
  return group
}

export function createWukong() {
  const group = new THREE.Group()
  group.name = '齐天大圣 · 可替换基础人物'
  const creature = createCreature({
    bones: [
      { name: 'hips', at: [0, 0.91, 0] },
      { name: 'chest', parent: 'hips', at: [0, 1.25, 0] },
      { name: 'neck', parent: 'chest', at: [0, 1.52, 0] },
      { name: 'head', parent: 'neck', at: [0, 1.69, 0] },
      { name: 'arm_L', parent: 'chest', at: [0.34, 1.42, 0] },
      { name: 'forearm_L', parent: 'arm_L', at: [0.47, 1.13, -0.03] },
      { name: 'thigh_L', parent: 'hips', at: [0.16, 0.86, 0] },
      { name: 'shin_L', parent: 'thigh_L', at: [0.18, 0.46, 0.02] },
    ],
    parts: [
      { bones: ['hips', 'chest'], chain: [[0, 0.83, 0, 0.18], [0, 1.10, 0, 0.25], [0, 1.43, 0, 0.24]], color: 'fur' },
      { bone: 'neck', capsule: [[0, 1.43, 0], [0, 1.60, 0]], r: [0.11, 0.10], color: 'fur' },
      { bone: 'head', ellipsoid: [0, 1.70, 0], r: [0.155, 0.19, 0.145], color: 'fur' },
      { bone: 'head', ellipsoid: [0, 1.68, 0.115], r: [0.10, 0.10, 0.075], color: 'face', blend: 0.025 },
      { bone: 'head', ellipsoid: [0.145, 1.72, 0], r: [0.035, 0.06, 0.025], color: 'fur', mirror: true },
      { bones: ['arm_L', 'forearm_L'], chain: [[0.27, 1.45, 0, 0.085], [0.39, 1.30, -0.01, 0.075], [0.47, 1.08, -0.03, 0.06], [0.50, 0.98, -0.05, 0.045]], color: 'fur' },
      { bones: ['thigh_L', 'shin_L'], chain: [[0.14, 0.90, 0, 0.11], [0.17, 0.63, 0.01, 0.085], [0.18, 0.28, 0.02, 0.06], [0.18, 0.08, 0.07, 0.055]], color: 'fur' },
      { bone: 'hips', chain: [[0, 0.88, -0.13, 0.035], [0.10, 0.72, -0.28, 0.028], [0.22, 0.66, -0.38, 0.012]], color: 'fur', flex: 1 },
    ],
    palette: { fur: '#5A3024', face: '#B47A58' },
  }, { name: '大圣 · 连续毛发与身体', detail: 96 })
  group.add(creature.object)

  const materials = {
    armor: namedMaterial('大圣 · 暗金甲胄', { color: '#6E5A36', roughness: 0.38, metalness: 0.85 }),
    dark: namedMaterial('大圣 · 墨黑甲片', { color: '#24282A', roughness: 0.48, metalness: 0.65 }),
    gold: namedMaterial('大圣 · 金箍与纹饰', { color: '#B38A45', roughness: 0.32, metalness: 0.9 }),
    staff: namedMaterial('金箍棒 · 黑金棒身', { color: '#202729', roughness: 0.36, metalness: 0.82 }),
    mane: namedMaterial('大圣 · 深色鬃毛', { color: '#30231F', roughness: 0.94, metalness: 0 }),
  }
  const clothTextures = fabric({ seed: 41, size: 256, threads: 72, slub: 0.12 })
  clothTextures.map.repeat.set(3, 3)
  clothTextures.normalMap.repeat.set(3, 3)
  materials.cape = namedMaterial('披风 · 深红织物', {
    color: '#9D1826',
    roughness: 0.88,
    metalness: 0,
    map: clothTextures.map,
    normalMap: clothTextures.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    sheen: 0.72,
    sheenColor: new THREE.Color('#D64B42'),
    sheenRoughness: 0.78,
    emissive: new THREE.Color('#240308'),
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
  }, true)

  const armor = new THREE.Group()
  armor.name = '甲胄 · 背甲与肩甲'
  const torso = mesh(new THREE.SphereGeometry(0.34, 36, 24), materials.dark, '甲胄 · 躯干底层', [0, 1.27, 0])
  torso.scale.set(1.0, 1.17, 0.68)
  armor.add(torso, makeBackPlate(materials.armor), makeScroll(materials.gold, 1), makeScroll(materials.gold, -1))
  const centerRing = mesh(new THREE.TorusGeometry(0.075, 0.014, 8, 32), materials.gold, '背甲 · 中央兽面环', [0, 1.22, -0.35])
  armor.add(centerRing)
  const centerGem = mesh(new THREE.OctahedronGeometry(0.055, 1), materials.dark, '背甲 · 中央黑玉', [0, 1.22, -0.355])
  centerGem.scale.set(0.75, 1.2, 0.35)
  armor.add(centerGem)
  for (const side of [-1, 1]) {
    const shoulder = mesh(new THREE.SphereGeometry(0.23, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), materials.armor, '肩甲 · 上层', [side * 0.35, 1.43, -0.01])
    shoulder.scale.set(1.15, 0.65, 0.92)
    shoulder.rotation.z = side * -0.22
    armor.add(shoulder)
    for (let i = 0; i < 3; i++) {
      const plate = mesh(new RoundedBoxGeometry(0.27 - i * 0.025, 0.075, 0.24, 3, 0.025), i % 2 ? materials.dark : materials.armor, '肩甲 · 层叠甲片', [side * (0.39 + i * 0.025), 1.35 - i * 0.07, -0.025])
      plate.rotation.z = side * -0.25
      armor.add(plate)
    }
    const bracer = mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.23, 16), materials.armor, '臂甲 · 金属护腕', [side * 0.465, 1.10, -0.03])
    bracer.rotation.z = side * -0.24
    armor.add(bracer)
  }
  for (let i = 0; i < 5; i++) {
    const band = mesh(new RoundedBoxGeometry(0.48 - i * 0.035, 0.055, 0.08, 2, 0.015), i % 2 ? materials.dark : materials.armor, '背甲 · 下缘层片', [0, 1.08 - i * 0.055, -0.31])
    armor.add(band)
  }
  // These vertices already use the creature's world-height coordinates. A zero
  // attachment offset keeps the bone root from applying that height a second time.
  creature.attach('chest', armor, [0, 0, 0])

  const headgear = new THREE.Group()
  headgear.name = '金箍 · 束发冠'
  const backMane = mesh(new THREE.SphereGeometry(1, 28, 20), materials.mane, '鬃毛 · 后脑轮廓', [0, 1.70, -0.075])
  backMane.scale.set(0.154, 0.178, 0.105)
  const napeMane = mesh(new THREE.SphereGeometry(1, 24, 16), materials.mane, '鬃毛 · 颈后层次', [0, 1.585, -0.09])
  napeMane.scale.set(0.115, 0.105, 0.075)
  headgear.add(backMane, napeMane)
  const circlet = mesh(new THREE.TorusGeometry(0.152, 0.014, 8, 48), materials.gold, '金箍 · 主环', [0, 1.735, 0])
  circlet.rotation.x = Math.PI / 2
  headgear.add(circlet)
  const crown = mesh(new THREE.OctahedronGeometry(0.065, 1), materials.gold, '金箍 · 后冠饰', [0, 1.75, -0.15])
  crown.scale.set(1.25, 0.65, 0.35)
  headgear.add(crown)
  for (const side of [-1, 1]) {
    const wing = mesh(new THREE.ConeGeometry(0.035, 0.16, 5), materials.gold, '金箍 · 侧翼', [side * 0.12, 1.79, -0.08])
    wing.rotation.z = side * -0.55
    headgear.add(wing)
  }
  creature.attach('head', headgear, [0, 0, 0])

  const { cape, update: updateCape } = createCape(materials.cape)
  creature.attach('chest', cape, [0, 0, 0])
  const staff = createStaff(materials)
  group.add(staff)

  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })

  return {
    group,
    creature,
    cape,
    staff,
    updateCape,
    sample(time, wind = 0.65) {
      creature.reset()
      const breath = Math.sin(time * Math.PI * 0.5)
      creature.bones.chest.rotation.x = breath * 0.007
      creature.bones.head.rotation.y = Math.sin(time * 0.45) * 0.018
      updateCape(time, wind)
    },
  }
}
