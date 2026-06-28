# The Loading Times — Complete Deployment Guide

## What You're Building

```
Browser
  ↓ fetch('/api/posts')
Cloudflare Worker  ← your Firebase secrets live HERE only
  ↓ Firebase REST API (Admin)
Firestore Database

Browser
  ↓ visit page
Cloudflare Pages   ← static HTML, zero secrets
```

---

## STEP 1 — Create New Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Add project"**
3. Name it: `theloadingtimes` (or anything you like)
4. Disable Google Analytics (not needed)
5. Click **Create Project**

### 1a. Enable Firestore

1. In sidebar → **Firestore Database**
2. Click **Create database**
3. Choose **Production mode**
4. Select location: `asia-south1` (Mumbai) — closest for India
5. Click **Enable**

### 1b. Deploy Firestore Security Rules

1. In Firestore → **Rules** tab
2. Replace everything with:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
3. Click **Publish**

> ⚠️ This blocks ALL browser access to Firestore. Only your Worker (with Admin SDK) can read/write. This is the whole point.

### 1c. Create Firestore Indexes

1. In Firestore → **Indexes** tab
2. Click **Add Index** for each of these:

| Collection | Fields | Order |
|---|---|---|
| posts | status ASC, publishedAt DESC | - |
| posts | status ASC, featured ASC, publishedAt DESC | - |
| posts | status ASC, categoryId ASC, publishedAt DESC | - |
| posts | status ASC, tags (Array), publishedAt DESC | - |
| subscribers | email ASC, createdAt DESC | - |

Or upload `firestore.indexes.json` via Firebase CLI:
```bash
npm install -g firebase-tools
firebase login
firebase use --add   # select your project
firebase deploy --only firestore:indexes
```

### 1d. Get Service Account Key (for Worker)

1. Firebase Console → ⚙️ **Project Settings** → **Service accounts** tab
2. Click **"Generate new private key"**
3. Download the JSON file — keep it safe, never commit to GitHub
4. You'll need these 3 values from it:
   - `project_id`
   - `client_email`
   - `private_key`

### 1e. Get Web API Key (for Admin panel login)

1. Firebase Console → ⚙️ **Project Settings** → **General** tab
2. Scroll down to **"Your apps"**
3. Click **"Add app"** → Web icon `</>`
4. Register the app (name: `TLT Admin`)
5. Copy the `apiKey` value → this is your `FIREBASE_WEB_API_KEY`

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDhEdPvftr3NZWyUE2Qti8TZuoeS19X4cg",
  authDomain: "theloadingtimes.firebaseapp.com",
  projectId: "theloadingtimes",
  storageBucket: "theloadingtimes.firebasestorage.app",
  messagingSenderId: "532382064400",
  appId: "1:532382064400:web:eca1931104b31fb3228f95"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

### 1f. Enable Firebase Authentication

1. Firebase Console → **Authentication** → **Get started**
2. Click **Email/Password** → Enable it → Save
3. Go to **Users** tab → **Add user**
4. Enter your admin email + password
5. That's your admin login

---

## STEP 2 — Set Up GitHub Repo

1. Create a new GitHub repo: `theloadingtimes` (or push to existing)
2. The folder structure should look like:

```
theloadingtimes/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── worker/
│   ├── src/
│   │   └── index.js
│   ├── wrangler.toml
│   └── package.json
├── frontend/
│   ├── index.html
│   ├── article.html
│   ├── articles.html
│   ├── category.html
│   ├── all-categories.html
│   ├── search.html
│   ├── tag.html
│   ├── newsletter.html
│   ├── about.html
│   ├── contact.html
│   ├── faq.html
│   ├── policy.html
│   ├── terms.html
│   ├── write-for-us.html
│   ├── admin/
│   │   └── index.html
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── core.js
│   ├── assets/
│   │   └── img/
│   │       └── logo.png   ← add your logo here
│   ├── _redirects
│   └── _headers
├── firestore.rules
└── firestore.indexes.json
```

