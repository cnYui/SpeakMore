# RightAlt 长按拦截提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `RightAlt` 增加长按拦截和提示弹窗，避免长按或过快消费导致重复识别，并把快捷键消费从 `Dashboard` 页面级逻辑上提到 `AppShell` 级。

**Architecture:** 新增一个独立的 renderer 侧快捷键守卫模块，专门处理 `global-keyboard` 事件的单次消费、`500ms` 长按判定、弹窗显隐和关闭策略。`AppShell` 负责监听快捷键与渲染提示浮层，`Dashboard` 退回为纯展示语音状态的页面，不再直接决定全局热键行为。

**Tech Stack:** Electron IPC、React 19、TypeScript、MUI、node:test 结构测试

---

## 文件职责

- `electron-app/renderer/src/services/shortcutGuard.ts`
  - 新增。负责解释 `global-keyboard` 键盘快照，管理长按计时器、单次消费和提示弹窗状态。
- `electron-app/renderer/src/components/AppShell.tsx`
  - 修改。接管全局快捷键监听，渲染长按提示浮层，调用 `toggleRecording`。
- `electron-app/renderer/src/pages/Dashboard.tsx`
  - 修改。移除 `global-keyboard` 监听，只保留语音状态展示与历史写入。
- `electron-app/renderer/src/uiTokens.ts`
  - 修改。补充浮层和快捷键 chip 的通用样式，避免弹窗样式散落。
- `electron-app/renderer/ui-structure.test.mjs`
  - 修改。先写失败测试，覆盖长按阈值、弹窗、`Dashboard` 去耦和 `AppShell` 接管全局快捷键。
- `docs/ai/context/20260513-195529-RightAltLongPressGuard-design.md`
  - 已存在，作为实现依据。

## Task 1: 先把失败测试补出来

**Files:**
- Modify: `electron-app/renderer/ui-structure.test.mjs`

- [ ] **Step 1: 写长按拦截的失败结构测试**

在 `electron-app/renderer/ui-structure.test.mjs` 追加下面几组断言：

```js
test('AppShell 接管全局快捷键并渲染 RightAlt 长按提示浮层', async () => {
  const appShell = await readProjectFile('src/components/AppShell.tsx')
  const guard = await readProjectFile('src/services/shortcutGuard.ts')

  assert.match(appShell, /ipcClient\.on\(['"]global-keyboard['"]/)
  assert.match(appShell, /toggleRecording/)
  assert.match(appShell, /检测到长按快捷键/)
  assert.match(appShell, /onClick=\{\s*handleCloseShortcutHint\s*\}/)
  assert.match(guard, /LONG_PRESS_MS\s*=\s*500/)
  assert.match(guard, /blocked|modalVisible|pressing/)
})

test('Dashboard 不再直接消费 global-keyboard', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx')

  assert.doesNotMatch(dashboard, /global-keyboard/)
  assert.doesNotMatch(dashboard, /findKeyboardShortcutMode/)
  assert.doesNotMatch(dashboard, /toggleRecording\(/)
  assert.match(dashboard, /subscribeVoiceSession/)
})
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm test`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected:

- 新增断言失败
- 失败原因应为 `shortcutGuard.ts` 尚不存在，`AppShell` 还没有弹窗和 `global-keyboard` 监听，`Dashboard` 仍直接消费快捷键

- [ ] **Step 3: 如失败原因不对，先修正测试表达**

只调整测试断言，不改生产代码。确保测试失败点精确落在：

- `AppShell` 未接管热键
- 缺少长按弹窗
- 缺少 `500ms` 阈值
- `Dashboard` 还在消费热键

- [ ] **Step 4: 提交测试红灯检查点**

```bash
git add electron-app/renderer/ui-structure.test.mjs
git commit -m "test: cover right alt long press guard structure"
```

## Task 2: 实现快捷键守卫服务

**Files:**
- Create: `electron-app/renderer/src/services/shortcutGuard.ts`
- Test: `electron-app/renderer/ui-structure.test.mjs`

- [ ] **Step 1: 新建守卫模块骨架**

创建 `electron-app/renderer/src/services/shortcutGuard.ts`，先定义类型和常量：

