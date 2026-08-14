; "Open in Micah" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInMicah" "" "Open in Micah"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInMicah" "Icon" '"$INSTDIR\micah.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInMicah" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInMicah\command" "" '"$INSTDIR\micah.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInMicah" "" "Open in Micah"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInMicah" "Icon" '"$INSTDIR\micah.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInMicah" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInMicah\command" "" '"$INSTDIR\micah.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInMicah" "" "Open in Micah"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInMicah" "Icon" '"$INSTDIR\micah.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInMicah" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInMicah\command" "" '"$INSTDIR\micah.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInMicah"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInMicah"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInMicah"
!macroend
