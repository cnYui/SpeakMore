' 无控制台窗口地运行 launch-speakmore-win.ps1（直接让快捷方式指向 powershell.exe 会闪一下黑窗口）。
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\launch-speakmore-win.ps1""", 0, False
