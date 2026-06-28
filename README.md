# The Loading Times — v2

> News that takes its time. And yours.

A complete rewrite of theloadingtimes.pages.dev with zero secrets in the browser.

## Architecture

- **Frontend** → Cloudflare Pages (static HTML/CSS/JS, no Firebase SDK)
- **Backend** → Cloudflare Worker (all Firestore calls, secrets encrypted here)
- **Database** → Firebase Firestore
- **Auth** → Firebase Authentication (admin panel only)

## Quick Start

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for the full step-by-step guide.

## Folder Structure

```
├── worker/          Cloudflare Worker (backend API)
├── frontend/        Cloudflare Pages (static site)
├── firestore.rules  Firestore security rules
└── firestore.indexes.json
```

## Pages

- `/` — Homepage with hero, trending, categories, latest
- `/article.html?slug=...` — Article reader
- `/articles.html` — All articles with filters
- `/category.html?slug=...` — Category listing
- `/all-categories.html` — All categories
- `/search.html` — Search
- `/tag.html?tag=...` — Tag listing
- `/newsletter.html` — Newsletter signup
- `/about.html`, `/contact.html`, `/faq.html`, `/policy.html`, `/terms.html`, `/write-for-us.html`
- `/admin/` — Admin panel (Firebase Auth protected)

## API Endpoints (Worker)

```
GET  /api/posts              All published posts
GET  /api/posts/:slug        Single post by slug
GET  /api/posts?featured=true Featured posts
GET  /api/posts?categoryId=X Posts by category
GET  /api/posts?tag=X        Posts by tag
GET  /api/categories         All categories
GET  /api/categories/:slug   Category by slug
GET  /api/settings           Site settings
GET  /api/search?q=X         Search posts
POST /api/subscribe          Subscribe to newsletter
POST /api/views              Increment post views

# Admin (requires Firebase ID token in Authorization header)
GET    /api/admin/posts
POST   /api/admin/posts
PUT    /api/admin/posts/:id
DELETE /api/admin/posts/:id
POST   /api/admin/categories
PUT    /api/admin/categories/:id
DELETE /api/admin/categories/:id
GET    /api/admin/subscribers
DELETE /api/admin/subscribers/:id
PUT    /api/admin/settings
```