3. Push all files to GitHub

---

## STEP 3 — Set Up Cloudflare Worker

### 3a. Install Wrangler

```bash
npm install -g wrangler
wrangler login   # opens browser to authenticate
```

### 3b. Update wrangler.toml

Open `worker/wrangler.toml` and set your Firebase project ID:

```toml
name = "tlt-api"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
FIREBASE_PROJECT_ID = "your-actual-project-id"
```

### 3c. Add Secrets to Cloudflare Worker

Run these one by one in your terminal (from inside the `worker/` folder):

```bash
cd worker
npm install

wrangler secret put FIREBASE_CLIENT_EMAIL
# Paste: client_email value from your service account JSON
# Example: firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com

wrangler secret put FIREBASE_PRIVATE_KEY
# Paste: the entire private_key value from your service account JSON
# It looks like: -----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
# IMPORTANT: paste the full string including -----BEGIN and -----END parts

wrangler secret put FIREBASE_WEB_API_KEY
# Paste: your Web API key (from Step 1e)
# Example: AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXX
```

> ✅ These secrets are encrypted by Cloudflare and never exposed anywhere.

### 3d. Deploy the Worker

```bash
cd worker
wrangler deploy
```

You'll get a URL like: `https://tlt-api.YOUR_SUBDOMAIN.workers.dev`

Copy this URL — you'll need it in the next step.

### 3e. Test the Worker

Open in browser:
```
https://tlt-api.YOUR_SUBDOMAIN.workers.dev/api/posts
https://tlt-api.YOUR_SUBDOMAIN.workers.dev/api/categories
https://tlt-api.YOUR_SUBDOMAIN.workers.dev/api/settings
```

You should see `[]` or `{}` — empty JSON. That means it's working!

---

## STEP 4 — Configure Frontend

### 4a. Update the Worker URL in frontend files

Open these files and replace `YOUR_SUBDOMAIN` with your actual Worker subdomain:

**`frontend/js/core.js`** — line 9:
```js
const API = 'https://tlt-api.YOUR_SUBDOMAIN.workers.dev';
```

**`frontend/admin/index.html`** — find this line:
```js
const API = 'https://tlt-api.YOUR_SUBDOMAIN.workers.dev';
```

### 4b. Update Firebase Config in Admin Panel

Open `frontend/admin/index.html` and find this section:
```js
const FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_WEB_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
};
```

Replace with your actual values from Step 1e.

> ℹ️ The Firebase Web API key in the admin panel is safe to expose — it only enables Firebase Auth login. It cannot access Firestore because you blocked it in the security rules.

---

## STEP 5 — Deploy Frontend to Cloudflare Pages

### Option A: Deploy from Cloudflare Dashboard (easiest)

1. Go to https://dash.cloudflare.com
2. **Pages** → **Create a project** → **Connect to Git**
3. Select your GitHub repo
4. Configure build settings:
   - **Build command**: (leave empty)
   - **Build output directory**: `frontend`
   - **Root directory**: (leave empty)
5. Click **Save and Deploy**
6. Done! You'll get a URL like `theloadingtimes.pages.dev`

### Option B: Deploy from CLI

```bash
wrangler pages deploy frontend --project-name=theloadingtimes
```

---

## STEP 6 — Set Up Auto-Deploy via GitHub Actions

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add these secrets:

| Secret Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Create at dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Found at dash.cloudflare.com → right sidebar |

3. Now every `git push` to `main` will automatically:
   - Deploy the Worker
   - Deploy the frontend to Pages

---

## STEP 7 — Add Your Logo

1. Create your logo image (PNG, 64×64 or 128×128)
2. Save it as `frontend/assets/img/logo.png`
3. Push to GitHub → auto-deploys

---

## STEP 8 — Connect Custom Domain

