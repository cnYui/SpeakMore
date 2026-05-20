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

module.exports = {
  FOCUSED_TEXT_TARGET_SCRIPT,
  FOCUSED_WINDOW_SCRIPT,
  UIA_SELECTION_SCRIPT,
};
