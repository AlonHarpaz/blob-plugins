---
description: Deploy and manage web apps with Blob. Guides the workflow — create apps (Workers or Containers), preview before going live, verify deploys, accept payments, debug with logs, manage databases and custom domains.
---

# Blob — App Deployment Skill

You are connected to Blob, a hosting platform where you deploy and manage web apps. Two runtimes: **Workers** (fast, built-in database/KV/storage) and **Containers** (Node.js 22, native modules, Express). Each app gets a live URL and resources provisioned automatically.

## Workflow

Follow this order for every new app:

1. **Create** the app with `create_app` — picks a name, provisions resources. Default is Worker runtime; use `runtime: "container"` for Node.js apps needing native modules or Express
2. **Preview** with `deploy` using `preview: true` — deploys to a staging URL so you can check it works
3. **Verify** the preview URL in the browser or with `fetch_url` with `preview: true`
4. **Go live** with `deploy` (without preview) — pushes to production
5. **Verify** the live URL with `fetch_url` — confirm it's working. Use `screenshots: true` on important deploys to get desktop + mobile screenshots for visual verification (adds ~5-10s)

## Rules

- **Always preview first.** Never deploy straight to production. Use `preview: true` to test on a staging URL before going live.
- **Always verify after deploy.** Call `fetch_url` after every deploy (both preview and production) to confirm the app is working.
- **Check status before changes.** Use `get_status` to see an app's current state before modifying it.
- **Use issues for tracking.** Use `create_issue` and `list_issues` to track bugs and tasks per app.

## Common Patterns

### Static site (HTML/CSS/JS only)
Just send your files to `deploy`. No server code needed — files are served from a global CDN.

```
deploy(app: "my-site", files: [
  { path: "/index.html", content: "..." },
  { path: "/style.css", content: "..." }
], preview: true)
```

### Full-stack app (backend + frontend)
Send files AND custom server code. The server code handles API routes, database queries, etc. Node.js APIs are supported (Buffer, crypto, path, stream, util, events) — most npm packages work when bundled.

Available bindings in server code (via the `ctx` parameter):
- `ctx.db` — database (SQL queries)
- `ctx.kv` — key-value store
- `ctx.storage` — file storage
- `ctx.assets` — serves your static files
- `ctx.auth` — built-in authentication (signup, login, logout, getUser)
- `ctx.payments` — accept payments via Stripe (see "Apps that accept payments" below)

The server code must export a default async function. For requests that aren't API routes, return `ctx.assets.fetch(request)` to serve static files. Always wrap it in try/catch:

```javascript
export default async function handler(request, ctx) {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    // Handle API routes
    const data = await ctx.db.prepare("SELECT * FROM users").all();
    return new Response(JSON.stringify(data.results), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Serve static files for everything else
  try {
    const r = await ctx.assets.fetch(request);
    if (r.status === 404) return new Response('Not found', { status: 404 });
    return r;
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
```

### Container app (Node.js 22)

For apps that need native modules, Express, or filesystem access, use the container runtime:

```
create_app(name: "my-app", runtime: "container")
```

- **Pre-installed:** better-sqlite3, sharp, bcrypt, express — any npm package works
- **Filesystem:** read/write access for temp files, SQLite databases, etc.
- **No platform-managed DB/KV/storage** — use native modules instead (e.g. better-sqlite3 for SQLite, fs for files)
- **No `ctx.auth` or `ctx.payments`** — these are Worker-only bindings. Use your own auth logic (e.g. express-session + bcrypt) in container apps
- **Cold start:** first request after sleep takes ~10-30s (container boot + npm install)
- **Available on all plans** (Free, Pro, Team)

Your server must listen on the `PORT` env var (default 3000):

```javascript
import express from 'express';
import Database from 'better-sqlite3';

const app = express();
const db = new Database('./data.db');

db.exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)');

app.get('/api/items', (req, res) => {
  res.json(db.prepare('SELECT * FROM items').all());
});

app.listen(process.env.PORT || 3000);
```

Bundle your code before deploying: `npx esbuild entry.js --bundle --platform=node --format=cjs --outfile=bundled.js`

Deploy uses auto-detection — if your code imports native modules (better-sqlite3, sharp) or uses Express listen patterns, it automatically picks the container runtime. You can also force it with `runtime: "container"` on the deploy call.

### Apps with user accounts

Use `ctx.auth` for built-in authentication — no boilerplate needed. It handles password hashing, sessions, and token management automatically.

```javascript
export default async function handler(request, ctx) {
  const url = new URL(request.url);

  if (url.pathname === '/api/signup' && request.method === 'POST') {
    const { email, password } = await request.json();
    return Response.json(await ctx.auth.signup(email, password));
  }
  if (url.pathname === '/api/login' && request.method === 'POST') {
    const { email, password } = await request.json();
    return Response.json(await ctx.auth.login(email, password));
  }
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    return Response.json(await ctx.auth.logout(request));
  }

  // Protected route — returns null if not authenticated
  const user = await ctx.auth.getUser(request);
  if (!user) return new Response('Unauthorized', { status: 401 });
  return Response.json({ message: `Hello ${user.email}` });
}
```

**API reference:**

