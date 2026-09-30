import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.js'

describe('@skillre/dsh-plugin-pomodoro', () => {
  it('exports the minimal Cordis function-plugin contract', () => {
    expect(plugin.name).toBe('skillre-pomodoro')
    expect(plugin.apply).toBeTypeOf('function')
    expect('default' in plugin).toBe(false)
  })
})
