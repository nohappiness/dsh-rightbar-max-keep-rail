// node --test：浏览器半的量宽、帧查找、变量写入、样式注入与采样循环。
//
// 加载方式与真实浏览器一致：跑 lib/client.js，接住 window.__ModuleLoader__.load()，
// 再拿它给的 factory(require) 取模块 —— 这样测的就是真正发布的那个文件。
//
// 断言里出现的选择器与变量名都来自 core 的 DOM 契约（ui-sidebar-right / ui-layout
// 发布的数据属性），不是 CSS-module 哈希类名。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 静音 console.warn，测试输出里只留断言。 */
const silentConsole = { warn: () => {}, error: () => {}, log: () => {} }

/** 在沙箱里执行 bundle，返回它注册的模块。 */
function loadBundle() {
  const registrations = []
  const window = { __ModuleLoader__: { load: (registration) => { registrations.push(registration) } } }
  const sandbox = { window, console: silentConsole, Object, Array, String, Symbol, Error, JSON, Math, Number }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.equal(registrations.length, 1, 'bundle 只注册一个模块')
  const registration = registrations[0]
  const requested = []
  const module = registration.factory((specifier) => {
    requested.push(specifier)
    throw new Error(`未预期的 require: ${specifier}`)
  })
  return { registration, module, requested }
}

/**
 * 假的窗口网格：frame（display:grid，三列）+ 全屏面板（absolute right:0）。
 *
 * 属性与 core 一致：全屏时 frame 带 `data-rightbar-fullscreen`，折叠/抽屉各带一个标记，
 * 面板带 `data-sidebar-right-panel="fullscreen"`。
 */
function makeDom(options = {}) {
  const state = {
    fullscreen: options.fullscreen !== false,
    collapsed: options.collapsed === true,
    drawer: options.drawer === true,
    tracks: options.tracks ?? '264px 812px 0px',
  }
  const frame = {
    parentElement: null,
    hasAttribute(name) {
      if (name === 'data-rightbar-fullscreen') return state.fullscreen
      if (name === 'data-sidebar-collapsed') return state.collapsed
      if (name === 'data-sidebar-drawer') return state.drawer
      return false
    },
  }
  const panel = {
    parentElement: frame,
    closest(selector) {
      return state.fullscreen && selector === '[data-rightbar-fullscreen]' ? frame : null
    },
  }
  const nodes = new Map()
  const head = {
    appendChild(node) {
      node.parentNode = head
      if (node.id) nodes.set(node.id, node)
    },
    removeChild(node) {
      node.parentNode = null
      nodes.delete(node.id)
    },
  }
  const doc = {
    head,
    documentElement: {
      style: {
        values: {},
        setProperty(name, value) { this.values[name] = value },
      },
    },
    querySelector(selector) {
      return state.fullscreen && selector === '[data-sidebar-right-panel="fullscreen"]' ? panel : null
    },
    getElementById(id) { return nodes.get(id) ?? null },
    createElement(tag) { return { tagName: tag, id: '', textContent: '', parentNode: null } },
  }
  const gcs = (el) => ({
    gridTemplateColumns: state.tracks,
    display: el === frame ? 'grid' : 'block',
  })
  return { state, frame, panel, doc, gcs, nodes }
}

/** 假的 MutationObserver：记下 observe 参数，供断言「订的是哪三个属性」。 */
function makeObserverClass() {
  const made = []
  class FakeObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      made.push(this)
    }
    observe(node, options) { this.observed = { node, options } }
    disconnect() { this.disconnected = true }
  }
  return { FakeObserver, made }
}

/** 假的 rAF：手动 flush，便于断言「全屏在跑、退出就停」。 */
function makeAnimation() {
  const pending = new Map()
  const cancelled = new Set()
  let next = 1
  return {
    pending,
    cancelled,
    requestAnimationFrame(fn) {
      const id = next++
      pending.set(id, fn)
      return id
    },
    cancelAnimationFrame(id) {
      cancelled.add(id)
      pending.delete(id)
    },
    /** 跑掉当前排队的回调（只跑一轮，不自动继续）。 */
    flush() {
      const queued = [...pending.entries()]
      pending.clear()
      for (const [, fn] of queued) fn()
      return queued.length
    },
  }
}

/** 组装一个完整 env。 */
function makeEnv(domOptions) {
  const dom = makeDom(domOptions)
  const { FakeObserver, made } = makeObserverClass()
  const animation = makeAnimation()
  const listeners = new Map()
  const env = {
    document: dom.doc,
    getComputedStyle: dom.gcs,
    MutationObserver: FakeObserver,
    requestAnimationFrame: animation.requestAnimationFrame,
    cancelAnimationFrame: animation.cancelAnimationFrame,
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
    observers: made,
    animation,
    listeners,
    dom,
  }
  return env
}

test('bundle 只注册一个模块，且不 require 任何东西', () => {
  const { registration, requested } = loadBundle()
  assert.equal(registration.id, 'dsh-rightbar-max-keep-rail')
  assert.deepEqual(requested, [])
})

test('模块对外只声明插件名与空 inject', () => {
  const { module } = loadBundle()
  assert.equal(module.name, 'dsh-rightbar-max-keep-rail')
  assert.deepEqual(Array.from(module.inject), [])
  assert.equal(typeof module.apply, 'function')
})

