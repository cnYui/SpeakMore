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
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32SelectionForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

function Read-TextPatternSelection($textPattern) {
  if ($null -eq $textPattern) { return "" }

  $ranges = $null
  try {
    $ranges = $textPattern.GetSelection()
  } catch {}

  if ($null -eq $ranges -or $ranges.Length -eq 0) { return "" }

  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($range in $ranges) {
    try {
      $text = $range.GetText(-1)
      if (-not [string]::IsNullOrWhiteSpace($text)) {
        [void]$parts.Add($text.Trim())
      }
    } catch {}
  }

  return ($parts -join "\\n").Trim()
}

function Read-ElementSelection($candidate) {
  if ($null -eq $candidate) {
    return @{ success = $false; text = ""; reason = "no_focused_element"; has_text_pattern = $false }
  }

  $textPattern = $null
  try {
    $textPattern = $candidate.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
  } catch {}

  if ($null -eq $textPattern) {
    return @{ success = $false; text = ""; reason = "text_pattern_unavailable"; has_text_pattern = $false }
  }

  $selectedText = Read-TextPatternSelection $textPattern
  if ([string]::IsNullOrWhiteSpace($selectedText)) {
    return @{ success = $false; text = ""; reason = "empty"; has_text_pattern = $true }
  }

  return @{ success = $true; text = $selectedText; reason = ""; has_text_pattern = $true }
}

function Find-SelectionInElements($elements, $limit) {
  if ($null -eq $elements -or $elements.Count -eq 0) {
    return @{ success = $false; text = ""; reason = "foreground_text_pattern_unavailable"; scanned = 0 }
  }

  $scanned = 0
  foreach ($candidate in $elements) {
    if ($scanned -ge $limit) { break }
    $scanned += 1

    $result = Read-ElementSelection $candidate
    if ($result.success) {
      return @{ success = $true; text = $result.text; reason = ""; scanned = $scanned }
    }
  }

  return @{ success = $false; text = ""; reason = "foreground_selection_empty"; scanned = $scanned }
}

function Find-ForegroundSelection() {
  $foreground = [Win32SelectionForeground]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) {
    return @{ success = $false; text = ""; reason = "no_foreground_window"; scanned = 0 }
  }

  $root = $null
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($foreground)
  } catch {}

  if ($null -eq $root) {
    return @{ success = $false; text = ""; reason = "foreground_root_unavailable"; scanned = 0 }
  }

  $textPatternCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::IsTextPatternAvailableProperty,
    $true
  )
  $documentCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Document
  )
  $documentTextCondition = [System.Windows.Automation.AndCondition]::new($documentCondition, $textPatternCondition)

  $documents = $null
  try {
    $documents = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $documentTextCondition)
  } catch {}

  $documentResult = Find-SelectionInElements $documents 24
  if ($documentResult.success) { return $documentResult }

  $textElements = $null
  try {
    $textElements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textPatternCondition)
  } catch {}

  $textResult = Find-SelectionInElements $textElements 96
  if ($textResult.success) { return $textResult }

  if ($documentResult.reason -eq "foreground_selection_empty" -or $textResult.reason -eq "foreground_selection_empty") {
    return @{ success = $false; text = ""; reason = "foreground_selection_empty"; scanned = ($documentResult.scanned + $textResult.scanned) }
  }

  return @{ success = $false; text = ""; reason = "foreground_text_pattern_unavailable"; scanned = 0 }
}

$element = [System.Windows.Automation.AutomationElement]::FocusedElement
$focusedResult = Read-ElementSelection $element
if ($focusedResult.success) {
  [PSCustomObject]@{ success = $true; text = $focusedResult.text; source = "uia"; confidence = "confirmed"; selection_scope = "focused_element" } | ConvertTo-Json -Compress
  exit 0
}

$foregroundResult = Find-ForegroundSelection
if ($foregroundResult.success) {
  [PSCustomObject]@{ success = $true; text = $foregroundResult.text; source = "uia"; confidence = "confirmed"; selection_scope = "foreground_descendant"; scanned = $foregroundResult.scanned } | ConvertTo-Json -Compress
  exit 0
}

