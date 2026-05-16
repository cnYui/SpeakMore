const { spawn } = require('child_process');

const DEFAULT_SELECTION_MARKER = `__TYPELESS_SELECTION_MARKER_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
const COPY_WAIT_MS = 80;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSendKeysShortcut(shortcut) {
  return () => new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${shortcut}")`,
    ], {
      windowsHide: true,
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
    });

    ps.on('exit', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`SendKeys exited with code ${code}`));
    });
    ps.on('error', reject);
  });
}

function normalizeSelectedTextResult(value) {
  if (typeof value === 'string') {
    return { success: Boolean(value.trim()), text: value.trim(), source: 'legacy' };
  }

  if (!value || typeof value !== 'object') {
    return { success: false, text: '', source: 'unknown', reason: 'invalid_result' };
  }

  const text = typeof value.text === 'string' ? value.text.trim() : '';
  return {
    success: Boolean(value.success) && Boolean(text),
    text: Boolean(value.success) ? text : '',
    source: typeof value.source === 'string' ? value.source : 'unknown',
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
  };
}

function normalizeUiaSelectionResult(value) {
  if (!value || typeof value !== 'object') {
    return { success: false, text: '', source: 'none', confidence: 'none', reason: 'invalid_result' };
  }

  const text = typeof value.text === 'string' ? value.text.trim() : '';
  const isConfirmed = value.success === true
    && value.source === 'uia'
    && value.confidence === 'confirmed'
    && Boolean(text);

  if (!isConfirmed) {
    return {
      success: false,
      text: '',
      source: 'none',
      confidence: 'none',
      reason: typeof value.reason === 'string' ? value.reason : 'empty',
    };
  }

  return {
    success: true,
    text,
    source: 'uia',
    confidence: 'confirmed',
  };
}

function createEmptyFocusedInfo() {
  return {
    appInfo: {
      app_name: '',
      app_identifier: '',
      window_title: '',
      app_type: 'native_app',
      app_metadata: {},
      browser_context: null,
    },
    elementInfo: {
      role: '',
      focused: false,
      editable: true,
      selected: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    },
  };
}

function normalizeFocusedInfo(value) {
  if (!value || typeof value !== 'object') return createEmptyFocusedInfo();

  const appInfo = value.appInfo && typeof value.appInfo === 'object' ? value.appInfo : {};
  const elementInfo = value.elementInfo && typeof value.elementInfo === 'object' ? value.elementInfo : {};

  return {
    appInfo: {
      app_name: typeof appInfo.app_name === 'string' ? appInfo.app_name : '',
      app_identifier: typeof appInfo.app_identifier === 'string' ? appInfo.app_identifier : '',
      window_title: typeof appInfo.window_title === 'string' ? appInfo.window_title : '',
      app_type: typeof appInfo.app_type === 'string' ? appInfo.app_type : 'native_app',
      app_metadata: appInfo.app_metadata && typeof appInfo.app_metadata === 'object' ? appInfo.app_metadata : {},
      browser_context: appInfo.browser_context ?? null,
    },
    elementInfo: {
      role: typeof elementInfo.role === 'string' ? elementInfo.role : '',
      focused: Boolean(elementInfo.focused),
      editable: elementInfo.editable !== false,
      selected: Boolean(elementInfo.selected),
      bounds: elementInfo.bounds && typeof elementInfo.bounds === 'object'
        ? elementInfo.bounds
        : { x: 0, y: 0, width: 0, height: 0 },
    },
  };
}

function powershellJsonCommand(script) {
  return () => new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
    });
    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    ps.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    ps.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    ps.on('error', reject);
  });
}

const FOCUSED_WINDOW_SCRIPT = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32Focus]::GetForegroundWindow()
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][Win32Focus]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
$processId = 0
[void][Win32Focus]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$process = $null
try { $process = Get-Process -Id $processId -ErrorAction Stop } catch {}
[PSCustomObject]@{
  hwnd = $hwnd.ToInt64().ToString()
  process_id = [int]$processId
  process_name = if ($process) { $process.ProcessName } else { "" }
  window_title = $titleBuilder.ToString()
} | ConvertTo-Json -Compress
`;

const UIA_SELECTION_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$element = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $element) {
  [PSCustomObject]@{ success = $false; text = ""; source = "none"; confidence = "none"; reason = "no_focused_element" } | ConvertTo-Json -Compress
  exit 0
}

$textPattern = $null
try {
  $textPattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
} catch {}

if ($null -eq $textPattern) {
  [PSCustomObject]@{ success = $false; text = ""; source = "none"; confidence = "none"; reason = "text_pattern_unavailable" } | ConvertTo-Json -Compress
  exit 0
}

$ranges = $null
try {
  $ranges = $textPattern.GetSelection()
} catch {}

if ($null -eq $ranges -or $ranges.Length -eq 0) {
  [PSCustomObject]@{ success = $false; text = ""; source = "none"; confidence = "none"; reason = "empty" } | ConvertTo-Json -Compress
  exit 0
}

$parts = New-Object System.Collections.Generic.List[string]
foreach ($range in $ranges) {
  try {
    $text = $range.GetText(-1)
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      [void]$parts.Add($text.Trim())
    }
  } catch {}
}

$selectedText = ($parts -join "\\n").Trim()
if ([string]::IsNullOrWhiteSpace($selectedText)) {
  [PSCustomObject]@{ success = $false; text = ""; source = "none"; confidence = "none"; reason = "empty" } | ConvertTo-Json -Compress
  exit 0
}

[PSCustomObject]@{ success = $true; text = $selectedText; source = "uia"; confidence = "confirmed" } | ConvertTo-Json -Compress
`;