```ts
import type { VoiceMode } from './voiceTypes'

export const LONG_PRESS_MS = 500

export type ShortcutHintState = {
  visible: boolean
  title: string
  message: string
}

export type ShortcutGuardAction =
  | { type: 'none' }
  | { type: 'start-recording'; mode: VoiceMode }
  | { type: 'show-hint' }
  | { type: 'close-hint' }

export type ShortcutGuardState = {
  isRightAltDown: boolean
  isBlocked: boolean
  modalVisible: boolean
  activeMode: VoiceMode | null
  longPressTimer: number | null
}
```

- [ ] **Step 2: 写最小可用的状态工厂和清理函数**

在同文件继续加入：

```ts
export function createInitialShortcutGuardState(): ShortcutGuardState {
  return {
    isRightAltDown: false,
    isBlocked: false,
    modalVisible: false,
    activeMode: null,
    longPressTimer: null,
  }
}

export function clearShortcutGuardTimer(state: ShortcutGuardState) {
  if (state.longPressTimer !== null) window.clearTimeout(state.longPressTimer)
  return { ...state, longPressTimer: null }
}
```

- [ ] **Step 3: 实现键盘快照解释函数**

同文件实现一个纯函数，输入键盘数组和当前状态，输出新状态与动作：

```ts
type KeyboardLike = { keyName?: string; isKeydown?: boolean }

function resolveMode(keys: KeyboardLike[]): VoiceMode {
  if (keys.some((key) => key.keyName === 'Space' && key.isKeydown)) return 'Ask'
  if (keys.some((key) => key.keyName === 'RightShift' && key.isKeydown)) return 'Translate'
  return 'Dictate'
}

export function reduceShortcutGuard(
  state: ShortcutGuardState,
  rawKeys: unknown,
  onLongPress: () => void,
): { state: ShortcutGuardState; action: ShortcutGuardAction } {
  const keys = Array.isArray(rawKeys) ? rawKeys as KeyboardLike[] : []
  const rightAltDown = keys.some((key) => key.keyName === 'RightAlt' && key.isKeydown)
  const comboDown = keys.some((key) => (key.keyName === 'Space' || key.keyName === 'RightShift') && key.isKeydown)

  if (!rightAltDown) {
    return {
      state: clearShortcutGuardTimer({
        ...state,
        isRightAltDown: false,
        isBlocked: false,
        activeMode: null,
      }),
      action: { type: 'none' },
    }
  }

  if (!state.isRightAltDown) {
    const timer = window.setTimeout(onLongPress, LONG_PRESS_MS)
    return {
      state: {
        ...state,
        isRightAltDown: true,
        isBlocked: false,
        activeMode: resolveMode(keys),
        longPressTimer: timer,
      },
      action: state.modalVisible ? { type: 'close-hint' } : { type: 'none' },
    }
  }

  if (state.isBlocked) {
    return { state: { ...state, activeMode: resolveMode(keys) }, action: { type: 'none' } }
  }

  if (comboDown) {
    return {
      state: clearShortcutGuardTimer({ ...state, activeMode: resolveMode(keys) }),
      action: { type: 'start-recording', mode: resolveMode(keys) },
    }
  }

  return { state: { ...state, activeMode: resolveMode(keys) }, action: { type: 'none' } }
}
```

- [ ] **Step 4: 实现长按触发后的显式阻断函数**

继续在同文件加入：

```ts
export function blockByLongPress(state: ShortcutGuardState) {
  return {
    state: clearShortcutGuardTimer({
      ...state,
      isBlocked: true,
      modalVisible: true,
    }),
    action: { type: 'show-hint' } as const,
  }
}

export function closeShortcutHint(state: ShortcutGuardState) {
  return {
    ...state,
    modalVisible: false,
  }
}
```

- [ ] **Step 5: 运行测试，确认第一组结构测试转绿或只剩 AppShell / Dashboard 未实现**

Run: `npm test`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected:

- `shortcutGuard.ts` 相关结构断言通过
- 仍可能失败在 `AppShell` / `Dashboard` 尚未改造

- [ ] **Step 6: 提交守卫模块检查点**

```bash
git add electron-app/renderer/src/services/shortcutGuard.ts electron-app/renderer/ui-structure.test.mjs
git commit -m "feat: add renderer shortcut guard for right alt"
```

## Task 3: 把全局快捷键监听上提到 AppShell

**Files:**
- Modify: `electron-app/renderer/src/components/AppShell.tsx`
- Modify: `electron-app/renderer/src/uiTokens.ts`
- Test: `electron-app/renderer/ui-structure.test.mjs`

- [ ] **Step 1: 为提示浮层补共用样式**

