# Settings Realization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把翻译目标语言、界面语言、DeepSeek API Key 和开机启动四个设置项做成真实可验证实现。

**Architecture:** Electron 主进程继续作为 renderer 的本地设置和系统能力边界；后端只暴露 DeepSeek 运行时配置接口。renderer 新增轻量 i18n 字典，设置页通过 IPC 和后端接口驱动真实行为。

**Tech Stack:** Electron main process、Vite + React + MUI + TypeScript、FastAPI、Python unittest/pytest、Node test。

---

## 文件结构

- Modify: `electron-app/renderer/src/services/settingsStore.ts`
  - 扩展 `preferredLanguage` 和 `translationTargetLanguage` 类型、默认值和归一化。
- Create: `electron-app/renderer/src/services/languages.ts`
  - 集中定义界面语言与翻译目标语言选项，供 Settings 和测试复用。
- Create: `electron-app/renderer/src/services/i18n.ts`
  - 轻量字典、`t()`、参数替换和语言归一化。
- Create: `electron-app/renderer/src/services/i18n.test.ts`
  - 覆盖字典完整性、回退和参数替换。
- Modify: `electron-app/renderer/src/pages/Settings.tsx`
  - 语言选项、DeepSeek 配置保存、开机启动真实回读。
- Modify: `electron-app/renderer/src/pages/Dashboard.tsx`
  - 使用 i18n 文案。
- Modify: `electron-app/renderer/src/pages/History.tsx`
  - 使用 i18n 文案。
- Modify: `electron-app/renderer/src/pages/Diagnostics.tsx`
  - 使用 i18n 文案。
- Modify: `electron-app/renderer/src/components/AppShell.tsx`
  - 持有当前界面语言并响应 `i18n:language-changed`。
- Modify: `electron-app/renderer/src/components/Sidebar.tsx`
  - 接收语言并渲染导航文案。
- Modify: `electron-app/renderer/src/navigation.ts`
  - 只保留 page 元数据，label 改由 i18n 提供。
- Modify: `electron-app/renderer/src/services/diagnostics.ts`
  - 接收语言参数或翻译函数。
- Modify: `electron-app/renderer/src/services/historyStore.ts`
  - 时间和速度格式支持语言参数。
- Modify: `electron-app/renderer/src/services/voiceTypes.ts`
  - 错误和悬浮条状态文案支持语言参数。
- Modify: `electron-app/renderer/public/floating-bar.html`
  - 增加本地双语字典并响应语言变更。
- Modify: `electron-app/renderer/public/floating-panel.html`
  - 增加本地双语字典并响应语言变更。
- Modify: `electron-app/renderer/src/services/recorder.ts`
  - 调用带语言的 `toFloatingBarState()`。
- Modify: `electron-app/renderer/src/services/recorder.behavior.test.ts`
  - 扩展翻译目标语言参数测试。
- Modify: `electron-app/renderer/ui-structure.test.mjs`
  - 更新结构断言，去掉“语言固定”的旧断言。
- Modify: `electron-app/main.js`
  - 设置归一化、多语言广播、开机启动回读、DeepSeek 配置 IPC。
- Create: `electron-app/settings-normalization.test.mjs`
  - 覆盖主进程可导出的设置归一化纯函数。
- Create: `electron-app/auto-launch.test.mjs`
  - 覆盖开机启动读写包装函数。
- Modify: `server/runtime_config.py`
  - DeepSeek `.env` 更新、脱敏状态和环境变量热更新。
- Modify: `server/refiner.py`
  - client reset、翻译语言显示名。
- Modify: `server/main.py`
  - 新增 DeepSeek 配置接口。
- Modify: `server/test_runtime_config.py`
  - 覆盖 `.env` 更新行为。
- Modify: `server/test_refiner_prompts.py`
  - 覆盖 client reset 和目标语言显示名。
- Create: `server/test_deepseek_config_api.py`
  - 覆盖后端配置接口。
- Modify: `AGENTS.md`
  - 实现完成后更新当前真实架构和已知限制。

---

## Task 1: 翻译目标语言扩展

**Files:**
- Create: `electron-app/renderer/src/services/languages.ts`
- Modify: `electron-app/renderer/src/services/settingsStore.ts`
- Modify: `electron-app/main.js`
- Modify: `electron-app/renderer/src/pages/Settings.tsx`
- Modify: `electron-app/renderer/src/services/recorder.behavior.test.ts`
- Modify: `electron-app/renderer/ui-structure.test.mjs`
- Modify: `server/refiner.py`
- Modify: `server/test_refiner_prompts.py`

- [ ] **Step 1: 写 renderer 设置归一化失败测试**

在 `electron-app/renderer/src/services/settingsStore.ts` 附近已有测试由 `ui-structure.test.mjs` 间接覆盖；本任务先在 `electron-app/renderer/src/services/i18n.test.ts` 创建后续共用测试文件，或者新增 `settingsStore.test.ts`。推荐新增 `settingsStore.test.ts`：

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSettings, normalizeSettingsForTest } from './settingsStore'

test('设置归一化接受支持的翻译目标语言', () => {
  assert.equal(normalizeSettingsForTest({ translationTargetLanguage: 'ja' }).translationTargetLanguage, 'ja')
  assert.equal(normalizeSettingsForTest({ translationTargetLanguage: 'zh-CN' }).translationTargetLanguage, 'zh-CN')
})

