# Frontend Followup — Customer `openingBalanceNote` (Backend DONE)

The opening-balance note is now surfaced directly on the customer object, so the
detail page can show it without digging into the ledger. No further backend work
needed — the card should light up automatically.

## TL;DR

- ✅ `GET /api/customers/:id` now returns a read-only `openingBalanceNote`.
- It's the note from the **opening-balance adjustment created at signup**
  (the `balanceAdjustment` passed to `POST /api/customers`).
- Later **manual** balance adjustments are explicitly excluded.
- Returns `null` when no opening balance was set (or it had no note).
- Nothing else changed — no new editable field, no schema change, request
  payloads untouched.

## Contract

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
  "balance": { "...": "existing balance object, unchanged" },
  "openingBalanceNote": "Carried forward balance from December 2025 statement"
}
```

When there is no opening-balance note:

```json
{
  "_id": "665f...",
  "balance": { "...": "..." },
  "openingBalanceNote": null
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `openingBalanceNote` | `string \| null` | Note from the opening balance set when the customer was first created. `null` if none. |

## Behavior notes

- **Read-only.** This is not a stored/editable customer field — it's surfaced
  from the existing opening-balance ledger adjustment. Don't send it back on
  create/update; it will be ignored.
- **Signup-only.** The backend returns the note only for the adjustment created
  together with the customer at signup. If a customer had *no* opening balance
  and later received a *manual* balance adjustment (via
  `POST /api/customers/:id/balance-adjustments`), that manual note is **not**
  returned as `openingBalanceNote` — you'll get `null`.
- **Empty note ⇒ `null`.** If an opening balance was set but without any note
  text, the field is `null` (nothing to display).
- **Scope:** only on the single-customer detail endpoint (`GET /api/customers/:id`).
  The customer **list** (`GET /api/customers`) does not include it.

## Frontend checklist

- [ ] On the customer detail page, read `customer.openingBalanceNote`.
- [ ] Show the opening-balance note card only when the value is a non-empty
      string; hide it when `null`.
- [ ] Treat it as read-only (no edit affordance tied to this field).
