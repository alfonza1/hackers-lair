' Hacker's Lair - silent Windows desktop launcher.
' Starts the local Node service hidden when needed, then opens the frameless
' desktop host. Pass "boot" to start only the service at Windows sign-in.
Option Explicit

Dim URL, shell, fso, scriptDir, nodeExe, electronExe, desktopScript, launchCommand, i, bootMode
URL = "http://localhost:4949/"

' VBScript's And is not short-circuiting, so guard Arguments(0) explicitly.
bootMode = False
If WScript.Arguments.Count > 0 Then
    If LCase(WScript.Arguments(0)) = "boot" Then bootMode = True
End If

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

If Not ServerIsUp(URL) Then
    nodeExe = "C:\Program Files\nodejs\node.exe"
    If Not fso.FileExists(nodeExe) Then nodeExe = "node"

    shell.CurrentDirectory = scriptDir
    ' Window style 0 = hidden; False = let the service keep running.
    shell.Run """" & nodeExe & """ """ & scriptDir & "\server.js""", 0, False

    For i = 1 To 30
        WScript.Sleep 500
        If ServerIsUp(URL) Then Exit For
    Next
End If

If bootMode Then WScript.Quit 0

If AppWindowIsOpen() Then
    shell.AppActivate "Hacker's Lair"
    WScript.Quit 0
End If

electronExe = scriptDir & "\node_modules\electron\dist\electron.exe"
desktopScript = scriptDir & "\desktop.js"
If Not fso.FileExists(electronExe) Then
    MsgBox "Hacker's Lair desktop files are not installed. Run npm install in:" & vbCrLf & scriptDir, 16, "Hacker's Lair"
    WScript.Quit 1
End If

shell.CurrentDirectory = scriptDir
launchCommand = """" & electronExe & """ """ & desktopScript & """"
shell.Run launchCommand, 1, False

Function ServerIsUp(u)
    Dim http
    ServerIsUp = False
    On Error Resume Next
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    http.SetTimeouts 1000, 1000, 1000, 1000
    http.Open "GET", u, False
    http.Send
    If Err.Number = 0 Then
        If http.Status = 200 Then ServerIsUp = True
    End If
    On Error GoTo 0
End Function

Function AppWindowIsOpen()
    Dim service, processes, process
    AppWindowIsOpen = False
    On Error Resume Next
    Set service = GetObject("winmgmts:\\.\root\cimv2")
    Set processes = service.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='electron.exe'")
    For Each process In processes
        If InStr(1, process.CommandLine & "", "desktop.js", vbTextCompare) > 0 Then
            AppWindowIsOpen = True
            Exit For
        End If
    Next
    On Error GoTo 0
End Function
