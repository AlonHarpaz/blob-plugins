<p align="center">
  <img src="icon.png" alt="Blob" width="120" />
</p>

<h1 align="center">Blob Plugins</h1>

<p align="center">Skills and app templates for <a href="https://imblob.com">Blob</a> — the AI-first hosting platform.</p>

## Plugins

### Blob

Deployment guide for Blob. Teaches Claude how to create, deploy, and manage web apps — Workers, Containers, payments, custom domains, and more.

**Skill:** `/blob` — invoked automatically when working with Blob's MCP tools.

### Email Marketing App

A complete email marketing app template (MailPilot). Claude follows the step-by-step instructions to deploy a full-stack app with auth, contacts, campaigns, templates, and Resend email integration.

**Skill:** `/email-marketing-app` — builds and deploys the app end-to-end.

## Installation

### Claude Desktop / Claude Code

Add the marketplace:

```
/plugin marketplace add AlonHarpaz/blob-plugins
```

Then install the plugins you want:

```
/plugin install blob@blob-plugins
/plugin install email-marketing-app@blob-plugins
```

Enable auto-update in the plugin settings so you always get the latest version.

## What is Blob?

Blob is a hosting platform built for AI. Connect your AI tool (Claude, Cursor, etc.) via MCP and deploy web apps with a single command. Each app gets a live URL, database, storage, and key-value store — all provisioned automatically.

Two runtimes:
- **Workers** — fast cold starts, built-in database/KV/storage, `ctx.auth` and `ctx.payments`
- **Containers** — Node.js 22, native modules (Express, better-sqlite3, sharp), filesystem access

Learn more at [imblob.com](https://imblob.com).

## License

MIT
