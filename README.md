# 大圣 · 景深呼吸

一个以东方叙事为主题的桌面 Web 2.5D 视觉实验。项目以原创概念图和人工分层深度图为基础，使用 Three.js ShaderMaterial 实现轻微景深视差、远景柔化和克制的环境循环，用于展示视觉设计、图像分层与 WebGL 前端实现能力。

## 在线演示

- 公开展示版：https://fkbqco4v4qii2.ok.kimi.link
- 版本：1a1afd57-58d2-88c4-8000-000004479b1b（2026-11-06 发布）
- 线上为只读静态展示，保留自动循环与鼠标景深交互，不包含公开编辑和状态保存入口。

## 效果与边界

- 保留全身背影、红色披风、金箍棒、天宫军阵与夕照云层的完整构图。
- 鼠标移动仅产生轻微、平滑的景深反馈，不劫持页面操作。
- 这是原图驱动的 2.5D 展示，不是可自由绕看的完整三维人物，也不包含真实布料或云层物理模拟。
- 当前以桌面 16:9 作品首屏为目标，不做全设备适配。

## 技术实现

- Three.js / WebGL
- JavaScript + ShaderMaterial
- 人工分层深度图
- 深度视差与九点柔化
- Edit3D 本地开发与预览工具

## 本地运行

要求 Node.js 22.12 或更高版本。

```bash
npm install
npm run dev
```

检查与构建：

```bash
npm run check
npm run build
```

## 项目结构

```text
src/                 场景、角色、环境和渲染代码
public/              天空、纹理与深度素材
scripts/             图像分层准备脚本
docs/design-brief.md 视觉与交互设计说明
docs/credits.md      资产来源说明
docs/ref/            原创概念参考
docs/review/         视觉验收记录
```

详细制作方式见 `docs/design-brief.md`，资产来源见 `docs/credits.md`。
