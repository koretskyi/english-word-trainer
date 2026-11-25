$ErrorActionPreference = 'Stop'

Write-Host 'Pixabay API key setup' -ForegroundColor Cyan
Write-Host 'Paste your key when prompted. Input will be hidden.'
$secure = Read-Host 'Pixabay API key' -AsSecureString

if ($secure.Length -eq 0) {
    Write-Error 'No key entered. Nothing was saved.'
    exit 1
}

$pointer = [IntPtr]::Zero
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)

    if ($key -match '[\r\n]') {
        throw 'The key contains an invalid line break.'
    }

    $envPath = Join-Path $PSScriptRoot '.env.local'
    $content = 'PIXABAY_API_KEY=' + $key + [Environment]::NewLine
    [System.IO.File]::WriteAllText($envPath, $content, [System.Text.UTF8Encoding]::new($false))

    Write-Host ''
    Write-Host '.env.local created in the project root.' -ForegroundColor Green
    Write-Host 'The key was not added to Git.' -ForegroundColor Green
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $key = $null
    if ($secure) { $secure.Dispose() }
}
