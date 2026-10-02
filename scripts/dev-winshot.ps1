# Capture the windows of ONE process with PrintWindow. Windows only. ASCII only (PowerShell 5.1 misreads UTF-8 without BOM).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-winshot.ps1 -ProcId <pid> -OutDir <dir> [-List] [-Restore] [-MaxWidth 1900]
#   -ProcId   main process id of the test app: first line of <test HOME>/.claude/pokebuddy/save.lock
#   -List     print handle, title and rectangle only
#   -Restore  bring a minimized window back without focus (SW_SHOWNOACTIVATE) before the capture
#   -MaxWidth windows at least this wide (the stage) are skipped
# Never capture the whole screen: other apps of the user get into the picture. See docs/contributing/development.md.
param([int]$ProcId, [string]$OutDir = ".", [switch]$List, [switch]$Restore, [int]$MaxWidth = 1900)
Add-Type -AssemblyName System.Drawing
$src = @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class PbWinShot {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> Of(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static string Title(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
}
'@
if (-not ('PbWinShot' -as [type])) { Add-Type -TypeDefinition $src }
[PbWinShot]::SetProcessDPIAware() | Out-Null
$n = 0
foreach ($h in [PbWinShot]::Of([uint32]$ProcId)) {
  if ($Restore -and [PbWinShot]::IsIconic($h)) { [PbWinShot]::ShowWindow($h, 4) | Out-Null; Start-Sleep -Milliseconds 400 }
  $r = New-Object PbWinShot+RECT
  [PbWinShot]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $ht = $r.B - $r.T
  $title = [PbWinShot]::Title($h)
  "window $h '$title' $($r.L),$($r.T) ${w}x${ht}"
  if ($List -or $w -le 0 -or $ht -le 0 -or $w -ge $MaxWidth) { continue }
  $bmp = [System.Drawing.Bitmap]::new([int]$w, [int]$ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $dc = $g.GetHdc()
  [PbWinShot]::PrintWindow($h, $dc, 2) | Out-Null
  $g.ReleaseHdc($dc); $g.Dispose()
  $n++
  $bmp.Save((Join-Path $OutDir "win$n.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "  saved win$n.png"
}