$reason = if ($foregroundResult.reason) { $foregroundResult.reason } else { $focusedResult.reason }
[PSCustomObject]@{ success = $false; text = ""; source = "none"; confidence = "none"; reason = $reason; focused_reason = $focusedResult.reason; foreground_scanned = $foregroundResult.scanned } | ConvertTo-Json -Compress
`;

const FOCUSED_TEXT_TARGET_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$element = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $element) {
  [PSCustomObject]@{
    success = $false
    source = "none"
    confidence = "none"
    reason = "no_focused_element"
    value_pattern = $false
    text_pattern = $false
    is_read_only = $false
    control_type = ""
  } | ConvertTo-Json -Compress
  exit 0
}

$controlType = ""
try { $controlType = $element.Current.ControlType.ProgrammaticName } catch {}

$valuePattern = $null
try { $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
if ($null -ne $valuePattern) {
  if ($valuePattern.Current.IsReadOnly) {
    [PSCustomObject]@{
      success = $false
      source = "none"
      confidence = "none"
      reason = "read_only"
      value_pattern = $true
      text_pattern = $false
      is_read_only = $true
      control_type = $controlType
    } | ConvertTo-Json -Compress
    exit 0
  }

  [PSCustomObject]@{
    success = $true
    source = "uia"
    confidence = "confirmed"
    reason = "value_pattern"
    value_pattern = $true
    text_pattern = $false
    is_read_only = $false
    control_type = $controlType
  } | ConvertTo-Json -Compress
  exit 0
}

$textPattern = $null
try { $textPattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern) } catch {}
if ($null -ne $textPattern -and ($controlType -eq "ControlType.Edit" -or $controlType -eq "ControlType.ComboBox")) {
  [PSCustomObject]@{
    success = $true
    source = "uia"
    confidence = "confirmed"
    reason = "text_pattern"
    value_pattern = $false
    text_pattern = $true
    is_read_only = $false
    control_type = $controlType
  } | ConvertTo-Json -Compress
  exit 0
}

[PSCustomObject]@{
  success = $false
  source = "none"
  confidence = "none"
  reason = "text_target_unavailable"
  value_pattern = $false
  text_pattern = $false
  is_read_only = $false
  control_type = $controlType
} | ConvertTo-Json -Compress
`;

const WIN32_CARET_TARGET_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32CaretTarget {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int left;
    public int top;
    public int right;
    public int bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO {
    public int cbSize;
    public int flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }

  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd);
}
"@

$foreground = [Win32CaretTarget]::GetForegroundWindow()
if ($foreground -eq [IntPtr]::Zero) {
  [PSCustomObject]@{ success = $false; source = "none"; confidence = "none"; reason = "no_foreground_window"; foreground_hwnd = ""; focus_hwnd = ""; caret_hwnd = "" } | ConvertTo-Json -Compress
  exit 0
}

$processId = 0
$threadId = [Win32CaretTarget]::GetWindowThreadProcessId($foreground, [ref]$processId)
$info = New-Object Win32CaretTarget+GUITHREADINFO
$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][Win32CaretTarget+GUITHREADINFO])

if (-not [Win32CaretTarget]::GetGUIThreadInfo($threadId, [ref]$info)) {
  [PSCustomObject]@{ success = $false; source = "none"; confidence = "none"; reason = "gui_thread_info_unavailable"; foreground_hwnd = $foreground.ToInt64().ToString(); focus_hwnd = ""; caret_hwnd = "" } | ConvertTo-Json -Compress
  exit 0
}

$caret = $info.hwndCaret
$focus = $info.hwndFocus
$isCaretInForegroundTree = ($caret -ne [IntPtr]::Zero) -and (($caret -eq $foreground) -or [Win32CaretTarget]::IsChild($foreground, $caret))
$isFocusInForegroundTree = ($focus -eq [IntPtr]::Zero) -or ($focus -eq $foreground) -or [Win32CaretTarget]::IsChild($foreground, $focus)

if ($isCaretInForegroundTree -and $isFocusInForegroundTree) {
  [PSCustomObject]@{
    success = $true
    source = "win32_caret"
    confidence = "confirmed"
    reason = "caret"
    foreground_hwnd = $foreground.ToInt64().ToString()
    focus_hwnd = $focus.ToInt64().ToString()
    caret_hwnd = $caret.ToInt64().ToString()
    flags = $info.flags
    caret_rect = @{ left = $info.rcCaret.left; top = $info.rcCaret.top; right = $info.rcCaret.right; bottom = $info.rcCaret.bottom }
  } | ConvertTo-Json -Compress
  exit 0
}

[PSCustomObject]@{
  success = $false
  source = "none"
  confidence = "none"
  reason = "caret_unavailable"
  foreground_hwnd = $foreground.ToInt64().ToString()
  focus_hwnd = $focus.ToInt64().ToString()
  caret_hwnd = $caret.ToInt64().ToString()
  flags = $info.flags
} | ConvertTo-Json -Compress
`;

const FOCUSED_WINDOW_TREE_SCRIPT = `
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class Win32WindowTree {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int count);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
}
"@

