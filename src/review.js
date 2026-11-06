// Verified with the final full-body artwork in the actual Play runtime.
export const review = {
  status: 'passed',
  checks: [
    { name: '新图与作品集首屏', status: 'passed', evidence: 'docs/review/full-body-portfolio.png：使用全身背影新图，完整保留人物、披风、岩石和天兵阵列；标题位于左下暗部，不遮挡主体。' },
    { name: '专属景深分层', status: 'passed', evidence: 'scripts/prepare_cinematic.py 按新图重制人物、披风、前景岩石与金箍棒深度；实际渲染未见旧半身图的局部漂移。' },
    { name: '四秒自动循环与轻微鼠标反馈', status: 'passed', evidence: '真实 Input.dispatchMouseEvent 后 target 与平滑 pointer 均为 [0.5625,0.2317]；时间从 3.499 秒循环至 0.149 秒。' },
    { name: '移除游戏化控件', status: 'passed', evidence: 'Play 首帧仅有宿主运行控件，无暂停、复位、鼠标教学或自定义游戏 HUD；滚轮不再劫持为调参。' },
    { name: '场景、文字与材质检查', status: 'passed', evidence: 'sceneLint=[]；材质为“大圣 · 天兵压境景深画面”；作品编号、标题与类别均正确显示，无 Director 动画或长镜头。' },
  ],
  limitations: [
    '当前是作品集首屏的 2.5D 景深画面，不是可自由绕看的完整三维人物。',
    '景深由人工分层深度图生成，鼠标驱动的是轻微图像视差，不是真实三维相机或布料模拟。',
    '完整个人作品集的导航、案例正文与其他作品将在后续页面中继续建设。',
  ],
}
