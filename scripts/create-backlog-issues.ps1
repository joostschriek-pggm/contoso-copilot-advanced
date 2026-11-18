# Creates the workshop backlog as GitHub issues in YOUR repository (run once, from the repo root).
# Requires: gh auth status -> logged in.
$ErrorActionPreference = 'Stop'

foreach ($file in Get-ChildItem docs/backlog/BL-*.md) {
    $lines = Get-Content $file.FullName -Encoding UTF8
    $title = $lines[0] -replace '^# ', ''
    $label = $lines[1] -replace '^labels: ', ''
    $body  = ($lines | Select-Object -Skip 3) -join "`n"

    gh label create $label --force *> $null

    $count = gh issue list --state all --search "`"$title`" in:title" --json number --jq 'length'
        if ($LASTEXITCODE -ne 0) { throw "gh issue list failed for: $title" }
    if ($count -eq '0') {
        gh issue create --title $title --label $label --body $body | Out-Null
        Write-Host "✔ created: $title"
    } else {
        Write-Host "• exists:  $title"
    }
}
