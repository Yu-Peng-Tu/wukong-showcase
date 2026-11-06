import * as THREE from 'three'
import { bindParams, framingReport } from './kit/edit3d.js'

const IMAGE_ASPECT = 16 / 9
const LOOP_SECONDS = 4
const DEFAULT_BLUR = 0.65

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */`
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform float uTime;
uniform float uMotion;
uniform float uFocus;
uniform float uBlur;
uniform float uCapeMotion;
uniform float uInteraction;
uniform float uViewportAspect;
uniform float uOpacity;
uniform vec2 uPointer;
varying vec2 vUv;

vec3 readImage(vec2 uv) {
  return texture2D(uImage, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

void main() {
  vec2 uv = vUv;
  if (uViewportAspect > ${IMAGE_ASPECT}) {
    uv.y = (uv.y - 0.5) * (${IMAGE_ASPECT} / uViewportAspect) + 0.5;
  } else {
    uv.x = (uv.x - 0.5) * (uViewportAspect / ${IMAGE_ASPECT}) + 0.5;
  }

  float phase = mod(uTime, ${LOOP_SECONDS.toFixed(1)}) / ${LOOP_SECONDS.toFixed(1)} * 6.28318530718;
  float depth = texture2D(uDepth, uv).r;
  vec2 drift = vec2(sin(phase), cos(phase) - 1.0);
  vec2 automaticParallax = drift * uMotion * 0.0022 * (depth - uFocus);
  vec2 mouseParallax = uPointer * uInteraction * 0.0032 * (depth - uFocus);
  vec2 parallax = automaticParallax + mouseParallax;

  vec3 center = readImage(uv + parallax);
  float redFabric = smoothstep(1.18, 2.1, center.r / max(center.g, 0.015));
  float capeRegion = smoothstep(0.42, 0.55, uv.x)
    * smoothstep(0.08, 0.20, uv.y)
    * (1.0 - smoothstep(0.72, 0.82, uv.y));
  float capeMask = redFabric * capeRegion * smoothstep(0.64, 0.84, depth);
  vec2 fabricWave = vec2(
    cos(uv.x * 8.0 + phase) * 0.00012,
    sin(uv.x * 10.0 + phase) * 0.00035
  ) * capeMask * uCapeMotion;
  vec2 sampleUv = uv + parallax + fabricWave;

  float radius = clamp(abs(depth - uFocus) * uBlur * 0.0018, 0.0, 0.0022);
  vec3 color = readImage(sampleUv) * 0.28;
  color += readImage(sampleUv + vec2(radius, 0.0)) * 0.09;
  color += readImage(sampleUv - vec2(radius, 0.0)) * 0.09;
  color += readImage(sampleUv + vec2(0.0, radius)) * 0.09;
  color += readImage(sampleUv - vec2(0.0, radius)) * 0.09;
  color += readImage(sampleUv + vec2(radius, radius) * 0.7071) * 0.09;
  color += readImage(sampleUv + vec2(-radius, radius) * 0.7071) * 0.09;
  color += readImage(sampleUv + vec2(radius, -radius) * 0.7071) * 0.09;
  color += readImage(sampleUv - vec2(radius, radius) * 0.7071) * 0.09;

  gl_FragColor = vec4(color, uOpacity);
  #include <colorspace_fragment>
}
`

