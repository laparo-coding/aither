# Aither → Hemera API Integration Plan

## Context

The **Aither app** (Next.js + Clerk) must access the **Hemera API** in order to:
1. **Read seminar/course data** (courses, bookings, participants)
2. **Write participant-specific results** (`CourseParticipation` fields: `resultOutcome`, `resultNotes`)

Both apps use Clerk as the auth provider.

---

## Empfehlung: Dedizierter Service-User mit Clerk

### Why NOT use the admin account?

| Risiko | Beschreibung |
|--------|-------------|
| **Over-privileging** | The admin can access everything, while Aither only needs course and participant data |
| **Audit-Verlust** | Alle Aither-Aktionen erscheinen als Admin-Aktionen im Log |
| **Credential-Kopplung** | Wenn Aither kompromittiert wird, ist der Admin-Zugang betroffen |
| **Session conflicts** | Admin sessions could be disrupted by parallel use |

### Empfohlener Ansatz: Clerk JWT + Service-Rolle

```mermaid
sequenceDiagram
    participant A as Aither App
    participant C as Clerk
    participant H as Hemera API

    A->>C: Authenticate as service-user
    C-->>A: JWT Token
    A->>H: API Request + Bearer JWT
    H->>C: Verify JWT
    C-->>H: Valid + userId + role=api-client
    H-->>A: Response Data
```
**Implementierung von `getUserRole(userId: string)`**

Beispiel (Pseudocode, server-side):

```typescript
import { clerkClient } from '@clerk/nextjs/server';

export async function getUserRole(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const user = await clerkClient.users.getUser(userId);
    if (!user) return null;
    const role = user?.publicMetadata?.role;
    return typeof role === 'string' && role.length > 0 ? role : null;
  } catch (error) {
    console.error(`getUserRole: failed to fetch user ${userId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}
```

Endpoint change: Ensure that `auth()` returns a `userId` before calling `getUserRole(userId)`; if `userId` is missing, return 401; if `getUserRole` returns a disallowed value, return 403. The simple role check can later be replaced with more fine-grained permission checks.


### Architektur-Optionen

#### Option A: Clerk Service-User mit eigener Rolle ⭐ Empfohlen

1. **Neuen Clerk-User anlegen** (z.B. `aither-service@hemera-academy.com`)
2. **Eigene Rolle zuweisen** via `publicMetadata`: `{ "role": "api-client" }`
3. **Extend Hemera**: Add a new `api-client` role in `lib/auth/permissions.ts` with limited permissions
4. **Aither**: Clerk Backend-SDK nutzen, um JWT zu generieren und an Hemera-API zu senden

**Vorteile:**
- Minimal changes to Hemera (only extend role + permissions)
- Clerk verwaltet Credentials zentral
- Audit-Trail zeigt klar "aither-service" als Akteur
- Gleiche Auth-Infrastruktur wie bestehende User

**Nachteile:**
- Service-User belegt einen Clerk-Seat
- JWT-Refresh muss in Aither gehandhabt werden

#### Option B: Clerk Machine-to-Machine (M2M) Token

1. **Create a Clerk JWT template** for service access
2. **API Key** in Clerk Dashboard generieren
3. **Extend the Hemera middleware** for M2M token validation

**Vorteile:**
- No user seat required
- Saubere M2M-Trennung

**Nachteile:**
- Clerk M2M ist ein neueres Feature, erfordert ggf. Plan-Upgrade
- Requires more middleware changes in Hemera

#### Option C: Shared API Key (simplest solution)

1. **API Key** als Environment Variable in beiden Apps
2. **Hemera**: Add a new middleware check for the `x-api-key` header
3. **Aither**: API Key bei jedem Request mitsenden

**Vorteile:**
- Sehr einfach zu implementieren
- No Clerk dependency for service-to-service communication

**Nachteile:**
- No user context (no audit trail showing exactly who did what)
- Key-Rotation muss manuell erfolgen
- Less secure than a JWT-based approach

---

## Empfohlene Implementierung: Option A

### Step-by-Step Plan

#### 1. Clerk: Service-User anlegen
- Neuen User in Clerk Dashboard erstellen: `aither-service@hemera-academy.com`
- `publicMetadata` setzen: `{ "role": "api-client", "service": "aither" }`

#### 2. Hemera: Introduce the new `api-client` role

**Datei:** `lib/auth/permissions.ts`
- `UserRole` erweitern um `api-client`
- Permissions definieren:
  - `read:courses` ✅
  - `read:bookings` ✅
  - `read:participations` ✅
  - `write:participation-results` ✅
  - `manage:courses` ❌
  - `manage:users` ❌

#### 3. Hemera: Add new API endpoints for service access

Neue Route-Gruppe `app/api/service/` mit:

| Endpunkt | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/service/courses` | GET | Read courses with participant data |
| `/api/service/courses/[id]` | GET | Read a single course with bookings |
| `/api/service/participations/[id]` | GET | Read participation details |
| `/api/service/participations/[id]/result` | PUT | Write result data |

