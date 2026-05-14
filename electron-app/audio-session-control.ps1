param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('mute-active-sessions', 'restore-sessions')]
  [string]$Action,

  [string]$Payload = ''
)

$ErrorActionPreference = 'Stop'

function Write-JsonResult($value) {
  $value | ConvertTo-Json -Depth 8 -Compress
}

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public sealed class AudioSessionSnapshot
{
    public string SessionKey { get; set; }
    public int ProcessId { get; set; }
    public bool WasMuted { get; set; }
    public string DisplayName { get; set; }
}

internal enum EDataFlow
{
    eRender,
    eCapture,
    eAll,
    EDataFlow_enum_count
}

internal enum ERole
{
    eConsole,
    eMultimedia,
    eCommunications,
    ERole_enum_count
}

internal enum AudioSessionState
{
    AudioSessionStateInactive = 0,
    AudioSessionStateActive = 1,
    AudioSessionStateExpired = 2
}

[Flags]
internal enum CLSCTX : uint
{
    INPROC_SERVER = 0x1,
    INPROC_HANDLER = 0x2,
    LOCAL_SERVER = 0x4,
    REMOTE_SERVER = 0x10,
    ALL = INPROC_SERVER | INPROC_HANDLER | LOCAL_SERVER | REMOTE_SERVER
}

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorComObject
{
}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    int EnumAudioEndpoints(EDataFlow dataFlow, uint dwStateMask, out object devices);
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
    int RegisterEndpointNotificationCallback(IntPtr pClient);
    int UnregisterEndpointNotificationCallback(IntPtr pClient);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    int Activate(ref Guid iid, CLSCTX dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    int GetState(out int pdwState);
}

[ComImport]
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionManager2
{
    int GetAudioSessionControl(ref Guid AudioSessionGuid, uint StreamFlags, out IAudioSessionControl SessionControl);
    int GetSimpleAudioVolume(ref Guid AudioSessionGuid, uint StreamFlags, out ISimpleAudioVolume AudioVolume);
    int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
    int RegisterSessionNotification(IntPtr SessionNotification);
    int UnregisterSessionNotification(IntPtr SessionNotification);
    int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionID, IntPtr duckNotification);
    int UnregisterDuckNotification(IntPtr duckNotification);
}

[ComImport]
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionEnumerator
{
    int GetCount(out int SessionCount);
    int GetSession(int SessionCount, out IAudioSessionControl Session);
}

