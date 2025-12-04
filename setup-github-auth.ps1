# GitHub Authentication Setup Script
# This script helps you set up GitHub authentication for pushing to the repository

Write-Host "GitHub Authentication Setup" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Clear old GitHub credentials
Write-Host "Step 1: Checking for old GitHub credentials..." -ForegroundColor Yellow
$credential = cmdkey /list | Select-String "github"
if ($credential) {
    Write-Host "Found stored credentials. You may need to update them." -ForegroundColor Yellow
    Write-Host "To remove old credentials, run: cmdkey /delete:git:https://github.com" -ForegroundColor Yellow
} else {
    Write-Host "No stored credentials found." -ForegroundColor Green
}

Write-Host ""
Write-Host "Step 2: Create a Personal Access Token" -ForegroundColor Yellow
Write-Host "1. Go to: https://github.com/settings/tokens" -ForegroundColor White
Write-Host "2. Click 'Generate new token' -> 'Generate new token (classic)'" -ForegroundColor White
Write-Host "3. Name it: bookstore-backend-push" -ForegroundColor White
Write-Host "4. Select expiration (90 days recommended)" -ForegroundColor White
Write-Host "5. Check the 'repo' scope" -ForegroundColor White
Write-Host "6. Click 'Generate token'" -ForegroundColor White
Write-Host "7. COPY THE TOKEN (you won't see it again!)" -ForegroundColor Red
Write-Host ""

# Prompt for token
$token = Read-Host "Paste your Personal Access Token here"

if ($token) {
    Write-Host ""
    Write-Host "Configuring git remote with token..." -ForegroundColor Yellow
    
    # Update remote URL with token
    $remoteUrl = "https://$token@github.com/kylejuris1/bookstore-backend.git"
    git remote set-url origin $remoteUrl
    
    Write-Host "Remote URL updated!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Attempting to push..." -ForegroundColor Yellow
    
    # Try to push
    git push -u origin main
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Success! Your code has been pushed to GitHub." -ForegroundColor Green
        Write-Host ""
        Write-Host "Note: The token is now in your git remote URL." -ForegroundColor Yellow
        Write-Host "For security, consider using git credential helper instead." -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "Push failed. Please check:" -ForegroundColor Red
        Write-Host "1. Token has 'repo' scope" -ForegroundColor White
        Write-Host "2. Repository exists and you have access" -ForegroundColor White
        Write-Host "3. Token hasn't expired" -ForegroundColor White
    }
} else {
    Write-Host "No token provided. Exiting." -ForegroundColor Red
}

