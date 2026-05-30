# Aither Service User Setup Guide

## Overview

Aither communicates with the Hemera Academy API through a dedicated service user with the `api-client` role. This guide describes the setup.

## Architecture

```
Aither App (Server-Side)
    ↓
Token Manager (getToken())
  ↓
Service Credential (long-lived token)
    ↓
Hemera API (/api/service/*)
    ↓
Auth Middleware (getUserRole())
    ↓
Service Endpoints (api-client or admin)
```

## Step 1: Create the Service User in Clerk

1. **Open the Clerk dashboard**: https://dashboard.clerk.com
2. **Navigate to the Hemera project**
3. **Users → Create User**
4. **Enter the user data**:
   - Email: `aither-service@hemera-academy.com`
  - Password: Secure generated password (not used for interactive login)
   - First Name: `Aither`
   - Last Name: `Service`

5. **Set the public metadata**:
   ```json
   {
     "role": "api-client",
     "service": "aither",
     "description": "Service user for Aither-Hemera API integration"
   }
   ```

6. **Record the user ID**: e.g. `user_2abc...`

## Step 2: Service Access Token / Service Credential

For production, we recommend using long-lived service credentials instead of short-lived dashboard sessions. Dashboard-generated session tokens are typically short-lived (for example ~60m) and are not suitable for unattended service-to-service communication.

For M2M auth we use a static API key, not Clerk JWTs:

```bash
# Generate API key (48 bytes, base64url-encoded)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Important**: Rotate and manage these keys through a secret manager (Vercel/AWS/GCP) and avoid committing them to version control.

## Step 3: Configure Environment Variables

### In Hemera (.env.local)

```bash
# API key for service authentication (must match Aither)
HEMERA_SERVICE_API_KEY=<generierter-api-key>

# Clerk user ID of the service user (for audit logging)
HEMERA_SERVICE_USER_ID=<clerk-user-id>
```

### In Aither (.env.local)

```bash
# Hemera API Base URL
HEMERA_API_BASE_URL=https://www.hemera.academy

# API key for the Hemera service API (must match Hemera)
HEMERA_API_KEY=<same-api-key-as-above>

# Clerk credentials (for local Aither auth)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

## Step 4: Verify Permissions

The service user has the following permissions, defined in `lib/auth/permissions.ts`:

```typescript
'api-client': [
  'read:courses',
  'read:participations',
  'write:participation-results',
]
```

### Allowed Endpoints

- ✅ `GET /api/service/courses` - Fetch course list
- ✅ `GET /api/service/courses/[id]` - Fetch course details with participations
- ✅ `GET /api/service/participations/[id]` - Fetch participation details
- ✅ `PUT /api/service/participations/[id]/result` - Write results

### Forbidden Endpoints

- ❌ `/api/admin/*` - Admin functions
- ❌ `/api/courses` (without `/service/`) - Public API
- ❌ All other non-service endpoints

## Step 5: Test the Integration

### Test 1: Fetch Course List

```bash
curl -X GET https://hemera-academy.vercel.app/api/service/courses \
  -H "Authorization: Bearer YOUR_SERVICE_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "title": "Basic Laparoscopy Course",
      "slug": "laparoskopie-basiskurs",
      "level": "BASIC",
      "startDate": "2026-03-15T00:00:00.000Z",
      "endDate": "2026-03-16T00:00:00.000Z",
      "participantCount": 12
    }
  ],
  "requestId": "...",
  "userId": "user_2abc...",
  "userRole": "api-client"
}
```

### Test 2: Write Participation Result

```bash
curl -X PUT https://hemera-academy.vercel.app/api/service/participations/PARTICIPATION_ID/result \
  -H "Authorization: Bearer YOUR_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "resultOutcome": "Successfully completed",
    "resultNotes": "Very strong performance",
    "complete": true
  }'
```

**Expected response** (200 OK):
```json
{
  "success": true,
  "message": "Participation result updated successfully",
  "requestId": "...",
  "userId": "user_2abc...",
  "userRole": "api-client"
}
```

### Test 3: Error Case - Invalid Token

```bash
curl -X GET https://hemera-academy.vercel.app/api/service/courses \
  -H "Authorization: Bearer invalid_token"
```

**Expected response** (401 Unauthorized):
```json
{
  "success": false,
  "error": "Not authenticated",
  "code": "UNAUTHORIZED",
  "requestId": "..."
}
```

