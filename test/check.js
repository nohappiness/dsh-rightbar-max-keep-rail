// 浏览器侧驱动：在夹具里按真实顺序改状态，量面板的 x / 宽度，把结果写进 #out。
//
// 这段只在 test/fixture.html 里跑，不进发布产物（package.json 的 files 不含 test/）。
// 判据：插件装上后，全屏面板的左缘应等于左侧栏右缘（x = 左栏宽），
// 宽度 = 视口宽 − 左栏宽；左栏折叠或变抽屉时不留白；退出全屏后一切恢复原生。

const out = document.getElementById('out')
const frame = document.getElementById('frame')
const panel = document.getElementById('panel')
const left = document.getElementById('left')
const results = []

/** 等 n 帧：插件的量宽走 requestAnimationFrame，改完 DOM 必须让出两帧再量。 */
const frames = (n = 2) => new Promise((resolve) => {
  let remaining = n
  const step = () => (remaining-- <= 0 ? resolve() : requestAnimationFrame(step))
  requestAnimationFrame(step)
})

/** 量一次：面板矩形、左栏矩形、视口宽。 */
function measure(label) {
  const p = panel.getBoundingClientRect()
  const l = left.getBoundingClientRect()
  const rounded = (n) => Math.round(n * 100) / 100
  results.push({
    label,
    panelX: rounded(p.x),
    panelWidth: rounded(p.width),
    leftRailWidth: rounded(l.width),
    viewport: window.innerWidth,
    computedWidth: getComputedStyle(panel).width,
    gapToRail: rounded(p.x - (l.x + l.width)),
  })
}

/** 改左栏列宽（模拟拖动左栏手柄）。 */
function setTrack(px) {
  frame.style.gridTemplateColumns = `${px}px minmax(560px, 1fr) minmax(0px, 0px)`
}

const PARAMS = new URLSearchParams(location.search)
/** ?raw=1：只量未装插件的原样（README 截图用）。 */
const RAW = PARAMS.has('raw')
/** ?clean=1：截图前把结果面板藏掉，只留布局。 */
const CLEAN = PARAMS.has('clean')

async function main() {
  await frames(2)
  // 0) 原样：未装插件时全屏面板盖住左栏（这就是要修的现象）。
  measure('before-plugin')
  if (RAW) {
    if (CLEAN) out.style.display = 'none'
    out.textContent = JSON.stringify({ viewport: window.innerWidth, results }, null, 2)
    const stop = document.createElement('div')
    stop.id = 'done'
    document.body.appendChild(stop)
    return
  }

  // 1) 装上插件。真实宿主会给 ctx（含 effect）；这里给空对象走 fallback 分支。
  const registration = window.__registration
  if (!registration) throw new Error('bundle 没有通过 __ModuleLoader__ 注册')
  const mod = registration.factory((specifier) => { throw new Error(`未预期的 require: ${specifier}`) })
  mod.apply({})
  await frames(3)
  measure('after-plugin')

  // 2) 拖动左栏：264 → 320，全屏期间要实时跟上。
  setTrack(320)
  await frames(3)
  measure('left-rail-dragged-320')

  // 3) 折叠左栏：没有轨道了，不该留白。
  setTrack(0)
  frame.setAttribute('data-sidebar-collapsed', '')
  await frames(3)
  measure('left-rail-collapsed')

  // 4) 窄屏抽屉：同样是 0，也不该留白。
  frame.removeAttribute('data-sidebar-collapsed')
  frame.setAttribute('data-sidebar-drawer', '')
  await frames(3)
  measure('left-rail-drawer')

  // 5) 退出全屏：面板回到 push 模式，插件必须完全放手。
  frame.removeAttribute('data-sidebar-drawer')
  frame.removeAttribute('data-rightbar-fullscreen')
  panel.setAttribute('data-sidebar-right-panel', 'push')
  panel.style.width = '420px'
  panel.style.setProperty('--dsh-sidebar-width', '420px')
  setTrack(264)
  await frames(3)
  measure('exit-fullscreen')

  // 6) 再进全屏：规则应立刻重新生效（真实宿主会同时把 frame 的属性挂回来）。
  frame.setAttribute('data-rightbar-fullscreen', '')
  panel.setAttribute('data-sidebar-right-panel', 'fullscreen')
  panel.style.width = '100vw'
  panel.style.setProperty('--dsh-sidebar-width', '100vw')
  await frames(3)
  measure('reenter-fullscreen')

  if (CLEAN) out.style.display = 'none'
  out.textContent = JSON.stringify({
    viewport: window.innerWidth,
    results,
    styleInjected: document.getElementById('dsh-rightbar-max-keep-rail') !== null,
    railVar: document.documentElement.style.getPropertyValue('--dsh-keeprail-left'),
  }, null, 2)
  const done = document.createElement('div')
  done.id = 'done'
  document.body.appendChild(done)
}

main().catch((error) => {
  out.textContent = `ERROR: ${error && error.stack ? error.stack : String(error)}`
  const done = document.createElement('div')
  done.id = 'done'
  done.textContent = 'error'
  document.body.appendChild(done)
})