| Method | Input | Returns |
|---|---|---|
| `ctx.auth.signup(email, password)` | Email + password (min 8 chars) | `{ token, userId }` or `{ error: "..." }` |
| `ctx.auth.login(email, password)` | Email + password | `{ token, userId }` or `{ error: "..." }` |
| `ctx.auth.logout(request)` | The request object | `{ ok: true }` |
| `ctx.auth.getUser(request)` | The request object | `{ id, email, createdAt }` or `null` |

- Tokens are sent/received via the `Authorization: Bearer <token>` header
- Emails are auto-lowercased and trimmed
- Sessions expire after 7 days
- Auth tables (`_auth_users`, `_auth_sessions`) are created automatically on first use

### Apps that accept payments

Use `ctx.payments` to accept payments from your app's users via Stripe. Requires a paid plan (Pro or Team).

**Setup:**
1. Run `connect_payments` — creates a Stripe Express account and returns an onboarding URL
2. Tell the user to complete Stripe onboarding at that URL (bank details, identity verification)
3. Check status with `payment_status` — when `chargesEnabled` is true, you're ready
4. Use `ctx.payments` in your server code

```javascript
export default async function handler(request, ctx) {
  const url = new URL(request.url);

  if (url.pathname === '/api/checkout' && request.method === 'POST') {
    const { items } = await request.json();
    const result = await ctx.payments.createCheckout({
      items: items.map(i => ({ name: i.name, amount: i.price, quantity: i.qty })),
      successUrl: `${url.origin}/success`,
      cancelUrl: `${url.origin}/cancel`,
    });
    return Response.json(result); // { url, sessionId } — redirect user to url
  }

  if (url.pathname === '/api/payments') {
    const result = await ctx.payments.getPayments(20);
    return Response.json(result); // { payments: [...] }
  }
}
```

**API reference:**

| Method | Input | Returns |
|---|---|---|
| `ctx.payments.isReady` | (property) | `true` if payments are connected |
| `ctx.payments.createCheckout(opts)` | `{ items: [{name, amount, quantity?}], successUrl, cancelUrl? }` | `{ url, sessionId }` or `{ error }` |
| `ctx.payments.getPayments(limit?)` | Optional limit (default 10) | `{ payments: [...] }` or `{ error }` |
| `ctx.payments.getAccount()` | (none) | `{ chargesEnabled, payoutsEnabled, detailsSubmitted }` or `{ error }` |

- `amount` is in cents (e.g. 1999 = $19.99)
- Builders keep 100% of revenue — 0% platform fee (only Stripe's standard fees apply)
- Use `disconnect_payments` to remove the Stripe connection

### Large deploys (CLI or database)

If your total file content + server code exceeds ~100KB, the MCP deploy call may hit payload limits.

**Option 1: CLI deploy (recommended for bundled JS/CSS)**

Use `get_deploy_token` to get a one-time token, then tell the user to run the CLI:

```
get_deploy_token(app: "my-app")
```

Returns a token and command. Tell the user to run the command. The token is single-use and expires in 5 minutes.

**Option 2: Store pages in database (for MCP-only workflows)**

If the user can't run CLI commands, store HTML pages in the database:

1. Create a `pages` table: `CREATE TABLE pages (name TEXT PRIMARY KEY, content TEXT NOT NULL)`
2. Deploy only the server code (with a placeholder file) — add a route to serve pages from the database:
   ```javascript
   const pageName = pathname === '/' ? 'index.html' : pathname.slice(1);
   if (pageName.endsWith('.html')) {
     const pg = await ctx.db.prepare('SELECT content FROM pages WHERE name = ?').bind(pageName).first();
     if (pg) return new Response(pg.content, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
   }
   ```
3. Insert each HTML page separately via `run_sql` with parameterized queries:
   ```
   run_sql(app: "myapp", query: "INSERT OR REPLACE INTO pages (name, content) VALUES (?, ?)",
     params: ["index.html", "<contents of index.html>"])
   ```

### Using npm packages
If your server code uses npm packages (hono, zod, drizzle, etc.), you must bundle before deploying. Tell the user to run:

```bash
npm install && npx esbuild entry.js --bundle --format=esm --outfile=bundled.js
```

Then send the contents of `bundled.js` as the serverCode parameter.

## Debugging

- **App not working?** Call `fetch_url` to see what the app returns, then `get_logs` to check for errors.
- **Health check failed?** Read the error details carefully — the staging check caught the issue before it reached production. Fix the error and redeploy.
- **Deploy includes automatic health checks.** Staging check runs before production, production check runs after. If the production check fails, it auto-rollbacks to the previous version. Use `skip_checks: true` only if the check is blocking a valid deploy (e.g. app requires specific headers).
- **Database issues?** Use `run_sql` to query the database directly.
- **Need to revert?** Use `rollback` to go back to a previous version.
- **Need help?** Use `report_issue` to file a bug, feature request, or question directly to the Blob team — no GitHub account needed.
- **Check ticket status?** Use `list_support_tickets` to see your filed tickets and any team replies.

## External Databases

- Use `connect_database` to connect an external PostgreSQL database with built-in connection pooling.
- Always redeploy after connecting a database — the server code needs the new binding (`ctx.externalDb`).
- Use `disconnect_database` to remove the connection.

## Custom Domains

1. Use `add_domain` to register the domain
2. Set a CNAME record pointing to `customers.imblob.com`
3. Use `check_dns` to verify DNS propagation
4. Once DNS propagates, the domain is live with automatic SSL
