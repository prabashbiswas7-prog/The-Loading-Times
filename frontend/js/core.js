/**
 * The Loading Times — Core JS
 * API calls go to the Cloudflare Worker, never to Firebase directly.
 */

// ── CONFIG ──────────────────────────────────────────────────────
// Change this to your deployed Worker URL after deployment
const API = window.TLT_API || 'https://tlt-api.prabashbiswas7.workers.dev';

// ── API CLIENT ──────────────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API error');
  }
  return res.json();
}

const API_CACHE = {};
async function cachedApi(path, ttl = 60000) {
  const now = Date.now();
  if (API_CACHE[path] && (now - API_CACHE[path].ts) < ttl) return API_CACHE[path].data;
  const data = await api(path);
  API_CACHE[path] = { data, ts: now };
  return data;
}

// ── HELPERS ─────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function sortByDate(posts) {
  return [...posts].sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
}

function toast(msg, type = 'success') {
  let el = document.getElementById('tlt-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tlt-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── CARD HTML ───────────────────────────────────────────────────
function cardHtml(post, catName = '') {
  const cat = catName || post._catName || '';
  const thumb = post.coverImage
    ? `<img class="card-thumb" src="${esc(post.coverImage)}" alt="${esc(post.title)}" loading="lazy">`
    : `<div class="card-thumb-placeholder">No Image</div>`;

  return `
    <a href="/article.html?slug=${esc(post.slug)}" class="card">
      ${thumb}
      <div class="card-body">
        ${cat ? `<span class="card-cat">${esc(cat)}</span>` : ''}
        <h3 class="card-title">${esc(post.title)}</h3>
        <div class="card-meta">
          <span>${fmtDate(post.publishedAt || post.createdAt)}</span>
          ${post.views ? `<span class="views">${post.views}</span>` : ''}
        </div>
      </div>
    </a>
  `;
}

// ── CATEGORIES MAP ──────────────────────────────────────────────
let _catsCache = null;
async function getCatsMap() {
  if (_catsCache) return _catsCache;
  const cats = await cachedApi('/api/categories');
  _catsCache = {};
  cats.forEach(c => { _catsCache[c.id] = c; });
  return _catsCache;
}

async function attachCatNames(posts) {
  const map = await getCatsMap();
  posts.forEach(p => { if (p.categoryId && map[p.categoryId]) p._catName = map[p.categoryId].name; });
}

// ── HEADER ──────────────────────────────────────────────────────
async function renderHeader() {
  const el = document.getElementById('site-header');
  if (!el) return;

  const currentPage = location.pathname.split('/').pop() || 'index.html';

  el.innerHTML = `
    <div class="container">
      <div class="header-inner">
        <a href="/index.html" class="logo">
          <img src="/assets/img/logo.png" alt="TLT Logo" onerror="this.style.display='none'">
          The Loading <span>Times</span>
        </a>
        <button class="hamburger" id="hamburger" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
        <ul class="nav-links" id="nav-links">
          <li><a href="/index.html" class="${currentPage === 'index.html' ? 'active' : ''}">Home</a></li>
          <li><a href="/articles.html" class="${currentPage === 'articles.html' ? 'active' : ''}">Articles</a></li>
          <li><a href="/all-categories.html" class="${currentPage === 'all-categories.html' ? 'active' : ''}">Categories</a></li>
          <li><a href="/about.html" class="${currentPage === 'about.html' ? 'active' : ''}">About</a></li>
          <li><a href="/contact.html" class="${currentPage === 'contact.html' ? 'active' : ''}">Contact</a></li>
        </ul>
        <form class="header-search" onsubmit="handleHeaderSearch(event)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="search" placeholder="Search articles..." id="header-search-input">
        </form>
      </div>
    </div>
  `;

  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('nav-links').classList.toggle('open');
  });
}

function handleHeaderSearch(e) {
  e.preventDefault();
  const q = document.getElementById('header-search-input').value.trim();
  if (q) window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
}

