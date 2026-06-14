# Account Management — Backend Handback to Frontend

**From:** Backend team  
**To:** Frontend team  
**Date:** 2026-06-14  
**Re:** Response to [Frontend Follow-up](./account-management-frontend-followup.md)

---

## Summary

Priority 1 and Priority 2 items (except server-side logout) are implemented on `main`. Deploy to your target environment and wire the BFF.

| Item | Status |
|------|--------|
| `GET /api/auth/me` | **Shipped** |
| Register returns token | **Shipped** |
| Session invalidation on password change / reset | **Shipped** (see behavior below) |
| `POST /api/auth/logout` (server-side) | **Not implemented** — cookie-only logout remains fine |

---

## 1. `GET /api/auth/me` *(Priority 1)*

```
GET /api/auth/me
Authorization: Bearer <access_token>
```

**Success `200`** — unchanged from your proposal:
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

**Errors:** `401` for missing, invalid, expired, or revoked JWT.

**Frontend action:** Add BFF `GET /api/auth/me`, `useMe` hook, hydrate `AppProvider` on admin shell mount.

---

## 2. Register returns token *(Priority 2)*

```
POST /api/auth/register
```

**Success `200`** — now matches login:
```json
{
  "access_token": "<jwt>",
  "user": {
    "id": "...",
    "email": "...",
    "name": "...",
    "role": "admin"
  }
}
```

**Frontend action:** Simplify `app/api/auth/register/route.ts` — remove the post-register login call; set cookie from `access_token` directly (same as login route).

**Breaking change:** Response no longer includes `{ message: "User registered successfully" }`. Update any code that relied on that shape.

---

## 3. Session invalidation *(Priority 2)*

### How it works

- Each user has a `tokenVersion` (starts at `0`).
- JWT payload now includes `tv` (token version).
- `AuthGuard` rejects tokens where `tv` does not match the user's current `tokenVersion`.

### When tokens are invalidated

| Event | All other sessions | Current session |
|-------|-------------------|-----------------|
| `POST /api/auth/reset-password` | Invalidated | N/A (user not logged in) |
| `POST /api/auth/change-password` | Invalidated | **Stays valid** — see below |

### `POST /api/auth/change-password` — updated response

**Success `200`**
```json
{
  "message": "Password updated successfully",
  "access_token": "<new-jwt-with-updated-tv>"
}
```

**Frontend action:** After successful change-password, **replace the auth cookie** with the new `access_token`. User stays on account settings without re-login. Sessions on other devices/browsers stop working on their next API call.

If you ignore `access_token` in the response, the current session will get `401` on the next request (because `tokenVersion` was bumped).

### `POST /api/auth/reset-password`

Response unchanged (`{ message }` only). All existing JWTs for that user are invalidated. No auto-login.

### Backward compatibility

Existing JWTs issued before this change have no `tv` claim — treated as `tv: 0`. They keep working until the user changes or resets their password.

---

## 4. `POST /api/auth/logout` — not implemented

Cookie-only logout via BFF remains the correct approach. Server-side JWT blocklisting is not needed unless you add refresh tokens or a session store later.

---

## Error format — unchanged

Same shape as documented. Validation `message` may be string or string array.

---

## Environment checklist

Confirm per environment before testing:

| Variable | Local | Staging | Production |
|----------|-------|---------|------------|
| `FRONTEND_URL` | `http://localhost:3000` | Staging Vercel URL | Production app URL |
| `SMTP_*` | Gmail configured | Required for real emails | Required |
| `CORS_ORIGINS` | Includes frontend origins | Includes staging origin | Includes prod origin |

Reset link format unchanged:
```
{FRONTEND_URL}/reset-password?token={64-char-hex-token}
```

---

## Suggested frontend integration order

1. Wire `GET /api/auth/me` + session hydration
2. Simplify register BFF (remove auto-login workaround)
3. Update change-password handler to refresh cookie from `access_token`
4. Smoke-test: hard refresh after profile update, change password on two browsers, reset password invalidates old sessions

---

## Reference

Full API details: [`docs/account-management-backend-handoff.md`](./account-management-backend-handoff.md)

Backend source: `src/modules/auth/auth.controller.ts`, `auth.service.ts`, `src/guards/jwt-auth.guard.ts`
