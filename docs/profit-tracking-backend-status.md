# Frontend Followup — Purchase Price & Profit Tracking (Backend DONE)

This is the backend-side response to the original handoff. **All requested
fields and the new endpoint are now live.** This doc tells the frontend agent
exactly what the API returns so you can verify wiring and remove any temporary
fallbacks.

## TL;DR

- ✅ `Product.purchasePrice` — accepted on create/update, returned on all reads.
- ✅ Order line `costPrice` + `lineCost`; order `costTotal` + `profitTotal`.
- ✅ Dashboard metrics: `totalCost`, `grossProfit`, `profitMargin`, `inventoryValueAtCost`.
- ✅ Revenue trend: per-bucket `cost`/`profit` + `summary.totalCost`/`summary.totalProfit`.
- ✅ New endpoint: `GET /api/dashboard/top-products`.

Nothing in the request payloads changed. The order create request still sends
only `productId`, `quantity`, `discountPercentage` — cost is derived server-side.

---

## Important behavior notes (read these)

### 1. Money values come back as 2-decimal **strings**

A global interceptor formats every currency field to a fixed 2-decimal string,
e.g. `250` → `"250.00"`. This already applied to `unitPrice`, `grandTotal`, etc.,
and now also applies to all new currency fields:

`purchasePrice, costPrice, lineCost, costTotal, profitTotal, totalCost,
grossProfit, inventoryValueAtCost, cost, profit, totalProfit`

**Percentages are NOT formatted as money** and come back as plain numbers:
`profitMargin` and `margin` (e.g. `24.21`).

Your shared parser (`getProfit`/`getMarginPercent` etc.) should already handle
"number or decimal string" — no change needed, just confirming the contract.

### 2. Profit basis = `subtotal` (ex-GST), cancelled excluded

- `profitTotal = subtotal − costTotal` (net of line discounts, before GST).
- `margin = profit / revenue × 100`, returns `0` when revenue is `0`, can be
  negative when selling below cost.

### 3. Realized-revenue basis is **COMPLETED orders** (heads up)

The original doc said "non-cancelled" for aggregates. The existing
`totalRevenue` and the revenue-trend series have **always** been computed over
`COMPLETED` orders only (pending orders are not counted as realized revenue).

To keep `grossProfit = totalRevenue − totalCost` internally consistent, all the
new cost/profit aggregates (dashboard metrics, revenue trend, top-products) use
the **same COMPLETED basis**. Cancelled orders are excluded in every case.

Practical implication for the UI: cost/profit numbers move in lockstep with the
revenue numbers you already display, so `revenue − cost = profit` will always add
up on screen. PENDING orders contribute to neither revenue nor cost.

### 4. Incremental rollout / backfill

- `purchasePrice` defaults to `0` for products created before this change, so
  reads always include the field (never `undefined`). A `0`/missing cost means
  **"cost not entered yet"**, not a real zero.
- **Product cost backfill (ops task, done via CSV):** there's a script to bulk
  fill real supplier costs without guessing them:
  - `npm run products:export-costs -- --out costs.csv [--missing-only]` →
    exports products to CSV for the client to fill in real costs.
  - `npm run products:import-costs -- --in costs.csv --dry-run` → preview.
  - `npm run products:import-costs -- --in costs.csv` → apply (idempotent; never
    overwrites an existing non-zero cost unless `--overwrite`).
  - We deliberately do **not** derive cost from sale price or a margin factor —
    that would fabricate the exact numbers this feature exists to report.
- **Missing-cost visibility:** `metrics.productsMissingPurchasePrice` tells you
  how many are still unfilled, and `top-products` excludes unfilled products so
  margins are never fabricated. Surface a banner until the count reaches `0`.
- Existing orders created before this change have no `costPrice` snapshot, so
  their `costTotal` is `0` and their `profitTotal == subtotal`. New orders are
  correct from here on (they snapshot the product's `purchasePrice` at order
  time). **Backfill product costs first, then backfill historical orders.**
- **Historical order backfill (ops task):** `npm run orders:backfill-costs`
  snapshots `costPrice`/`lineCost` onto old line items and recomputes
  `costTotal`/`profitTotal` for every non-cancelled order, using each product's
  **current** `purchasePrice` (an approximation of the true historical cost —
  the best available default).
  - `npm run orders:backfill-costs -- --dry-run` → preview only; prints
    `{ ordersAffected, itemsAffected, estimatedTotalCost, estimatedTotalProfit }`.
  - `npm run orders:backfill-costs` → apply (batched, idempotent; never
    overwrites a line that already has a `costPrice`).
  - Run the product cost backfill **first** (`products:import-costs`). By
    default, line items whose product still has no cost are **skipped** (not
    locked to `0`), so you can fill product costs later and re-run to converge.
    Pass `--zero-missing` to snapshot `0` for them instead (they'll show 100%
    margin until the product cost is filled).
  - Same user-scoping flags as the product backfill (`--email`, `--user-id`,
    `--all-users`). Cancelled orders are never touched.

---

## Endpoint-by-endpoint contract

### Product

`POST /api/products` and `PATCH /api/products/:id` accept `purchasePrice`
(required on create, `>= 0`, max 2 decimals; negatives → `400`).

`GET /api/products` and `GET /api/products/:id` return it on every product:

```json
{
  "_id": "665f...",
  "name": "Saiban Syrup 120ml",
  "unitPrice": "250.00",
  "purchasePrice": "180.00",
  "quantityInStock": 100,
  "lowStockThreshold": 20
}
```

