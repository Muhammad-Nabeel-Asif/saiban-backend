# Account Management API — Backend Handoff

This document describes what the Saiban **backend** has implemented for login-adjacent account management. The frontend BFF routes and UI described in the original handoff can now proxy to these live endpoints.

**Status:** Ready for integration (local dev tested; deploy requires env setup below).

---

## Architecture (unchanged)

```
Browser → Next.js BFF (/api/auth/*) → Backend API ({API_URL}/api/auth/*)
```

| Flow type | Routes | Auth |
|-----------|--------|------|
| Public | `forgot-password`, `reset-password`, `login`, `register` | None |
| Authenticated | `change-password`, `profile` | `Authorization: Bearer <jwt>` |

Global API prefix: **`/api`** (all paths below are relative to that).

---

## Implemented endpoints

| Method | Backend path | Matches frontend BFF? |
|--------|--------------|------------------------|
| `POST` | `/api/auth/forgot-password` | Yes → `/api/auth/forgot-password` |
| `POST` | `/api/auth/reset-password` | Yes → `/api/auth/reset-password` |
| `POST` | `/api/auth/change-password` | Yes → `/api/auth/change-password` |
| `PATCH` | `/api/auth/profile` | Yes → `/api/auth/profile` |
| `POST` | `/api/auth/login` | Already integrated |
| `POST` | `/api/auth/register` | Already integrated |

**Not implemented (optional / future):**

- `GET /api/auth/me` — user hydration on hard refresh
- Email change flow — email is read-only by design for this phase

---

## Endpoint contracts

### `POST /api/auth/forgot-password`

Initiates password reset email. Response is **always the same** for valid email format, whether or not the account exists.

**Request**
```json
{ "email": "user@example.com" }
```

**Success `200`**
```json
{ "message": "If an account exists, a reset link has been sent." }
```

**Errors**

| Status | When | Example `message` |
|--------|------|-------------------|
| `400` | Invalid email format | Validation message from NestJS |
| `429` | Rate limited | `"Too many requests. Please try again later."` |

**Rate limits (defaults)**

- 3 requests per email per 15 minutes
- 10 requests per IP per 15 minutes

**Reset email link format**

```
{FRONTEND_URL}/reset-password?token={64-char-hex-token}
```

- Token is single-use, cryptographically random (32 bytes, hex-encoded)
- Expires after **1 hour** (configurable via `PASSWORD_RESET_EXPIRY_HOURS`)
- `FRONTEND_URL` must be set per environment (see Deployment section)

---

### `POST /api/auth/reset-password`

Completes forgot-password flow. Does **not** return a JWT — frontend should redirect to `/login`.

**Request**
```json
{
  "token": "opaque-token-from-email-query-param",
  "password": "newSecret123"
}
```

**Success `200`**
```json
{ "message": "Password updated successfully" }
```

**Errors**

| Status | When | Example `message` |
|--------|------|-------------------|
| `400` | Invalid/expired token | `"Invalid or expired reset token"` |
| `400` | Password too short | `"password must be longer than or equal to 6 characters"` |
| `400` | Missing fields | Validation messages |

**Behavior**

- Password minimum length: **6 characters**
- Token invalidated on success (and any outstanding reset token for that user is cleared)
- Existing JWTs for that user are **not** revoked — user must log in again manually

---

### `POST /api/auth/change-password` *(authenticated)*

**Headers**
```
Authorization: Bearer <access_token>
```

**Request**
```json
{
  "currentPassword": "oldSecret123",
  "newPassword": "newSecret456"
}
```

**Success `200`**
```json
{ "message": "Password updated successfully" }
```

**Errors**

| Status | When | Example `message` |
|--------|------|-------------------|
| `401` | Missing/invalid/expired JWT | `"Missing Authorization header"`, `"Invalid or expired token"`, etc. |
| `400` | Wrong current password | `"Current password is incorrect"` |
| `400` | New same as current | `"New password must be different from current password"` |
| `400` | New password too short | Validation message |

**Behavior**

- Current session JWT **remains valid** after change — no re-login required
- Other sessions/devices are **not** invalidated

---

### `PATCH /api/auth/profile` *(authenticated)*

**Headers**
```
Authorization: Bearer <access_token>
```

**Request**
```json
{ "name": "Jane Doe" }
```

**Success `200`**
```json
{
  "user": {
    "id": "674a1b2c3d4e5f6789012345",
    "email": "user@example.com",
    "name": "Jane Doe",
    "role": "admin"
  }
}
```

**Errors**

| Status | When | Example `message` |
|--------|------|-------------------|
| `401` | Missing/invalid JWT | See change-password |
| `400` | Name too short | `"name must be longer than or equal to 2 characters"` |

**Notes**

- Only `name` is updatable — email is not accepted/changed
- `user` shape matches login response (see below) — safe to sync sidebar/local state

---

## Reference: existing auth endpoints

### `POST /api/auth/login`

Unchanged. Returns:

```json
{
  "access_token": "<jwt>",
  "user": {
    "id": "<mongodb-object-id>",
    "email": "user@example.com",
    "name": "Jane Doe",
    "role": "admin"
  }
}
```

### `POST /api/auth/register`

