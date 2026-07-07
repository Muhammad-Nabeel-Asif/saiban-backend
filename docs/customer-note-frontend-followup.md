# Frontend Followup — Customer `note` (Backend DONE)

The dedicated customer-level note is now persisted on the `Customer` model and
returned on all relevant endpoints. This is separate from the read-only
`openingBalanceNote` (opening-balance ledger note) — both fields coexist and are
independent.

## TL;DR

- ✅ `note` is a new optional, editable field stored directly on the customer.
- ✅ `POST /api/customers` accepts top-level `note` and persists it.
- ✅ `PATCH /api/customers/:id` accepts `note` (including `""` to clear).
- ✅ `GET /api/customers/:id` returns `note` alongside `openingBalanceNote`.
- ✅ `GET /api/customers` (list) also returns `note` on each customer.
- ✅ `openingBalanceNote` is unchanged — still read-only, from the opening-balance
  ledger adjustment only.
- ✅ No migration required — existing customers without a stored note return `""`.

## Two notes — do not merge

| Field | Where it lives | Editable | Shown on profile |
|-------|----------------|----------|------------------|
| **`note`** (this doc) | Directly on the `Customer` model | Yes (create + edit) | Yes — dedicated "Note" card |
| **`openingBalanceNote`** (existing) | Opening-balance ledger adjustment | No (set once at signup) | No — Transaction history only |

- Top-level `note` → customer profile note (this feature).
- `balanceAdjustment.note` on create → opening-balance ledger note (unchanged).
  Surfaced read-only as `openingBalanceNote` on the detail response.

---

## Contract

### `POST /api/customers`

Optional top-level `note` in the request body:

```json
{
  "firstName": "City",
  "lastName": "Pharmacy",
  "email": "purchase@citypharmacy.com.pk",
  "phoneNumber": "03211234567",
  "streetAddress": "45 Mall Road, Gulberg II",
  "city": "Lahore",
  "state": "Punjab",
  "note": "Prefers delivery after 5pm. Verbal discount agreed with owner.",
  "balanceAdjustment": {
    "amount": 15000,
    "direction": "customer_owes",
    "note": "Carried forward from December 2025 statement"
  }
}
```

Response includes the persisted `note` on the customer object (same shape as
other customer fields).

### `PATCH /api/customers/:id`

Accepts optional `note`. The backend sets the field to whatever is sent,
including `""` to clear it:

```json
{
  "firstName": "City",
  "note": "Updated: now on 30-day credit terms."
}
```

Clearing the note:

```json
{
  "note": ""
}
```

### `GET /api/customers/:id`

```json
{
  "_id": "665f...",
  "firstName": "City",
  "lastName": "Pharmacy",
  "email": "purchase@citypharmacy.com.pk",
  "phoneNumber": "03211234567",
  "streetAddress": "45 Mall Road, Gulberg II",
  "city": "Lahore",
  "state": "Punjab",
  "note": "Prefers delivery after 5pm. Verbal discount agreed with owner.",
  "openingBalanceNote": "Carried forward from December 2025 statement",
  "balance": { "...": "existing balance object, unchanged" }
}
```

When there is no customer note:

```json
{
  "_id": "665f...",
  "note": "",
  "openingBalanceNote": null,
  "balance": { "...": "..." }
}
```

### `GET /api/customers` (list)

Each item in `data` now includes `note`:

```json
{
  "data": [
    {
      "_id": "665f...",
      "firstName": "City",
      "lastName": "Pharmacy",
      "note": "Prefers delivery after 5pm.",
      "...": "other existing fields"
    }
  ],
  "pagination": { "...": "unchanged" }
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `note` | `string` | Editable customer-level note. `""` when none. |
| `openingBalanceNote` | `string \| null` | Read-only opening-balance ledger note (detail only). Unchanged. |

---

## Behavior notes

- **Editable.** Unlike `openingBalanceNote`, `note` is a real stored field. Send
  it on create and update; do not send `openingBalanceNote` back (it is ignored).
- **Empty = no note.** `""`, absent, and whitespace-only are all treated as "no
  note". The backend trims on input and returns `""` when empty. Hide the Note
  card when the value is empty/whitespace.
- **Max length:** 2000 characters. Requests exceeding this are rejected with a
  validation error.
- **Legacy customers:** Customers created before this change have no stored note.
  The backend returns `""` — no migration or backfill needed.
- **`openingBalanceNote` unchanged:** Still read-only, signup-only, detail-only.
  See `docs/customer-opening-balance-note-status.md`.

---

## Frontend checklist

The frontend types and UI are already implemented per the original handoff.
Verify against the live API:

- [ ] Create customer with `note` — confirm it persists and appears on the detail
      page Note card.
- [ ] Edit customer `note` — confirm updates save and re-fetch correctly.
- [ ] Clear customer `note` (send `""`) — confirm the Note card hides after save.
- [ ] Detail page shows both `note` (editable card) and `openingBalanceNote`
      (read-only, transaction history only) as separate concepts.
- [ ] List response includes `note` on each customer (optional for UI; type already
      allows it).

---

## Backend files changed

| Area | File |
|------|------|
| Schema | `src/schemas/customer.schema.ts` — added `note` (default `""`) |
| DTOs | `src/modules/customer/customer.dto.ts` — `note` on create/update |
| Service | `src/modules/customer/customer.service.ts` — persist, normalize, return |
| Tests | `src/modules/customer/customer.service.spec.ts`, `customer.dto.spec.ts` |
