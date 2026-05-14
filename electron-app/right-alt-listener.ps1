$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class RightAltKeyboardHook
{
    public const int VK_RMENU = 165;
    public const int VK_RSHIFT = 161;
    public const int VK_SPACE = 32;
    public const int VK_ESCAPE = 27;

    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    private static readonly LowLevelKeyboardProc Proc = HookCallback;
    private static IntPtr hookId = IntPtr.Zero;
    private static bool rightAltIsDown = false;
    private static bool rightShiftIsDown = false;
    private static bool spaceIsDown = false;
    private static bool escapeIsDown = false;

    public static void Start()
    {
        hookId = SetHook(Proc);
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) != 0)
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
        UnhookWindowsHookEx(hookId);
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using (Process currentProcess = Process.GetCurrentProcess())
        using (ProcessModule currentModule = currentProcess.MainModule)
        {
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(currentModule.ModuleName), 0);
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int vkCode = Marshal.ReadInt32(lParam);
            int message = wParam.ToInt32();
            bool isDownMessage = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            bool isUpMessage = message == WM_KEYUP || message == WM_SYSKEYUP;

            if ((vkCode == VK_RMENU || vkCode == VK_RSHIFT || vkCode == VK_SPACE || vkCode == VK_ESCAPE) && (isDownMessage || isUpMessage))
            {
                string key = vkCode == VK_RMENU ? "RightAlt" : (vkCode == VK_RSHIFT ? "RightShift" : (vkCode == VK_SPACE ? "Space" : "Escape"));
                bool isCurrentlyDown = vkCode == VK_RMENU
                    ? rightAltIsDown
                    : (vkCode == VK_RSHIFT ? rightShiftIsDown : (vkCode == VK_SPACE ? spaceIsDown : escapeIsDown));

                if (isDownMessage && !isCurrentlyDown)
                {
                    if (vkCode == VK_RMENU) rightAltIsDown = true;
                    else if (vkCode == VK_RSHIFT) rightShiftIsDown = true;
                    else if (vkCode == VK_SPACE) spaceIsDown = true;
                    else escapeIsDown = true;
                    Console.WriteLine("{\"key\":\"" + key + "\",\"isKeydown\":true}");
                    Console.Out.Flush();
                }
                else if (isUpMessage && isCurrentlyDown)
                {
                    if (vkCode == VK_RMENU) rightAltIsDown = false;
                    else if (vkCode == VK_RSHIFT) rightShiftIsDown = false;
                    else if (vkCode == VK_SPACE) spaceIsDown = false;
                    else escapeIsDown = false;
                    Console.WriteLine("{\"key\":\"" + key + "\",\"isKeydown\":false}");
                    Console.Out.Flush();
                }
            }
        }

        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);
}
"@

[RightAltKeyboardHook]::Start()
