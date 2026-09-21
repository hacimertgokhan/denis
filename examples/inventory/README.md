# Stockroom — a stock-keeping app on Denis

A small inventory system where **everything lives in one Denis database**:
accounts and sessions as keys, products and stock movements as tables, id
counters as keys. Express renders plain HTML; `denis-client` is the only
data layer. It runs unchanged against a Denis server you host (TCP) or a
database on Denis Cloud (HTTPS with an API key).

```
users        user:<email>      {"name","hash","salt","role","createdAt"}   scrypt, per-user salt
sessions     session:<token>   {"email","expiresAt"}                        14 days, httpOnly cookie
counters     seq:product, seq:movement
inv_products table (id, sku, name, category, unit, quantity, min_quantity, price, updated_at)
inv_movements table (id, product_id, sku, kind, quantity, note, actor, created_at)
```

Rules: quantities only change through a movement (`in`, `out`, `adjust`),
stock never goes below zero, every movement records who did it, the first
account to register becomes the **owner** (only the owner deletes products),
later accounts are **staff**. The overview page is one `QUERY` round trip
(`denis.graph`): counts, every product for the value and low-stock list, and
the latest movements.

## Run it

```sh
npm install

# against Denis Cloud: create a database, copy a write API key from its Connect tab
DENIS_API_KEY=dk_... npm start

# against your own server
DENIS_HOST=127.0.0.1 DENIS_PORT=5142 DENIS_GROUP=crm DENIS_PASSWORD=s3cret npm start
```

Open http://localhost:4100, create the first account, add products.
`npm run seed` adds six sample products; `npm test` runs an end-to-end
check (register, sign in, product, movements, overview) against whichever
Denis the variables point at.

| Variable | Meaning |
| --- | --- |
| `DENIS_API_KEY` | Denis Cloud API key (write scope). When set, the TCP variables are ignored. |
| `DENIS_URL` | Platform URL, default `https://denis.hacimertgokhan.com` |
| `DENIS_HOST`, `DENIS_PORT`, `DENIS_GROUP`, `DENIS_PASSWORD`, `DENIS_TOKEN` | Your own server; without `DENIS_TOKEN` a project is created on first start |
| `PORT` | HTTP port, default 4100 |

## Where to look

- `src/denis.js` — the client (Cloud or TCP), the schema, the id counter, SQL quoting.
- `src/auth.js` — accounts, password hashing, sessions, the cookie middleware.
- `src/stock.js` — products, movements, the overview query.
- `src/server.js` — routes; `src/views.js` — the pages.