**Note for frontend:** Register returns a **message only**, not a token:

```json
{ "message": "User registered successfully" }
```

If the BFF currently expects `access_token` on register, keep the existing post-register login call (or update the BFF to login after register).

**Validation added:** password minimum length **6**; name minimum length **2** when provided.

---

## Error response format

All errors go through a global exception filter:

```json
{
  "statusCode": 400,
  "timestamp": "2026-06-14T12:00:00.000Z",
  "path": "/api/auth/change-password",
  "method": "POST",
  "message": "Current password is incorrect"
}
```

For validation errors, `message` may be a **string array** (NestJS default). Frontend should handle both:

```typescript
const msg = Array.isArray(body.message) ? body.message[0] : body.message;
```

Reading order (as in original handoff): `message` first, then `error` fallback.

---

## Password policy

| Rule | Value |
|------|-------|
| Minimum length | 6 characters |
| Uppercase / symbols | Not required |
| Register | Same 6-char minimum |
| Profile name | Minimum 2 characters |

Frontend validation already aligned with these rules should work without changes.

---

## Security behavior summary

| Concern | Backend behavior |
|---------|------------------|
| Email enumeration (forgot-password) | Same success response regardless of account existence |
| Reset token storage | SHA-256 hash stored; raw token only in email URL |
| Reset token reuse | Single-use; cleared after successful reset |
| Rate limiting | Forgot-password only (429) |
| Session invalidation on password change | No — current JWT stays valid |
| Session invalidation on reset-password | N/A — no auto-login |

---

## Deployment / environment

Backend requires these env vars for full account-management functionality:

| Variable | Required | Description |
|----------|----------|-------------|
| `FRONTEND_URL` | **Yes** (for reset emails) | Base URL for reset links, e.g. `https://saiban-nu.vercel.app` |
| `PASSWORD_RESET_EXPIRY_HOURS` | No | Default `1` |
| `SMTP_HOST` | Yes (prod) | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | No | Default `587` |
| `SMTP_SECURE` | No | Default `false` (STARTTLS on 587) |
| `SMTP_USER` | Yes (prod) | SMTP username |
| `SMTP_PASS` | Yes (prod) | SMTP password / app password |
| `SMTP_FROM` | No | Default `noreply@saiban.app`; use authenticated sender for Gmail |

**Per-environment `FRONTEND_URL` examples:**

| Environment | Suggested value |
|-------------|-----------------|
| Local | `http://localhost:3000` |
| Staging | Staging Vercel URL |
| Production | Production app URL |

**CORS:** Backend reads `CORS_ORIGINS` (comma-separated). Frontend origins must be listed for browser-direct calls; BFF server-side proxy is unaffected.

**Dev without SMTP:** If `SMTP_HOST` is unset, reset links are **logged to the backend console** instead of emailed — useful for local testing.

---

## Frontend integration checklist

- [ ] Confirm `API_URL` / `NEXT_PUBLIC_API_URL` points at running backend
- [ ] BFF routes proxy to paths above (no path changes expected)
- [ ] Forgot password → check email (or backend logs in dev) → `/reset-password?token=...`
- [ ] Reset password → success → redirect to `/login` (no token in response)
- [ ] Account settings → PATCH profile → update local user state from `response.user`
- [ ] Account settings → change password → stay logged in (cookie unchanged)
- [ ] Handle `429` on forgot-password with user-friendly copy
- [ ] Handle validation `message` as string **or** array

### Suggested smoke tests

1. **Forgot → reset → login**
   - POST forgot-password with known email
   - Open link from email (or server log)
   - POST reset-password with new password
   - Login with new password

2. **Profile update**
   - PATCH profile with new name + Bearer token
   - Refresh page; sidebar should show updated name (if local state synced from response)

3. **Change password**
   - POST change-password while logged in
   - Logout → login with new password (old password should fail)

4. **Rate limit**
   - POST forgot-password 4+ times for same email within 15 min → expect `429`

---

## Differences from original frontend handoff spec

| Topic | Original spec | Actual backend |
|-------|---------------|----------------|
| Register response | Token + user (same as login) | `{ message }` only — login separately |
| Reset 404 vs 400 | Optional 404 for missing token | Always `400` with generic message |
| Session invalidation | Open question | Not implemented — JWTs remain valid |
| `GET /api/auth/me` | Optional future | Not implemented |

---

## Backend source reference

| Concern | Location |
|---------|----------|
| Routes | `src/modules/auth/auth.controller.ts` |
| Business logic | `src/modules/auth/auth.service.ts` |
| Request validation | `src/modules/auth/auth.dto.ts` |
| Email sending | `src/modules/mail/mail.service.ts` |
| JWT guard | `src/guards/jwt-auth.guard.ts` |
| User schema (reset fields) | `src/schemas/user.schema.ts` |
| Env template | `.env.example` |

---

## Questions / follow-ups

Contact backend if you need:

1. **`GET /api/auth/me`** for hard-refresh user hydration
2. **Register returning token** (auto-login after signup)
3. **Global session invalidation** after password change/reset
4. **Stricter password policy** (would require frontend validation updates)

Otherwise, existing BFF routes and UI should integrate without structural changes once `API_URL` and backend env are configured per environment.
