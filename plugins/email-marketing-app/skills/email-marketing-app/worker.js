const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function hex(buffer) {
  return [...buffer].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hexStr) {
  const bytes = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function getBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return hex(salt) + ':' + hex(new Uint8Array(bits));
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return hex(new Uint8Array(bits)) === hashHex;
}

async function authenticate(request, ctx) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const session = await ctx.db.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE id = ?'
  )
    .bind(token)
    .first();
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    await ctx.db.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
    return null;
  }
  return session.user_id;
}

async function createSession(ctx, userId) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await ctx.db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  )
    .bind(sessionId, userId, expiresAt)
    .run();
  return sessionId;
}

// --- Auth routes ---

async function signup(request, ctx) {
  const body = await getBody(request);
  if (!body || !body.email || !body.password) {
    return err('Email and password are required');
  }
  const existing = await ctx.db.prepare('SELECT id FROM users WHERE email = ?')
    .bind(body.email)
    .first();
  if (existing) return err('Email already registered', 409);

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(body.password);
  await ctx.db.prepare(
    'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)'
  )
    .bind(userId, body.email, passwordHash)
    .run();

  const token = await createSession(ctx, userId);
  return json({ token }, 201);
}

async function login(request, ctx) {
  const body = await getBody(request);
  if (!body || !body.email || !body.password) {
    return err('Email and password are required');
  }
  const user = await ctx.db.prepare(
    'SELECT id, password_hash FROM users WHERE email = ?'
  )
    .bind(body.email)
    .first();
  if (!user) return err('Invalid credentials', 401);

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) return err('Invalid credentials', 401);

  const token = await createSession(ctx, user.id);
  return json({ token });
}

async function logout(request, ctx) {
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    await ctx.db.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
  }
  return json({ ok: true });
}

// --- Contact routes ---

async function listContacts(request, ctx, userId) {
  const url = new URL(request.url);
  const search = url.searchParams.get('search');
  let results;
  if (search) {
    const pattern = `%${search}%`;
    results = await ctx.db.prepare(
      'SELECT id, email, name, tags, status, created_at FROM contacts WHERE user_id = ? AND (email LIKE ? OR name LIKE ?) ORDER BY created_at DESC'
    )
      .bind(userId, pattern, pattern)
      .all();
  } else {
    results = await ctx.db.prepare(
      'SELECT id, email, name, tags, status, created_at FROM contacts WHERE user_id = ? ORDER BY created_at DESC'
    )
      .bind(userId)
      .all();
  }
  return json(results.results);
}

async function createContact(request, ctx, userId) {
  const body = await getBody(request);
  if (!body || !body.email) return err('Email is required');
  const id = crypto.randomUUID();
  try {
    await ctx.db.prepare(
      'INSERT INTO contacts (id, user_id, email, name, tags) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(id, userId, body.email, body.name || '', body.tags || '')
      .run();
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return err('Contact with this email already exists', 409);
    }
    throw e;
  }
  return json({ id, email: body.email, name: body.name || '', tags: body.tags || '' }, 201);
}

