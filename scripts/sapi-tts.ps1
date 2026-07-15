param(
  [Parameter(Mandatory=$true)][string]$TextPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [string]$VoiceName = "",
  [int]$Rate = 0,
  [int]$Volume = 100
)

Add-Type -AssemblyName System.Speech

$text = Get-Content -LiteralPath $TextPath -Raw -Encoding UTF8
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = $Rate
$synth.Volume = $Volume

if ($VoiceName -ne "") {
  $synth.SelectVoice($VoiceName)
}

$synth.SetOutputToWaveFile($OutputPath)
$synth.Speak($text)
$synth.SetOutputToNull()
$synth.Dispose()
