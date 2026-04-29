# Customers list API — `sort` query parameter

This note is for frontend integration of **`GET /customers`** (authenticated).

## Endpoint

`GET /api/customers`  
(Exact base path follows your API prefix; often `/api/customers`.)

**Headers:** `Authorization: Bearer <JWT>` (same as other admin routes.)

## Query parameters (existing + new)

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `page`    | number | No       | Page number (default `1`). |
| `limit`   | number | No       | Page size (default `10`, max `100`). |
| `search`  | string | No       | Case-insensitive match on first name, last name, or email. |
| **`sort`** | **string** | **No** | **List ordering.** See below. |

## `sort` values

| Value     | Behavior |
|-----------|----------|
| *(omit)* or `name` | **Alphabetical** — `firstName` A→Z, then `lastName` A→Z (case-insensitive English collation). Use for **Customers Management** table. |
| `recent`  | **Newest first** — `createdAt` descending. Use for **Dashboard “Recent customers”** (e.g. `limit=5`). |

Invalid values return **400** validation error.

## Examples

**Customers Management (default alphabetical):**

```http
GET /api/customers?page=1&limit=10
GET /api/customers?sort=name&page=1&limit=10
```

**Dashboard — five most recently created customers:**

```http
GET /api/customers?sort=recent&limit=5
```

**Recent customers matching a search (still ordered by date among matches):**

```http
GET /api/customers?sort=recent&search=homeo&limit=10
```

## Response shape

Unchanged: `{ data: Customer[], pagination: { page, limit, total, pages } }`.