async function updateContact(request, ctx, userId, contactId) {
  const body = await getBody(request);
  if (!body) return err('Request body is required');
  const existing = await ctx.db.prepare(
    'SELECT id FROM contacts WHERE id = ? AND user_id = ?'
  )
    .bind(contactId, userId)
    .first();
  if (!existing) return err('Contact not found', 404);

  const fields = [];
  const values = [];
  if (body.email !== undefined) { fields.push('email = ?'); values.push(body.email); }
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.tags !== undefined) { fields.push('tags = ?'); values.push(body.tags); }
  if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status); }
  if (fields.length === 0) return err('No fields to update');

  values.push(contactId, userId);
  await ctx.db.prepare(
    `UPDATE contacts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  )
    .bind(...values)
    .run();
  return json({ ok: true });
}

async function deleteContact(ctx, userId, contactId) {
  const result = await ctx.db.prepare(
    'DELETE FROM contacts WHERE id = ? AND user_id = ?'
  )
    .bind(contactId, userId)
    .run();
  if (result.meta.changes === 0) return err('Contact not found', 404);
  return json({ ok: true });
}

async function importContacts(request, ctx, userId) {
  const body = await getBody(request);
  if (!body || !Array.isArray(body)) return err('Expected a JSON array of contacts');
  let imported = 0;
  let skipped = 0;
  for (const contact of body) {
    if (!contact.email) { skipped++; continue; }
    const id = crypto.randomUUID();
    try {
      await ctx.db.prepare(
        'INSERT INTO contacts (id, user_id, email, name, tags) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(id, userId, contact.email, contact.name || '', contact.tags || '')
        .run();
      imported++;
    } catch {
      skipped++;
    }
  }
  return json({ imported, skipped }, 201);
}

// --- Template routes ---

async function listTemplates(ctx, userId) {
  const results = await ctx.db.prepare(
    'SELECT id, name, subject, html, created_at, updated_at FROM templates WHERE user_id = ? ORDER BY updated_at DESC'
  )
    .bind(userId)
    .all();
  return json(results.results);
}

async function createTemplate(request, ctx, userId) {
  const body = await getBody(request);
  if (!body || !body.name) return err('Name is required');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await ctx.db.prepare(
    'INSERT INTO templates (id, user_id, name, subject, html, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, userId, body.name, body.subject || '', body.html || '', now, now)
    .run();
  return json({ id, name: body.name }, 201);
}

async function updateTemplate(request, ctx, userId, templateId) {
  const body = await getBody(request);
  if (!body) return err('Request body is required');
  const existing = await ctx.db.prepare(
    'SELECT id FROM templates WHERE id = ? AND user_id = ?'
  )
    .bind(templateId, userId)
    .first();
  if (!existing) return err('Template not found', 404);

  const fields = [];
  const values = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.subject !== undefined) { fields.push('subject = ?'); values.push(body.subject); }
  if (body.html !== undefined) { fields.push('html = ?'); values.push(body.html); }
  if (fields.length === 0) return err('No fields to update');

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(templateId, userId);
  await ctx.db.prepare(
    `UPDATE templates SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  )
    .bind(...values)
    .run();
  return json({ ok: true });
}

async function deleteTemplate(ctx, userId, templateId) {
  const result = await ctx.db.prepare(
    'DELETE FROM templates WHERE id = ? AND user_id = ?'
  )
    .bind(templateId, userId)
    .run();
  if (result.meta.changes === 0) return err('Template not found', 404);
  return json({ ok: true });
}

// --- Campaign routes ---

async function listCampaigns(ctx, userId) {
  const results = await ctx.db.prepare(
    `SELECT c.id, c.name, c.status, c.subject, c.sent_at, c.created_at,
       (SELECT COUNT(*) FROM sends WHERE campaign_id = c.id) AS total_sends,
       (SELECT COUNT(*) FROM sends WHERE campaign_id = c.id AND status IN ('sent','delivered','opened')) AS sent_count,
       (SELECT COUNT(*) FROM sends WHERE campaign_id = c.id AND status = 'opened') AS opened_count
     FROM campaigns c WHERE c.user_id = ? ORDER BY c.created_at DESC`
  )
    .bind(userId)
    .all();
  return json(results.results);
}