test('设置归一化拒绝未知翻译目标语言', () => {
  assert.equal(normalizeSettingsForTest({ translationTargetLanguage: 'xx' }).translationTargetLanguage, defaultSettings.translationTargetLanguage)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd electron-app/renderer
npm test -- src/services/settingsStore.test.ts
```

Expected: FAIL，原因是 `normalizeSettingsForTest` 尚未导出或 `TranslationTargetLanguage` 仍只允许 `en`。

- [ ] **Step 3: 新增语言定义并扩展 settingsStore**

`electron-app/renderer/src/services/languages.ts`：

```ts
export const interfaceLanguageOptions = [
  { code: 'zh-CN', labelZh: '简体中文', labelEn: 'Simplified Chinese' },
  { code: 'en-US', labelZh: '英文', labelEn: 'English' },
] as const

export type InterfaceLanguage = typeof interfaceLanguageOptions[number]['code']

export const translationTargetLanguageOptions = [
  { code: 'en', labelZh: '英文', labelEn: 'English' },
  { code: 'zh-CN', labelZh: '简体中文', labelEn: 'Simplified Chinese' },
  { code: 'ja', labelZh: '日语', labelEn: 'Japanese' },
  { code: 'ko', labelZh: '韩语', labelEn: 'Korean' },
  { code: 'fr', labelZh: '法语', labelEn: 'French' },
  { code: 'de', labelZh: '德语', labelEn: 'German' },
  { code: 'es', labelZh: '西班牙语', labelEn: 'Spanish' },
] as const

export type TranslationTargetLanguage = typeof translationTargetLanguageOptions[number]['code']

export function isInterfaceLanguage(value: unknown): value is InterfaceLanguage {
  return interfaceLanguageOptions.some((item) => item.code === value)
}

export function isTranslationTargetLanguage(value: unknown): value is TranslationTargetLanguage {
  return translationTargetLanguageOptions.some((item) => item.code === value)
}
```

`settingsStore.ts`：

```ts
import { ipcClient } from './ipc'
import {
  isInterfaceLanguage,
  isTranslationTargetLanguage,
  type InterfaceLanguage,
  type TranslationTargetLanguage,
} from './languages'

export type { InterfaceLanguage, TranslationTargetLanguage }

export type LocalSettings = {
  preferredLanguage: InterfaceLanguage
  translationTargetLanguage: TranslationTargetLanguage
  launchAtSystemStartup: boolean
  selectedAudioDeviceId: string
}

export const defaultSettings: LocalSettings = {
  preferredLanguage: 'zh-CN',
  translationTargetLanguage: 'en',
  launchAtSystemStartup: false,
  selectedAudioDeviceId: 'default',
}

function normalizeInterfaceLanguage(value: unknown): InterfaceLanguage {
  return isInterfaceLanguage(value) ? value : defaultSettings.preferredLanguage
}

function normalizeTranslationTargetLanguage(value: unknown): TranslationTargetLanguage {
  return isTranslationTargetLanguage(value) ? value : defaultSettings.translationTargetLanguage
}

function normalizeSettings(settings?: Partial<LocalSettings> | null): LocalSettings {
  return {
    ...defaultSettings,
    preferredLanguage: normalizeInterfaceLanguage(settings?.preferredLanguage),
    translationTargetLanguage: normalizeTranslationTargetLanguage(settings?.translationTargetLanguage),
    launchAtSystemStartup: Boolean(settings?.launchAtSystemStartup),
    selectedAudioDeviceId: settings?.selectedAudioDeviceId || 'default',
  }
}

export const normalizeSettingsForTest = normalizeSettings
```

保留文件内现有 `loadSettings()`、`saveSettings()`、`getSelectedAudioDeviceId()`、`getTranslationTargetLanguage()`，只替换类型和归一化实现。

- [ ] **Step 4: 运行 renderer 设置测试确认通过**

Run:

```powershell
cd electron-app/renderer
npm test -- src/services/settingsStore.test.ts
```

Expected: PASS。

- [ ] **Step 5: 写后端翻译目标语言显示名失败测试**

在 `server/test_refiner_prompts.py` 增加：

```python
    def test_translation_user_message_uses_target_language_display_name(self):
        fake_client = FakeClient()

        with patch("refiner._get_client", return_value=fake_client):
            asyncio.run(refiner.refine_text(
                raw_text="你好",
                mode="translation",
                parameters={"output_language": "ja"},
            ))

        call = fake_client.chat.completions.calls[0]
        user_message = call["messages"][1]["content"]
        self.assertIn("目标语言：日语 (ja)", user_message)
```

- [ ] **Step 6: 运行后端测试确认失败**

Run:

```powershell
cd server
python -m pytest test_refiner_prompts.py -q
```

Expected: FAIL，当前 user message 仍是 `目标语言：ja`。

- [ ] **Step 7: 实现后端语言显示名**

在 `server/refiner.py` 增加：

```python
LANGUAGE_DISPLAY_NAMES = {
    "en": "英文 (en)",
    "zh-CN": "简体中文 (zh-CN)",
    "ja": "日语 (ja)",
    "ko": "韩语 (ko)",
    "fr": "法语 (fr)",
    "de": "德语 (de)",
    "es": "西班牙语 (es)",
}


def format_target_language(value: str | None) -> str:
    code = value or "en"
    return LANGUAGE_DISPLAY_NAMES.get(code, LANGUAGE_DISPLAY_NAMES["en"])
```

替换翻译分支：

```python
target_lang = format_target_language(parameters.get("output_language", "en"))
user_message = f"目标语言：{target_lang}\n\n待翻译的语音转写文本：\n{raw_text}"
```

- [ ] **Step 8: 更新 Settings 页面语言选项**

`Settings.tsx` 使用 `translationTargetLanguageOptions` 渲染 `MenuItem`：

```tsx
{translationTargetLanguageOptions.map((item) => (
  <MenuItem key={item.code} value={item.code}>
    {item.labelZh} ({item.code})
  </MenuItem>
))}
```

- [ ] **Step 9: 扩展主进程设置归一化**

`electron-app/main.js`：

```js
const SUPPORTED_INTERFACE_LANGUAGES = new Set(['zh-CN', 'en-US']);
const SUPPORTED_TRANSLATION_TARGET_LANGUAGES = new Set(['en', 'zh-CN', 'ja', 'ko', 'fr', 'de', 'es']);
```

`normalizeLocalSettings()` 中：

```js
preferredLanguage: SUPPORTED_INTERFACE_LANGUAGES.has(value.preferredLanguage)
  ? value.preferredLanguage
  : DEFAULT_LANGUAGE,
```

- [ ] **Step 10: 运行相关验证**

Run:

```powershell
cd electron-app/renderer
npm test
cd ..\..
npm run renderer:build
node --check electron-app/main.js
cd server
python -m pytest test_refiner_prompts.py -q
```

Expected: 全部 PASS。

---

## Task 2: 开机启动真实状态回读

**Files:**
- Modify: `electron-app/main.js`
- Create: `electron-app/auto-launch.test.mjs`
- Modify: `electron-app/renderer/src/pages/Settings.tsx`
- Modify: `electron-app/renderer/ui-structure.test.mjs`

- [ ] **Step 1: 写主进程开机启动纯函数失败测试**

`electron-app/auto-launch.test.mjs`：

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readAutoLaunchEnabledForTest,
  updateAutoLaunchForTest,
} from './main.js'

test('读取开机启动使用 Electron 登录项真实状态', () => {
  const fakeApp = {
    getLoginItemSettings: () => ({ openAtLogin: true }),
  }

  assert.deepEqual(readAutoLaunchEnabledForTest(fakeApp), { enabled: true })
})

test('更新开机启动后回读系统真实状态', () => {
  const calls = []
  const fakeApp = {
    setLoginItemSettings: (payload) => calls.push(payload),
    getLoginItemSettings: () => ({ openAtLogin: false }),
  }

  assert.deepEqual(updateAutoLaunchForTest(fakeApp, true, 'C:/app/SpeakMore.exe'), { enabled: false })
  assert.deepEqual(calls[0], { openAtLogin: true, path: 'C:/app/SpeakMore.exe' })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node --test electron-app/auto-launch.test.mjs
```

Expected: FAIL，函数尚未导出。

- [ ] **Step 3: 抽出并导出开机启动函数**

`electron-app/main.js` 增加：

```js
function readAutoLaunchEnabled(appApi = app) {
  return { enabled: Boolean(appApi.getLoginItemSettings().openAtLogin) };
}

function updateAutoLaunch(appApi = app, enable, executablePath = process.execPath) {
  appApi.setLoginItemSettings({ openAtLogin: Boolean(enable), path: executablePath });
  return readAutoLaunchEnabled(appApi);
}
```

IPC 替换为：

```js
ipcMain.handle('permission:get-auto-launch', () => readAutoLaunchEnabled());
ipcMain.handle('permission:update-auto-launch', (_, payload = {}) => updateAutoLaunch(app, payload.enable));
```

文件末尾已有 `module.exports` 时合并导出；没有时增加不会影响 Electron 启动的导出：

```js
module.exports = {
  readAutoLaunchEnabledForTest: readAutoLaunchEnabled,
  updateAutoLaunchForTest: updateAutoLaunch,
}
```

如果 `main.js` 直接执行 Electron 初始化导致测试导入困难，则把函数放到新文件 `electron-app/auto-launch.js` 并由 `main.js` require。

- [ ] **Step 4: Settings 页面加载真实状态**

`Settings.tsx` 增加：

```ts
async function loadAutoLaunchState(baseSettings: LocalSettings) {
  try {
    const result = await ipcClient.invoke<{ enabled?: boolean }>('permission:get-auto-launch')
    const launchAtSystemStartup = Boolean(result?.enabled)
    if (launchAtSystemStartup !== baseSettings.launchAtSystemStartup) {
      return await saveSettings({ ...baseSettings, launchAtSystemStartup })
    }
    return { ...baseSettings, launchAtSystemStartup }
  } catch {
    return baseSettings
  }
}
```

`useEffect` 中先 `loadSettings()`，再 `loadAutoLaunchState()`。

- [ ] **Step 5: Settings 切换成功后使用系统回读状态**

替换 Switch `onChange`：

```tsx
onChange={(_event, checked) => {
  const previous = settings
  void (async () => {
    setSettings({ ...settings, launchAtSystemStartup: checked })
    try {
      const result = await ipcClient.invoke<{ enabled?: boolean }>('permission:update-auto-launch', { enable: checked })
      await updateSettings({ ...settings, launchAtSystemStartup: Boolean(result?.enabled) })
    } catch {
      setSettings(previous)
    }
  })()
}}
```

- [ ] **Step 6: 运行验证**

Run:

```powershell
node --test electron-app/auto-launch.test.mjs
node --check electron-app/main.js
cd electron-app/renderer
npm test
```

Expected: 全部 PASS。

---

## Task 3: DeepSeek API Key 热更新

**Files:**
- Modify: `server/runtime_config.py`
- Modify: `server/refiner.py`
- Modify: `server/main.py`
- Modify: `server/test_runtime_config.py`
- Modify: `server/test_refiner_prompts.py`
- Create: `server/test_deepseek_config_api.py`
- Modify: `electron-app/main.js`
- Modify: `electron-app/renderer/src/pages/Settings.tsx`
- Modify: `electron-app/renderer/ui-structure.test.mjs`

- [ ] **Step 1: 写 runtime_config 失败测试**

在 `server/test_runtime_config.py` 增加：

```python
    def test_update_deepseek_api_key_preserves_other_env_values(self):
        from runtime_config import read_deepseek_config_status, update_env_file_value

        with tempfile.TemporaryDirectory() as tmp_dir:
            env_path = Path(tmp_dir) / ".env"
            env_path.write_text("HOST=127.0.0.1\nDEEPSEEK_API_KEY=old-key\nPORT=8000\n", encoding="utf-8")

            update_env_file_value(env_path, "DEEPSEEK_API_KEY", "new-secret-key")

            self.assertEqual(
                env_path.read_text(encoding="utf-8"),
                "HOST=127.0.0.1\nDEEPSEEK_API_KEY=new-secret-key\nPORT=8000\n",
            )
            self.assertEqual(
                read_deepseek_config_status(env_path),
                {"configured": True, "masked": "**********-key"},
            )
```

文件顶部补：

```python
import tempfile
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd server
python -m pytest test_runtime_config.py -q
```

Expected: FAIL，函数尚不存在。

- [ ] **Step 3: 实现 runtime_config 更新函数**

`server/runtime_config.py` 增加：

```python
def mask_secret(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        return ""
    suffix = stripped[-4:] if len(stripped) >= 4 else stripped
    return f"**********{suffix}"


def update_env_file_value(env_path: Path, key: str, value: str) -> None:
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    next_line = f"{key}={value}" if value else f"{key}="
    replaced = False
    next_lines: list[str] = []

    for line in lines:
        if line.startswith(f"{key}="):
            next_lines.append(next_line)
            replaced = True
        else:
            next_lines.append(line)

    if not replaced:
        next_lines.append(next_line)

    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")


def read_deepseek_config_status(env_path: Path | None = None) -> dict:
    path = env_path or _ENV_FILE_PATH
    value = ""
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("DEEPSEEK_API_KEY="):
                value = line.split("=", 1)[1].strip()
                break
    if env_path is None:
        value = os.getenv("DEEPSEEK_API_KEY", value)
    value = value.strip()
    return {"configured": bool(value), "masked": mask_secret(value)}


def update_deepseek_api_key(api_key: str, env_path: Path | None = None) -> dict:
    path = env_path or _ENV_FILE_PATH
    normalized = api_key.strip()
    update_env_file_value(path, "DEEPSEEK_API_KEY", normalized)
    if normalized:
        os.environ["DEEPSEEK_API_KEY"] = normalized
    else:
        os.environ.pop("DEEPSEEK_API_KEY", None)
    return read_deepseek_config_status(path)
```

- [ ] **Step 4: 写 refiner client reset 失败测试**

在 `server/test_refiner_prompts.py` 增加：

```python
    def test_reset_client_recreates_deepseek_client_with_latest_key(self):
        created_keys = []

        class FakeAsyncOpenAI:
            def __init__(self, api_key=None, base_url=None):
                created_keys.append(api_key)
                self.chat = SimpleNamespace(completions=FakeCompletions())

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "first"}, clear=False):
            with patch("refiner.AsyncOpenAI", FakeAsyncOpenAI):
                refiner.reset_client()
                refiner._get_client()

        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "second"}, clear=False):
            with patch("refiner.AsyncOpenAI", FakeAsyncOpenAI):
                refiner.reset_client()
                refiner._get_client()

        self.assertEqual(created_keys, ["first", "second"])
```

文件顶部补：

```python
import os
```

- [ ] **Step 5: 实现 refiner reset**

`server/refiner.py`：

```python
def reset_client() -> None:
    global _client
    _client = None
```

- [ ] **Step 6: 写 FastAPI 配置接口失败测试**

`server/test_deepseek_config_api.py`：

```python
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import create_app, set_voice_service_state


class DeepSeekConfigApiTest(unittest.TestCase):
    def test_get_deepseek_config_does_not_return_plain_key(self):
        app = create_app(preload_model=lambda: None, exit_scheduler=lambda code=1: None)
        set_voice_service_state(app, "ready", "ready")

        with patch("main.read_deepseek_config_status", return_value={"configured": True, "masked": "**********1234"}):
            with TestClient(app) as client:
                response = client.get("/config/deepseek")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"configured": True, "masked": "**********1234"})
        self.assertNotIn("api_key", response.json())

    def test_post_deepseek_config_updates_key_and_resets_client(self):
        app = create_app(preload_model=lambda: None, exit_scheduler=lambda code=1: None)
        set_voice_service_state(app, "ready", "ready")

        with patch("main.update_deepseek_api_key", return_value={"configured": True, "masked": "**********abcd"}) as update:
            with patch("main.reset_refiner_client") as reset:
                with TestClient(app) as client:
                    response = client.post("/config/deepseek", json={"api_key": "secret-abcd"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"configured": True, "masked": "**********abcd"})
        update.assert_called_once_with("secret-abcd")
        reset.assert_called_once()
```

- [ ] **Step 7: 实现 FastAPI 接口**

`server/main.py` import：

```python
from refiner import refine_text, reset_client as reset_refiner_client
from runtime_config import (
    get_cors_allowed_origins,
    get_server_host,
    get_server_port,
    load_server_env,
    read_deepseek_config_status,
    update_deepseek_api_key,
)
```

`create_app()` 内新增：

```python
    @app.get("/config/deepseek")
    async def get_deepseek_config():
        return read_deepseek_config_status()

    @app.post("/config/deepseek")
    async def update_deepseek_config(payload: dict):
        status = update_deepseek_api_key(str(payload.get("api_key", "")))
        reset_refiner_client()
        return status
```

- [ ] **Step 8: 主进程新增 DeepSeek 配置 IPC**

`electron-app/main.js` 增加 helper：

```js
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.detail || `请求失败: ${response.status}`);
  }
  return data;
}
```

IPC：

```js
ipcMain.handle('deepseek:get-config', () => fetchJson(`${VOICE_SERVER_URL}/config/deepseek`));
ipcMain.handle('deepseek:update-api-key', (_, payload = {}) => fetchJson(`${VOICE_SERVER_URL}/config/deepseek`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ api_key: payload.apiKey || payload.api_key || '' }),
}));
```

- [ ] **Step 9: Settings 页面接入保存**

新增 state：

```ts
const [deepseekStatus, setDeepseekStatus] = useState<{ configured?: boolean; masked?: string } | null>(null)
const [deepseekError, setDeepseekError] = useState('')
const [deepseekSaving, setDeepseekSaving] = useState(false)
```

加载：

```ts
ipcClient.invoke<{ configured?: boolean; masked?: string }>('deepseek:get-config')
  .then(setDeepseekStatus)
  .catch(() => setDeepseekStatus(null))
```

保存：

```ts
const handleSaveDeepSeekApiKey = async () => {
  setDeepseekSaving(true)
  setDeepseekError('')
  try {
    const status = await ipcClient.invoke<{ configured?: boolean; masked?: string }>('deepseek:update-api-key', { apiKey: deepseekApiKey })
    setDeepseekStatus(status)
    setDeepseekApiKey('')
  } catch (error) {
    setDeepseekError(error instanceof Error ? error.message : String(error))
  } finally {
    setDeepseekSaving(false)
  }
}
```

按钮：

```tsx
<Button variant="contained" size="small" disabled={deepseekSaving} onClick={handleSaveDeepSeekApiKey}>
  保存
</Button>
```

- [ ] **Step 10: 运行验证**

Run:

```powershell
cd server
python -m pytest test_runtime_config.py test_refiner_prompts.py test_deepseek_config_api.py -q
cd ..
node --check electron-app/main.js
cd electron-app/renderer
npm test
npm run build
```

Expected: 全部 PASS。

---

## Task 4: 轻量界面 i18n

**Files:**
- Create: `electron-app/renderer/src/services/i18n.ts`
- Create: `electron-app/renderer/src/services/i18n.test.ts`
- Modify: `electron-app/renderer/src/navigation.ts`
- Modify: `electron-app/renderer/src/components/AppShell.tsx`
- Modify: `electron-app/renderer/src/components/Sidebar.tsx`
- Modify: `electron-app/renderer/src/pages/Dashboard.tsx`
- Modify: `electron-app/renderer/src/pages/History.tsx`
- Modify: `electron-app/renderer/src/pages/Settings.tsx`
- Modify: `electron-app/renderer/src/pages/Diagnostics.tsx`
- Modify: `electron-app/renderer/src/services/diagnostics.ts`
- Modify: `electron-app/renderer/src/services/historyStore.ts`
- Modify: `electron-app/renderer/src/services/voiceTypes.ts`
- Modify: `electron-app/renderer/src/services/recorder.ts`
- Modify: `electron-app/renderer/public/floating-bar.html`
- Modify: `electron-app/renderer/public/floating-panel.html`
- Modify: `electron-app/main.js`
- Modify: `electron-app/renderer/ui-structure.test.mjs`
- Modify: `AGENTS.md`

- [ ] **Step 1: 写 i18n 失败测试**

`electron-app/renderer/src/services/i18n.test.ts`：

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeInterfaceLanguage, t, translationKeys } from './i18n'

test('界面语言非法值回落到简体中文', () => {
  assert.equal(normalizeInterfaceLanguage('xx'), 'zh-CN')
})

test('中英文翻译字典都包含所有 key', () => {
  for (const key of translationKeys) {
    assert.notEqual(t('zh-CN', key), key)
    assert.notEqual(t('en-US', key), key)
  }
})

test('翻译支持参数替换', () => {
  assert.equal(t('zh-CN', 'diagnostics.microphone.detected', { count: 2 }), '检测到 2 个输入设备')
  assert.equal(t('en-US', 'diagnostics.microphone.detected', { count: 2 }), '2 input devices detected')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd electron-app/renderer
npm test -- src/services/i18n.test.ts
```

Expected: FAIL，`i18n.ts` 尚不存在。

- [ ] **Step 3: 创建 i18n 字典**

`electron-app/renderer/src/services/i18n.ts`：

```ts
import { isInterfaceLanguage, type InterfaceLanguage } from './languages'

export type TranslationKey =
  | 'nav.home'
  | 'nav.history'
  | 'nav.settings'
  | 'nav.diagnostics'
  | 'dashboard.title'
  | 'dashboard.shortcutPrefix'
  | 'dashboard.shortcutMiddle'
  | 'dashboard.shortcutSuffix'
  | 'dashboard.personalizationDisabled'
  | 'dashboard.personalization'
  | 'dashboard.totalDuration'
  | 'dashboard.totalTextLength'
  | 'dashboard.savedTime'
  | 'dashboard.averageSpeed'
  | 'dashboard.recentResult'
  | 'dashboard.copyRecentResult'
  | 'history.title'
  | 'history.searchPlaceholder'
  | 'history.empty'
  | 'history.clearAll'
  | 'settings.title'
  | 'settings.shortcuts'
  | 'settings.shortcut.dictate'
  | 'settings.shortcut.ask'
  | 'settings.shortcut.translate'
  | 'settings.microphone'
  | 'settings.systemDefault'
  | 'settings.inputDevice'
  | 'settings.language'
  | 'settings.interfaceLanguage'
  | 'settings.translationTargetLanguage'
  | 'settings.model'
  | 'settings.deepseekApiKey'
  | 'settings.deepseekPlaceholderEmpty'
  | 'settings.deepseekPlaceholderConfigured'
  | 'settings.deepseekSave'
  | 'settings.deepseekConfigured'
  | 'settings.deepseekNotConfigured'
  | 'settings.autoLaunch'
  | 'settings.version'
  | 'settings.checkUpdates'
  | 'diagnostics.title'
  | 'diagnostics.empty'
  | 'diagnostics.run'
  | 'diagnostics.running'
  | 'diagnostics.backendHealth.name'
  | 'diagnostics.backendHealth.ok'
  | 'diagnostics.backendReady.name'
  | 'diagnostics.backendReady.ok'
  | 'diagnostics.microphone.name'
  | 'diagnostics.microphone.detected'
  | 'diagnostics.microphone.empty'
  | 'diagnostics.microphone.error'
  | 'diagnostics.system.name'
  | 'diagnostics.system.ok'
  | 'diagnostics.system.empty'
  | 'diagnostics.system.error'
  | 'diagnostics.paste.name'
  | 'diagnostics.paste.ok'
  | 'diagnostics.paste.preview'
  | 'history.minutes'
  | 'history.charsPerMinute'
  | 'voice.recordingAsk'
  | 'voice.cancelled'
  | 'voice.backendUnavailable'
  | 'voice.websocketTimeout'
  | 'voice.websocketClosed'
  | 'voice.microphonePermissionDenied'
  | 'voice.microphoneUnavailable'
  | 'voice.recordingStartFailed'
  | 'voice.recordingStopFailed'
  | 'voice.audioEmpty'
  | 'voice.asrFailed'
  | 'voice.refineFailed'
  | 'voice.pasteFailed'
  | 'voice.protocolInvalid'
  | 'voice.unknown'

const zh: Record<TranslationKey, string> = {
  'nav.home': '首页',
  'nav.history': '历史记录',
  'nav.settings': '设置',
  'nav.diagnostics': '诊断',
  'dashboard.title': '首页',
  'dashboard.shortcutPrefix': '请短按',
  'dashboard.shortcutMiddle': '或按',
  'dashboard.shortcutSuffix': '开始听写',
  'dashboard.personalizationDisabled': '暂未启用',
  'dashboard.personalization': '整体个性化',
  'dashboard.totalDuration': '总听写时长',
  'dashboard.totalTextLength': '累计听写字数',
  'dashboard.savedTime': '节省时间',
  'dashboard.averageSpeed': '平均速度',
  'dashboard.recentResult': '最近结果',
  'dashboard.copyRecentResult': '复制最近结果',
  'history.title': '历史记录',
  'history.searchPlaceholder': '搜索历史记录...',
  'history.empty': '暂无历史记录',
  'history.clearAll': '清除所有历史',
  'settings.title': '设置',
  'settings.shortcuts': '快捷键',
  'settings.shortcut.dictate': '按下开始和停止语音输入。',
  'settings.shortcut.ask': '按下开始和停止自由提问。',
  'settings.shortcut.translate': '按下开始和停止翻译。',
  'settings.microphone': '麦克风',
  'settings.systemDefault': '系统默认',
  'settings.inputDevice': '输入设备 {id}',
  'settings.language': '语言',
  'settings.interfaceLanguage': '界面语言',
  'settings.translationTargetLanguage': '翻译目标语言',
  'settings.model': '大模型',
  'settings.deepseekApiKey': 'DeepSeek API Key',
  'settings.deepseekPlaceholderEmpty': '请输入 DeepSeek API Key',
  'settings.deepseekPlaceholderConfigured': '已配置：{masked}',
  'settings.deepseekSave': '保存',
  'settings.deepseekConfigured': '已配置',
  'settings.deepseekNotConfigured': '未配置',
  'settings.autoLaunch': '开机启动',
  'settings.version': '版本 0.1（本地版）',
  'settings.checkUpdates': '检查更新',
  'diagnostics.title': '诊断',
  'diagnostics.empty': '点击下方按钮运行诊断',
  'diagnostics.run': '运行诊断',
  'diagnostics.running': '诊断中...',
  'diagnostics.backendHealth.name': '语音后端存活',
  'diagnostics.backendHealth.ok': '{url} 可访问',
  'diagnostics.backendReady.name': '语音链路就绪',
  'diagnostics.backendReady.ok': '{url} 已就绪',
  'diagnostics.microphone.name': '麦克风',
  'diagnostics.microphone.detected': '检测到 {count} 个输入设备',
  'diagnostics.microphone.empty': '没有检测到麦克风',
  'diagnostics.microphone.error': '无法读取麦克风设备',
  'diagnostics.system.name': '系统信息',
  'diagnostics.system.ok': '系统信息可读取',
  'diagnostics.system.empty': '系统信息为空',
  'diagnostics.system.error': '当前环境无法读取 Electron 系统信息',
  'diagnostics.paste.name': '自动粘贴',
  'diagnostics.paste.ok': 'IPC 可用',
  'diagnostics.paste.preview': '浏览器预览环境无法自动粘贴',
  'history.minutes': '{value} 分钟',
  'history.charsPerMinute': '{value} 字/分钟',
  'voice.recordingAsk': '请随意提出问题',
  'voice.cancelled': '当前转录已取消',
  'voice.backendUnavailable': '语音后端未启动，请稍后重试',
  'voice.websocketTimeout': '连接语音后端超时，请稍后重试',
  'voice.websocketClosed': '语音连接已断开，请重试',
  'voice.microphonePermissionDenied': '无法访问麦克风，请检查系统权限',
  'voice.microphoneUnavailable': '没有找到可用麦克风',
  'voice.recordingStartFailed': '录音启动失败，请重试',
  'voice.recordingStopFailed': '录音停止失败，请重试',
  'voice.audioEmpty': '没有识别到声音',
  'voice.asrFailed': '语音转写失败，请重试',
  'voice.refineFailed': '润色失败，已保留原始转写',
  'voice.pasteFailed': '已生成文本，但无法自动粘贴',
  'voice.protocolInvalid': '语音服务返回了无法识别的数据',
  'voice.unknown': '语音输入出现未知错误',
}

const en: Record<TranslationKey, string> = {
  'nav.home': 'Home',
  'nav.history': 'History',
  'nav.settings': 'Settings',
  'nav.diagnostics': 'Diagnostics',
  'dashboard.title': 'Home',
  'dashboard.shortcutPrefix': 'Press',
  'dashboard.shortcutMiddle': 'or',
  'dashboard.shortcutSuffix': 'to start voice input',
  'dashboard.personalizationDisabled': 'Not enabled',
  'dashboard.personalization': 'Personalization',
  'dashboard.totalDuration': 'Total dictation time',
  'dashboard.totalTextLength': 'Total dictated characters',
  'dashboard.savedTime': 'Time saved',
  'dashboard.averageSpeed': 'Average speed',
  'dashboard.recentResult': 'Recent result',
  'dashboard.copyRecentResult': 'Copy recent result',
  'history.title': 'History',
  'history.searchPlaceholder': 'Search history...',
  'history.empty': 'No history yet',
  'history.clearAll': 'Clear all history',
  'settings.title': 'Settings',
  'settings.shortcuts': 'Shortcuts',
  'settings.shortcut.dictate': 'Press to start and stop voice input.',
  'settings.shortcut.ask': 'Press to start and stop free ask.',
  'settings.shortcut.translate': 'Press to start and stop translation.',
  'settings.microphone': 'Microphone',
  'settings.systemDefault': 'System default',
  'settings.inputDevice': 'Input device {id}',
  'settings.language': 'Language',
  'settings.interfaceLanguage': 'Interface language',
  'settings.translationTargetLanguage': 'Translation target language',
  'settings.model': 'Model',
  'settings.deepseekApiKey': 'DeepSeek API Key',
  'settings.deepseekPlaceholderEmpty': 'Enter DeepSeek API Key',
  'settings.deepseekPlaceholderConfigured': 'Configured: {masked}',
  'settings.deepseekSave': 'Save',
  'settings.deepseekConfigured': 'Configured',
  'settings.deepseekNotConfigured': 'Not configured',
  'settings.autoLaunch': 'Launch at startup',
  'settings.version': 'Version 0.1 (local)',
  'settings.checkUpdates': 'Check for updates',
  'diagnostics.title': 'Diagnostics',
  'diagnostics.empty': 'Click the button below to run diagnostics',
  'diagnostics.run': 'Run diagnostics',
  'diagnostics.running': 'Running...',
  'diagnostics.backendHealth.name': 'Voice backend health',
  'diagnostics.backendHealth.ok': '{url} is reachable',
  'diagnostics.backendReady.name': 'Voice pipeline ready',
  'diagnostics.backendReady.ok': '{url} is ready',
  'diagnostics.microphone.name': 'Microphone',
  'diagnostics.microphone.detected': '{count} input devices detected',
  'diagnostics.microphone.empty': 'No microphone detected',
  'diagnostics.microphone.error': 'Unable to read microphone devices',
  'diagnostics.system.name': 'System information',
  'diagnostics.system.ok': 'System information is available',
  'diagnostics.system.empty': 'System information is empty',
  'diagnostics.system.error': 'Electron system information is unavailable in this environment',
  'diagnostics.paste.name': 'Auto paste',
  'diagnostics.paste.ok': 'IPC is available',
  'diagnostics.paste.preview': 'Auto paste is unavailable in browser preview',
  'history.minutes': '{value} min',
  'history.charsPerMinute': '{value} chars/min',
  'voice.recordingAsk': 'Ask anything',
  'voice.cancelled': 'Current transcription cancelled',
  'voice.backendUnavailable': 'Voice backend is not running. Try again later.',
  'voice.websocketTimeout': 'Timed out connecting to voice backend. Try again later.',
  'voice.websocketClosed': 'Voice connection closed. Please retry.',
  'voice.microphonePermissionDenied': 'Cannot access microphone. Check system permissions.',
  'voice.microphoneUnavailable': 'No available microphone found.',
  'voice.recordingStartFailed': 'Failed to start recording. Please retry.',
  'voice.recordingStopFailed': 'Failed to stop recording. Please retry.',
  'voice.audioEmpty': 'No speech detected.',
  'voice.asrFailed': 'Speech transcription failed. Please retry.',
  'voice.refineFailed': 'Refinement failed. Original transcription was kept.',
  'voice.pasteFailed': 'Text was generated, but auto paste failed.',
  'voice.protocolInvalid': 'Voice service returned unrecognized data.',
  'voice.unknown': 'Unknown voice input error.',
}

export const translationKeys = Object.keys(zh) as TranslationKey[]

const dictionaries: Record<InterfaceLanguage, Record<TranslationKey, string>> = {
  'zh-CN': zh,
  'en-US': en,
}

export function normalizeInterfaceLanguage(value: unknown): InterfaceLanguage {
  return isInterfaceLanguage(value) ? value : 'zh-CN'
}

export function t(language: InterfaceLanguage, key: TranslationKey, params: Record<string, string | number> = {}) {
  const template = dictionaries[normalizeInterfaceLanguage(language)][key] || key
  return Object.entries(params).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template,
  )
}
```

- [ ] **Step 4: AppShell 持有语言状态**

`AppShell.tsx`：

```tsx
const [language, setLanguage] = useState<InterfaceLanguage>('zh-CN')

useEffect(() => {
  loadSettings().then((value) => setLanguage(value.preferredLanguage)).catch(() => undefined)
  return ipcClient.on('i18n:language-changed', (_event, payload) => {
    const nextLanguage = payload && typeof payload === 'object'
      ? (payload as { lng?: unknown }).lng
      : null
    setLanguage(normalizeInterfaceLanguage(nextLanguage))
  })
}, [])
```

把页面渲染改成：

```tsx
home: <Dashboard language={language} />,
history: <History language={language} />,
settings: <Settings language={language} onLanguageChange={setLanguage} />,
diagnostics: <Diagnostics language={language} />,
```

`Sidebar activePage={page} onNavigate={setPage} language={language}`。

- [ ] **Step 5: 迁移 Sidebar 和 navigation**

`navigation.ts`：

```ts
import type { TranslationKey } from './services/i18n'

export type Page = 'home' | 'history' | 'settings' | 'diagnostics'

export const pages: { page: Page; labelKey: TranslationKey }[] = [
  { page: 'home', labelKey: 'nav.home' },
  { page: 'history', labelKey: 'nav.history' },
  { page: 'settings', labelKey: 'nav.settings' },
  { page: 'diagnostics', labelKey: 'nav.diagnostics' },
]
```

`Sidebar.tsx` 接收 `language`，用 `t(language, item.labelKey)`。

- [ ] **Step 6: 迁移 Dashboard / History / Diagnostics / Settings**

每个页面增加 props：

```ts
import type { InterfaceLanguage } from '../services/languages'

type Props = { language: InterfaceLanguage }
```

把硬编码文案替换成 `t(language, '...')`。设置页语言选项显示使用：

```tsx
{interfaceLanguageOptions.map((item) => (
  <MenuItem key={item.code} value={item.code}>
    {language === 'en-US' ? item.labelEn : item.labelZh} ({item.code})
  </MenuItem>
))}
```

- [ ] **Step 7: 迁移 diagnostics 服务**

`runDiagnostics(language: InterfaceLanguage)`，所有 `name` 和 `message` 通过 `t()` 生成。

- [ ] **Step 8: 迁移 history 格式化**

`historyStore.ts`：

```ts
export function formatDurationMinutes(durationMs: number, language: InterfaceLanguage = 'zh-CN'): string {
  return t(language, 'history.minutes', { value: Math.floor(Math.max(0, durationMs) / 60000) })
}
```

`formatSavedMinutes` 同理，`formatAverageSpeed` 对空值仍返回 `--`。

- [ ] **Step 9: 迁移 voiceTypes**

`createVoiceError(code, detail, language = 'zh-CN')` 或新增 `getVoiceErrorMessage(code, language)`，避免所有调用点一次性传语言。推荐：

```ts
export function getVoiceErrorMessage(code: VoiceErrorCode, language: InterfaceLanguage = 'zh-CN') {
  return t(language, voiceErrorMessageKeys[code])
}
```

`toFloatingBarState(session, language = 'zh-CN')` 中使用 `t(language, 'voice.recordingAsk')` 和 `t(language, 'voice.cancelled')`。

`recorder.ts` 增加当前语言订阅：

```ts
let interfaceLanguage: InterfaceLanguage = 'zh-CN'

ipcClient.on('i18n:language-changed', (_event, payload) => {
  interfaceLanguage = normalizeInterfaceLanguage((payload as { lng?: unknown })?.lng)
})
```

`setSession()` 中：

```ts
ipcClient.send('voice-state', toFloatingBarState(session, interfaceLanguage))
```

- [ ] **Step 10: 迁移悬浮 HTML**

`floating-bar.html` 增加：

```js
const I18N = {
  'zh-CN': {
    recording: '正在监听...',
    connecting: '正在连接...',
    stopping: '正在停止...',
    transcribing: '正在转写...',
    cancelled: '当前转录已取消',
    completed: '已完成',
    error: '发生错误',
    idle: 'Right Alt 录音',
  },
  'en-US': {
    recording: 'Listening...',
    connecting: 'Connecting...',
    stopping: 'Stopping...',
    transcribing: 'Transcribing...',
    cancelled: 'Current transcription cancelled',
    completed: 'Completed',
    error: 'Error',
    idle: 'Right Alt recording',
  },
};
let language = 'zh-CN';
function tr(key) { return (I18N[language] || I18N['zh-CN'])[key]; }
```

监听：

```js
window.ipcRenderer.on('i18n:language-changed', (_event, payload) => {
  language = payload && payload.lng === 'en-US' ? 'en-US' : 'zh-CN';
  render();
});
```

`floating-panel.html` 同理迁移标题、说明、关闭/复制 aria-label/title。

- [ ] **Step 11: 主进程 i18n:set-language 接收真实语言**

`electron-app/main.js`：

```js
ipcMain.handle('i18n:set-language', (_, payload = {}) => {
  const nextLanguage = SUPPORTED_INTERFACE_LANGUAGES.has(payload.lng || payload.language)
    ? (payload.lng || payload.language)
    : DEFAULT_LANGUAGE;
  const settings = writeLocalSettings({ ...readLocalSettings(), preferredLanguage: nextLanguage });
  sendToMain('i18n:language-changed', { lng: settings.preferredLanguage });
  sendToFloatingBar('i18n:language-changed', { lng: settings.preferredLanguage });
  sendToFloatingPanel('i18n:language-changed', { lng: settings.preferredLanguage });
  return settings.preferredLanguage;
});
```

`settings:update` 写入 `preferredLanguage` 后也广播同样事件。

- [ ] **Step 12: 更新结构测试**

`ui-structure.test.mjs`：

- 移除 `语言固定为简体中文` 的断言。
- 增加 `MenuItem value="en-US"`。
- 增加 `MenuItem value="ja"`、`ko`、`fr`、`de`、`es`。
- 增加 `i18n:language-changed` 广播断言。

- [ ] **Step 13: 实现完成后更新 AGENTS.md**

把以下旧事实改成新事实：

- 设置页界面语言支持 `zh-CN` / `en-US`。
- 翻译目标语言支持 `en`、`zh-CN`、`ja`、`ko`、`fr`、`de`、`es`。
- DeepSeek API Key 输入框会通过后端配置接口热更新 `server/.env` 和运行时 client。
- 开机启动状态由 Electron 登录项真实回读。

保留自由提问无工具限制。

- [ ] **Step 14: 运行最终验证**

Run:

```powershell
cd electron-app/renderer
npm test
npm run build
cd ..\..
node --check electron-app/main.js
node --test electron-app/right-alt-relay.test.js
node --test electron-app/auto-launch.test.mjs
cd server
python -m pytest -q
```

Expected: 全部 PASS。

---

## 自检

- Spec coverage：覆盖翻译目标语言、界面语言、DeepSeek API Key 热更新和开机启动真实状态。
- Placeholder scan：没有 `TBD`、`TODO`、`后续实现` 作为实施步骤。
- Type consistency：统一使用 `InterfaceLanguage`、`TranslationTargetLanguage`、`preferredLanguage`、`translationTargetLanguage`、`output_language`、`DEEPSEEK_API_KEY`。
- Scope check：没有包含 DeepSeek tool calls、搜索工具或天气工具。