在 `electron-app/renderer/src/uiTokens.ts` 增加：

```ts
export const overlayCardSx = {
  bgcolor: '#fff',
  borderRadius: '12px',
  border: '1px solid rgba(119,119,119,0.12)',
  boxShadow: '0 16px 36px rgba(17,17,17,0.16), 0 4px 12px rgba(17,17,17,0.08)',
}

export const shortcutChipSx = {
  borderRadius: '6px',
  border: '1px solid rgba(119,119,119,0.12)',
  px: 1,
  py: 0.5,
  fontSize: '13px',
  display: 'inline-flex',
  alignItems: 'center',
}
```

- [ ] **Step 2: 在 AppShell 中接入快捷键守卫状态**

修改 `electron-app/renderer/src/components/AppShell.tsx`，加入：

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { ipcClient } from '../services/ipc'
import { toggleRecording } from '../services/recorder'
import {
  blockByLongPress,
  closeShortcutHint,
  createInitialShortcutGuardState,
  reduceShortcutGuard,
} from '../services/shortcutGuard'
import { overlayCardSx, shortcutChipSx } from '../uiTokens'
```

- [ ] **Step 3: 在 AppShell 中实现长按回调和事件消费**

在 `AppShell` 组件内部加入：

```tsx
const [shortcutGuard, setShortcutGuard] = useState(createInitialShortcutGuardState())

const handleCloseShortcutHint = () => {
  setShortcutGuard((prev) => closeShortcutHint(prev))
}

useEffect(() => {
  return ipcClient.on('global-keyboard', (_event, keys) => {
    let nextAction: null | { type: string; mode?: 'Dictate' | 'Ask' | 'Translate' } = null

    setShortcutGuard((prev) => {
      const next = reduceShortcutGuard(prev, keys, () => {
        setShortcutGuard((current) => blockByLongPress(current).state)
      })
      nextAction = next.action
      return next.state
    })

    if (nextAction?.type === 'close-hint') {
      handleCloseShortcutHint()
      return
    }

    if (nextAction?.type === 'start-recording' && nextAction.mode) {
      void toggleRecording(nextAction.mode)
    }
  })
}, [])
```

实现时不要机械照抄这段，重点保持语义：

- 首次按下 `RightAlt` 只进入判定态
- 超过 `500ms` 才转成长按拦截
- 组合键在阈值前按下时正常识别
- 弹窗显示后再次点按 `RightAlt` 时先关闭弹窗，再允许新的按键周期继续工作

- [ ] **Step 4: 在 AppShell 渲染提示浮层**

在主内容容器内加一层绝对定位浮层：

```tsx
{shortcutGuard.modalVisible && (
  <Box sx={{ position: 'fixed', top: 72, right: 24, zIndex: 1600 }}>
    <Box sx={{ ...overlayCardSx, width: 360, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography sx={{ fontSize: 16, fontWeight: 500 }}>检测到长按快捷键</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.75 }}>
            长按 Right Alt 不会开始语音输入。请短按 Right Alt，或使用 Right Alt + Space / Right Alt + Right Shift。
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.5 }}>
            <Box sx={shortcutChipSx}>Right Alt</Box>
            <Box sx={shortcutChipSx}>Right Alt + Space</Box>
            <Box sx={shortcutChipSx}>Right Alt + Right Shift</Box>
          </Box>
        </Box>
        <IconButton size="small" onClick={handleCloseShortcutHint}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Box>
  </Box>
)}
```

- [ ] **Step 5: 运行测试确认 AppShell 结构转绿**

Run: `npm test`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected:

- `AppShell` 接管热键和弹窗相关结构断言通过
- 可能只剩 `Dashboard` 仍有旧监听导致失败

- [ ] **Step 6: 提交 AppShell 检查点**

```bash
git add electron-app/renderer/src/components/AppShell.tsx electron-app/renderer/src/uiTokens.ts electron-app/renderer/ui-structure.test.mjs
git commit -m "feat: show right alt long press hint in app shell"
```

## Task 4: 去掉 Dashboard 对全局热键的直接消费

**Files:**
- Modify: `electron-app/renderer/src/pages/Dashboard.tsx`
- Test: `electron-app/renderer/ui-structure.test.mjs`

- [ ] **Step 1: 删除页面级快捷键监听和模式解释函数**

从 `Dashboard.tsx` 移除：

- `findKeyboardShortcutMode`
- `ipcClient.on('global-keyboard', ...)`
- 页面内直接调用 `toggleRecording(...)`

保留：

- `subscribeVoiceSession`
- `disposeRecorder`
- `saveVoiceHistory`
- 复制结果逻辑

- [ ] **Step 2: 收敛 imports**

调整 `Dashboard.tsx` 的导入到最小集合，例如：

```tsx
import { Box, Typography, IconButton } from '@mui/material'
import { useEffect, useState } from 'react'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { ipcClient } from '../services/ipc'
import { getVoiceStatusLabel, initialVoiceSession, type VoiceSession } from '../services/voiceTypes'
import { disposeRecorder, subscribeVoiceSession } from '../services/recorder'
import { saveVoiceHistory } from '../services/historyStore'
import { cardSx, subtlePanelSx } from '../uiTokens'
```

- [ ] **Step 3: 保持首页文案与新交互一致**

将提示文案明确成“短按”而不是“按住”，避免与长按拦截冲突。期望类似：

```tsx
<Typography sx={{ fontSize: 14, color: '#5d5d5d', mt: 0.5 }}>
  请短按 <Box component="kbd" ...>Right Alt</Box>，
  或使用 <Box component="kbd" ...>Right Alt + Space</Box>、
  <Box component="kbd" ...>Right Alt + Right Shift</Box> 开始语音输入。
