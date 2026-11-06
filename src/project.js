import { createScene } from './scene.js'

// Add independent scene factories here. Each receives its own SDK instance.
export function createProject() {
  return {
    id: 'wukong-showcase',
    name: '大圣 · 景深呼吸',
    defaultSceneId: 'main',
    scenes: [{ id: 'main', name: '一人当关 · 景深展示', createScene }],
  }
}