// ── FOOTER ──────────────────────────────────────────────────────
async function renderFooter() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  const year = new Date().getFullYear();
  el.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="/index.html" class="logo">The Loading <span>Times</span></a>
          <p>News that takes its time. And yours.<br>Independent journalism, delivered slow.</p>
        </div>
        <div class="footer-col">
          <h4>Navigate</h4>
          <ul>
            <li><a href="/index.html">Home</a></li>
            <li><a href="/articles.html">All Articles</a></li>
            <li><a href="/all-categories.html">Categories</a></li>
            <li><a href="/search.html">Search</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Company</h4>
          <ul>
            <li><a href="/about.html">About Us</a></li>
            <li><a href="/contact.html">Contact</a></li>
            <li><a href="/write-for-us.html">Write For Us</a></li>
            <li><a href="/newsletter.html">Newsletter</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4>Legal</h4>
          <ul>
            <li><a href="/policy.html">Privacy Policy</a></li>
            <li><a href="/terms.html">Terms of Use</a></li>
            <li><a href="/faq.html">FAQ</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${year} The Loading Times. All rights reserved.</span>
        <span>Built with Cloudflare Workers + Firebase</span>
      </div>
    </div>
  `;
}

// ── HERO SLIDER ─────────────────────────────────────────────────
function initHeroSlider(containerEl) {
  const track = containerEl.querySelector('.hero-slider-track');
  if (!track) return;
  let slides = Array.from(containerEl.querySelectorAll('.hero-slide'));
  if (slides.length <= 1) return;

  const dots = containerEl.querySelectorAll('.hero-dot');
  const prevBtn = containerEl.querySelector('.hero-arrow.prev');
  const nextBtn = containerEl.querySelector('.hero-arrow.next');
  const timerBar = containerEl.querySelector('.hero-timer-bar');
  const DURATION = 5000;
  let current = 1;
  let transitioning = false;
  let raf, startTime, remaining = DURATION, paused = false;

  const firstClone = slides[0].cloneNode(true);
  const lastClone = slides[slides.length - 1].cloneNode(true);
  track.appendChild(firstClone);
  track.insertBefore(lastClone, slides[0]);
  slides = containerEl.querySelectorAll('.hero-slide');
  track.style.transform = `translateX(-100%)`;

  function updateDots(idx) {
    dots.forEach(d => d.classList.remove('active'));
    let di = idx - 1;
    if (di < 0) di = dots.length - 1;
    if (di >= dots.length) di = 0;
    if (dots[di]) dots[di].classList.add('active');
  }

  function go(idx) {
    if (transitioning) return;
    transitioning = true;
    current = idx;
    track.style.transition = 'transform 0.5s ease-in-out';
    track.style.transform = `translateX(-${current * 100}%)`;
    updateDots(current);
    reset();
  }

  track.addEventListener('transitionend', () => {
    transitioning = false;
    if (slides[current]?.id === 'first-clone') { track.style.transition = 'none'; current = 1; track.style.transform = `translateX(-100%)`; }
    else if (slides[current]?.id === 'last-clone') { track.style.transition = 'none'; current = slides.length - 2; track.style.transform = `translateX(-${current * 100}%)`; }
  });

  firstClone.id = 'first-clone';
  lastClone.id = 'last-clone';

  function animate(t) {
    if (paused) { startTime = t; raf = requestAnimationFrame(animate); return; }
    if (!startTime) startTime = t;
    const p = Math.min((t - startTime) / remaining, 1);
    if (timerBar) timerBar.style.width = `${p * 100}%`;
    if (p >= 1) go(current + 1);
    else raf = requestAnimationFrame(animate);
  }

  function reset() {
    cancelAnimationFrame(raf);
    startTime = null; remaining = DURATION;
    if (timerBar) timerBar.style.width = '0%';
    if (!paused) raf = requestAnimationFrame(animate);
  }

  prevBtn?.addEventListener('click', () => go(current - 1));
  nextBtn?.addEventListener('click', () => go(current + 1));
  dots.forEach((d, i) => d.addEventListener('click', () => go(i + 1)));
  containerEl.addEventListener('mouseenter', () => { paused = true; });
  containerEl.addEventListener('mouseleave', () => { paused = false; reset(); });
  raf = requestAnimationFrame(animate);
}

// ── POPUP MODAL ─────────────────────────────────────────────────
async function checkPopup() {
  try {
    const settings = await cachedApi('/api/settings');
    const popup = settings?.popup;
    if (!popup?.enabled) return;

    const lastSeen = localStorage.getItem('tlt_popup_seen');
    if (lastSeen && Date.now() - parseInt(lastSeen) < 86400000) return;

    const el = document.getElementById('welcome-modal');
    if (!el) return;

    document.getElementById('wm-title').textContent = popup.title || 'Welcome';
    document.getElementById('wm-text').textContent = popup.text || '';

    if (popup.image) {
      const img = document.getElementById('wm-image');
      img.src = popup.image;
      img.parentElement.style.display = 'block';
    }
    if (popup.btnText && popup.btnLink) {
      const btn = document.getElementById('wm-btn');
      btn.textContent = popup.btnText;
      btn.href = popup.btnLink;
      btn.parentElement.style.display = 'block';
    }

    el.classList.add('open');
    localStorage.setItem('tlt_popup_seen', Date.now().toString());
  } catch (e) { /* silent */ }
}

// ── INIT ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([renderHeader(), renderFooter()]);
  checkPopup();
});
