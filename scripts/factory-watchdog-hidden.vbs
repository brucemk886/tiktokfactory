' Launches the given command with no console window so a stray click cannot
' close the watchdog (and, with it, the local worker it supervises).
' Usage: wscript.exe factory-watchdog-hidden.vbs "<exe>" "<arg>" ...
Dim shell, cmd, i
Set shell = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  If i > 0 Then cmd = cmd & " "
  cmd = cmd & Chr(34) & WScript.Arguments(i) & Chr(34)
Next
If Len(cmd) > 0 Then shell.Run cmd, 0, False