### Orders

`GET /api/orders`, `GET /api/orders/:id`, `GET /api/customers/:id/orders`:

```json
{
  "items": [
    {
      "productId": { "_id": "665f...", "name": "Saiban Syrup 120ml", "purchasePrice": "180.00" },
      "quantity": 10,
      "unitPrice": "250.00",
      "costPrice": "180.00",
      "discountPercentage": 5,
      "lineTotal": "2375.00",
      "lineCost": "1800.00"
    }
  ],
  "subtotal": "2375.00",
  "discountTotal": "125.00",
  "costTotal": "1800.00",
  "profitTotal": "575.00",
  "grandTotal": "2375.00"
}
```

`costPrice` is snapshotted at order-creation time from the product's
`purchasePrice`, so it stays correct even if the product's cost changes later.

> Note: orders do not currently carry a `gstTotal` field in the schema (GST is
> effectively `0` in the current pricing). `profitTotal` is computed against
> `subtotal`, so this matches the "profit excludes GST" rule.

### `GET /api/dashboard/metrics`

```json
{
  "metrics": {
    "totalProducts": 120,
    "totalCustomers": 80,
    "totalOrders": 540,
    "totalRevenue": "1250000.00",
    "pendingPayments": "90000.00",
    "receivedPayments": "1160000.00",
    "totalCost": "870000.00",
    "grossProfit": "380000.00",
    "profitMargin": 30.4,
    "inventoryValueAtCost": "540000.00",
    "productsMissingPurchasePrice": 12
  },
  "alerts": { "lowStockProducts": [], "pendingOrders": [] }
}
```

- `inventoryValueAtCost = Σ (product.quantityInStock × product.purchasePrice)`
  over all products (current stock at cost — independent of order status).
- `profitMargin` is a plain number (percentage), not a money string.
- `productsMissingPurchasePrice` (plain number) = how many products still have no
  real cost entered (`purchasePrice` missing or `<= 0`). Use it to show a data-
  completeness banner, e.g. "12 products are missing a purchase price — profit
  figures are incomplete." It's `0` once everything is backfilled.

### `GET /api/dashboard/revenue-trend?range=7d|14d|30d|90d`

```json
{
  "range": "14d",
  "granularity": "day",
  "timezone": "Asia/Karachi",
  "summary": {
    "totalRevenue": "250000.00",
    "totalCost": "170000.00",
    "totalProfit": "80000.00",
    "orderCount": 120,
    "currency": "PKR",
    "excludedStatuses": ["cancelled"]
  },
  "series": [
    {
      "bucketStart": "2026-06-14",
      "bucketEnd": "2026-06-14",
      "label": "14 Jun",
      "revenue": "18000.00",
      "cost": "12200.00",
      "profit": "5800.00",
      "orderCount": 9
    }
  ]
}
```

- `profit` per bucket = `revenue − cost`.
- `90d` switches to weekly buckets (`granularity: "week"`), same as before.

### `GET /api/dashboard/top-products` (NEW)

Query params:

| Param | Values | Default |
|-------|--------|---------|
| `metric` | `profit` \| `margin` \| `revenue` | `profit` |
| `limit` | integer (1–100) | `5` |

Response:

```json
{
  "metric": "profit",
  "data": [
    {
      "productId": "665f...",
      "name": "Saiban Syrup 120ml",
      "unitsSold": 320,
      "revenue": "80000.00",
      "cost": "57600.00",
      "profit": "22400.00",
      "margin": 28.0
    }
  ]
}
```

- Sorted descending by the chosen `metric` (ties broken by `unitsSold`).
- Aggregated over COMPLETED orders.
- `margin` is a plain number (percentage).
- **Products with no purchase price filled in are excluded** from this card, so
  it never shows a fabricated 100% margin. As costs are backfilled, more products
  appear here. (This is why the card can be empty/short before backfill — pair it
  with the `productsMissingPurchasePrice` banner.)
- No data → `200` with `{ "metric": "...", "data": [] }`. (Your `retry: false`
  404 fallback stays as a safety net but shouldn't be hit.)

---

## Frontend verification checklist

- [ ] Product form sends `purchasePrice`; create/update succeed; negative is rejected with a `400` you surface nicely.
- [ ] Product list/details render `purchasePrice` + live margin from real data (drop the `—` fallback once confirmed).
- [ ] Order items table shows `costPrice`/`lineCost`; order summary shows `costTotal`/`profitTotal` and derived margin.
- [ ] Order create form's live profit preview matches the persisted `profitTotal` after submit.
- [ ] Dashboard KPIs read `totalCost`/`grossProfit`/`profitMargin`/`inventoryValueAtCost` (stop client-deriving `grossProfit` if you were).
- [ ] Show a "N products missing purchase price" banner driven by `metrics.productsMissingPurchasePrice` (hide when `0`).
- [ ] Revenue trend chart plots `cost`/`profit` and uses `summary.totalProfit`.
- [ ] "Most profitable products" card calls `/dashboard/top-products` with `metric`/`limit` and renders the array (incl. empty state).
- [ ] Confirm your money parser treats the 2-decimal **string** values correctly everywhere.

## Open questions for the frontend agent

1. Historical order backfill is now available (`npm run orders:backfill-costs`,
   see §4). Confirm you want it run in production once product costs are filled;
   until then old orders show `profit == subtotal`.
2. Should `top-products` support a date range filter (e.g. last 30d) like the
   revenue trend, or is all-time fine for now? Currently it's all-time over
   COMPLETED orders.
