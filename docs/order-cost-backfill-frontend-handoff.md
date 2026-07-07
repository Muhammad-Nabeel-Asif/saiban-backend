# Frontend Handoff — Historical Order Cost Backfill (DONE in production)

This is a short, action-oriented note for the **frontend agent**. It covers what
changed in this session and whether the FE needs to do anything.

**TL;DR: no new API contract, no new fields, no FE code changes required.** We
just backfilled historical data so the profit numbers you already render are now
accurate across the full order history (not just recent orders).

---

## What happened

The profit/cost feature (`purchasePrice`, order `costPrice`/`lineCost`,
`costTotal`/`profitTotal`, dashboard `totalCost`/`grossProfit`/`profitMargin`,
revenue-trend `cost`/`profit`, and `GET /api/dashboard/top-products`) was already
shipped — see `docs/profit-tracking-backend-status.md` for the full contract.

The only remaining gap was **old orders had no cost snapshot**, so their
`costTotal` was `0` and `profitTotal == subtotal` (a misleading ~100% margin on
historical dashboard buckets).

We built and ran a one-time, idempotent migration
(`npm run orders:backfill-costs`) against **production**:

- **184 orders updated, 931 line items** backfilled with real per-unit cost
  (snapshotted from each product's current `purchasePrice`).
- `costTotal` / `profitTotal` recomputed as `subtotal − costTotal`.
- **202 of 210** non-cancelled orders now have `costTotal > 0`.
- Cancelled orders untouched. Revenue/`grandTotal`/`unitPrice`/`lineTotal`
  untouched — cost/profit fields only.

## What this means for the FE

- **Dashboard**: `metrics.totalCost` and `grossProfit` are now higher/realistic;
  `profitMargin` is no longer inflated. `revenue-trend` historical buckets now
  return real `cost` and `profit < revenue`. `top-products` shows realistic
  margins. **Nothing to change** — you already consume these fields.
- **Order details**: old orders now show real `costPrice`/`lineCost` per item and
  `costTotal`/`profitTotal` at the order level. Same shapes as before.
- **Money format is unchanged**: currency fields are still 2-decimal **strings**;
  `profitMargin`/`margin` are still plain numbers.

## Two data caveats worth surfacing in the UI (not blockers)

1. **2 products still have no purchase price**, so 8 orders that only contain them
   remain uncosted (`profit == subtotal` for those). This is real data the owner
   still needs to enter. Keep showing the existing
   `metrics.productsMissingPurchasePrice` banner — it will drop to `0` once these
   are filled and the backfill is re-run (both are backend ops tasks, not FE).
   - Affected products: **ASHOKA** (syrup 120ml), **Augmentin 625mg**.

2. **~112 historical line items reference products that were deleted** from the
   catalog. There is no cost source for them, so those specific lines stay
   uncosted and can slightly overstate profit on the orders that contain them.
   This is inherent to deleted-product history — no FE action, just be aware if a
   very old order shows a higher-than-expected margin.

Because of these, on a small number of old orders `revenue − cost` will be larger
than the "true" profit. Your existing guardrail (hide/soften profit when cost is
missing or zero) still applies and is the right behavior — keep it.

## Action items for the FE agent

- **None required.** Optionally: re-verify the dashboard/order screens now that
  historical data is populated, and confirm the `productsMissingPurchasePrice`
  banner still renders (it should show `2` until those products are costed).
- You can safely **drop any remaining temporary `—` / "no data yet" fallbacks**
  for cost/profit on historical orders, since real data now exists (keep the
  zero/missing-cost guard for the edge cases above).

## Open question back to FE (unchanged)

- Should `GET /api/dashboard/top-products` support a date-range filter (e.g. last
  30d) like the revenue trend, or is all-time fine? Currently all-time over
  COMPLETED orders.
