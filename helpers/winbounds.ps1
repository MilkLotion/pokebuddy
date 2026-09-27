# 모든 최상위 창의 고유 ID·소유 앱·위치·크기를 z-order(앞→뒤)로 출력 (Windows)
# 사용: powershell -NoProfile -File winbounds.ps1 [앱이름]          한 번 출력하고 끝 (pokebuddy status)
#       powershell -NoProfile -File winbounds.ps1 -Serve [앱이름]   표준입력으로 한 줄 받을 때마다 한 줄 출력 (펫)
#   앱이름은 무시된다 — 목록은 언제나 전체다.
#   받는 쪽이 앵커 앱만 골라 쓰고, 동시에 "내 창보다 앞에 있는 창"을 알아야 가림 판정을 할 수 있다
#
# -Serve 를 두는 이유: PowerShell 기동과 Add-Type 의 C# 컴파일이 부를 때마다 수백 ms(느린 컴퓨터·백신 검사 시 수 초) 든다.
# 펫이 폴링마다 새로 띄우면 타임아웃에 걸려 "헬퍼 응답 없음 → 펫 숨김" 으로 빠지고, 폴링이 겹쳐 PowerShell 이 쌓인다.
# 한 번 띄워 두면 한 번 묻는 데 1ms 안쪽이다(실측 0.4ms). 표준입력이 닫히면(펫 종료) 스스로 끝난다.
#
# Process.MainWindowHandle 은 프로세스당 하나뿐이라 쓰지 않는다 — Electron 은 창이 여러 개여도
# 최상위 창 전부를 메인 프로세스 하나가 소유하므로, 그 값으로는 창을 하나밖에 못 본다.
# EnumWindows 로 직접 열거해야 창마다 HWND 를 얻을 수 있다.
#
# 좌표는 물리 픽셀이다 (모니터별 DPI 인식). Electron 창 좌표(DIP)로 바꾸는 일은 받는 쪽(src/main/app.ts toDip)이 한다.
# 출력: {"frontmost":"Code","frontId":123456,"windows":[{"app":"Code","pid":2108,"id":65792,"x":0,"y":0,"w":1600,"h":900}],
#        "input":{"click":3,"x":10,"y":20,"esc":1}}
#   input 은 -Serve 에서만 — 마우스 버튼(왼·오른)을 누른 횟수와 마지막 누른 자리(물리 픽셀), Esc 를 누른 횟수.
#   앱이 그리는 트레이 메뉴는 포커스를 쥐지 않으므로(쥐면 숨겨진 아이콘 창이 닫힌다) 바깥 클릭·Esc 를 이것으로 안다.
#   전역 후크 없이 15ms 마다 GetAsyncKeyState 로 본다.
#
# ★ 이 파일은 UTF-8 BOM 으로 저장한다. Windows PowerShell 5.1 은 BOM 없는 스크립트를 시스템 코드 페이지
#   (한국어 Windows 는 CP949)로 읽는다. 그러면 한국어 주석 끝 바이트가 줄바꿈을 삼켜 다음 C# 줄이 주석이 되고,
#   Add-Type 컴파일이 실패해 창 목록이 비어 나온다. 에디터가 BOM 을 지우지 않게 주의한다.
param([string]$App = "", [switch]$Serve)

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class PokeBuddyWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT value, int size);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  public static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  // 입력 감시 — 누른 순간(떼었다가 눌림)마다 센다. 읽는 쪽은 수가 늘었는지만 본다
  static volatile bool watching = false;
  static int clicks = 0, escs = 0, clickX = 0, clickY = 0;
  static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
  public static void WatchInput() {
    if (watching) return;
    watching = true;
    var t = new System.Threading.Thread(() => {
      bool mouse = false, esc = false;
      while (true) {
        bool m = Down(0x01) || Down(0x02) || Down(0x04); // 왼·오른·가운데 버튼
        if (m && !mouse) { POINT p; if (GetCursorPos(out p)) { clickX = p.X; clickY = p.Y; } System.Threading.Interlocked.Increment(ref clicks); }
        mouse = m;
        bool e = Down(0x1B);
        if (e && !esc) System.Threading.Interlocked.Increment(ref escs);
        esc = e;
        System.Threading.Thread.Sleep(15);
      }
    });
    t.IsBackground = true;
    t.Start();
  }

  const uint GW_OWNER = 4;
  const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;
  // 모니터마다 배율이 다를 때 좌표가 가상화되지 않도록 — 창을 읽기 전에 불러야 한다
  static readonly IntPtr DPI_PER_MONITOR_V2 = new IntPtr(-4);
  public static void MakeDpiAware() { try { SetProcessDpiAwarenessContext(DPI_PER_MONITOR_V2); } catch {} }

  // 보이지 않는데 IsWindowVisible 이 참인 창 — 잠든 UWP 앱(설정·계산기), 다른 가상 데스크톱의 창.
  // 남겨 두면 맨 앞 창·가림 판정에 끼어든다
  static bool Cloaked(IntPtr h) {
    int cloaked;
    return DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0;
  }

  // 눈에 보이는 테두리 — GetWindowRect 는 Windows 10 이후 보이지 않는 크기 조절 테두리(약 7px)까지 포함한다
  static RECT Bounds(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) == 0) return r;
    GetWindowRect(h, out r);
    return r;
  }

  // 실행 파일 이름(확장자 없이) — Process.ProcessName 과 같은 값.
  // Process.GetProcessById 는 부를 때마다 전체 프로세스를 열거해, 폴링마다 창 주인 수만큼 반복하면 CPU 를 꽤 먹는다
  static string ProcessName(int pid, Dictionary<int, string> cache) {
    string name;
    if (cache.TryGetValue(pid, out name)) return name;
    name = "";
    IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (h != IntPtr.Zero) {
      var path = new StringBuilder(1024);
      int size = path.Capacity;
      if (QueryFullProcessImageName(h, 0, path, ref size)) name = System.IO.Path.GetFileNameWithoutExtension(path.ToString());
      CloseHandle(h);
    }
    cache[pid] = name;
    return name;
  }

  // 콘솔 코드 페이지(한국어 Windows 는 CP949)와 무관하게 받는 쪽이 읽도록 ASCII 로만 쓴다
  static string Json(string s) {
    var sb = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"' || c == '\\') sb.Append('\\').Append(c);
      else if (c < 0x20 || c > 0x7e) sb.AppendFormat("\\u{0:x4}", (int)c);
      else sb.Append(c);
    }
    return sb.Append('"').ToString();
  }

  // EnumWindows 는 앞→뒤(z-order) 순으로 돌려준다 — 전역 순서이므로 가림 판정에 그대로 쓸 수 있다
  public static string Snapshot() {
    // pid → 프로세스 이름은 한 번 묻는 동안만 기억한다 — 오래 들고 있으면 재사용된 pid 에 옛 이름이 붙는다
    var names = new Dictionary<int, string>();
    var items = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      if (IsIconic(h)) return true;                       // 최소화 창은 (-32000,-32000) 을 준다
      if (GetWindow(h, GW_OWNER) != IntPtr.Zero) return true; // 대화상자·팝업 제외, 최상위만
      if (Cloaked(h)) return true;
      RECT r = Bounds(h);
      int w = r.Right - r.Left, ht = r.Bottom - r.Top;
      if (w < 200 || ht < 200) return true;               // 툴팁·얇은 보조 창 제외
      int pid; GetWindowThreadProcessId(h, out pid);
      items.Add("{\"app\":" + Json(ProcessName(pid, names)) + ",\"pid\":" + pid + ",\"id\":" + h.ToInt64() +
                ",\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"w\":" + w + ",\"h\":" + ht + "}");
      return true;
    }, IntPtr.Zero);

    string front = "";
    long frontId = 0;
    int frontPid = 0; // 맨 앞 창 주인의 프로세스 번호 — 이름만으로는 펫끼리(전부 electron) 가를 수 없다
    IntPtr fg = GetForegroundWindow();
    if (fg != IntPtr.Zero) {
      frontId = fg.ToInt64();
      GetWindowThreadProcessId(fg, out frontPid);
      front = ProcessName(frontPid, names);
    }
    string input = watching ? ",\"input\":{\"click\":" + clicks + ",\"x\":" + clickX + ",\"y\":" + clickY + ",\"esc\":" + escs + "}" : "";
    return "{\"frontmost\":" + Json(front) + ",\"frontId\":" + frontId + ",\"frontPid\":" + frontPid + ",\"windows\":[" + String.Join(",", items) + "]" + input + "}";
  }
}
"@ -ErrorAction SilentlyContinue

# 컴파일에 실패했으면 바로 끝낸다 — -Serve 로 떠 있으면서 답을 못 하면 받는 쪽은 타임아웃까지 기다려야 한다
if (-not ("PokeBuddyWin" -as [type])) { exit 1 }

[PokeBuddyWin]::MakeDpiAware()

if ($Serve) {
  [PokeBuddyWin]::WatchInput()
  while ($null -ne [Console]::In.ReadLine()) {
    [Console]::Out.WriteLine([PokeBuddyWin]::Snapshot())
    [Console]::Out.Flush()
  }
  exit 0
}

[PokeBuddyWin]::Snapshot()