Each endpoint checks:
```typescript
import { auth } from '@clerk/nextjs/server';

// Server-side guard for service endpoints — ensure the route handler is declared `async`
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // getUserRole should be implemented using clerkClient.users.getUser(userId)
  const role = await getUserRole(userId);
  if (role !== 'api-client' && role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ... handler logic continues here
}
```

#### 4. Aither: Use the Clerk backend SDK for API calls

Important: For service-to-service flows, the Aither side must **not** depend on an interactive user session token (`sessionId`). Instead, Aither should use a server-side service token / API key managed either by the Clerk backend SDK or as a dedicated service credential. Use an explicit token caching/rotation pattern (see "JWT / Token Management" below).

Pseudocode / Pattern (serverseitig in Aither):

```typescript
// Simple, robust option: read a pre-provisioned service credential from the environment
// (recommended). Store a pre-generated machine credential in your secrets manager and
// expose it as `CLERK_SERVICE_USER_API_KEY` (or as a sign-in token `CLERK_SERVICE_USER_SIGNIN_TOKEN`).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getServiceToken() {
  const cacheKey = 'hemera-service-token';
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 120000) return cached.token;

  // Prefer a pre-provisioned key stored in the environment / secrets manager
  const envToken = process.env.CLERK_SERVICE_USER_API_KEY || process.env.CLERK_SERVICE_USER_SIGNIN_TOKEN;
  if (!envToken) {
    throw new Error('Missing service credential: set CLERK_SERVICE_USER_API_KEY or CLERK_SERVICE_USER_SIGNIN_TOKEN');
  }

  // Cache short-lived usage (expiresAt is approximate when using a static API key)
  const expiresAt = Date.now() + 15 * 60 * 1000;
  tokenCache.set(cacheKey, { token: envToken, expiresAt });
  return envToken;
}

const token = await getServiceToken();
const response = await fetch(`${process.env.HEMERA_API_BASE_URL}/api/service/courses`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
```

Implementierungs‑Hinweise:
- Load `CLERK_SERVICE_USER_API_KEY` (or `CLERK_SERVICE_USER_SIGNIN_TOKEN`) from the environment / secrets manager. The pattern above uses a static pre-provisioned service credential; no token is minted dynamically at runtime.
- Implementiere `tokenCache` in Aither; for horizontal scalability use a shared cache (Redis, Vercel KV) instead of process memory.
- On 401 responses that include `WWW-Authenticate` or an expiry indication, refresh the credential from the environment once and retry the failed request (retry-on-expiry).

#### 5. Hemera: Adjust the Middleware

**File:** `proxy.ts` (in the Hemera repo, `proxy.ts` at the project root) — ensure that `/api/service/*` routes are protected by Clerk auth.

Implementation notes for `proxy.ts`:
- `proxy.ts` is the central Next.js/Edge proxy handler (see the existing `proxy.ts` in the repo). Extend it or import middleware that specifically intercepts routes matching `/api/service/*` and runs Clerk verification (for example `auth()` / `clerkMiddleware()` / `verifySession`).
- The middleware should inject the validated `userId` and `role` into the request context/headers so the actual route handlers under `app/api/service/*` can check the role.
- Exportiere den konfigurierten Handler / Middleware (z. B. `proxyMiddleware`) so er dort zentral verwendet werden kann.

### JWT / Token Management (additional notes)

- Access token lifetime: We recommend short-lived access tokens (for example 15 minutes) and a refresh cadence in Aither that renews tokens proactively (for example when <= 2 minutes of validity remain) or every 10 minutes.
- Token caching: Implement a `getServiceToken()` function in Aither with a `tokenCache` (in-memory for dev, Redis/Vercel KV for production) and safe rotation.
- Retry on expiry: If Hemera returns 401/`WWW-Authenticate`, Aither should refresh the token once and retry the request.
- Error handling: If refresh/retries fail, log the issue, remove invalid cached tokens, and fail with 5xx/401 depending on the cause.

---

## Datenfluss

```mermaid
flowchart LR
    subgraph Aither
        A1[Service Logic]
        A2[Clerk SDK]
    end

    subgraph Clerk
        C1[Service User JWT]
    end

    subgraph Hemera
        H1[/api/service/*]
        H2[Auth Middleware]
        H3[Permissions Check]
        H4[Prisma DB]
    end

    A1 --> A2
    A2 --> C1
    C1 --> H1
    H1 --> H2
    H2 --> H3
    H3 --> H4
```

## Security Considerations

- **Principle of Least Privilege**: The `api-client` role has only the minimum required permissions
- **Audit Trail**: Alle Aktionen sind dem Service-User zugeordnet
- **JWT validation**: Clerk verifies token integrity and expiration

### Rate Limiting (implementation guidance)

