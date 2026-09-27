# 한 프로세스의 창 글자를 모두 적는다 — 업데이트 E2E 가 멈춘 설치 파일의 메시지 창을 읽는다 (scripts/e2e-update.cjs)
#   powershell -NoProfile -File scripts/e2e/window-text.ps1 -ProcessId <pid>
param([int]$ProcessId)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
  "[창] $($w.Current.Name)"
  foreach ($e in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($e.Current.Name) { "  $($e.Current.ControlType.ProgrammaticName) $($e.Current.Name)" }
  }
}
