// node --test：宿主半只承担「让这一行被挂上」的职责，别无他物。

import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name } from '../lib/index.js'

test('插件名与包名一致（cordis.patch.yml 的 row name 必须等于它）', () => {
  assert.equal(name, 'dsh-rightbar-max-keep-rail')
  assert.deepEqual(inject, [])
})

test('apply 不依赖任何宿主服务，调用不出错', () => {
  assert.doesNotThrow(() => apply())
  assert.doesNotThrow(() => apply({}))
})