$foreground = [Win32WindowTree]::GetForegroundWindow()
if ($foreground -eq [IntPtr]::Zero) {
  [PSCustomObject]@{ success = $false; reason = "no_foreground_window"; foreground_hwnd = ""; process_name = ""; window_title = ""; class_names = @() } | ConvertTo-Json -Compress
  exit 0
}

$processId = 0
[void][Win32WindowTree]::GetWindowThreadProcessId($foreground, [ref]$processId)
$process = $null
try { $process = Get-Process -Id $processId -ErrorAction Stop } catch {}

$titleBuilder = New-Object System.Text.StringBuilder 512
[void][Win32WindowTree]::GetWindowText($foreground, $titleBuilder, $titleBuilder.Capacity)

$classNames = New-Object System.Collections.Generic.List[string]
$foregroundClass = New-Object System.Text.StringBuilder 256
[void][Win32WindowTree]::GetClassName($foreground, $foregroundClass, $foregroundClass.Capacity)
if ($foregroundClass.Length -gt 0) { [void]$classNames.Add($foregroundClass.ToString()) }

$callback = [Win32WindowTree+EnumWindowsProc]{
  param($child, $lparam)
  $builder = New-Object System.Text.StringBuilder 256
  [void][Win32WindowTree]::GetClassName($child, $builder, $builder.Capacity)
  if ($builder.Length -gt 0) { [void]$classNames.Add($builder.ToString()) }
  return $true
}
[void][Win32WindowTree]::EnumChildWindows($foreground, $callback, [IntPtr]::Zero)

[PSCustomObject]@{
  success = $true
  foreground_hwnd = $foreground.ToInt64().ToString()
  process_name = if ($process) { $process.ProcessName } else { "" }
  process_id = [int]$processId
  window_title = $titleBuilder.ToString()
  class_names = @($classNames | Select-Object -Unique)
} | ConvertTo-Json -Compress
`;

// 把录音开始时锁定的窗口重新切回前台（焦点在中途漂走时用）。hwnd 只接受纯数字，拼进脚本前先校验。
// Windows 限制后台进程抢前台，所以用挂接输入线程的办法放行；窗口被最小化就先还原。
function createRestoreForegroundWindowScript(hwnd) {
  const handle = String(hwnd || '').trim();
  if (!/^[0-9]{1,20}$/.test(handle)) return null;
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32RestoreForeground {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
$target = [IntPtr]::new([long]${handle})
if (-not [Win32RestoreForeground]::IsWindow($target)) {
  [PSCustomObject]@{ success = $false; reason = 'window_gone' } | ConvertTo-Json -Compress
  exit 0
}
if ([Win32RestoreForeground]::IsIconic($target)) { [void][Win32RestoreForeground]::ShowWindow($target, 9) }
# Windows 不允许后台进程抢前台。把本线程的输入队列临时挂到当前前台窗口的线程上就能放行。
# 不能用“按一下 Alt”这个常见办法：Alt 按下又松开会让 Chrome 之类的应用把焦点移到菜单栏，之后的 Ctrl+V 就贴不进输入框了。
$unusedPid = 0
$foreground = [Win32RestoreForeground]::GetForegroundWindow()
$foregroundThread = [Win32RestoreForeground]::GetWindowThreadProcessId($foreground, [ref]$unusedPid)
$currentThread = [Win32RestoreForeground]::GetCurrentThreadId()
$attached = $false
if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
  $attached = [Win32RestoreForeground]::AttachThreadInput($currentThread, $foregroundThread, $true)
}
[void][Win32RestoreForeground]::BringWindowToTop($target)
[void][Win32RestoreForeground]::SetForegroundWindow($target)
if ($attached) { [void][Win32RestoreForeground]::AttachThreadInput($currentThread, $foregroundThread, $false) }
Start-Sleep -Milliseconds 120
if ([Win32RestoreForeground]::GetForegroundWindow() -ne $target) {
  [Win32RestoreForeground]::SwitchToThisWindow($target, $true)
  Start-Sleep -Milliseconds 120
}
$now = [Win32RestoreForeground]::GetForegroundWindow()
[PSCustomObject]@{
  success = ($now -eq $target)
  reason = if ($now -eq $target) { 'restored' } else { 'foreground_denied' }
  foreground_hwnd = $now.ToInt64().ToString()
} | ConvertTo-Json -Compress
`;
}

module.exports = {
  createRestoreForegroundWindowScript,
  FOCUSED_WINDOW_TREE_SCRIPT,
  FOCUSED_TEXT_TARGET_SCRIPT,
  FOCUSED_WINDOW_SCRIPT,
  UIA_SELECTION_SCRIPT,
  WIN32_CARET_TARGET_SCRIPT,
};
