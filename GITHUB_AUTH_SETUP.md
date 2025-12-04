# GitHub Authentication Setup

## Step 1: Create a Personal Access Token

1. Go to GitHub: https://github.com/settings/tokens
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Give it a name: `bookstore-backend-push`
4. Select expiration (recommend 90 days or custom)
5. Select scopes:
   - ✅ **repo** (Full control of private repositories)
6. Click **"Generate token"**
7. **IMPORTANT**: Copy the token immediately (you won't see it again!)

## Step 2: Use the Token

After creating the token, you'll be prompted to enter it when pushing. Use the token as your password.

Alternatively, you can configure it directly in the remote URL (see below).

## Quick Setup (After Creating Token)

Once you have your token, run:
```bash
git remote set-url origin https://YOUR_TOKEN@github.com/kylejuris1/bookstore-backend.git
git push -u origin main
```

Or use it when prompted for password during push.