### For the frontend (Pages):
1. Cloudflare Pages → your project → **Custom domains**
2. Add `theloadingtimes.com` (or your domain)
3. If your domain is already on Cloudflare, it auto-configures

### For the Worker (optional — nicer API URL):
1. Cloudflare Workers → `tlt-api` → **Triggers** → **Custom Domains**
2. Add `api.theloadingtimes.com`
3. Update the `API` constant in your frontend files to use this domain

---

## STEP 9 — First Login & Create Content

1. Go to `https://theloadingtimes.pages.dev/admin/`
2. Sign in with the admin email/password you created in Step 1f
3. Go to **Categories** → create your categories
4. Go to **New Post** → write your first article
5. Set status to **Published** → save
6. Visit your homepage — your article should appear!

---

## Firestore Collections Reference

The Worker uses these Firestore collections:

### `posts`
| Field | Type | Notes |
|---|---|---|
| title | string | Required |
| slug | string | Required, unique, URL-friendly |
| content | string | HTML content |
| excerpt | string | Short summary |
| coverImage | string | URL of cover image |
| categoryId | string | ID of category document |
| author | string | Author name |
| tags | array | Array of tag strings |
| featured | boolean | Show in hero slider |
| status | string | `"published"` or `"draft"` |
| views | number | Auto-incremented |
| readTime | number | Minutes |
| publishedAt | timestamp | ISO string |
| createdAt | timestamp | Auto-set |
| updatedAt | timestamp | Auto-set on edit |

### `categories`
| Field | Type |
|---|---|
| name | string |
| slug | string |
| description | string |
| image | string (URL) |
| createdAt | timestamp |

### `subscribers`
| Field | Type |
|---|---|
| name | string |
| email | string |
| createdAt | timestamp |

### `settings/site` (single document)
| Field | Type |
|---|---|
| popup.enabled | boolean |
| popup.title | string |
| popup.text | string |
| popup.image | string |
| popup.btnText | string |
| popup.btnLink | string |

---

## Troubleshooting

### Worker returns 500 errors
- Check your secrets: `wrangler secret list`
- Make sure `FIREBASE_PRIVATE_KEY` has actual newlines (not escaped `\n`)
- Check Worker logs: `wrangler tail`

### Admin login fails
- Make sure `FIREBASE_WEB_API_KEY` is correct
- Check Firebase Console → Authentication → Users — is your user there?
- Make sure Email/Password auth is enabled

### Articles not showing
- Make sure posts have `status: "published"`
- Make sure Firestore indexes are created (Step 1c)
- Open browser DevTools → Network tab to see API responses

### Firestore index errors
- Worker logs will say "The query requires an index"
- Go to Firebase Console → Firestore → Indexes and create it there
- Or click the link in the error message — Firebase auto-generates it

### CORS errors in browser
- The Worker already sets CORS headers for `*`
- If you restrict to your domain later, update `CORS_HEADERS` in `worker/src/index.js`

---

## Cost Estimate

| Service | Free Tier | Estimated Usage |
|---|---|---|
| Cloudflare Workers | 100,000 requests/day free | ✅ More than enough |
| Cloudflare Pages | Unlimited bandwidth free | ✅ Free |
| Firebase Firestore | 50,000 reads/day free | ✅ Fine for starting out |
| GitHub Actions | 2,000 min/month free | ✅ Free |

**Total monthly cost: ₹0** until you get serious traffic.

---

## Security Summary

| What | Old (bad) | New (good) |
|---|---|---|
| Firebase config | Exposed in browser JS | Not in browser at all |
| Firestore access | Open from browser | Blocked — Worker only |
| Admin auth | Firebase client SDK | Firebase Auth → Worker verifies token |
| Secrets | In source code or browser | Cloudflare encrypted secrets |
| API keys | Anyone can steal them | Only Cloudflare can see them |

---

*Built with Cloudflare Workers + Firebase Firestore + Cloudflare Pages*