test('样式：全屏面板宽度 = 100vw − 左栏宽，且压过宿主内联宽度', () => {
  const { module } = loadBundle()
  const css = module.__internals.CSS_TEXT
  assert.match(css, /\[data-sidebar-right-panel="fullscreen"\]/)
  assert.match(css, /width: calc\(100vw - var\(--dsh-keeprail-left, 0px\)\) !important;/)
  assert.match(css, /max-width: none !important;/)
  assert.match(css, /--dsh-sidebar-width: calc\(100vw - var\(--dsh-keeprail-left, 0px\)\) !important;/)
})

test('量宽：读 frame 第一列，折叠/抽屉/量不到都是 0', () => {
  const { module } = loadBundle()
  const { leftRailPx } = module.__internals
  const at = (tracks, flags = {}) => {
    const dom = makeDom({ tracks, ...flags })
    return leftRailPx(dom.frame, dom.gcs)
  }
  assert.equal(at('264px 812px 0px'), 264)
  assert.equal(at('263.5px 812px 0px'), 263.5)
  assert.equal(at('264px 812px 0px', { collapsed: true }), 0)
  assert.equal(at('264px 812px 0px', { drawer: true }), 0)
  assert.equal(at('none'), 0)
  assert.equal(leftRailPx(null, () => { throw new Error('不该被调用') }), 0)
  assert.equal(leftRailPx({ hasAttribute: () => false }, () => { throw new Error('读不到') }), 0)
})

test('找 frame：优先全屏标记，退路是最近的 grid 祖先', () => {
  const { module } = loadBundle()
  const { frameOf } = module.__internals

  const marked = makeDom()
  assert.equal(frameOf(marked.panel, marked.gcs), marked.frame)

  const grid = { parentElement: null }
  const middle = { parentElement: grid }
  const panel = {
    parentElement: middle,
    closest() { return null },
  }
  const gcs = (el) => ({ display: el === grid ? 'grid' : 'block' })
  assert.equal(frameOf(panel, gcs), grid)

  const orphan = { parentElement: null, closest() { return null } }
  assert.equal(frameOf(orphan, gcs), null)
})

test('同步：全屏时把左栏宽写进 <html> 的变量，非全屏不写', () => {
  const { module } = loadBundle()
  const { sync, RAIL_VAR, resetLastRail } = module.__internals

  const off = makeEnv({ fullscreen: false })
  resetLastRail()
  assert.equal(sync(off), false, '非全屏返回 false')
  assert.equal(off.dom.doc.documentElement.style.values[RAIL_VAR], undefined)

  const on = makeEnv({ tracks: '264px 812px 0px' })
  resetLastRail()
  assert.equal(sync(on), true)
  assert.equal(on.dom.doc.documentElement.style.values[RAIL_VAR], '264px')

  // 拖宽左栏：同一次全屏里也应该跟上。
  on.dom.state.tracks = '300px 776px 0px'
  sync(on)
  assert.equal(on.dom.doc.documentElement.style.values[RAIL_VAR], '300px')

  // 折叠左栏：留白归零。
  on.dom.state.collapsed = true
  sync(on)
  assert.equal(on.dom.doc.documentElement.style.values[RAIL_VAR], '0px')
})

test('安装：注入一份样式、只订三个属性、全屏期间逐帧量宽、退出即停', () => {
  const { module } = loadBundle()
  const { STYLE_ID, RAIL_VAR, CSS_TEXT } = module.__internals
  module.__internals.resetLastRail()
  const env = makeEnv({ tracks: '264px 812px 0px' })

  const dispose = module.__internals.install(env)
  const style = env.dom.doc.getElementById(STYLE_ID)
  assert.ok(style, 'style 注入到 head')
  assert.equal(style.textContent, CSS_TEXT)
  assert.equal(env.dom.doc.documentElement.style.values[RAIL_VAR], '264px', '装上就先量一次')
  assert.equal(env.observers.length, 1, '一个 MutationObserver')
  assert.deepEqual(
    Array.from(env.observers[0].observed.options.attributeFilter),
    ['data-rightbar-fullscreen', 'data-sidebar-collapsed', 'data-sidebar-drawer', 'data-sidebar-right-panel'],
  )
  assert.equal(env.observers[0].observed.options.subtree, true)
  assert.ok(env.listeners.has('resize'), '窗口改大小也要重量')

  // 全屏在：跑一帧后还要排下一帧。
  assert.equal(env.animation.flush(), 1)
  assert.equal(env.animation.pending.size, 1)

  // 退出全屏：跑完这一帧不再排。
  env.dom.state.fullscreen = false
  env.animation.flush()
  assert.equal(env.animation.pending.size, 0, '面板消失后停止采样')

  dispose()
  assert.equal(env.observers[0].disconnected, true)
  assert.equal(env.dom.doc.getElementById(STYLE_ID), null, '卸载时把样式也带走')
  assert.equal(env.listeners.has('resize'), false)
})

test('重复安装不会注入第二份样式', () => {
  const { module } = loadBundle()
  const { STYLE_ID } = module.__internals
  const env = makeEnv()
  env.dom.doc.getElementById = (id) => env.dom.nodes.get(id) ?? null

  const first = module.__internals.install(env)
  const second = module.__internals.install(env)
  assert.equal([...env.dom.nodes.keys()].filter(id => id === STYLE_ID).length, 1)
  second()
  first()
})

test('apply：没有 document 时安静退出，不抛错', () => {
  const { module } = loadBundle()
  assert.doesNotThrow(() => module.apply())
  assert.doesNotThrow(() => module.apply({}))
})