export async function createScene({ asset }) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, IMAGE_ASPECT, 0.01, 10)
  camera.name = '主镜头 · 作品集首屏'
  camera.position.z = 1
  scene.add(camera)

  const loader = new THREE.TextureLoader()
  const [image, depth] = await Promise.all([
    loader.loadAsync('/textures/wukong-cinematic.jpg'),
    loader.loadAsync('/textures/wukong-depth.png'),
  ])
  image.colorSpace = THREE.SRGBColorSpace
  depth.colorSpace = THREE.NoColorSpace

  const material = new THREE.ShaderMaterial({
    name: '大圣 · 天兵压境景深画面',
    vertexShader,
    fragmentShader,
    uniforms: {
      uImage: { value: image },
      uDepth: { value: depth },
      uTime: { value: 0 },
      uMotion: { value: 0.45 },
      uFocus: { value: 0.9 },
      uBlur: { value: DEFAULT_BLUR },
      uCapeMotion: { value: 0.3 },
      uInteraction: { value: 0.55 },
      uViewportAspect: { value: IMAGE_ASPECT },
      uOpacity: { value: 1 },
      uPointer: { value: new THREE.Vector2() },
    },
    transparent: true,
    depthWrite: false,
  })

  scene.background = new THREE.Color('#101214')
  const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * IMAGE_ASPECT, height), material)
  mesh.name = '大圣 · 全身背影分层画面'
  mesh.onBeforeRender = (_renderer, _scene, renderCamera) => {
    const aspect = renderCamera.aspect || IMAGE_ASPECT
    material.uniforms.uViewportAspect.value = aspect
    if (aspect > IMAGE_ASPECT) mesh.scale.set(aspect / IMAGE_ASPECT, 1, 1)
    else mesh.scale.set(1, IMAGE_ASPECT / aspect, 1)
    material.uniforms.uOpacity.value = material.opacity
  }
  const cinematic = new THREE.Group()
  cinematic.name = '大圣 · 天兵压境'
  cinematic.add(mesh)
  scene.add(cinematic)
  scene.userData.framing = framingReport(scene, cinematic)

  asset.register('cinematic', cinematic, { name: '大圣 · 天兵压境' })
  asset.register('camera_main', camera, { name: '主镜头 · 作品集首屏' })
  asset.registerText('work_index', {
    name: '作品编号',
    text: 'SELECTED WORK  /  01',
    position: [0.065, 0.075],
    visible: true,
    style: {
      font: 'bold 15px sans-serif', color: '#F4E9D2', align: 'left',
      strokeColor: '#000000', strokeWidth: 2, backgroundColor: '#00000000', padding: 4,
    },
  })
  asset.registerText('work_title', {
    name: '作品标题',
    text: '大圣 · 天兵压境',
    position: [0.065, 0.80],
    visible: true,
    style: {
      font: 'bold 42px sans-serif', color: '#F4E9D2', align: 'left',
      strokeColor: '#000000', strokeWidth: 3, backgroundColor: '#00000000', padding: 4,
    },
  })
  asset.registerText('work_discipline', {
    name: '作品类别',
    text: '网页视觉作品  ·  东方叙事与景深',
    position: [0.065, 0.865],
    visible: true,
    style: {
      font: '18px sans-serif', color: '#E2D7C3', align: 'left',
      strokeColor: '#000000', strokeWidth: 2, backgroundColor: '#00000000', padding: 4,
    },
  })

  const settings = { motion: 0.45, focus: 0.9, blur: DEFAULT_BLUR, capeMotion: 0.3, interaction: 0.55 }
  const applySettings = () => {
    material.uniforms.uMotion.value = settings.motion
    material.uniforms.uFocus.value = settings.focus
    material.uniforms.uBlur.value = settings.blur
    material.uniforms.uCapeMotion.value = settings.capeMotion
    material.uniforms.uInteraction.value = settings.interaction
  }
  const offSettings = bindParams(asset, 'cinematic', settings, {
    motion: { label: '氛围 · 自动视差', type: 'number', min: 0, max: 1.5, step: 0.05 },
    focus: { label: '景深 · 人物焦点', type: 'number', min: 0.72, max: 0.98, step: 0.01 },
    blur: { label: '景深 · 远景柔化', type: 'number', min: 0, max: 1.5, step: 0.05 },
    capeMotion: { label: '披风 · 微动态', type: 'number', min: 0, max: 1, step: 0.05 },
    interaction: { label: '鼠标 · 视差反馈', type: 'number', min: 0, max: 1.5, step: 0.05 },
  }, applySettings, { name: '景深与氛围', objectId: 'cinematic' })

  return {
    scene,
    camera,
    play({ canvas, signal }) {
      let time = 0
      const pointer = new THREE.Vector2()
      const target = new THREE.Vector2()
      const setPointer = (x, y) => target.set(
        THREE.MathUtils.clamp(x, -1, 1),
        THREE.MathUtils.clamp(y, -1, 1),
      )
      const onPointerMove = (event) => {
        const rect = canvas.getBoundingClientRect()
        setPointer(
          ((event.clientX - rect.left) / rect.width - 0.5) * 2,
          (0.5 - (event.clientY - rect.top) / rect.height) * 2,
        )
      }
      const onPointerLeave = () => setPointer(0, 0)
      canvas.addEventListener('pointermove', onPointerMove, { signal })
      canvas.addEventListener('pointerleave', onPointerLeave, { signal })

      window.__wukongShowcase = {
        state: () => ({ time, pointer: pointer.toArray(), target: target.toArray(), blur: settings.blur }),
      }
      signal.addEventListener('abort', () => { delete window.__wukongShowcase }, { once: true })

      return {
        update(dt) {
          time = (time + dt) % LOOP_SECONDS
          pointer.lerp(target, 1 - Math.exp(-dt * 9))
          material.uniforms.uPointer.value.copy(pointer)
          material.uniforms.uTime.value = time
        },
        dispose() { delete window.__wukongShowcase },
      }
    },
    dispose() {
      offSettings()
      mesh.geometry.dispose()
      material.dispose()
      image.dispose()
      depth.dispose()
    },
  }
}