## Security Notes

### Token Security

1. **Never commit tokens to Git**: `.env` is in `.gitignore`
2. **Token rotation**: Implement regular token renewal
3. **Secure storage**: Use a secret manager (Vercel, AWS, GCP)
4. **Monitoring**: Monitor API calls through Rollbar

### Rate Limiting

The Aither client is limited to **2 requests/second** (p-throttle).
Hemera applies additional rate limits per user/role.

### Audit Trail

All service API calls are logged:
- Service user ID
- Endpoint and method
- Timestamp and response time
- Status code

Logs are available in Rollbar and the Hemera database.

## Troubleshooting

### Problem: 401 Unauthorized

**Cause**: API key is invalid or not set

**Solution**:
1. Verify that `HEMERA_API_KEY` is set in Aither
2. Verify that `HEMERA_SERVICE_API_KEY` in Hemera has the same value
3. Update `HEMERA_SERVICE_API_KEY` in `.env`

### Problem: 403 Forbidden

**Cause**: The service user does not have the correct role

**Solution**:
1. Open the Clerk dashboard
2. Find the service user
3. Verify public metadata: `{ "role": "api-client" }`
4. If incorrect, fix the metadata and save it

### Problem: 429 Too Many Requests

**Cause**: Rate limit exceeded

**Solution**:
1. The Aither client already honors the `Retry-After` header automatically
2. Wait for the automatic retry
3. If persistent, raise the rate limit in Hemera

### Problem: 500 Internal Server Error

**Cause**: Server-side error in Hemera

**Solution**:
1. Check the Rollbar dashboard (Hemera project)
2. Analyze the error details
3. Contact the Hemera team if needed

## Token Refresh Strategy (Production)

For production, implement automatic token refresh:

```typescript
// In Aither: src/lib/hemera/token-manager.ts erweitern

import { clerkClient } from '@clerk/nextjs/server';
import type { Session } from '@clerk/nextjs/server';

class HemeraTokenManager {
  private tokenCache: { token: string; expiresAt: number } | null = null;

  async getToken(): Promise<string> {
    // Return cached token if still valid (> 2 minutes remaining)
    if (this.tokenCache && this.isTokenValid(this.tokenCache)) {
      return this.tokenCache.token;
    }

    // Fetch new token via Clerk Backend API
    const newToken = await this.fetchNewToken();
    return newToken;
  }

  private async fetchNewToken(): Promise<string> {
    // Use the Clerk server client instance provided by the SDK
    // The Clerk backend API exposes session creation via `clerkClient.sessions.create`.
    const session: Session = await clerkClient.sessions.create({
      userId: process.env.CLERK_SERVICE_USER_ID!,
      expiresInSeconds: 900, // 15 minutes
    } as any);

    // Access typed token fields on the returned session.
    // Clerk session types typically expose `lastActiveToken` which itself
    // contains a typed `raw` or `jwt` property. Use these typed fields
    // instead of unsafe `any` casts.
    const lastActiveToken = (session as unknown as { lastActiveToken?: { raw?: string; jwt?: string } }).lastActiveToken;
    const token = lastActiveToken?.raw ?? lastActiveToken?.jwt ?? (session as unknown as { token?: string }).token ?? (session as unknown as { jwt?: string }).jwt;

    if (!token) throw new Error('Failed to obtain service token from Clerk session response');

    this.tokenCache = {
      token,
      expiresAt: Date.now() + 900 * 1000 - 30000, // -30s safety margin
    };

    return this.tokenCache.token;
  }

  // Validate cached token structure and expiry
  private isTokenValid(cache: { token: string; expiresAt: number } | null): cache is { token: string; expiresAt: number } {
    if (!cache) return false;
    if (!cache.token || typeof cache.token !== 'string') return false;
    if (!cache.expiresAt || typeof cache.expiresAt !== 'number') return false;
    return cache.expiresAt > Date.now();
  }
}
```

## Related Documentation

- [Hemera API Documentation](../hemera/docs/api/README.md)
- [Clerk Backend API](https://clerk.com/docs/reference/backend-api)
- [Aither Integration Spec](../specs/001-hemera-api-integration/spec.md)
- [Service API Contract](../specs/001-hemera-api-integration/contracts/hemera-api-consumer-contract.md)
