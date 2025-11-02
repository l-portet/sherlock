// Set this 👇
const OPENAI_API_KEY = '<API_KEY>';
const RAPIDAPI_KEY  = '<API_KEY>';


// KEYS & OPENAI
const OPENAI_MODEL   = 'gpt-5-nano'; // fast
const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

// RAPIDAPI
const RAPIDAPI_HOST = 'tiktok-api23.p.rapidapi.com';

// Limits / windows
const POSTS_COUNT_LIMIT = 150; // hard safety cap
const STOP_AFTER_POSTS  = 60;  // strict ">" → stops at 61+
const TT_IDS_STORAGE_PREFIX = 'TT_IDS_';
const DAYS_WINDOW = 30;
const ONE_DAY = 24 * 60 * 60 * 1000;

const defaultHeaders = {
  'x-rapidapi-key': RAPIDAPI_KEY,
  'x-rapidapi-host': RAPIDAPI_HOST,
  accept: 'application/json',
};

const cache = { secUid: null, userId: null, posts: null, stats: null, lastFetchedAt: null };

// Logging -------------------------------------------------------------------------
const log = {
  info: (...a) => console.log('%c[TT Stats]%c', 'color:#7dd3fc;font-weight:700', 'color:inherit', ...a),
  step: (...a) => console.log('%c[Flow]%c', 'color:#a78bfa;font-weight:700', 'color:inherit', ...a),
  ok:   (...a) => console.log('%c[OK]%c', 'color:#34d399;font-weight:700', 'color:inherit', ...a),
  warn: (...a) => console.warn('%c[Warn]%c', 'color:#fbbf24;font-weight:700', 'color:inherit', ...a),
  err:  (...a) => console.error('%c[Error]%c', 'color:#f87171;font-weight:700', 'color:inherit', ...a),
};

// Number formatting ---------------------------------------------------------------
const nfCompact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const nfFull = new Intl.NumberFormat('en');
const fmtCompact = (n) => nfCompact.format(Math.round(n || 0));
const fmtFull = (n) => nfFull.format(Math.round(n || 0));
const fmtPct = (n) => `${(n * 100).toFixed(2)}%`;

