; Windows 설치 파일의 사용자 정의 단계 — scripts/build-exe.cjs 의 nsis.include
; 제거할 때 CLI 훅 등록을 걷는다. 설치된 exe 를 Node 모드로 돌려 dist/cli/uninstall-hooks.js(원본 src/cli/uninstall-hooks.ts)를 실행한다.
; 업데이트 때도 옛 제거 프로그램이 돌기 때문에 그때(isUpdated)는 건너뛴다 — 건너뛰지 않으면 업데이트할 때마다 연결이 끊긴다

!macro customUnInstall
  ${ifNot} ${isUpdated}
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\app\dist\cli\uninstall-hooks.js"'
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'
  ${endIf}
!macroend
