!macro customInstall
  DetailPrint "Provisioning SQL Cockpit Windows service and tray startup task..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup\scripts\post-install.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  StrCmp $0 "0" done
    MessageBox MB_ICONSTOP|MB_OK "SQL Cockpit service provisioning failed (exit code $0). Run the installer as Administrator and review setup logs under $INSTDIR\resources\setup\scripts."
    Abort
  done:
!macroend

!macro customUnInstall
  DetailPrint "Removing SQL Cockpit startup task and service..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup\scripts\post-uninstall.ps1"'
  Pop $0
!macroend
