// dsh-rightbar-max-keep-rail · 浏览器半：把「面板全屏」的宽度从整个窗口收成「会话区」，
// 让左侧会话列表栏在全屏时依然可见。
//
// ── 原生是什么样（读 core 源码得出，不是推测）────────────────────────────────
// 右侧栏的「面板全屏」（词条 `command.fullscreen` = 面板全屏／退出全屏，快捷键命令
// `pane.fullscreen.toggle`）在 `packages/client/ui-sidebar-right/src/client/shell/
// SidebarRight.tsx:342` 里写死：
//
//     width: fullscreen ? '100vw' : width
//     '--dsh-sidebar-width': fullscreen ? '100vw' : `${width}px`
//     data-sidebar-right-panel: fullscreen ? 'fullscreen' : 'push'
//
// 面板本身是 `position:absolute; inset:0 0 0 auto`（同目录 SidebarRight.module.css:31），
// 全屏时 `--dsh-dockkit-dock-layer: 40`（普通面板 20），于是 100vw 的面板**盖住整个 frame**，
// 左侧会话列表一起被盖掉。
//
// 唯一的例外是 Windows 桌面构建的 SidebarRight.module.css:93：
//
//     [data-windows-titlebar] .panel[data-sidebar-right-panel='fullscreen'] {
//       max-width: calc(100vw - var(--dsh-windows-sidebar-width));
//     }
//
// 而 `--dsh-windows-sidebar-width` 就是左侧栏列宽（ui-layout/src/client/AppFrame.tsx:294
// 写入 `cols.sidebar`）。也就是说「覆盖会话、保留左栏」正是 Windows 桌面端全屏的样子，
// Web 构建缺这一条。本插件把这条规则搬到所有构建：
//
//   1. 一条样式：全屏面板宽度 = 100vw − 左栏宽（面板靠 right:0 定位，自然从右侧往左铺）；
//   2. 一次量宽：从左栏列的网格轨道读出 px，写进 CSS 变量 `--dsh-keeprail-left`。
//
// 量宽必须是活的：左栏可以被拖宽、被折叠、在窄屏变成抽屉（`data-sidebar-drawer`），
// 窗口也可以改大小。所以全屏期间用 rAF 采样（每帧一次 getComputedStyle），
// 只有「全屏面板在场」时才跑；面板一消失就停。
//
// 该用哪个元素、哪个属性：全部是 ui-sidebar-right / ui-layout 已发布的 DOM 契约属性
// （`data-sidebar-right-panel`、`data-rightbar-fullscreen`、`data-sidebar-collapsed`、
// `data-sidebar-drawer`），没有一个 CSS-module 哈希类名。
window.__ModuleLoader__.load({
  id: 'dsh-rightbar-max-keep-rail',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** 注入的 <style> 的 id（也用来防重复注入）。 */
    var STYLE_ID = 'dsh-rightbar-max-keep-rail'
    /** 全屏面板：ui-sidebar-right 发布在面板上的数据属性。 */
    var PANEL_SELECTOR = '[data-sidebar-right-panel="fullscreen"]'
    /** 承载整个窗口网格的 frame：全屏时带这个属性（AppFrame.tsx:305）。 */
    var FRAME_SELECTOR = '[data-rightbar-fullscreen]'
    /**
     * 会改变面板几何的属性：
     *   · `data-rightbar-fullscreen` / `data-sidebar-collapsed` / `data-sidebar-drawer` 在 frame 上；
     *   · `data-sidebar-right-panel` 在面板上（push ↔ fullscreen 的切换标记）。
     * 订上第四个是为了「面板进了全屏但 frame 属性没变」这种宿主差异也能立刻量到。
     */
    var FRAME_ATTRS = [
      'data-rightbar-fullscreen',
      'data-sidebar-collapsed',
      'data-sidebar-drawer',
      'data-sidebar-right-panel',
    ]
    /** 插件写在 <html> 上的变量名：面板通过继承拿到它。 */
    var RAIL_VAR = '--dsh-keeprail-left'

    /**
     * 注入的样式。
     *
     * 面板的宽度与 `--dsh-sidebar-width` 都是宿主内联写的，内联声明压过普通样式表规则，
     * 所以这里必须 `!important`（普通 !important 声明高于内联的普通声明）。
     * `max-width: none` 是为了盖掉 Windows 桌面构建那条 `max-width`——宽度已经算对了，
     * 再让一次会让面板比会话区更窄。
     */
    var CSS_TEXT = [
      '/* dsh-rightbar-max-keep-rail：面板全屏只覆盖会话区，保留左侧会话列表栏 */',
      '[data-sidebar-right-panel="fullscreen"] {',
      '  width: calc(100vw - var(' + RAIL_VAR + ', 0px)) !important;',
      '  max-width: none !important;',
      '  --dsh-sidebar-width: calc(100vw - var(' + RAIL_VAR + ', 0px)) !important;',
      '}',
    ].join('\n')

    /** 上一次写进变量的值，避免每帧重复写（写自定义属性会触发 html 的 style 变更）。 */
    var lastRail = null

    /**
     * 读 frame 左侧第一列（会话列表栏）的宽度。
     *
     * 计算值里的 `grid-template-columns` 已经是解析后的 px 列表
     * （frame 的内联值是 `「${cols.sidebar}px minmax(...) minmax(0, Npx)」`），
     * 所以第一段就是左栏的实际占宽。
     *
     * @param {Element|null} frame - 承载网格的 frame。
     * @param {(el: Element) => CSSStyleDeclaration} gcs - getComputedStyle。
     * @returns {number} 左侧栏像素宽；折叠、抽屉态或量不到时为 0。
     */
    function leftRailPx(frame, gcs) {
      if (!frame || typeof frame.hasAttribute !== 'function') return 0
      // 折叠（无轨道）与窄屏抽屉（浮层，不占列）都不该留白。
      if (frame.hasAttribute('data-sidebar-collapsed')) return 0
      if (frame.hasAttribute('data-sidebar-drawer')) return 0
      var computed
      try {
        computed = gcs(frame).gridTemplateColumns || ''
      } catch (error) {
        return 0
      }
      var first = String(computed).trim().split(/\s+/)[0] || ''
      var px = Number.parseFloat(first)
      if (!Number.isFinite(px) || px <= 0) return 0
      return Math.round(px * 100) / 100
    }

    /**
     * 找承载网格的 frame。
     *
     * 正常路径是全屏时带 `data-rightbar-fullscreen` 的那个元素；万一将来宿主改了属性，
     * 就沿父链找第一个 `display: grid` 的祖先（frame 就是网格容器）。
     *
     * @param {Element} panel - 全屏面板。
     * @param {(el: Element) => CSSStyleDeclaration} gcs - getComputedStyle。
     * @returns {Element|null}
     */
    function frameOf(panel, gcs) {
      if (typeof panel.closest === 'function') {
        var marked = panel.closest(FRAME_SELECTOR)
        if (marked) return marked
      }
      var el = panel.parentElement
      for (var depth = 0; el && depth < 8; depth += 1) {
        var display = ''
        try {
          display = gcs(el).display
        } catch (error) {
          display = ''
        }
        if (display === 'grid' || display === 'inline-grid') return el
        el = el.parentElement
      }
      return null
    }

    /**
     * 同步一次：面板在场就量宽并写变量。
     *
     * @param {object} env - 取 `document` / `getComputedStyle` 的环境（浏览器里是 window）。
     * @returns {boolean} 当前是否处于面板全屏（false = 该停掉采样）。
     */
    function sync(env) {
      var doc = env && env.document
      if (!doc || typeof doc.querySelector !== 'function') return false
      var panel = doc.querySelector(PANEL_SELECTOR)
      if (!panel) return false
      var gcs = function (el) { return env.getComputedStyle(el) }
      var rail = leftRailPx(frameOf(panel, gcs), gcs)
      var root = doc.documentElement
      if (root && root.style && typeof root.style.setProperty === 'function') {
        var next = rail + 'px'
        if (next !== lastRail) {
          root.style.setProperty(RAIL_VAR, next)
          lastRail = next
        }
      }
      return true
    }

    /**
     * 装好样式与采样：注入 <style>，订阅 frame 属性变化，全屏期间逐帧量宽。
     *
     * @param {object} env - 浏览器 window。
     * @returns {() => void} 卸载函数。
     */
    function install(env) {
      var doc = env && env.document
      if (!doc || typeof doc.createElement !== 'function') return function () {}
      if (typeof doc.getElementById !== 'function' || doc.getElementById(STYLE_ID) === null) {
        var style = doc.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS_TEXT
        var host = doc.head || doc.documentElement
        if (host && typeof host.appendChild === 'function') host.appendChild(style)
      }

      var request = typeof env.requestAnimationFrame === 'function'
        ? env.requestAnimationFrame.bind(env)
        : function (fn) { return setTimeout(fn, 16) }
      var cancel = typeof env.cancelAnimationFrame === 'function'
        ? env.cancelAnimationFrame.bind(env)
        : function (id) { clearTimeout(id) }

      var alive = true
      var frameId = 0

      /** 一帧：同步；仍在全屏就继续排下一帧，退出就停。 */
      function tick() {
        frameId = 0
        if (!alive) return
        if (sync(env)) frameId = request(tick)
      }

      /** 状态变了就（重新）起一轮采样；已在采样时不叠加。 */
      function kick() {
        if (alive && frameId === 0) frameId = request(tick)
      }

      var observer = null
      if (typeof env.MutationObserver === 'function' && doc.documentElement) {
        observer = new env.MutationObserver(kick)
        try {
          observer.observe(doc.documentElement, {
            subtree: true,
            attributes: true,
            attributeFilter: FRAME_ATTRS,
          })
        } catch (error) {
          observer = null
        }
      }

      var onResize = function () { kick() }
      if (typeof env.addEventListener === 'function') {
        env.addEventListener('resize', onResize, { passive: true })
      }

      // 首帧就可能已经是全屏（全屏状态是持久化的），所以直接量一次再排采样。
      sync(env)
      kick()

      return function uninstall() {
        alive = false
        if (frameId) {
          cancel(frameId)
          frameId = 0
        }
        if (observer) {
          try {
            observer.disconnect()
          } catch (error) {
            // 已经断开：无事可做。
          }
        }
        if (typeof env.removeEventListener === 'function') {
          env.removeEventListener('resize', onResize)
        }
        var node = typeof doc.getElementById === 'function' ? doc.getElementById(STYLE_ID) : null
        if (node && node.parentNode) node.parentNode.removeChild(node)
        lastRail = null
      }
    }

    /**
     * 客户端插件体：装样式与采样，随插件生命周期卸载。
     *
     * @param {object} ctx - 客户端根上下文。
     */
    function apply(ctx) {
      if (typeof window === 'undefined' || !window.document) return
      var effect = ctx && typeof ctx.effect === 'function'
        ? ctx.effect.bind(ctx)
        : function (fn) { return fn() }
      effect(function () { return install(window) }, 'dsh-rightbar-max-keep-rail: keep the left rail')
    }

    module.exports = {
      name: 'dsh-rightbar-max-keep-rail',
      inject: [],
      apply: apply,
      // 仅供 test/ 直取纯函数。
      __internals: {
        CSS_TEXT: CSS_TEXT,
        PANEL_SELECTOR: PANEL_SELECTOR,
        FRAME_SELECTOR: FRAME_SELECTOR,
        RAIL_VAR: RAIL_VAR,
        STYLE_ID: STYLE_ID,
        leftRailPx: leftRailPx,
        frameOf: frameOf,
        sync: sync,
        install: install,
        resetLastRail: function () { lastRail = null },
      },
    }
    return module.exports
  },
})
