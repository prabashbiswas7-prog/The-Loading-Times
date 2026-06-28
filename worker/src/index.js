/**
 * The Loading Times — Cloudflare Worker
 * All Firebase/Firestore calls happen here. Keys never reach the browser.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── Public API routes ──────────────────────────────────────────────
      if (path === '/api/posts' && request.method === 'GET') {
        return await getPosts(request, env);
      }
      if (path.startsWith('/api/posts/') && request.method === 'GET') {
        const slug = path.replace('/api/posts/', '');
        return await getPostBySlug(slug, env);
      }
      if (path === '/api/categories' && request.method === 'GET') {
        return await getCategories(env);
      }
      if (path.startsWith('/api/categories/') && request.method === 'GET') {
        const slug = path.replace('/api/categories/', '');
        return await getCategoryBySlug(slug, env);
      }
      if (path === '/api/settings' && request.method === 'GET') {
        return await getSettings(env);
      }
      if (path === '/api/subscribe' && request.method === 'POST') {
        return await subscribe(request, env);
      }
      if (path === '/api/views' && request.method === 'POST') {
        return await incrementViews(request, env);
      }
      if (path === '/api/search' && request.method === 'GET') {
        return await searchPosts(request, env);
      }
      if (path === '/api/tags' && request.method === 'GET') {
        return await getPostsByTag(request, env);
      }

      // ── Admin API routes (require auth) ───────────────────────────────
      if (path.startsWith('/api/admin/')) {
        return await handleAdmin(request, env, path);
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500);
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// FIREBASE HELPERS
// ═══════════════════════════════════════════════════════════════

function base64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getFirebaseToken(env) {
  // Firebase Admin auth via service account → get access token
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64urlEncode(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  }));

  const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const cryptoKey = await importPrivateKey(privateKey);
  const signingInput = `${header}.${payload}`;
  const signature = await signJWT(signingInput, cryptoKey);
  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const errorData = await tokenRes.json().catch(() => ({}));
    throw new Error(`Google Auth Token Error: ${errorData.error_description || tokenRes.statusText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function importPrivateKey(pem) {
  const pemBody = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

async function signJWT(input, key) {
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function firestoreURL(env, path) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

async function handleFirestoreResponse(res) {
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error?.message || `Firestore error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function firestoreGet(env, path) {
  const token = await getFirebaseToken(env);
  const res = await fetch(firestoreURL(env, path), {
    headers: { Authorization: `Bearer ${token}` }
  });
  return handleFirestoreResponse(res);
}

async function firestoreQuery(env, collection, conditions = [], orderBy = null, limit = null) {
  const token = await getFirebaseToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

  const query = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: conditions.length > 0 ? buildWhere(conditions) : undefined,
      orderBy: orderBy ? orderBy : undefined,
      limit: limit ? limit : undefined,
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(query),
  });
  return handleFirestoreResponse(res);
}

async function firestoreSet(env, path, data) {
  const token = await getFirebaseToken(env);
  const res = await fetch(firestoreURL(env, path) + '?currentDocument.exists=false', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  return handleFirestoreResponse(res);
}

async function firestoreUpdate(env, path, data) {
  const token = await getFirebaseToken(env);
  const fields = toFirestoreFields(data);
  const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const res = await fetch(`${firestoreURL(env, path)}?${updateMask}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  return handleFirestoreResponse(res);
}

async function firestoreDelete(env, path) {
  const token = await getFirebaseToken(env);
  const res = await fetch(firestoreURL(env, path), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.error?.message || `Firestore error: ${res.status} ${res.statusText}`);
  }
}

async function firestoreAdd(env, collection, data) {
  const token = await getFirebaseToken(env);
  const res = await fetch(firestoreURL(env, collection), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  return handleFirestoreResponse(res);
}

function buildWhere(conditions) {
  if (conditions.length === 1) {
    const [field, op, value] = conditions[0];
    return { fieldFilter: { field: { fieldPath: field }, op: opMap(op), value: toFirestoreValue(value) } };
  }
  return {
    compositeFilter: {
      op: 'AND',
      filters: conditions.map(([field, op, value]) => ({
        fieldFilter: { field: { fieldPath: field }, op: opMap(op), value: toFirestoreValue(value) }
      }))
    }
  };
}

function opMap(op) {
  return { '==': 'EQUAL', '>': 'GREATER_THAN', '<': 'LESS_THAN', '>=': 'GREATER_THAN_OR_EQUAL', 'array-contains': 'ARRAY_CONTAINS' }[op] || 'EQUAL';
}

function toFirestoreValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v === null) return { nullValue: 'NULL_VALUE' };
  return { stringValue: String(v) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && v.__serverTimestamp) {
      fields[k] = { timestampValue: new Date().toISOString() };
    } else if (Array.isArray(v)) {
      fields[k] = { arrayValue: { values: v.map(toFirestoreValue) } };
    } else if (v && typeof v === 'object') {
      fields[k] = { mapValue: { fields: toFirestoreFields(v) } };
    } else {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

function fromFirestoreDoc(doc) {
  if (!doc || !doc.fields) return null;
  const id = doc.name ? doc.name.split('/').pop() : null;
  const obj = { id };
  for (const [k, v] of Object.entries(doc.fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj;
}

function fromFirestoreValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if (v.mapValue !== undefined) {
    const obj = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) {
      obj[k] = fromFirestoreValue(val);
    }
    return obj;
  }
  return null;
}

function parseQueryResults(results) {
  if (!Array.isArray(results)) return [];
  return results
    .filter(r => r.document)
    .map(r => fromFirestoreDoc(r.document));
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC HANDLERS
// ═══════════════════════════════════════════════════════════════

async function getPosts(request, env) {
  const url = new URL(request.url);
  const categoryId = url.searchParams.get('categoryId');
  const tag = url.searchParams.get('tag');
  const featured = url.searchParams.get('featured');
  const limit = parseInt(url.searchParams.get('limit') || '100');

  const conditions = [['status', '==', 'published']];
  if (categoryId) conditions.push(['categoryId', '==', categoryId]);
  if (featured === 'true') conditions.push(['featured', '==', true]);
  if (tag) conditions.push(['tags', 'array-contains', tag]);

  const results = await firestoreQuery(env, 'posts', conditions, [{ field: { fieldPath: 'publishedAt' }, direction: 'DESCENDING' }], limit);
  const posts = parseQueryResults(results);
  return json(posts);
}

async function getPostBySlug(slug, env) {
  const results = await firestoreQuery(env, 'posts', [['slug', '==', slug], ['status', '==', 'published']]);
  const posts = parseQueryResults(results);
  if (!posts.length) return json({ error: 'Not found' }, 404);
  return json(posts[0]);
}

async function getCategories(env) {
  const results = await firestoreQuery(env, 'categories', [], null);
  const cats = parseQueryResults(results);
  return json(cats);
}

async function getCategoryBySlug(slug, env) {
  const results = await firestoreQuery(env, 'categories', [['slug', '==', slug]]);
  const cats = parseQueryResults(results);
  if (!cats.length) return json({ error: 'Not found' }, 404);
  return json(cats[0]);
}

async function getSettings(env) {
  const doc = await firestoreGet(env, 'settings/site');
  const settings = fromFirestoreDoc(doc);
  return json(settings || {});
}

async function subscribe(request, env) {
  const body = await request.json();
  const { name, email } = body;
  if (!name || !email) return json({ error: 'Name and email required' }, 400);
  if (!email.includes('@')) return json({ error: 'Invalid email' }, 400);

  // Check duplicate
  const existing = await firestoreQuery(env, 'subscribers', [['email', '==', email]]);
  if (parseQueryResults(existing).length > 0) {
    return json({ error: 'Already subscribed' }, 409);
  }

  await firestoreAdd(env, 'subscribers', {
    name, email,
    createdAt: { __serverTimestamp: true }
  });
  return json({ success: true });
}

async function incrementViews(request, env) {
  const body = await request.json();
  const { postId } = body;
  if (!postId) return json({ error: 'postId required' }, 400);

  const doc = await firestoreGet(env, `posts/${postId}`);
  const post = fromFirestoreDoc(doc);
  if (!post) return json({ error: 'Post not found' }, 404);

  const newViews = (post.views || 0) + 1;
  await firestoreUpdate(env, `posts/${postId}`, { views: newViews });
  return json({ views: newViews });
}

async function searchPosts(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  if (!q) return json([]);

  const results = await firestoreQuery(env, 'posts', [['status', '==', 'published']], null, 200);
  const posts = parseQueryResults(results);

  const filtered = posts.filter(p =>
    (p.title || '').toLowerCase().includes(q) ||
    (p.excerpt || '').toLowerCase().includes(q) ||
    (p.tags || []).some(t => t.toLowerCase().includes(q))
  );
  return json(filtered.slice(0, 20));
}

async function getPostsByTag(request, env) {
  const url = new URL(request.url);
  const tag = url.searchParams.get('tag');
  if (!tag) return json([]);
  const results = await firestoreQuery(env, 'posts', [['status', '==', 'published'], ['tags', 'array-contains', tag]]);
  return json(parseQueryResults(results));
}

// ═══════════════════════════════════════════════════════════════
// ADMIN HANDLERS (Firebase Auth token verification)
// ═══════════════════════════════════════════════════════════════

async function verifyAdminToken(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const idToken = authHeader.replace('Bearer ', '');
  if (!idToken) return null;

  // Verify Firebase ID token via Google API
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json();
  if (data.error || !data.users || !data.users[0]) return null;
  return data.users[0];
}

async function handleAdmin(request, env, path) {
  const user = await verifyAdminToken(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const subPath = path.replace('/api/admin', '');

  // Posts CRUD
  if (subPath === '/posts' && request.method === 'GET') {
    const results = await firestoreQuery(env, 'posts', [], [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }]);
    return json(parseQueryResults(results));
  }
  if (subPath === '/posts' && request.method === 'POST') {
    const body = await request.json();
    body.createdAt = { __serverTimestamp: true };
    body.updatedAt = { __serverTimestamp: true };
    body.views = 0;
    const result = await firestoreAdd(env, 'posts', body);
    return json(fromFirestoreDoc(result));
  }
  if (subPath.startsWith('/posts/') && request.method === 'PUT') {
    const postId = subPath.replace('/posts/', '');
    const body = await request.json();
    body.updatedAt = { __serverTimestamp: true };
    await firestoreUpdate(env, `posts/${postId}`, body);
    return json({ success: true });
  }
  if (subPath.startsWith('/posts/') && request.method === 'DELETE') {
    const postId = subPath.replace('/posts/', '');
    await firestoreDelete(env, `posts/${postId}`);
    return json({ success: true });
  }

  // Categories CRUD
  if (subPath === '/categories' && request.method === 'POST') {
    const body = await request.json();
    body.createdAt = { __serverTimestamp: true };
    const result = await firestoreAdd(env, 'categories', body);
    return json(fromFirestoreDoc(result));
  }
  if (subPath.startsWith('/categories/') && request.method === 'PUT') {
    const catId = subPath.replace('/categories/', '');
    const body = await request.json();
    await firestoreUpdate(env, `categories/${catId}`, body);
    return json({ success: true });
  }
  if (subPath.startsWith('/categories/') && request.method === 'DELETE') {
    const catId = subPath.replace('/categories/', '');
    await firestoreDelete(env, `categories/${catId}`);
    return json({ success: true });
  }

  // Settings
  if (subPath === '/settings' && request.method === 'PUT') {
    const body = await request.json();
    const token = await getFirebaseToken(env);
    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/settings/site`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFirestoreFields(body) }),
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody.error?.message || `Firestore error: ${res.status} ${res.statusText}`);
    }
    return json({ success: true });
  }

  // Subscribers
  if (subPath === '/subscribers' && request.method === 'GET') {
    const results = await firestoreQuery(env, 'subscribers', [], [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }]);
    return json(parseQueryResults(results));
  }
  if (subPath.startsWith('/subscribers/') && request.method === 'DELETE') {
    const subId = subPath.replace('/subscribers/', '');
    await firestoreDelete(env, `subscribers/${subId}`);
    return json({ success: true });
  }

  // Supabase storage images proxy (for image uploads in admin)
  if (subPath === '/upload' && request.method === 'POST') {
    // Image is stored directly in Supabase from admin — no change needed
    return json({ error: 'Use Supabase Storage directly from admin' }, 400);
  }

  return json({ error: 'Admin route not found' }, 404);
}

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
