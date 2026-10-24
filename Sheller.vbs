Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = root & "\node_modules\electron\dist\electron.exe"
mainPath = root & "\out\main\index.js"

If Not fso.FileExists(exePath) Then
  MsgBox "Electron not found. Run npm install.", vbCritical, "Sheller"
  WScript.Quit 1
End If

If Not fso.FileExists(mainPath) Then
  MsgBox "Build not found. Run npm run build.", vbCritical, "Sheller"
  WScript.Quit 1
End If

shell.CurrentDirectory = root
shell.Run """" & exePath & """ .", 0, False