Use a server-side rate limiter to protect `/api/service/*`. Recommended library: `@upstash/ratelimit` with Upstash Redis.

Example (Node/Edge):

```ts
import Redis from '@upstash/redis';
import Ratelimit from '@upstash/ratelimit';

const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow({ window: 60, limit: 120 }), // 120 requests/min per key
});

// In route handler
const identifier = userId || request.ip;
const result = await ratelimit.limit(identifier);
if (!result.success) {
  return new Response('Too Many Requests', { status: 429 });
}
```

Call `ratelimit.limit(identifier)` early in `/api/service/*` handlers. Choose `identifier` by priority: authenticated userId → client IP → service API key.

### IP Whitelisting

Configure allowlists in the deployment platform (Vercel Edge Config, cloud firewall, or load balancer) and gate them with an environment flag, e.g. `SERVICE_IP_ALLOWLIST=1` to enable. Keep whitelisting optional and configurable so you can disable it for non-prod environments. Document the source of truth for the list and how to update it.

### PII Redaction

Add a dedicated PII redaction step for all API responses returning bookings/participations. Implement a single transform function used by service endpoints to ensure consistent sanitization:

```ts
// Example shape
type CourseParticipation = { id: string; courseId: string; userId: string; resultOutcome?: string; resultNotes?: string; email?: string; phoneNumber?: string; billingAddress?: string; paymentMethod?: string; cardNumber?: string; transactionId?: string };

function sanitizeParticipation(participation: CourseParticipation) {
  // Keep allowed fields and pseudonymize userId
  return {
    id: participation.id,
    courseId: participation.courseId,
    userId: hashUserId(participation.userId), // pseudonymize
    resultOutcome: participation.resultOutcome,
    resultNotes: participation.resultNotes,
  };
}

// Audit logging when PII is accessed
function logPIIAccess(requesterId: string, fields: string[], reason: string) {
  // Implement audit entry: timestamp, requesterId, fields touched, reason, request id
}

// Guidance: Enumerate all PII fields centrally (email, phoneNumber, birthDate, fullName, billingAddress, cardNumber, transactionId, paymentMethod) and specify strategy per field (remove/hash/pseudonymize). Use a KMS-backed HMAC key or KMS envelope encryption for stable pseudonymization and rotate keys following your key rotation policy.


## Confirmed Constraints

| Frage | Antwort |
|-------|---------|
| Hosting | Hemera auf Vercel, Aither lokal/anderer Host |
| Datenzugriff | Kurse, Bookings und Participations. Sensitive booking fields are explicitly excluded from responses: `paymentMethod`, `cardNumber`, `billingAddress`, `transactionId`. `CourseParticipation` exposes only `id`, `courseId`, `userId` (pseudonymous), `resultOutcome`, and `resultNotes`. PII fields (e.g., `email`, `phoneNumber`, `birthDate`, `fullName`) are redacted or hashed before returning. |
| Clerk-Plan | Free/Hobby - no M2M available → **Option A confirmed** |

---

## Implementation Tasks (Hemera Side)

- [ ] Clerk: Create service user `aither-service@hemera-academy.com` and set `publicMetadata.role = "api-client"`
- [ ] `lib/auth/permissions.ts`: `UserRole` um `api-client` erweitern mit Permissions `read:courses`, `read:participations`, `write:participation-results`
- [ ] `app/api/service/courses/route.ts`: GET endpoint for the course list (with participant count)
- [ ] `app/api/service/courses/[id]/route.ts`: GET endpoint for course details including participations
- [ ] `app/api/service/participations/[id]/route.ts`: GET endpoint for participation details
- [ ] `app/api/service/participations/[id]/result/route.ts`: PUT endpoint to write result data
- [ ] Create auth guard helper for `/api/service/*` routes (allow `api-client` or `admin`)
- [ ] Add rate limiting for `/api/service/*` endpoints
- [ ] Tests: contract tests for the new service endpoints

## Implementation Tasks (Aither Side)

- [ ] Create the Hemera API client with Clerk backend SDK JWT generation
- [ ] Configure environment variables (`HEMERA_API_URL`, Clerk service-user credentials)
- [ ] Implement API calls for course and participation data

### Environment Variables (Checklist)

Die folgenden Environment-Variablen sollten gesetzt und dokumentiert werden (server-side vs client-side gekennzeichnet):

- `HEMERA_API_URL` (server-side): Hemera API base URL, for example `https://hemera.example.com`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (client-side): Clerk publishable key
- `CLERK_SECRET_KEY` (server-side): Clerk secret key for backend SDKs
- `CLERK_SERVICE_USER_EMAIL` (server-side): service user email (reference)
- `CLERK_SERVICE_USER_API_KEY` or `CLERK_SERVICE_USER_ID` (server-side): service user credential/ID for server-side integrations

Note: The `NEXT_PUBLIC_` prefix marks client-side variables; all other variables are confidential and belong in a secret store (Vercel/GCP/AWS/etc.).