async function readFocusedInfo({
  readWindowInfo = powershellJsonCommand(FOCUSED_WINDOW_SCRIPT),
} = {}) {
  try {
    const windowInfo = await readWindowInfo();
    const processName = typeof windowInfo.process_name === 'string' ? windowInfo.process_name : '';
    const windowTitle = typeof windowInfo.window_title === 'string' ? windowInfo.window_title : '';
    const hwnd = typeof windowInfo.hwnd === 'string' ? windowInfo.hwnd : '';
    const processId = Number(windowInfo.process_id || 0);

    return normalizeFocusedInfo({
      appInfo: {
        app_name: processName,
        app_identifier: processName ? `${processName}.exe` : '',
        window_title: windowTitle,
        app_type: 'native_app',
        app_metadata: { hwnd, process_id: processId },
        browser_context: null,
      },
      elementInfo: {
        role: '',
        focused: Boolean(hwnd),
        editable: true,
        selected: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      },
    });
  } catch {
    return createEmptyFocusedInfo();
  }
}

function getWindowHandle(focusedInfo) {
  return String(focusedInfo?.appInfo?.app_metadata?.hwnd || '');
}

function isSameFocusedContext(previous, current) {
  const normalizedPrevious = normalizeFocusedInfo(previous);
  const normalizedCurrent = normalizeFocusedInfo(current);
  const previousHwnd = getWindowHandle(normalizedPrevious);
  const currentHwnd = getWindowHandle(normalizedCurrent);

  if (previousHwnd || currentHwnd) return Boolean(previousHwnd && previousHwnd === currentHwnd);

  return normalizedPrevious.appInfo.app_identifier === normalizedCurrent.appInfo.app_identifier
    && normalizedPrevious.appInfo.window_title === normalizedCurrent.appInfo.window_title;
}

function isNonEmptyClipboardImage(image) {
  if (!image) return false;
  return typeof image.isEmpty === 'function' ? !image.isEmpty() : true;
}

function createClipboardSnapshot(clipboard) {
  const data = {};

  const text = clipboard.readText();
  if (text) data.text = text;

  if (typeof clipboard.readHTML === 'function') {
    const html = clipboard.readHTML();
    if (html) data.html = html;
  }

  if (typeof clipboard.readRTF === 'function') {
    const rtf = clipboard.readRTF();
    if (rtf) data.rtf = rtf;
  }

  if (typeof clipboard.readImage === 'function') {
    const image = clipboard.readImage();
    if (isNonEmptyClipboardImage(image)) data.image = image;
  }

  return data;
}

function restoreClipboardSnapshot(clipboard, snapshot) {
  if (typeof clipboard.write === 'function') {
    clipboard.write(snapshot);
    return;
  }

  clipboard.writeText(snapshot.text || '');
}

async function readSelectedTextByClipboard({
  clipboard,
  sendCopyShortcut = createSendKeysShortcut('^c'),
  wait: waitForClipboard = wait,
  marker = DEFAULT_SELECTION_MARKER,
  copyWaitMs = COPY_WAIT_MS,
} = {}) {
  if (!clipboard || typeof clipboard.readText !== 'function' || typeof clipboard.writeText !== 'function') {
    return { success: false, text: '', source: 'clipboard', reason: 'clipboard_unavailable' };
  }

  const previousClipboard = createClipboardSnapshot(clipboard);
  let restoreFailed = false;

  try {
    clipboard.writeText(marker);
    await sendCopyShortcut();
    await waitForClipboard(copyWaitMs);

    const copiedText = clipboard.readText();
    const text = copiedText === marker ? '' : String(copiedText || '').trim();

    if (!text) {
      return { success: false, text: '', source: 'clipboard', reason: 'empty' };
    }

    return { success: true, text, source: 'clipboard' };
  } catch (error) {
    return {
      success: false,
      text: '',
      source: 'clipboard',
      reason: 'copy_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      restoreClipboardSnapshot(clipboard, previousClipboard);
    } catch {
      restoreFailed = true;
    }

    if (restoreFailed) {
      console.warn('恢复剪贴板文本失败');
    }
  }
}

async function readSelectedTextByUia({
  readUiaSelection = powershellJsonCommand(UIA_SELECTION_SCRIPT),
} = {}) {
  try {
    return normalizeUiaSelectionResult(await readUiaSelection());
  } catch (error) {
    return {
      success: false,
      text: '',
      source: 'none',
      confidence: 'none',
      reason: 'uia_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readSelectionSnapshot({
  clipboard,
  readFocusedInfo: readFocus = readFocusedInfo,
  readUiaSelection,
  sendCopyShortcut,
  wait,
  marker,
  copyWaitMs,
} = {}) {
  const focusInfo = normalizeFocusedInfo(await readFocus());
  const selection = await readSelectedTextByUia({ readUiaSelection });

  if (clipboard && sendCopyShortcut) {
    await readSelectedTextByClipboard({
      clipboard,
      sendCopyShortcut,
      wait,
      marker,
      copyWaitMs,
    });
  }

  return {
    ...selection,
    focusInfo,
  };
}

module.exports = {
  isSameFocusedContext,
  normalizeFocusedInfo,
  normalizeUiaSelectionResult,
  readSelectedTextByClipboard,
  readSelectedTextByUia,
  readFocusedInfo,
  readSelectionSnapshot,
  normalizeSelectedTextResult,
};