async function createCampaign(request, ctx, userId) {
  const body = await getBody(request);
  if (!body || !body.name) return err('Name is required');
  const id = crypto.randomUUID();
  await ctx.db.prepare(
    'INSERT INTO campaigns (id, user_id, name, template_id, subject, html) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, userId, body.name, body.template_id || null, body.subject || '', body.html || '')
    .run();
  return json({ id, name: body.name }, 201);
}

async function updateCampaign(request, ctx, userId, campaignId) {
  const body = await getBody(request);
  if (!body) return err('Request body is required');
  const existing = await ctx.db.prepare(
    'SELECT id, status FROM campaigns WHERE id = ? AND user_id = ?'
  )
    .bind(campaignId, userId)
    .first();
  if (!existing) return err('Campaign not found', 404);
  if (existing.status !== 'draft') return err('Can only edit draft campaigns');

  const fields = [];
  const values = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.subject !== undefined) { fields.push('subject = ?'); values.push(body.subject); }
  if (body.html !== undefined) { fields.push('html = ?'); values.push(body.html); }
  if (body.template_id !== undefined) { fields.push('template_id = ?'); values.push(body.template_id); }
  if (fields.length === 0) return err('No fields to update');

  values.push(campaignId, userId);
  await ctx.db.prepare(
    `UPDATE campaigns SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  )
    .bind(...values)
    .run();
  return json({ ok: true });
}

async function deleteCampaign(ctx, userId, campaignId) {
  const result = await ctx.db.prepare(
    'DELETE FROM campaigns WHERE id = ? AND user_id = ?'
  )
    .bind(campaignId, userId)
    .run();
  if (result.meta.changes === 0) return err('Campaign not found', 404);
  return json({ ok: true });
}

async function sendCampaign(ctx, userId, campaignId) {
  const campaign = await ctx.db.prepare(
    'SELECT id, status, subject, html, template_id FROM campaigns WHERE id = ? AND user_id = ?'
  )
    .bind(campaignId, userId)
    .first();
  if (!campaign) return err('Campaign not found', 404);
  if (campaign.status !== 'draft') return err('Campaign has already been sent');

  let subject = campaign.subject;
  let html = campaign.html;

  if (campaign.template_id && (!subject || !html)) {
    const template = await ctx.db.prepare(
      'SELECT subject, html FROM templates WHERE id = ?'
    )
      .bind(campaign.template_id)
      .first();
    if (template) {
      if (!subject) subject = template.subject;
      if (!html) html = template.html;
    }
  }

  if (!subject || !html) return err('Campaign must have a subject and HTML content');
  if (!ctx.RESEND_API_KEY) return err('RESEND_API_KEY is not configured. Set it with set_env before sending.', 500);

  await ctx.db.prepare(
    "UPDATE campaigns SET status = 'sending' WHERE id = ?"
  )
    .bind(campaignId)
    .run();

  const contacts = await ctx.db.prepare(
    "SELECT id, email FROM contacts WHERE user_id = ? AND status = 'active'"
  )
    .bind(userId)
    .all();

  const fromEmail = ctx.FROM_EMAIL || 'noreply@example.com';
  let sentCount = 0;
  let failedCount = 0;

  for (const contact of contacts.results) {
    const sendId = crypto.randomUUID();
    await ctx.db.prepare(
      'INSERT INTO sends (id, campaign_id, contact_id) VALUES (?, ?, ?)'
    )
      .bind(sendId, campaignId, contact.id)
      .run();

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ctx.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: contact.email,
          subject,
          html,
        }),
      });

      const result = await response.json();

      if (response.ok && result.id) {
        await ctx.db.prepare(
          "UPDATE sends SET status = 'sent', resend_id = ?, sent_at = ? WHERE id = ?"
        )
          .bind(result.id, new Date().toISOString(), sendId)
          .run();
        sentCount++;
      } else {
        await ctx.db.prepare(
          "UPDATE sends SET status = 'failed' WHERE id = ?"
        )
          .bind(sendId)
          .run();
        failedCount++;
      }
    } catch {
      await ctx.db.prepare(
        "UPDATE sends SET status = 'failed' WHERE id = ?"
      )
        .bind(sendId)
        .run();
      failedCount++;
    }
  }

  // If all sends failed, revert to draft so user can retry
  if (sentCount === 0 && failedCount > 0) {
    await ctx.db.prepare(
      "UPDATE campaigns SET status = 'draft' WHERE id = ?"
    )
      .bind(campaignId)
      .run();
    // Clean up failed send records so retry starts fresh
    await ctx.db.prepare(
      'DELETE FROM sends WHERE campaign_id = ?'
    )
      .bind(campaignId)
      .run();
    return err('All ' + failedCount + ' emails failed to send. Campaign reverted to draft — check your RESEND_API_KEY and try again.', 500);
  }

  const now = new Date().toISOString();
  await ctx.db.prepare(
    "UPDATE campaigns SET status = 'sent', sent_at = ? WHERE id = ?"
  )
    .bind(now, campaignId)
    .run();

  return json({ sent: sentCount, failed: failedCount });
}

// --- Dashboard route ---

async function dashboard(ctx, userId) {
  const contacts = await ctx.db.prepare(
    'SELECT COUNT(*) AS count FROM contacts WHERE user_id = ?'
  )
    .bind(userId)
    .first();
  const campaigns = await ctx.db.prepare(
    'SELECT COUNT(*) AS count FROM campaigns WHERE user_id = ?'
  )
    .bind(userId)
    .first();
  const sent = await ctx.db.prepare(
    "SELECT COUNT(*) AS count FROM sends s JOIN campaigns c ON s.campaign_id = c.id WHERE c.user_id = ? AND s.status IN ('sent','delivered','opened')"
  )
    .bind(userId)
    .first();
  const opened = await ctx.db.prepare(
    "SELECT COUNT(*) AS count FROM sends s JOIN campaigns c ON s.campaign_id = c.id WHERE c.user_id = ? AND s.status = 'opened'"
  )
    .bind(userId)
    .first();

  return json({
    totalContacts: contacts.count,
    totalCampaigns: campaigns.count,
    totalSent: sent.count,
    totalOpened: opened.count,
  });
}

// --- Router ---

function matchRoute(method, pathname) {
  // Auth routes
  if (method === 'POST' && pathname === '/api/auth/signup') return { handler: 'signup' };
  if (method === 'POST' && pathname === '/api/auth/login') return { handler: 'login' };
  if (method === 'POST' && pathname === '/api/auth/logout') return { handler: 'logout' };

  // Dashboard
  if (method === 'GET' && pathname === '/api/dashboard') return { handler: 'dashboard', auth: true };

  // Contacts
  if (method === 'GET' && pathname === '/api/contacts') return { handler: 'listContacts', auth: true };
  if (method === 'POST' && pathname === '/api/contacts') return { handler: 'createContact', auth: true };
  if (method === 'POST' && pathname === '/api/contacts/import') return { handler: 'importContacts', auth: true };

  const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
  if (contactMatch) {
    if (method === 'PUT') return { handler: 'updateContact', auth: true, id: contactMatch[1] };
    if (method === 'DELETE') return { handler: 'deleteContact', auth: true, id: contactMatch[1] };
  }

  // Templates
  if (method === 'GET' && pathname === '/api/templates') return { handler: 'listTemplates', auth: true };
  if (method === 'POST' && pathname === '/api/templates') return { handler: 'createTemplate', auth: true };

  const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (templateMatch) {
    if (method === 'PUT') return { handler: 'updateTemplate', auth: true, id: templateMatch[1] };
    if (method === 'DELETE') return { handler: 'deleteTemplate', auth: true, id: templateMatch[1] };
  }

  // Campaigns
  if (method === 'GET' && pathname === '/api/campaigns') return { handler: 'listCampaigns', auth: true };
  if (method === 'POST' && pathname === '/api/campaigns') return { handler: 'createCampaign', auth: true };

  const campaignSendMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/send$/);
  if (campaignSendMatch && method === 'POST') {
    return { handler: 'sendCampaign', auth: true, id: campaignSendMatch[1] };
  }

  const campaignMatch = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
  if (campaignMatch) {
    if (method === 'PUT') return { handler: 'updateCampaign', auth: true, id: campaignMatch[1] };
    if (method === 'DELETE') return { handler: 'deleteCampaign', auth: true, id: campaignMatch[1] };
  }

  return null;
}

export default async function handler(request, ctx) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;
      const method = request.method;

      if (method === 'OPTIONS') return handleOptions();

      // API routes
      if (pathname.startsWith('/api/')) {
        const route = matchRoute(method, pathname);
        if (!route) return err('Not found', 404);

        let userId = null;
        if (route.auth) {
          userId = await authenticate(request, ctx);
          if (!userId) return err('Unauthorized', 401);
        }

        switch (route.handler) {
          // Auth
          case 'signup': return signup(request, ctx);
          case 'login': return login(request, ctx);
          case 'logout': return logout(request, ctx);

          // Dashboard
          case 'dashboard': return dashboard(ctx, userId);

          // Contacts
          case 'listContacts': return listContacts(request, ctx, userId);
          case 'createContact': return createContact(request, ctx, userId);
          case 'importContacts': return importContacts(request, ctx, userId);
          case 'updateContact': return updateContact(request, ctx, userId, route.id);
          case 'deleteContact': return deleteContact(ctx, userId, route.id);

          // Templates
          case 'listTemplates': return listTemplates(ctx, userId);
          case 'createTemplate': return createTemplate(request, ctx, userId);
          case 'updateTemplate': return updateTemplate(request, ctx, userId, route.id);
          case 'deleteTemplate': return deleteTemplate(ctx, userId, route.id);

          // Campaigns
          case 'listCampaigns': return listCampaigns(ctx, userId);
          case 'createCampaign': return createCampaign(request, ctx, userId);
          case 'updateCampaign': return updateCampaign(request, ctx, userId, route.id);
          case 'deleteCampaign': return deleteCampaign(ctx, userId, route.id);
          case 'sendCampaign': return sendCampaign(ctx, userId, route.id);
        }
      }

      // Non-API: serve HTML pages from database (pages table)
      const pageName = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (pageName.endsWith('.html')) {
        const pg = await ctx.db.prepare('SELECT content FROM pages WHERE name = ?').bind(pageName).first();
        if (pg) return new Response(pg.content, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      // Fallback to static assets
      try {
        return await ctx.assets.fetch(request);
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    } catch (e) {
      console.error('Unhandled error:', e);
      return err('Internal server error', 500);
    }
}
