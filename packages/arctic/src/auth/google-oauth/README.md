# Google OAuth Authentication for Arctic

This module implements OAuth 2.0 authentication for Google's Gemini API using Google's standard OAuth2 flow with pre-configured client credentials from the Gemini CLI project.

## Features

- **No Setup Required**: Uses pre-configured OAuth client credentials from Google's Gemini CLI
- **Automatic Browser Opening**: Browser opens automatically for login
- **Token Refresh**: Automatic token refresh before expiration
- **Simple Integration**: Just run `arctic auth google` and select "Login with Google"

## Quick Start

### Authenticate

```bash
arctic auth google
```

Select **"Login with Google"** and follow the browser prompts. That's it!

## How It Works

1. **Start OAuth Flow**: Arctic starts a local callback server on a random port
2. **Browser Opens**: Your browser opens to Google's authorization page
3. **User Consent**: You log in to Google and grant permissions
4. **Callback**: Google redirects to the local server with authorization code
5. **Token Exchange**: Arctic exchanges the code for access and refresh tokens
6. **Storage**: Tokens are stored in `~/.arctic/auth.json`
7. **Auto Refresh**: Tokens are automatically refreshed 5 minutes before expiration

## Usage

### Using OAuth Authentication

```bash
# Authenticate
arctic auth google
# Select "Login with Google"

# Use any Google model
arctic chat --model google/gemini-2.0-flash-exp
```

### Using API Key (Existing Method)

```bash
# Authenticate with API key
arctic auth google
# Select "Use API Key"
# Enter your API key

# Use any Google model
arctic chat --model google/gemini-2.0-flash-exp
```

## OAuth Scopes

The following scopes are requested:
- `https://www.googleapis.com/auth/cloud-platform` - Access to Google Cloud Platform
- `https://www.googleapis.com/auth/userinfo.email` - User email
- `https://www.googleapis.com/auth/userinfo.profile` - User profile

## Implementation Details

### OAuth Configuration

Uses Google's official Gemini CLI OAuth credentials:
- **Client ID**: `681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com`
- **Client Secret**: `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`

These are the same credentials used by Google's official Gemini Code Assist CLI.

### Token Management

- **Access Token**: Short-lived (1 hour), used for API requests
- **Refresh Token**: Long-lived, used to get new access tokens
- **Auto Refresh**: Tokens are refreshed 5 minutes before expiration
- **Storage**: Stored in `~/.arctic/auth.json` with OAuth type

### Callback Server

- Dynamic port allocation (finds available port automatically)
- Local server on `http://localhost:<port>/oauth2callback`
- Redirects to Google's success/failure pages after auth
- Server automatically closes after receiving callback

## Troubleshooting

### "Authentication failed"
Try clearing your Google auth cache and re-authenticating:
```bash
arctic auth google
# Select "Login with Google" again
```

### "Browser doesn't open automatically"
The URL will be printed in the terminal. Copy and paste it into your browser manually.

### "No access token or refresh token received"
This usually means you denied permissions. Try again and make sure to grant all requested permissions.

### API requests fail after login
Make sure you completed the browser login flow. Check that credentials are stored:
```bash
cat ~/.arctic/auth.json | grep -A5 '"google"'
```

You should see an entry with `"type": "oauth"` and `"access"` and `"refresh"` fields.

## Dependencies

- `google-auth-library` - Google's official OAuth library
- `open` - Cross-platform utility to open browser

## Comparison: OAuth vs API Key

| Feature | OAuth (Login with Google) | API Key |
|---------|--------------------------|---------|
| **Setup** | Zero setup - just login! | Requires API key from Google Cloud |
| **Security** | OAuth tokens (auto-refresh) | Static API key |
| **User Experience** | Browser-based login | Copy/paste key |
| **Token Management** | Automatic refresh | N/A |
| **Best For** | Personal use, development | CI/CD, automation |

## Related Files

- `index.ts` - Main OAuth plugin implementation
- `README.md` - This file