// Profile detection ---------------------------------------------------------------
const isProfilePage = () => {
  const path = location.pathname.replace(/\/+$/, '');
  return /^\/@[^/]+$/.test(path);
};
const getUsername = () => {
  const m = location.pathname.match(/^\/@([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

// Loader helpers ------------------------------------------------------------------
const setLoader = (msg) => { const lbl = document.getElementById('sh_loader-label'); if (lbl) lbl.textContent = msg || 'Loading'; };
const showLoader = () => document.getElementById('sh_stats-loader')?.classList.remove('sh_hidden');
const hideLoader = () => document.getElementById('sh_stats-loader')?.classList.add('sh_hidden');

// --- thumbs & brand-mention helpers ---
const pickUrl = (...vals) => vals.find(v => typeof v === 'string' && /^https?:\/\//.test(v)) || null;
const fromList = (obj, key) => (Array.isArray(obj?.[key]) && obj[key].length ? pickUrl(...obj[key]) : null);
const extractThumb = (p) => {
  const v = p.video || p.aweme?.video || {};
  return (
    pickUrl(p.cover, p.originCover, p.dynamicCover, p.thumbnail, p.thumbnail_url, p.coverUrl, p.cover_url) ||
    pickUrl(v.cover, v.coverUrl, v.cover_url, v.originCover, v.dynamicCover, v.poster) ||
    fromList(v, 'cover') || fromList(v, 'coverUrl') || fromList(v, 'originCover') || fromList(v, 'dynamicCover') ||
    fromList(v, 'shareCover') || null
  );
};
const firstHandle = (caption='') => {
  const m = caption.match(/@([a-z0-9._-]+)/i);
  return m ? m[1] : null;
};
const prettyBrandFromHandle = (h) => h ? h.replace(/[._-]+/g,' ').replace(/\b\w/g, c => c.toUpperCase()) : null;
const truncate = (s, n = 160) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// Normalize TikTok post -----------------------------------------------------------
const normalizePost = (p) => {
  const tsSec = p.createTime ?? p.create_time ?? p.create_time_utc ?? p.timestamp ?? p.time ?? null;
  const takenAtISO = tsSec ? new Date(Number(tsSec) * 1000).toISOString() : null;

  const stats = p.stats || p.statistics || {};
  const play = stats.playCount ?? p.play_count ?? p.playCount ?? stats.play_count ?? 0;
  const digg = stats.diggCount ?? p.digg_count ?? p.like_count ?? stats.digg_count ?? 0;
  const comments = stats.commentCount ?? p.comment_count ?? stats.comment_count ?? 0;

  const rawCaption =
    (typeof p.desc === 'string' && p.desc) ||
    (typeof p.title === 'string' && p.title) ||
    (typeof p.text === 'string' && p.text) ||
    (typeof p.caption === 'string' && p.caption) ||
    (p?.shareMeta?.desc || '') || '';

  const id = String(
    p.id ?? p.aweme_id ?? p.awemeId ?? p?.aweme?.aweme_id ?? p?.video?.id ?? p.group_id ?? ''
  );

  return {
    id,
    taken_at: takenAtISO,
    play_count: Number(play) || 0,
    like_count: Number(digg) || 0,
    comment_count: Number(comments) || 0,
    caption: rawCaption.trim(),
    thumb: extractThumb(p) || null,
  };
};

// Fetch user IDs (secUid & userId) ------------------------------------------------
const fetchUserIds = async () => {
  if (cache.secUid && cache.userId) {
    log.ok('IDs (cache)', { secUid: cache.secUid, userId: cache.userId });
    return { secUid: cache.secUid, userId: cache.userId };
  }

  const username = getUsername();
  if (!username) throw new Error('Not on a TikTok profile.');

  const lsKey = `${TT_IDS_STORAGE_PREFIX}${username}`;
  try {
    const raw = localStorage.getItem(lsKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.secUid) {
        cache.secUid = parsed.secUid;
        cache.userId = parsed.userId || null;
        log.ok('IDs (localStorage)', parsed);
        return parsed;
      }
    }
  } catch {}

  const url = `https://${RAPIDAPI_HOST}/api/user/info?uniqueId=${encodeURIComponent(username)}`;
  setLoader('Fetching user IDs');
  showLoader();
  log.step('User → fetch', { username, url });

  const t0 = performance.now();
  const res = await fetch(url, { method: 'GET', headers: defaultHeaders });
  const dt = Math.round(performance.now() - t0);

  if (!res.ok) {
    log.err('User HTTP', res.status, `${dt}ms`);
    throw new Error(`User HTTP ${res.status}`);
  }

  const data = await res.json();

  const u =
    data?.userInfo?.user ??
    data?.data?.userInfo?.user ??
    data?.data?.user ??
    data?.user ??
    data?.data ??
    null;

  const secUid =
    u?.secUid ?? u?.sec_uid ?? data?.secUid ?? data?.data?.secUid ?? null;

  const userId =
    u?.id ?? u?.userId ?? u?.uid ?? data?.userId ?? data?.data?.userId ?? null;

  if (!secUid) {
    log.err('User parse ✗', data);
    throw new Error('Could not resolve secUid from API response');
  }

  const ids = { secUid, userId };
  cache.secUid = secUid;
  cache.userId = userId;

  try { localStorage.setItem(lsKey, JSON.stringify(ids)); } catch {}
  log.ok('User IDs ✓', { ...ids, dt: `${dt}ms` });
  return ids;
};

// Fetch posts (cursor-based; no date cutoff) -------------------------------------
const fetchPosts = async ({ secUid, userId }) => {
  if (cache.posts) {
    const ageSec = Math.round((Date.now() - (cache.lastFetchedAt || Date.now())) / 1000);
    log.ok('Posts (cache)', cache.posts.length, `age=${ageSec}s`);
    return cache.posts;
  }

  setLoader('Fetching posts… (chunk 1)');
  showLoader();
  let cursor = '0';
  let chunkIndex = 0;
  const posts = [];
  const CHUNK_SIZE = 30;

  log.step('Posts → start', { secUid, userId, limit: POSTS_COUNT_LIMIT, stopAfterPosts: STOP_AFTER_POSTS });

  while (true) {
    chunkIndex += 1;

    const url = new URL(`https://${RAPIDAPI_HOST}/api/user/posts`);
    url.searchParams.set('secUid', secUid);
    url.searchParams.set('count', String(CHUNK_SIZE));
    url.searchParams.set('cursor', cursor);
    if (userId) { url.searchParams.set('userId', userId); url.searchParams.set('user_id', userId); }

    log.info(`Chunk ${chunkIndex} → GET`, url.toString());

    const t0 = performance.now();
    const res = await fetch(url.toString(), { method: 'GET', headers: defaultHeaders });
    const dt = Math.round(performance.now() - t0);

    if (!res.ok) {
      log.err('Posts HTTP', res.status, 'chunk', chunkIndex, `${dt}ms`);
      throw new Error(`Posts HTTP ${res.status}`);
    }

    const body = await res.json();
    const d = body?.data || body;

    const rawList = d?.itemList || d?.items || d?.aweme_list || d?.videos || d?.postList || [];
    const chunk = Array.isArray(rawList) ? rawList.map(normalizePost) : [];

    const hasMore =
      (typeof d?.hasMore === 'boolean' && d.hasMore) ||
      (typeof d?.has_more === 'boolean' && d.has_more) ||
      (typeof d?.hasMore === 'string' && d.hasMore === 'true');

    const nextCursor = d?.cursor ?? d?.nextCursor ?? d?.maxCursor ?? null;

    posts.push(...chunk);
    cursor = (hasMore && nextCursor != null) ? String(nextCursor) : '';

    log.ok(`Chunk ${chunkIndex} ✓`, `+${chunk.length} posts`, `cursor=${cursor}`, `${dt}ms`);
    setLoader(`Fetching posts… (chunk ${chunkIndex}, total ${posts.length})`);

    const reachedEnd = !hasMore || !cursor;
    const hitLimit   = posts.length >= POSTS_COUNT_LIMIT;
    const minCount   = posts.length > STOP_AFTER_POSTS; // strict ">"

    if (reachedEnd || hitLimit || minCount) {
      const reasons = [];
      if (reachedEnd) reasons.push('no_cursor');
      if (hitLimit) reasons.push('limit');
      if (minCount) reasons.push('min_count_reached');
      log.step('Posts → stop', { chunks: chunkIndex, total: posts.length, reasons });
      break;
    }

    if (chunk.length === 0) {
      log.warn('Empty chunk; stopping to avoid loop');
      break;
    }
  }

  cache.posts = posts;
  cache.lastFetchedAt = Date.now();
  return posts;
};

// Stats --------------------------------------------------------------------------
const computeStats = (posts) => {
  if (cache.stats) {
    log.ok('Stats (cache)', cache.stats);
    return cache.stats;
  }

  setLoader('Computing stats');
  log.step('Stats → compute', { inputPosts: posts.length });

  const now = new Date();
  const NOW_MS = now.getTime();
  const THREE_DAYS = 3 * ONE_DAY;

  // Avg Posts / Day (last DAYS_WINDOW days, exclude today)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const daysForAvg = Math.max(DAYS_WINDOW - 1, 1);
  const windowStart = todayStart - daysForAvg * ONE_DAY;

  const windowPostsExclToday = posts.filter((p) => {
    const ts = new Date(p.taken_at).getTime();
    return Number.isFinite(ts) && ts >= windowStart && ts < todayStart;
  });

  const avgPostsPerDay = windowPostsExclToday.length / daysForAvg;

  // Other stats (posts ≥ 3 days old)
  const oldPosts = posts.filter((p) => {
    const ts = new Date(p.taken_at).getTime();
    return Number.isFinite(ts) && (NOW_MS - ts) > THREE_DAYS;
  });

  const views = oldPosts.map((p) => p.play_count || 0);
  const engagementRates = oldPosts
    .filter((p) => (p.play_count || 0) > 0)
    .map((p) => (p.like_count + p.comment_count) / p.play_count);

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const median = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const stats = {
    sampleSize: oldPosts.length,
    avgPostsPerDay,
    avgViews: Math.round(avg(views)),
    medViews: Math.round(median(views)),
    avgEngagementRate: avg(engagementRates),
    medEngagementRate: median(engagementRates),
  };

  log.ok('Stats ✓', {
    sampleSize: stats.sampleSize,
    avgPostsPerDay: stats.avgPostsPerDay,
    avgViews: stats.avgViews,
    medViews: stats.medViews,
    avgER: stats.avgEngagementRate,
    medER: stats.medEngagementRate
  });

  cache.stats = stats;
  return stats;
};

// Activity grid helpers ----------------------------------------------------------
const toISODate = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);

const computeDailyCounts = (posts, days = DAYS_WINDOW) => {
  setLoader('Building activity grid');
  log.step('Activity → compute', { days, posts: posts.length });

  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * ONE_DAY);
  const counts = new Map();
  for (const p of posts) {
    const dt = new Date(p.taken_at);
    if (!Number.isFinite(dt.getTime())) continue;
    const key = toISODate(dt);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const series = [];
  for (let t = start.getTime(); t <= end.getTime(); t += ONE_DAY) {
    const d = new Date(t);
    const key = toISODate(d);
    series.push({ date: new Date(d), count: counts.get(key) || 0 });
  }
  const max = series.reduce((m, x) => Math.max(m, x.count), 0);

  log.ok('Activity ✓', { days: series.length, maxCountInDay: max });
  return { series, max };
};

const levelFor = (count, max) => {
  if (!count) return 0;
  if (max <= 1) return count ? 2 : 0;
  const r = count / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
};

// Tooltip helpers ----------------------------------------------------------------
const tooltipEl = () => document.getElementById('sh_igstats-tooltip');
const showTooltip = (html, x, y) => { const tip = tooltipEl(); if (!tip) return; tip.innerHTML = html; tip.classList.remove('sh_hidden'); positionTooltip(x, y); };
const positionTooltip = (x, y) => { const tip = tooltipEl(); if (!tip) return; const pad = 12; const rect = tip.getBoundingClientRect(); let nx = x + pad; let ny = y + pad; if (nx + rect.width > window.innerWidth - 8) nx = x - rect.width - pad; if (ny + rect.height > window.innerHeight - 8) ny = y - rect.height - pad; tip.style.left = `${nx}px`; tip.style.top = `${ny}px`; };
const hideTooltip = () => tooltipEl()?.classList.add('sh_hidden');

// Drawer UI ----------------------------------------------------------------------
const ensureDrawer = () => {
  let drawer = document.getElementById('sh_stats-drawer');
  if (drawer) return drawer;
  drawer = document.createElement('div');
  drawer.id = 'sh_stats-drawer';
  drawer.innerHTML = `
    <div class="sh_drawer-content">
      <div class="sh_drawer-header">
        <h3>🔎 Sherlock / Influencer Stats</h3>
        <div class="sh_header-actions">
          <button id="sh_refresh-stats" title="Refresh">↻</button>
          <button id="sh_close-drawer" aria-label="Close">×</button>
        </div>
      </div>
      <div id="sh_drawer-body">
        <div class="sh_loader sh_hidden" id="sh_stats-loader" aria-live="polite">
          <div class="sh_spinner"></div>
          <div class="sh_loader-label" id="sh_loader-label">Loading</div>
        </div>
        <div id="sh_stats-cards" class="sh_hidden"></div>

        <!-- Activity -->
        <div id="sh_activity" class="sh_hidden" style="--cell: 12px; --gap: 3px;">
          <div class="sh_activity-header">Activity (last ${DAYS_WINDOW} days)</div>
          <div class="sh_activity-layout sh_fullwidth">
            <div class="sh_x-axis-top" id="sh_x-axis-top"></div>
            <div class="sh_activity-grid" id="sh_activity-grid" role="grid" aria-label="Posts in last ${DAYS_WINDOW} days"></div>
          </div>
          <div class="sh_activity-legend">
            <span>0</span>
            <span class="sh_legend-box sh_level-0"></span>
            <span class="sh_legend-box sh_level-1"></span>
            <span class="sh_legend-box sh_level-2"></span>
            <span class="sh_legend-box sh_level-3"></span>
            <span class="sh_legend-box sh_level-4"></span>
            <span>4+</span>
          </div>
        </div>

        <!-- Views chart -->
        <div id="sh_views" class="sh_hidden">
          <div class="sh_views-header">Views (last <span id="sh_views-count">–</span> posts)</div>
          <div class="sh_views-chart-wrap" id="sh_views-wrap">
            <div class="sh_views-ylabs" id="sh_views-ylabs">
              <span id="sh_ylab-max"></span>
              <span id="sh_ylab-mid"></span>
              <span id="sh_ylab-min">0</span>
            </div>
            <div class="sh_views-avglab" id="sh_views-avglab">–</div>
            <svg id="sh_views-spark" class="sh_views-spark" preserveAspectRatio="none"></svg>
          </div>
          <div class="sh_views-axis">
            <div id="sh_views-min" class="sh_axis-label"></div>
            <div id="sh_views-max" class="sh_axis-label"></div>
          </div>
        </div>

        <!-- Paid partnerships -->
        <div id="sh_paid" class="sh_hidden">
          <div class="sh_paid-header">Paid partnerships (AI detection)</div>
          <div class="sh_loader sh_hidden" id="sh_paid-loader" aria-live="polite">
            <div class="sh_spinner"></div>
            <div class="sh_loader-label">Analyzing promos</div>
          </div>
          <div id="sh_paid-list"></div>
        </div>

        <div id="sh_stats-error" class="sh_hidden"></div>
        <div id="sh_igstats-tooltip" class="sh_tooltip sh_hidden" role="tooltip"></div>
      </div>
    </div>
  `;
  document.body.appendChild(drawer);
  drawer.querySelector('#sh_close-drawer').addEventListener('click', closeDrawer);
  drawer.querySelector('#sh_refresh-stats').addEventListener('click', async () => {
    log.step('Refresh clicked → invalidate cache');
    cache.posts = null; cache.stats = null;
    await fetchAndRenderStats(true);
  });
  return drawer;
};

const openDrawer = () => { const drawer = ensureDrawer(); drawer.classList.add('sh_open'); };
const closeDrawer = () => { const drawer = document.getElementById('sh_stats-drawer'); if (!drawer) return; drawer.classList.remove('sh_open'); };

const resetDrawerState = () => {
  showLoader(); setLoader('Starting');
  const cards = document.getElementById('sh_stats-cards');
  const activity = document.getElementById('sh_activity');
  const grid = document.getElementById('sh_activity-grid');
  const xTop = document.getElementById('sh_x-axis-top');
  const error = document.getElementById('sh_stats-error');
  const paid = document.getElementById('sh_paid');
  const paidList = document.getElementById('sh_paid-list');
  const paidLoader = document.getElementById('sh_paid-loader');
  if (cards) { cards.classList.add('sh_hidden'); cards.innerHTML = ''; }
  if (activity) activity.classList.add('sh_hidden');
  if (grid) grid.innerHTML = '';
  if (xTop) xTop.innerHTML = '';
  if (error) { error.classList.add('sh_hidden'); error.textContent = ''; }
  if (paid) paid.classList.add('sh_hidden');
  if (paidList) paidList.innerHTML = '';
  if (paidLoader) paidLoader.classList.add('sh_hidden');

  // Views reset
  const views = document.getElementById('sh_views');
  const spark = document.getElementById('sh_views-spark');
  const viewsCount = document.getElementById('sh_views-count');
  const vmin = document.getElementById('sh_views-min');
  const vmax = document.getElementById('sh_views-max');
  if (views) views.classList.add('sh_hidden');
  if (spark) spark.innerHTML = '';
  if (viewsCount) viewsCount.textContent = '–';
  if (vmin) vmin.textContent = '';
  if (vmax) vmax.textContent = '';
};

// Stat cards ---------------------------------------------------------------------
const statCard = (label, display, title, hint = '') => `
  <div class="sh_stat" title="${title}">
    <div class="sh_label">${label}</div>
    <div class="sh_value" data-tooltip="${title}">${display}</div>
    ${hint ? `<div class=\"sh_hint\">${hint}</div>` : ''}
  </div>
`;

const renderStats = (stats) => {
  hideLoader();
  const cards = document.getElementById('sh_stats-cards');
  cards.classList.remove('sh_hidden');
  cards.innerHTML = `
    <div class="sh_stat-grid">
      ${statCard('Sample Size', fmtCompact(stats.sampleSize), fmtFull(stats.sampleSize), 'posts ≥ 3 days old')}
      ${statCard('Avg Posts / Day', stats.avgPostsPerDay.toFixed(2), stats.avgPostsPerDay.toString(), 'based on posts ≥ 1 day old')}
      ${statCard('Avg Views', fmtCompact(stats.avgViews), fmtFull(stats.avgViews))}
      ${statCard('Median Views', fmtCompact(stats.medViews), fmtFull(stats.medViews))}
      ${statCard('Avg Engagement', fmtPct(stats.avgEngagementRate), (stats.avgEngagementRate).toString())}
      ${statCard('Median Engagement', fmtPct(stats.medEngagementRate), (stats.medEngagementRate).toString())}
    </div>
  `;
  cards.querySelectorAll('.sh_value').forEach((el) => {
    el.addEventListener('mouseenter', (e) => showTooltip(el.getAttribute('data-tooltip') || '', e.clientX, e.clientY));
    el.addEventListener('mousemove', (e) => positionTooltip(e.clientX, e.clientY));
    el.addEventListener('mouseleave', hideTooltip);
  });
};

// Activity grid ------------------------------------------------------------------
const renderActivity = (posts) => {
  const { series, max } = computeDailyCounts(posts, DAYS_WINDOW);
  const activityWrap = document.getElementById('sh_activity');
  const grid = document.getElementById('sh_activity-grid');
  const xTop = document.getElementById('sh_x-axis-top');
  activityWrap.classList.remove('sh_hidden');

  xTop.classList.add('sh_fullwidth');
  grid.classList.add('sh_fullwidth');

  const weekdays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  xTop.innerHTML = weekdays.map(d => `<div class="sh_x-top-tick">${d}</div>`).join('');

  const firstIdx = (series.length ? ((series[0].date.getDay() + 6) % 7) : 0);

  grid.innerHTML = '';
  for (let i = 0; i < firstIdx; i++) {
    const cell = document.createElement('div'); cell.className = 'sh_cell sh_empty'; grid.appendChild(cell);
  }

  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
  for (const d of series) {
    const lvl = levelFor(d.count, max);
    const cell = document.createElement('div');
    cell.className = `sh_cell sh_level-${lvl}`;
    const dateStr = `${monthFmt.format(d.date)} ${d.date.getDate()}, ${d.date.getFullYear()}`;
    const html = `<b>${dateStr}</b><br/>${d.count} post${d.count === 1 ? '' : 's'}`;
    cell.addEventListener('mouseenter', (e) => showTooltip(html, e.clientX, e.clientY));
    cell.addEventListener('mousemove', (e) => positionTooltip(e.clientX, e.clientY));
    cell.addEventListener('mouseleave', hideTooltip);
    grid.appendChild(cell);
  }
};

// Views sparkline ----------------------------------------------------------------
const renderViewsChart = (posts) => {
  const wrap = document.getElementById('sh_views');
  const svg = document.getElementById('sh_views-spark');
  const wrapDiv = document.getElementById('sh_views-wrap');
  const countEl = document.getElementById('sh_views-count');
  const vMinEl = document.getElementById('sh_views-min');
  const vMaxEl = document.getElementById('sh_views-max');
  const avgLab = document.getElementById('sh_views-avglab');
  const yMaxEl = document.getElementById('sh_ylab-max');
  const yMidEl = document.getElementById('sh_ylab-mid');
  const yMinEl = document.getElementById('sh_ylab-min');
  if (!wrap || !svg || !wrapDiv) return;

  const sorted = [...posts]
    .filter(p => Number.isFinite(new Date(p.taken_at).getTime()))
    .sort((a,b) => new Date(a.taken_at) - new Date(b.taken_at));
  const series = sorted.slice(-30).map(p => ({
    date: new Date(p.taken_at),
    views: Number(p.play_count) || 0,
  }));
  const N = series.length;
  if (!N) { wrap.classList.add('sh_hidden'); return; }

  const maxV = series.reduce((m,x)=>Math.max(m,x.views), 0) || 1;

  const THREE_DAYS = 3 * ONE_DAY;
  const postsOld = posts.filter(p => {
    const ts = new Date(p.taken_at).getTime();
    return Number.isFinite(ts) && (Date.now() - ts) > THREE_DAYS;
  });
  const avgPerPostAllOld = postsOld.length
    ? postsOld.reduce((a, p) => a + (p.play_count || 0), 0) / postsOld.length
    : 0;
  const avgForLine = (cache.stats && Number.isFinite(cache.stats.avgViews))
    ? cache.stats.avgViews
    : avgPerPostAllOld;

  const HEIGHT = 100;
  svg.setAttribute('viewBox', `0 0 ${N} ${HEIGHT}`);

  const yAt = (val) => HEIGHT - (val / maxV) * HEIGHT;
  const parts = [];

  parts.push(`<line class="sh_gridline" x1="0" x2="${N}" y1="${HEIGHT}" y2="${HEIGHT}"/>`);
  parts.push(`<line class="sh_gridline" x1="0" x2="${N}" y1="${HEIGHT / 2}" y2="${HEIGHT / 2}"/>`);
  parts.push(`<line class="sh_gridline" x1="0" x2="${N}" y1="0" y2="0"/>`);

  series.forEach((d, i) => {
    const y = yAt(d.views);
    const h = Math.max(HEIGHT - y, 0);
    parts.push(`<rect class="sh_bar sh_bar-view" data-idx="${i}" x="${i}" y="${y}" width="0.9" height="${h}" rx="0.6" ry="0.6"></rect>`);
  });

  const yAvg = yAt(avgForLine);
  parts.push(`<line class="sh_avg-line" x1="0" x2="${N}" y1="${yAvg}" y2="${yAvg}"></line>`);

  svg.innerHTML = parts.join('');

  if (yMaxEl) yMaxEl.textContent = fmtCompact(maxV);
  if (yMidEl) yMidEl.textContent = fmtCompact(maxV / 2);
  if (yMinEl) yMinEl.textContent = '0';
  if (avgLab) {
    avgLab.textContent = `${fmtCompact(avgForLine)} avg`;
    requestAnimationFrame(() => {
      const sr = svg.getBoundingClientRect();
      const wr = wrapDiv.getBoundingClientRect();
      const yPx = sr.top + (yAvg / HEIGHT) * sr.height;
      avgLab.style.top = `${Math.round(yPx - wr.top)}px`;
    });
  }

  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const rect = () => svg.getBoundingClientRect();
  const idxFromClientX = (cx) => {
    const r = rect();
    const relX = Math.min(Math.max(cx - r.left, 0), r.width);
    const unit = r.width / N;
    return Math.max(0, Math.min(N - 1, Math.round(relX / unit)));
  };
  const showIndex = (i, clientX, clientY) => {
    const d = series[i];
    const dateStr = `${monthFmt.format(d.date)} ${d.date.getDate()}, ${d.date.getFullYear()}`;
    showTooltip(`<b>${dateStr}</b><br/>${fmtFull(d.views)} views`, clientX, clientY);
    svg.querySelectorAll('.sh_bar-view').forEach((el, j) => {
      if (j === i) { el.setAttribute('stroke', '#93c5fd'); el.setAttribute('stroke-width', '0.08'); }
      else { el.removeAttribute('stroke'); el.removeAttribute('stroke-width'); }
    });
  };
  wrapDiv.addEventListener('mousemove', (e) => {
    const r = rect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    const i = idxFromClientX(e.clientX);
    showIndex(i, e.clientX, e.clientY);
  });
  wrapDiv.addEventListener('mouseleave', () => {
    hideTooltip();
    svg.querySelectorAll('.sh_bar-view').forEach((el) => { el.removeAttribute('stroke'); el.removeAttribute('stroke-width'); });
  });

  if (countEl) countEl.textContent = String(N);
  if (vMinEl) vMinEl.textContent = '0';
  if (vMaxEl) vMaxEl.textContent = fmtCompact(maxV);

  wrap.classList.remove('sh_hidden');
};

// ==== Paid partnership detection (no timeout, no fallback, no max_tokens) =======
const buildPostUrl = (post) => {
  const username = getUsername();
  if (!username || !post?.id) return null;
  return `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${post.id}`;
};

const last30Posts = (posts) =>
  [...posts]
    .filter(p => Number.isFinite(new Date(p.taken_at).getTime()))
    .sort((a,b) => new Date(a.taken_at) - new Date(b.taken_at))
    .slice(-30);

// Robust JSON parsing ------------------------------------------------------------
const parseJsonLoose = (txt) => {
  if (!txt) return null;
  try {
    const cleaned = String(txt).trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    try {
      const s = txt.indexOf('['), e = txt.lastIndexOf(']');
      if (s >= 0 && e >= s) return JSON.parse(txt.slice(s, e + 1));
    } catch {}
  }
  return null;
};

const llmDetectPromos = async (posts) => {
  const items = last30Posts(posts).map((p, i) => ({
    i,
    caption: (p.caption || '').slice(0, 320), // lean payload
  }));

  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY for promo detection.');
  if (!items.length) return [];

  const sys = `You detect paid promos in TikTok captions. Consider clear disclosures (#ad, sponsored) and salesy CTAs.
Return JSON object with "results": array of {i,is_promo,brand,category,confidence}`;
  const user = `Decide for these (index+caption only):\n${JSON.stringify(items)}`;

  const r = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
    }),
  });

  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = parseJsonLoose(content) ?? {};
  const arr =
    Array.isArray(parsed) ? parsed :
    Array.isArray(parsed.results) ? parsed.results :
    Array.isArray(parsed.data) ? parsed.data :
    Array.isArray(parsed.items) ? parsed.items : [];

  const byIndex = new Map(arr.map(x => [x.i, x]));
  return items.map(it => {
    const ai = byIndex.get(it.i) || {};
    const h = firstHandle(it.caption);
    const forced = !!h;
    return {
      i: it.i,
      is_promo: forced || !!ai.is_promo,
      brand: forced ? (prettyBrandFromHandle(h) || ai.brand || null) : (ai.brand || null),
      category: forced ? (ai.category || 'brand') : (ai.category || null),
      confidence: forced ? Math.max(0.85, Number(ai.confidence || 0)) : Number(ai.confidence || 0) || 0,
    };
  });
};

const renderPaidPromos = async (posts) => {
  const wrap = document.getElementById('sh_paid');
  const list = document.getElementById('sh_paid-list');
  const loader = document.getElementById('sh_paid-loader');
  if (!wrap || !list) return;

  wrap.classList.remove('sh_hidden');
  list.innerHTML = '';
  loader?.classList.remove('sh_hidden');

  const last = last30Posts(posts);
  const ai = await llmDetectPromos(posts);

  loader?.classList.add('sh_hidden');

  const joined = ai.map((x) => ({
    ...x,
    post: last[x.i],
    url: buildPostUrl(last[x.i]),
  })).filter(x => x.post);

  const promos = joined.filter(x => x.is_promo).sort((a,b) =>
    new Date(b.post?.taken_at||0) - new Date(a.post?.taken_at||0)
  );

  if (!promos.length) {
    list.innerHTML = `<div class="sh_paid-empty">None detected.</div>`;
    return;
  }

  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
  list.innerHTML = '';
  for (const x of promos) {
    const p = x.post || {};
    const d = p.taken_at ? new Date(p.taken_at) : null;
    const dateStr = d ? `${monthFmt.format(d)} ${d.getDate()}, ${d.getFullYear()}` : '–';
    const thumb = p.thumb;
    const views = Number(p.play_count || 0);
    const er = views > 0 ? ( (Number(p.like_count||0) + Number(p.comment_count||0)) / views ) : null;

    const item = document.createElement('div');
    item.className = 'sh_paid-item';

    const thumbHtml = thumb
      ? `<a class="sh_paid-thumb" href="${x.url}" target="_blank" rel="noopener">
           <img referrerpolicy="no-referrer" src="${thumb}" alt="post thumbnail"/>
         </a>`
      : `<div class="sh_paid-thumb sh_paid-thumb--fallback"></div>`;

    item.innerHTML = `
      ${thumbHtml}
      <div class="sh_paid-body">
        <div class="sh_paid-top">
          <div class="sh_paid-brand">${x.brand || 'Unknown brand/app'}</div>
          <div class="sh_paid-right">${
            x.confidence >= 0.75
              ? '<span class="sh_badge sh_badge-good">Likely</span>'
              : x.confidence >= 0.5
              ? '<span class="sh_badge sh_badge-warn">Maybe</span>'
              : '<span class="sh_badge sh_badge-neutral">Unclear</span>'
          }</div>
        </div>

        <div class="sh_paid-meta">
          <span>${dateStr}</span><span>•</span>
          <span><b>${fmtCompact(views)}</b> views</span>
          <span>•</span>
          <span>ER <b>${er == null ? '—' : fmtPct(er)}</b></span>
        </div>

        <div class="sh_paid-caption">${truncate(p.caption || '', 220)}</div>
      </div>
    `;
    list.appendChild(item);
  }
};

// Error --------------------------------------------------------------------------
const showError = (message) => { hideLoader(); const error = document.getElementById('sh_stats-error'); if (error) { error.classList.remove('sh_hidden'); error.textContent = message; } };

// Orchestrator -------------------------------------------------------------------
const fetchAndRenderStats = async (force = false) => {
  try {
    log.step('Flow → fetchAndRenderStats', { force });
    openDrawer();

    if (!force && cache.posts && cache.stats) {
      log.info('Using cache for render');
      hideLoader();
      renderStats(cache.stats);
      renderActivity(cache.posts);
      renderViewsChart(cache.posts);
      await renderPaidPromos(cache.posts);
      return;
    }

    resetDrawerState();

    const t0 = performance.now();
    const ids = await fetchUserIds();
    const posts = await fetchPosts(ids);
    const stats = computeStats(posts);
    const dt = Math.round(performance.now() - t0);

    log.ok('Flow ✓ fetched & computed', { totalPosts: posts.length, elapsed: `${dt}ms` });

    renderStats(stats);
    renderActivity(posts);
    renderViewsChart(posts);
    await renderPaidPromos(posts);
  } catch (e) {
    log.err('Flow ✗', e);
    showError(e.message || 'Failed to load stats');
  }
};

// Entry button -------------------------------------------------------------------
const buildButtonUI = () => {
  if (document.getElementById('sh_stats-floating-btn')) return;
  const button = document.createElement('button');
  button.id = 'sh_stats-floating-btn';
  button.textContent = 'View Stats';
  button.addEventListener('click', () => fetchAndRenderStats(false));
  document.body.appendChild(button);
};

if (isProfilePage()) buildButtonUI();
