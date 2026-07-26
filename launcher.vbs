' Hacker's Lair - silent Windows desktop launcher.
' Starts the local Node service hidden when needed, then opens the frameless
' desktop host. Pass "boot" to start only the service at Windows sign-in.
Option Explicit

Dim shell, fso, scriptDir, nodeExe, electronExe, desktopScript, launchCommand, i, bootMode

' VBScript's And is not short-circuiting, so guard Arguments(0) explicitly.
bootMode = False
If WScript.Arguments.Count > 0 Then
    If LCase(WScript.Arguments(0)) = "boot" Then bootMode = True
End If

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

If Not ServerIsUp() Then
    nodeExe = "C:\Program Files\nodejs\node.exe"
    If Not fso.FileExists(nodeExe) Then nodeExe = "node"

    shell.CurrentDirectory = scriptDir
    ' Window style 0 = hidden; False = let the service keep running.
    shell.Run """" & nodeExe & """ """ & scriptDir & "\server.js""", 0, False

    For i = 1 To 30
        WScript.Sleep 500
        If ServerIsUp() Then Exit For
    Next
End If

If Not ServerIsUp() Then
    MsgBox "Hacker's Lair started but its local identity could not be verified.", 16, "Hacker's Lair"
    WScript.Quit 1
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

Function ServerIsUp()
    Dim http, u, expectedNonce, responseText
    ServerIsUp = False
    If Not ReadIdentity(u, expectedNonce) Then Exit Function
    On Error Resume Next
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    http.SetTimeouts 1000, 1000, 1000, 1000
    http.Open "GET", u & "api/identity", False
    http.Send
    If Err.Number = 0 Then
        If http.Status = 200 Then
            responseText = http.ResponseText
            If InStr(1, responseText, """app"":""hackers-lair""", vbTextCompare) > 0 _
                And InStr(1, responseText, """nonce"":""" & expectedNonce & """", vbBinaryCompare) > 0 Then
                ServerIsUp = True
            End If
        End If
    End If
    On Error GoTo 0
End Function

Function ReadIdentity(ByRef u, ByRef nonce)
    Dim dataDir, overrideDir, identityFile, stream, content, portPattern, noncePattern, matches
    ReadIdentity = False
    overrideDir = shell.ExpandEnvironmentStrings("%PROJECT_MANAGER_DATA_DIR%")
    If overrideDir = "%PROJECT_MANAGER_DATA_DIR%" Or Len(Trim(overrideDir)) = 0 Then
        dataDir = shell.ExpandEnvironmentStrings("%APPDATA%") & "\HackersLair"
    Else
        dataDir = overrideDir
    End If
    identityFile = dataDir & "\api-token"
    If Not fso.FileExists(identityFile) Then Exit Function

    On Error Resume Next
    Set stream = fso.OpenTextFile(identityFile, 1, False)
    content = stream.ReadAll
    stream.Close
    If Err.Number <> 0 Then
        Err.Clear
        On Error GoTo 0
        Exit Function
    End If
    On Error GoTo 0

    Set portPattern = New RegExp
    portPattern.Pattern = """port""\s*:\s*(\d+)"
    portPattern.Global = False
    Set noncePattern = New RegExp
    noncePattern.Pattern = """nonce""\s*:\s*""([^""]+)"""
    noncePattern.Global = False
    If Not portPattern.Test(content) Or Not noncePattern.Test(content) Then Exit Function

    Set matches = portPattern.Execute(content)
    u = "http://127.0.0.1:" & matches(0).SubMatches(0) & "/"
    Set matches = noncePattern.Execute(content)
    nonce = matches(0).SubMatches(0)
    ReadIdentity = Len(nonce) > 0
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