</Typography>
```

- [ ] **Step 4: 运行测试确认全部结构测试通过**

Run: `npm test`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected:

- 全部 `node:test` 结构测试通过

- [ ] **Step 5: 提交 Dashboard 去耦检查点**

```bash
git add electron-app/renderer/src/pages/Dashboard.tsx electron-app/renderer/ui-structure.test.mjs
git commit -m "refactor: move global keyboard handling out of dashboard"
```

## Task 5: 构建与人工验证

**Files:**
- Verify: `electron-app/renderer/dist/**`
- Verify: `electron-app/main.js`
- Verify: `electron-app/renderer/public/floating-bar.html`

- [ ] **Step 1: 构建 renderer**

Run: `npm run build`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected:

- `tsc -b && vite build` 成功
- 生成新的 `dist/assets/index-*.js`

- [ ] **Step 2: 重启 Electron**

Run:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process powershell.exe -WorkingDirectory 'D:\CodeWorkSpace\typeless' -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','npm start *> electron-app/out.log 2> electron-app/err.log'
```

Expected:

- `Typeless` 窗口重新启动
- `electron-app/err.log` 没有新增未处理异常

- [ ] **Step 3: 人工验证短按与长按**

按下面顺序验证：

1. 短按 `RightAlt`
   - 进入正常识别
2. 长按 `RightAlt` 超过 `500ms`
   - 不进入识别
   - 出现提示弹窗
3. 松开 `RightAlt`
   - 弹窗仍保留
4. 点击 `×`
   - 弹窗关闭
5. 弹窗显示后再次短按 `RightAlt`
   - 先关弹窗
   - 再进入正常识别
6. 弹窗显示后再次长按 `RightAlt`
   - 先关旧弹窗
   - 再重新弹出新提示

- [ ] **Step 4: 记录验证结果到上下文文档**

新增一个验证文档到 `docs/ai/context/`，记录：

- 测试命令
- build 结果
- Electron 启动结果
- 长按/短按人工验证结果

- [ ] **Step 5: 提交最终实现**

```bash
git add electron-app/renderer/src/services/shortcutGuard.ts electron-app/renderer/src/components/AppShell.tsx electron-app/renderer/src/pages/Dashboard.tsx electron-app/renderer/src/uiTokens.ts electron-app/renderer/ui-structure.test.mjs docs/ai/context/*.md
git commit -m "feat: guard right alt long press before voice capture"
```

## 自检

- 设计要求中的 `500ms` 阈值已在 Task 2 覆盖。
- “松开后不自动消失、再次点按关闭且允许正常识别”的交互已在 Task 3 和 Task 5 覆盖。
- 未把这次任务扩展到后端协议、麦克风设置、历史统计等无关范围。
- 计划中的测试先于实现，符合当前项目可用的 `node:test` 结构测试方式。

## 执行交接

Plan complete and saved to `docs/ai/context/20260513-195824-RightAltLongPressGuard-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 我分任务执行并在任务间检查  
**2. Inline Execution** - 我在当前会话里直接按这个 plan 连续实现

回复 `1` 或 `2` 即可。
