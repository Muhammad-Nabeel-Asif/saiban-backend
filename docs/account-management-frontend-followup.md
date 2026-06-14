# Account Management — Frontend Follow-up for Backend

**From:** Frontend team  
**To:** Backend team  
**Date:** 2026-06-14  
**Context:** Account management UIs and BFF routes are integrated against the live auth APIs. This document lists what we still need, what is optional, and a few confirmations to keep environments aligned.

> **Backend response:** See [`account-management-frontend-handback.md`](./account-management-frontend-handback.md) — Priority 1 and 2 items are implemented.

---

## What is working today

No further backend work is required for these flows to function end-to-end:

| Flow | Backend endpoint(s) | Frontend status |
|------|---------------------|-----------------|
| Login | `POST /api/auth/login` | Integrated |
| Register | `POST /api/auth/register` + BFF auto-login | Integrated (see workaround below) |
| Forgot password | `POST /api/auth/forgot-password` | Integrated |
| Reset password | `POST /api/auth/reset-password` | Integrated |
| Change password | `POST /api/auth/change-password` | Integrated |
| Update profile | `PATCH /api/auth/profile` | Integrated |

**Workaround in place:** Register returns `{ message }` only. Our BFF calls login immediately after a successful register, sets the cookie, and returns `{ user }`. This works but adds an extra round-trip per signup.

**Error handling:** We parse NestJS errors where `message` is a string or string array (`lib/api-error.ts`). `429` on forgot-password is handled in the UI.

---

## Priority 1 — Needed for better UX

### `GET /api/auth/me` *(authenticated)*

**Why we need it**

Today the sidebar and account page read user data from `localStorage`, not the server. After a hard refresh:

- The `auth-token` cookie may still be valid, but displayed name/email can be **stale** (e.g. profile updated elsewhere, or localStorage cleared while cookie remains).
- We have no way to confirm the session is still valid without calling a protected endpoint.

**Proposed contract**

```
GET /api/auth/me
Authorization: Bearer <access_token>
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

| Status | When |
|--------|------|
| `401` | Missing, invalid, or expired JWT |

**Notes for backend**

- `user` shape must match login/profile responses (`id`, `email`, `name`, `role`).
- We will add a BFF route `GET /api/auth/me` that reads the HttpOnly cookie and forwards the Bearer token — same pattern as `change-password` and `profile`.
- We will call this on app load (admin shell mount) to hydrate sidebar/account state when a session exists.

**Frontend work after you ship this:** BFF route + `useMe` hook + hydrate `AppProvider` on load. We will handle this once the endpoint is live.

---

## Priority 2 — Nice to have (not blocking)

### Register returning token directly

**Current:** `POST /api/auth/register` → `{ message }`  
**Preferred:** Same response as login:

```json
{
  "access_token": "<jwt>",
  "user": { "id": "...", "email": "...", "name": "...", "role": "..." }
}
```

**Why:** Removes the extra login call from our BFF, simplifies error handling, and avoids edge cases where register succeeds but auto-login fails (`502` today).

**If you add this:** Tell us — we will simplify `app/api/auth/register/route.ts` to match the login route.

---

### Session invalidation on password change / reset

**Current backend behavior (per your handoff):** JWTs remain valid after password change; reset does not auto-login.

**Optional enhancement:** Invalidate all outstanding JWTs when:

- `POST /api/auth/change-password` succeeds, **or**
- `POST /api/auth/reset-password` succeeds

**Why:** Stolen/old sessions on other devices would stop working. If implemented, tell us whether the **current** session JWT should also be invalidated (would require re-login on the device that changed the password).

**Frontend impact:** If current JWT is invalidated on change-password, we need to redirect to login after success instead of staying on account settings. We can handle either behavior once documented.

---

### `POST /api/auth/logout` on backend

**Current:** Frontend BFF deletes the `auth-token` cookie locally only. No upstream logout call.

**Optional:** Backend logout that invalidates the JWT server-side (blocklist or session store).

**Why:** Only matters if you implement global session invalidation or server-side session tracking. Not required for current flows.

---

## Priority 3 — Future / out of scope for now

These are **not** needed for the current release. Flagging for roadmap alignment:

| Feature | Notes |
|---------|-------|
| Email change flow | Email is read-only in UI; no endpoint required yet |
| Stricter password policy | Frontend validates min 6 chars; tell us before adding uppercase/symbol rules |
| Refresh tokens | No refresh flow today; users re-login when JWT expires |
| `GET /api/auth/me` role-based UI | We store `role` but do not gate admin nav by it yet |

---

## Environment confirmations

Please confirm per environment (local / staging / production):

| Item | Question |
|------|----------|
| `FRONTEND_URL` | Set to the correct app URL so reset emails point to `/reset-password?token=...` |
| `API_URL` (frontend `.env`) | Points at the matching backend instance |
| `CORS_ORIGINS` | Includes frontend origin if any browser-direct backend calls are added later |
| SMTP | Production sends real reset emails; dev can log links to console |

**Reset link format we expect (unchanged):**
```
{FRONTEND_URL}/reset-password?token={64-char-hex-token}
```

---

## Error format — please keep consistent

We rely on this shape across all auth endpoints:

```json
{
  "statusCode": 400,
  "message": "Human-readable error",
  "path": "/api/auth/...",
  "method": "POST",
  "timestamp": "..."
}
```

For validation errors, `message` as a **string array** is fine — we take the first entry.

Please avoid introducing a different error field (e.g. only `error` without `message`) on new endpoints.

---

## Suggested backend delivery order

1. **`GET /api/auth/me`** — highest value for frontend; unblocks session hydration
2. **Register returns token** — small DX improvement, optional
3. **Session invalidation policy** — decide and document; we will adjust UI if needed
4. Everything else — future phases

---

## How to hand back to frontend

When an item above is ready, reply with:

1. Endpoint path and method  
2. Request/response JSON (or note “unchanged from proposal”)  
3. Any behavior change from current docs (e.g. JWT invalidated on password change)  
4. Which environment it is deployed to  

We will wire the BFF + UI and update `docs/account-management-api-handoff.md`.

---

## Contact / references

| Doc | Purpose |
|-----|---------|
| `docs/account-management-api-handoff.md` | Original frontend → backend spec |
| [`account-management-backend-handoff.md`](./account-management-backend-handoff.md) | What backend implemented |
| [`account-management-frontend-handback.md`](./account-management-frontend-handback.md) | **Backend response — items delivered** |
| This document | What frontend still needs |

**No blockers for shipping account management as-is.** Priority 1 (`GET /api/auth/me`) is the only item we would like scheduled next for production polish.
