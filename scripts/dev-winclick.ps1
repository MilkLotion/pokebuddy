# Send a left click to a window with PostMessage. The mouse does not move. Windows only. ASCII only.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-winclick.ps1 -Hwnd <handle> -X <x> -Y <y>
#   -Hwnd   window handle printed by scripts/dev-winshot.ps1
#   -X -Y   client coordinates. Read them from the PNG of dev-winshot.
#           The settings window has an invisible 8 px frame on the left: use (picture x - 8). Device windows have no frame.
#           Display scale 100% is assumed.
param([long]$Hwnd, [int]$X, [int]$Y)
$src = @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class PbClick {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public static IntPtr Render(IntPtr top) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(top, (h, l) => { var s = new StringBuilder(128); GetClassName(h, s, 128); if (s.ToString() == "Chrome_RenderWidgetHostHWND") { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static void Click(IntPtr h, int x, int y) {
    IntPtr pos = (IntPtr)((y << 16) | (x & 0xFFFF));
    PostMessage(h, 0x0200, IntPtr.Zero, pos);
    PostMessage(h, 0x0201, (IntPtr)1, pos);
    PostMessage(h, 0x0202, IntPtr.Zero, pos);
  }
}
'@
if (-not ('PbClick' -as [type])) { Add-Type -TypeDefinition $src }
$top = [IntPtr]$Hwnd
$r = [PbClick]::Render($top)
if ($r -eq [IntPtr]::Zero) { $r = $top }
[PbClick]::Click($r, $X, $Y)
"clicked $X,$Y on $r"