[ComImport]
[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionControl
{
    int GetState(out AudioSessionState pRetVal);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    int RegisterAudioSessionNotification(IntPtr NewNotifications);
    int UnregisterAudioSessionNotification(IntPtr NewNotifications);
}

[ComImport]
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionControl2
{
    int GetState(out AudioSessionState pRetVal);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    int RegisterAudioSessionNotification(IntPtr NewNotifications);
    int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetProcessId(out uint pRetVal);
    int IsSystemSoundsSession();
    int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
}

[ComImport]
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISimpleAudioVolume
{
    int SetMasterVolume(float fLevel, ref Guid EventContext);
    int GetMasterVolume(out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid EventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

public static class AudioSessionController
{
    public static List<AudioSessionSnapshot> MuteActiveSessions(int[] excludedProcessIds)
    {
        var excluded = new HashSet<int>(excludedProcessIds ?? Array.Empty<int>());
        var mutedSessions = new List<AudioSessionSnapshot>();

        foreach (var session in EnumerateSessions(activeOnly: true))
        {
            if (excluded.Contains(session.ProcessId))
            {
                continue;
            }

            bool isMuted;
            session.Volume.GetMute(out isMuted);
            if (isMuted)
            {
                continue;
            }

            Guid eventContext = Guid.Empty;
            session.Volume.SetMute(true, ref eventContext);

            mutedSessions.Add(new AudioSessionSnapshot
            {
                SessionKey = session.SessionKey,
                ProcessId = session.ProcessId,
                WasMuted = false,
                DisplayName = session.DisplayName
            });
        }

        return mutedSessions;
    }

    public static List<AudioSessionSnapshot> RestoreSessions(AudioSessionSnapshot[] snapshots)
    {
        var restoredSessions = new List<AudioSessionSnapshot>();
        if (snapshots == null || snapshots.Length == 0)
        {
            return restoredSessions;
        }

        var snapshotByKey = new Dictionary<string, AudioSessionSnapshot>(StringComparer.Ordinal);
        foreach (var snapshot in snapshots)
        {
            if (snapshot == null || string.IsNullOrWhiteSpace(snapshot.SessionKey))
            {
                continue;
            }

            snapshotByKey[snapshot.SessionKey] = snapshot;
        }

        foreach (var session in EnumerateSessions(activeOnly: false))
        {
            AudioSessionSnapshot snapshot;
            if (!snapshotByKey.TryGetValue(session.SessionKey, out snapshot))
            {
                continue;
            }

            Guid eventContext = Guid.Empty;
            session.Volume.SetMute(snapshot.WasMuted, ref eventContext);
            restoredSessions.Add(snapshot);
        }

        return restoredSessions;
    }

    private static IEnumerable<AudioSessionInfo> EnumerateSessions(bool activeOnly)
    {
        var sessions = new List<AudioSessionInfo>();
        IMMDeviceEnumerator enumerator = null;
        IMMDevice device = null;
        object managerObject = null;
        IAudioSessionManager2 manager = null;
        IAudioSessionEnumerator sessionEnumerator = null;

        try
        {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);

            var managerGuid = typeof(IAudioSessionManager2).GUID;
            device.Activate(ref managerGuid, CLSCTX.ALL, IntPtr.Zero, out managerObject);
            manager = (IAudioSessionManager2)managerObject;
            manager.GetSessionEnumerator(out sessionEnumerator);

            int count;
            sessionEnumerator.GetCount(out count);

            for (int index = 0; index < count; index++)
            {
                IAudioSessionControl control = null;

                try
                {
                    sessionEnumerator.GetSession(index, out control);
                    if (control == null)
                    {
                        continue;
                    }

                    AudioSessionState state;
                    control.GetState(out state);
                    if (activeOnly && state != AudioSessionState.AudioSessionStateActive)
                    {
                        continue;
                    }

                    var control2 = (IAudioSessionControl2)control;
                    var volume = (ISimpleAudioVolume)control;

                    uint processIdValue;
                    control2.GetProcessId(out processIdValue);

                    string sessionIdentifier;
                    control2.GetSessionIdentifier(out sessionIdentifier);

                    string sessionInstanceIdentifier;
                    control2.GetSessionInstanceIdentifier(out sessionInstanceIdentifier);

                    string displayName;
                    control.GetDisplayName(out displayName);

                    sessions.Add(new AudioSessionInfo
                    {
                        SessionKey = BuildSessionKey((int)processIdValue, sessionIdentifier, sessionInstanceIdentifier),
                        ProcessId = (int)processIdValue,
                        DisplayName = string.IsNullOrWhiteSpace(displayName) ? sessionIdentifier : displayName,
                        Volume = volume
                    });

                    control = null;
                }
                finally
                {
                    if (control != null)
                    {
                        Marshal.ReleaseComObject(control);
                    }
                }
            }

            return sessions;
        }
        finally
        {
            if (sessionEnumerator != null)
            {
                Marshal.ReleaseComObject(sessionEnumerator);
            }

            if (manager != null)
            {
                Marshal.ReleaseComObject(manager);
            }

            if (managerObject != null && Marshal.IsComObject(managerObject))
            {
                Marshal.ReleaseComObject(managerObject);
            }

            if (device != null)
            {
                Marshal.ReleaseComObject(device);
            }

            if (enumerator != null)
            {
                Marshal.ReleaseComObject(enumerator);
            }
        }
    }

    private static string BuildSessionKey(int processId, string sessionIdentifier, string sessionInstanceIdentifier)
    {
        var normalizedSessionIdentifier = sessionIdentifier ?? string.Empty;
        var normalizedSessionInstanceIdentifier = sessionInstanceIdentifier ?? string.Empty;
        return processId.ToString() + "|" + normalizedSessionIdentifier + "|" + normalizedSessionInstanceIdentifier;
    }

    private sealed class AudioSessionInfo
    {
        public string SessionKey { get; set; }
        public int ProcessId { get; set; }
        public string DisplayName { get; set; }
        public ISimpleAudioVolume Volume { get; set; }
    }
}
"@

function ConvertTo-AudioSessionSnapshotArray {
  param([object[]]$Items)

  if (-not $Items) {
    return @()
  }

  $snapshots = New-Object 'System.Collections.Generic.List[AudioSessionSnapshot]'
  foreach ($item in $Items) {
    if (-not $item) {
      continue
    }

    $snapshot = [AudioSessionSnapshot]::new()
    $snapshot.SessionKey = [string]$item.SessionKey
    $snapshot.ProcessId = [int]$item.ProcessId
    $snapshot.WasMuted = [bool]$item.WasMuted
    $snapshot.DisplayName = [string]$item.DisplayName
    $snapshots.Add($snapshot)
  }

  return $snapshots.ToArray()
}

try {
  $inputPayload = if ([string]::IsNullOrWhiteSpace($Payload)) { @{} } else { $Payload | ConvertFrom-Json }

  switch ($Action) {
    'mute-active-sessions' {
      $excludedProcessIds = @()
      if ($null -ne $inputPayload.excludedProcessIds) {
        $excludedProcessIds = @($inputPayload.excludedProcessIds | ForEach-Object { [int]$_ })
      }

      Write-JsonResult @{
        success = $true
        mutedSessions = [AudioSessionController]::MuteActiveSessions($excludedProcessIds)
      }
      break
    }
    'restore-sessions' {
      $snapshots = @()
      if ($null -ne $inputPayload.mutedSessions) {
        $snapshots = ConvertTo-AudioSessionSnapshotArray -Items @($inputPayload.mutedSessions)
      }

      Write-JsonResult @{
        success = $true
        restoredSessions = [AudioSessionController]::RestoreSessions($snapshots)
      }
      break
    }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
}
