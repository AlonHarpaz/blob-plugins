---
description: Build and deploy a complete email marketing app with contacts, campaigns, templates, and Resend integration. Creates a full-stack app on Blob with auth, dark UI, and send tracking.
---

# Email Marketing App — MailPilot

Build and deploy a complete email marketing application. The app includes user authentication, contact management, email template editor, campaign builder with HTML preview, and email sending via Resend API.

## What Gets Built

| Feature | Description |
|---|---|
| Auth | Signup/login with PBKDF2 password hashing, session tokens |
| Contacts | Add, edit, delete, bulk import (JSON), search, tags |
| Templates | Create reusable email templates with live HTML preview |
| Campaigns | Draft campaigns, pick template or custom HTML, preview, send |
| Sending | Sends via Resend API to all active contacts, tracks status |
| Dashboard | Stats: total contacts, campaigns, emails sent, open rate |
| Dark UI | Professional dark theme with Tailwind CSS |

## Architecture

```
Single-page app (SPA) with hash routing
HTML pages stored in database (pages table), served by the server code

index.html          Full HTML document — auth screens, sidebar, router, dashboard
contacts.html       Fragment — contact table, add/edit modal, import
campaigns.html      Fragment — campaign list, editor with preview, stats view
templates.html      Fragment — template grid, editor modal with live preview
worker.js           Server code — all API routes, auth, DB queries, page serving, Resend calls
schema.sql          Database — 7 tables (users, sessions, contacts, templates, campaigns, sends, pages)
```

## Deploy Sequence

Follow these steps in order. Do NOT skip any step.

### Step 1: Create the app

```
create_app(name: "mailpilot", template: "full-stack")
```

### Step 2: Set up the database

Read the file `schema.sql` from this skill's directory. Run each CREATE TABLE and CREATE INDEX statement individually:

```
run_sql(app: "mailpilot", query: "CREATE TABLE users (...)")
run_sql(app: "mailpilot", query: "CREATE TABLE sessions (...)")
run_sql(app: "mailpilot", query: "CREATE TABLE contacts (...)")
run_sql(app: "mailpilot", query: "CREATE TABLE templates (...)")
run_sql(app: "mailpilot", query: "CREATE TABLE campaigns (...)")
run_sql(app: "mailpilot", query: "CREATE TABLE sends (...)")
run_sql(app: "mailpilot", query: "CREATE TABLE pages (...)")
run_sql(app: "mailpilot", query: "CREATE INDEX idx_sessions_user_id ...")
run_sql(app: "mailpilot", query: "CREATE INDEX idx_contacts_user_id ...")
run_sql(app: "mailpilot", query: "CREATE INDEX idx_templates_user_id ...")
run_sql(app: "mailpilot", query: "CREATE INDEX idx_campaigns_user_id ...")
run_sql(app: "mailpilot", query: "CREATE INDEX idx_sends_campaign_id ...")
run_sql(app: "mailpilot", query: "CREATE INDEX idx_sends_contact_id ...")
```

### Step 3: Set environment variables

Ask the user for their Resend API key and sender email. Then:

```
set_env(app: "mailpilot", variables: [
  { key: "RESEND_API_KEY", value: "<user's Resend API key>" },
  { key: "FROM_EMAIL", value: "<user's verified sender email>" }
])
```

If the user doesn't have a Resend key yet, tell them:
1. Go to resend.com and create a free account
2. Go to API Keys and create a new key
3. Verify a sender domain or use their onboarding email

The app will still deploy without these — sending will just fail until they're set.

### Step 4: Deploy the server code

Read the file `worker.js` from this skill's directory. Deploy it with a placeholder file:

```
deploy(
  app: "mailpilot",
  files: [{ path: "/placeholder.txt", content: "ok" }],
  serverCode: <contents of worker.js>,
  preview: true,
  description: "Initial deploy — email marketing app"
)
```

**Why only the server code?** The HTML files are too large to fit in a single deploy call. Instead, the server code serves HTML pages from the database (`pages` table), and we load the pages in the next step.

### Step 5: Load the HTML pages into the database

Read each HTML file from `pages/` and insert it into the `pages` table using parameterized queries. Do each file separately:

```
run_sql(app: "mailpilot", query: "INSERT OR REPLACE INTO pages (name, content) VALUES (?, ?)",
  params: ["index.html", <contents of pages/index.html>])

run_sql(app: "mailpilot", query: "INSERT OR REPLACE INTO pages (name, content) VALUES (?, ?)",
  params: ["contacts.html", <contents of pages/contacts.html>])

run_sql(app: "mailpilot", query: "INSERT OR REPLACE INTO pages (name, content) VALUES (?, ?)",
  params: ["campaigns.html", <contents of pages/campaigns.html>])

run_sql(app: "mailpilot", query: "INSERT OR REPLACE INTO pages (name, content) VALUES (?, ?)",
  params: ["templates.html", <contents of pages/templates.html>])
```

### Step 6: Verify preview

```
fetch_url(app: "mailpilot", preview: true)
```

Check that the response includes "MailPilot" in the HTML, with the full login form and sidebar. If you see "Not Found" instead, the pages may not have been inserted correctly — check with `run_sql(query: "SELECT name FROM pages")`.

### Step 7: Go live

```
deploy(
  app: "mailpilot",
  files: [{ path: "/placeholder.txt", content: "ok" }],
  serverCode: <same server code as step 4>,
  description: "Go live"
)
```

The pages in the database are already there from step 5 — they persist across deploys.

### Step 8: Verify production

```
fetch_url(app: "mailpilot")
```

### Step 9: Share with user

Tell the user their app is live and give them the URL. Explain:
- Go to the URL and create an account
- Add contacts manually or import a JSON list
- Create email templates with the HTML editor
- Build campaigns using templates or custom HTML
- Set RESEND_API_KEY and FROM_EMAIL to enable sending (if not done in step 3)

## API Routes Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/auth/signup | No | Create account |
| POST | /api/auth/login | No | Sign in |
| POST | /api/auth/logout | Yes | Sign out |
| GET | /api/dashboard | Yes | Stats overview |
| GET | /api/contacts | Yes | List contacts (?search=) |
| POST | /api/contacts | Yes | Create contact |
| PUT | /api/contacts/:id | Yes | Update contact |
| DELETE | /api/contacts/:id | Yes | Delete contact |
| POST | /api/contacts/import | Yes | Bulk import JSON array |
| GET | /api/templates | Yes | List templates |
| POST | /api/templates | Yes | Create template |
| PUT | /api/templates/:id | Yes | Update template |
| DELETE | /api/templates/:id | Yes | Delete template |
| GET | /api/campaigns | Yes | List campaigns with stats |
| POST | /api/campaigns | Yes | Create campaign |
| PUT | /api/campaigns/:id | Yes | Update draft campaign |
| DELETE | /api/campaigns/:id | Yes | Delete campaign |
| POST | /api/campaigns/:id/send | Yes | Send to all active contacts |

## Database Schema

7 tables: `users`, `sessions`, `contacts`, `templates`, `campaigns`, `sends`, `pages`. The `pages` table stores the HTML files (served by the server code). See `schema.sql` for full DDL.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| RESEND_API_KEY | For sending | API key from resend.com |
| FROM_EMAIL | For sending | Verified sender email address |

## Customization Ideas

After the initial deploy, the user might ask to:
- Change the app name or branding ("MailPilot" -> their brand)
- Add contact list/segment support (filter contacts by tags when sending)
- Add email scheduling (send at a future time)
- Add unsubscribe links in emails
- Add webhook endpoint for Resend delivery/open events
- Add CSV export for contacts
- Connect a custom domain
