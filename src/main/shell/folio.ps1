# folio: the commands marked (OSC 133, 633;E) and the folder said (OSC 7).
$Global:__FolioPrompt = $function:prompt
$Global:__FolioLast = (Get-History -Count 1).Id
function Global:prompt {
  $ok = $?
  $code = if ($ok) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }
  $e = [char]27; $a = [char]7
  $out = ''
  $h = Get-History -Count 1
  if ($h -and $h.Id -ne $Global:__FolioLast) {
    $Global:__FolioLast = $h.Id
    $cmd = $h.CommandLine -replace '\\', '\\' -replace ';', '\x3b' -replace "`n", '\x0a'
    $out += "$e]633;E;$cmd$a$e]133;D;$code$a"
  }
  $out += "$e]7;file://$env:COMPUTERNAME/$($PWD.ProviderPath -replace '\\', '/')$a$e]133;A$a"
  $out + (& $Global:__FolioPrompt) + "$e]133;B$a"
}
if (Get-Module PSReadLine) {
  Set-PSReadLineKeyHandler -Chord Enter -ScriptBlock {
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    [Console]::Write("$([char]27)]133;C$([char]7)")
  }
}
