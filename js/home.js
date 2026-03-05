/**
 * src/index.js
 * ─────────────────────────────────────────────────────────────
 * Dashboard logic: load customers + movies, normalize data,
 * train model, run recommendations and render movie cards.
 *
 * Change HOST to switch environments:
 */
const HOST = 'http://localhost:3000';

/* ════════════════════════════════════════════════════════════
   API LAYER
════════════════════════════════════════════════════════════ */

async function apiRequest(path, options = {}) {
    const response = await fetch(`${HOST}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });

    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json();
            message = body.message || body.error || message;
        } catch (_) { /* ignore */ }
        throw new Error(message);
    }

    return response.status === 204 ? null : response.json();
}

const api = {
    customers:    ()           => apiRequest('/customers'),
    movies:       ()           => apiRequest('/movies'),
    interactions: ()           => apiRequest('/interactions'),

    /** POST /ml/normalize  — no body */
    normalize: () => apiRequest('/ml/normalize', { method: 'POST' }),

    /** POST /ml/train  — { units, epochs } */
    train: (units = 128, epochs = 100) =>
        apiRequest('/ml/train', {
            method: 'POST',
            body: JSON.stringify({ units, epochs }),
        }),

    /** POST /ml/predict  — { modelJSON, customerId } */
    predict: (modelJSON, customerId) =>
        apiRequest('/ml/predict', {
            method: 'POST',
            body: JSON.stringify({ modelJSON, customerId }),
        }),
};

/* ════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════ */

let allMovies        = [];     // full movie catalogue from API
let allInteractions  = [];     // all interactions (for past purchases panel)
let savedModelJSON   = null;   // kept in memory after training
let lossChartInst    = null;   // Chart.js instances
let accChartInst     = null;
let isRecommended    = false;  // whether movie list is in rec mode

/* ════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
    // Wire buttons
    document.getElementById('normalizeDataBtn').addEventListener('click', handleNormalize);
    document.getElementById('trainModelBtn').addEventListener('click', handleTrain);
    document.getElementById('runRecommendationBtn').addEventListener('click', handlePredict);

    // User select → show age + past purchases
    document.getElementById('userSelect').addEventListener('change', handleUserChange);

    // Load initial data in parallel
    await Promise.all([loadCustomers(), loadMovies(), loadInteractions()]);
});

/* ════════════════════════════════════════════════════════════
   DATA LOADERS
════════════════════════════════════════════════════════════ */

async function loadCustomers() {
    try {
        const customers = await api.customers();
        const select    = document.getElementById('userSelect');

        customers.forEach(c => {
            const opt = document.createElement('option');
            opt.value       = c.properties.id;
            opt.textContent = c.properties.name;
            opt.dataset.age    = c.properties.age    || '';
            opt.dataset.gender = c.properties.gender || '';
            select.appendChild(opt);
        });
    } catch (err) {
        toast(`Could not load customers: ${err.message}`, 'error');
    }
}

async function loadMovies() {
    try {
        allMovies = await api.movies();
        renderMovieCards(allMovies);
    } catch (err) {
        document.getElementById('movieList').innerHTML = `
            <div class="empty-state col-12">
                <i class="bi bi-exclamation-triangle" style="color:var(--accent-red)"></i>
                Failed to load movies: ${escHtml(err.message)}
            </div>`;
    }
}

async function loadInteractions() {
    try {
        allInteractions = await api.interactions();
        renderAllUsersPurchases(allInteractions);
    } catch (err) {
        // Non-critical — silently ignore
        console.warn('Could not load interactions:', err.message);
    }
}

/* ════════════════════════════════════════════════════════════
   USER SELECT HANDLER
════════════════════════════════════════════════════════════ */

function handleUserChange(e) {
    const select   = e.target;
    const selected = select.options[select.selectedIndex];
    const id       = select.value;

    // Age field
    document.getElementById('userAge').value = selected.dataset.age || '';
    console.log(document.getElementById('userAge').value)

    // Past purchases
    const ppList = document.getElementById('pastPurchasesList');

    if (!id) {
        ppList.innerHTML = `
            <p style="font-family:'Space Mono',monospace;font-size:0.75rem;color:var(--text-muted);">
                Select a user to see their history.
            </p>`;
        return;
    }

    const userInteractions = allInteractions.filter(i => i.properties.customerId === id);

    if (userInteractions.length === 0) {
        ppList.innerHTML = `
            <p style="font-family:'Space Mono',monospace;font-size:0.75rem;color:var(--text-muted);">
                No purchases found for this user.
            </p>`;
        return;
    }

    ppList.innerHTML = userInteractions.map(i => {
        const movie    = allMovies.find(m => m.properties.id === i.properties.movieId);
        const title    = movie ? escHtml(movie.properties.name) : shortUuid(i.properties.movieId);
        const typeClass = (i.properties.type || '').toLowerCase() === 'buy' ? 'pp-type-buy' : 'pp-type-rent';
        const typeLabel = capitalize(i.properties.type || 'unknown');
        const stars     = miniStars(i.properties.rating);

        return `
            <div class="past-purchase-item">
                <span class="pp-title">${title}</span>
                <span class="${typeClass}">${typeLabel}</span>
                &nbsp;·&nbsp;${stars}
                &nbsp;·&nbsp;${formatDate(i.properties.date)}
            </div>`;
    }).join('');
}

/* ════════════════════════════════════════════════════════════
   NORMALIZE
════════════════════════════════════════════════════════════ */

async function handleNormalize() {
    const btn = document.getElementById('normalizeDataBtn');
    const statusEl = document.getElementById('normalizeStatus');

    setButtonLoading(btn, 'Normalizing…');
    setStatus(statusEl, 'info', '<span class="btn-spinner"></span> Running normalization…');

    try {
        await api.normalize();
        setStatus(statusEl, 'success', '<i class="bi bi-check-circle-fill"></i> Data normalized successfully.');
        toast('Data normalized successfully.', 'success');
    } catch (err) {
        setStatus(statusEl, 'error', `<i class="bi bi-x-circle-fill"></i> ${escHtml(err.message)}`);
        toast(`Normalization failed: ${err.message}`, 'error');
    } finally {
        restoreButton(btn, `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="white" style="width:16px;height:16px;">
                <path d="M544 269.8C529.2 279.6 512.2 287.5 494.5 293.8C447.5 310.6 385.8 320 320 320C254.2 320 192.4 310.5 145.5 293.8C127.9 287.5 110.8 279.6 96 269.8L96 352C96 396.2 196.3 432 320 432C443.7 432 544 396.2 544 352L544 269.8zM544 192L544 144C544 99.8 443.7 64 320 64C196.3 64 96 99.8 96 144L96 192C96 236.2 196.3 272 320 272C443.7 272 544 236.2 544 192zM494.5 453.8C447.6 470.5 385.9 480 320 480C254.1 480 192.4 470.5 145.5 453.8C127.9 447.5 110.8 439.6 96 429.8L96 496C96 540.2 196.3 576 320 576C443.7 576 544 540.2 544 496L544 429.8C529.2 439.6 512.2 447.5 494.5 453.8z"/>
            </svg>
            Normalize Data`);
    }
}

/* ════════════════════════════════════════════════════════════
   TRAIN
════════════════════════════════════════════════════════════ */

async function handleTrain() {
    const btn      = document.getElementById('trainModelBtn');
    const statusEl = document.getElementById('trainStatus');

    setButtonLoading(btn, 'Training…');
    setStatus(statusEl, 'info', '<span class="btn-spinner"></span> Training model (units: 128, epochs: 100)…');

    try {
        const result = await api.train(128, 100);

        // Persist model JSON for the predict request
        savedModelJSON = result.model;

        // Enable predict button
        document.getElementById('runRecommendationBtn').disabled = false;

        // Render charts
        renderTrainingCharts(result.history);

        const finalLoss = result.history.loss.at(-1).toFixed(6);
        const finalAcc  = (result.history.acc.at(-1) * 100).toFixed(1);

        setStatus(statusEl, 'success',
            `<i class="bi bi-check-circle-fill"></i> Training complete — loss: ${finalLoss} · accuracy: ${finalAcc}%`);
        toast('Model trained successfully.', 'success');
    } catch (err) {
        setStatus(statusEl, 'error', `<i class="bi bi-x-circle-fill"></i> ${escHtml(err.message)}`);
        toast(`Training failed: ${err.message}`, 'error');
    } finally {
        restoreButton(btn, '<i class="bi bi-cpu"></i> Train Model');
    }
}

/* ════════════════════════════════════════════════════════════
   PREDICT
════════════════════════════════════════════════════════════ */

async function handlePredict() {
    const customerId = document.getElementById('userSelect').value;
    const btn        = document.getElementById('runRecommendationBtn');
    const statusEl   = document.getElementById('predictStatus');

    if (!customerId) {
        setStatus(statusEl, 'error', '<i class="bi bi-exclamation-circle-fill"></i> Please select a user first.');
        toast('Please select a user before running recommendations.', 'error');
        return;
    }

    if (!savedModelJSON) {
        setStatus(statusEl, 'error', '<i class="bi bi-exclamation-circle-fill"></i> Train the model first.');
        toast('Train the model first.', 'error');
        return;
    }

    setButtonLoading(btn, 'Predicting…');
    setStatus(statusEl, 'info', '<span class="btn-spinner"></span> Running recommendation engine…');

    try {
        const result = await api.predict(savedModelJSON, customerId);

        // result is expected to be an array of movies (with optional score field),
        // or an object with a movies/recommendations array.
        const recommended = normalizeRecommendationResult(result);

        renderRecommendedMovies(recommended, customerId);

        setStatus(statusEl, 'success',
            `<i class="bi bi-stars"></i> ${recommended.length} movies recommended for this user.`);
        toast(`${recommended.length} recommendations ready.`, 'success');
    } catch (err) {
        setStatus(statusEl, 'error', `<i class="bi bi-x-circle-fill"></i> ${escHtml(err.message)}`);
        toast(`Prediction failed: ${err.message}`, 'error');
    } finally {
        restoreButton(btn, `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"
                stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="8" cy="7" r="4.5"/>
                <path d="M5 12h6"/><path d="M6 13h4"/>
                <path d="M6 5.5c.6-.7 1.2-1 2-1"/>
            </svg>
            Run Recommendation`);
    }
}

/**
 * Normalise whatever shape the /ml/predict response has into
 * a flat array of movie objects (with an optional `score` field).
 *
 * Handles:
 *   - Array of movie objects directly
 *   - { movies: [...] }
 *   - { recommendations: [...] }
 *   - Array of { movieId, score } → merged with allMovies
 */
function normalizeRecommendationResult(result) {
    if (!result) return [];

    // Flat array
    if (Array.isArray(result)) {
        // Array of { movieId, score } stubs → merge with allMovies
        if (result.length > 0 && result[0].movieId && !result[0].name) {
            return result
                .map(r => {
                    const movie = allMovies.find(m => m.properties.id === r.movieId);
                    return movie ? { ...movie, score: r.score ?? r.prediction ?? null } : null;
                })
                .filter(Boolean);
        }
        return result;
    }

    // Object with known keys
    const arr = result.movies || result.recommendations || result.data || [];
    if (Array.isArray(arr)) return normalizeRecommendationResult(arr);

    return [];
}

/* ════════════════════════════════════════════════════════════
   MOVIE CARD RENDERING
════════════════════════════════════════════════════════════ */

function renderMovieCards(movies) {
    const list = document.getElementById('movieList');

    if (!movies || movies.length === 0) {
        list.innerHTML = `
            <div class="empty-state col-12">
                <i class="bi bi-film"></i>No movies found.
            </div>`;
        return;
    }

    list.innerHTML = movies.map(m => movieCardHTML(m, false, null)).join('');
    isRecommended  = false;
    hideBanner();
}

function renderRecommendedMovies(recommended, customerId) {
    if (!recommended || recommended.length === 0) {
        toast('No recommendations returned.', 'info');
        return;
    }

    isRecommended = true;

    // Build a score map for quick lookup
    const scoreMap = {};
    recommended.forEach(r => {
        if (r.id) scoreMap[r.id] = r.score;
    });

    // Recommended IDs set (for ordering)
    const recIds = new Set(recommended.map(r => r.id));

    // Put recommended first, then the rest
    const recMovies  = recommended;
    const restMovies = allMovies.filter(m => !recIds.has(m.id));
    const ordered    = [...recMovies, ...restMovies];

    document.getElementById('movieList').innerHTML =
        ordered.map((m, idx) => {
            const isRec = recIds.has(m.id);
            const score = isRec ? scoreMap[m.id] : null;
            return movieCardHTML(m, isRec, score, idx + 1);
        }).join('');

    // Animate score bars after DOM update
    requestAnimationFrame(() => {
        document.querySelectorAll('.movie-score-fill').forEach(bar => {
            const target = bar.dataset.score;
            if (target != null) bar.style.width = `${Math.min(parseFloat(target) * 100, 100)}%`;
        });
    });

    // Show the recommendation banner
    const select     = document.getElementById('userSelect');
    const userName   = select.options[select.selectedIndex]?.text || 'this user';
    showBanner(`Showing ${recommended.length} personalised recommendations for ${escHtml(userName)}`);
}

function movieCardHTML(m, isRec, score, rank) {
    const stars = miniStars(m.properties.rating);
    const scorePercent = score != null ? Math.min(parseFloat(score) * 100, 100).toFixed(1) : null;

    return `
        <div class="col-md-3 col-sm-6">
            <div class="movie-card ${isRec ? 'recommended' : ''}">
                <span class="rec-badge">
                    <i class="bi bi-stars"></i>
                    ${rank ? `#${rank} · ` : ''}Recommended
                </span>
                <div class="movie-card-genre">${escHtml(m.properties.genre || '—')}</div>
                <div class="movie-card-title">${escHtml(m.properties.name)}</div>
                <div class="movie-card-director">
                    <i class="bi bi-camera-video me-1" style="font-size:0.65rem;"></i>
                    ${escHtml(m.properties.director || '—')}
                </div>

                ${isRec && score != null ? `
                <div class="movie-score-bar">
                    <div class="movie-score-fill" data-score="${score}" style="width:0%"></div>
                </div>` : ''}

                <div class="movie-card-meta">
                    <span class="movie-meta-chip">
                        ${stars}
                    </span>
                    <span class="movie-meta-chip">
                        <i class="bi bi-clock"></i> ${m.properties.durationMinutes ? `${m.properties.durationMinutes}m` : '—'}
                    </span>
                    <span class="movie-meta-chip">
                        <i class="bi bi-translate"></i> ${capitalize(m.properties.language || '—')}
                    </span>
                    ${m.properties.price != null
                        ? `<span class="price-tag">$${parseFloat(m.properties.price).toFixed(2)}</span>`
                        : ''}
                </div>
            </div>
        </div>`;
}

function clearRecommendation() {
    isRecommended = false;
    renderMovieCards(allMovies);
    hideBanner();
    setStatus(document.getElementById('predictStatus'), 'info', '');
    document.getElementById('predictStatus').style.display = 'none';
}

/* ════════════════════════════════════════════════════════════
   TRAINING CHARTS
════════════════════════════════════════════════════════════ */

function renderTrainingCharts(history) {
    const chartsWrap = document.getElementById('chartsWrap');
    chartsWrap.style.display = 'flex';

    const epochs = history.loss.map((_, i) => i + 1);

    const chartDefaults = {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 600 },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#16161f',
                borderColor: '#2a2a3a',
                borderWidth: 1,
                titleColor: '#8888aa',
                bodyColor: '#e8e8f0',
                titleFont: { family: "'Space Mono', monospace", size: 10 },
                bodyFont:  { family: "'Space Mono', monospace", size: 11 },
            },
        },
        scales: {
            x: {
                ticks:  { color: '#55556a', font: { family: "'Space Mono', monospace", size: 9 } },
                grid:   { color: '#2a2a3a' },
                title:  { display: true, text: 'Epoch', color: '#55556a',
                          font: { family: "'Space Mono', monospace", size: 9 } },
            },
            y: {
                ticks:  { color: '#55556a', font: { family: "'Space Mono', monospace", size: 9 } },
                grid:   { color: '#2a2a3a' },
            },
        },
    };

    // Destroy previous instances if re-training
    if (lossChartInst) lossChartInst.destroy();
    if (accChartInst)  accChartInst.destroy();

    // Loss chart
    lossChartInst = new Chart(document.getElementById('lossChart'), {
        type: 'line',
        data: {
            labels: epochs,
            datasets: [{
                data:        history.loss,
                borderColor: '#f75a5a',
                backgroundColor: 'rgba(247,90,90,0.08)',
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.4,
            }],
        },
        options: {
            ...chartDefaults,
            scales: {
                ...chartDefaults.scales,
                y: {
                    ...chartDefaults.scales.y,
                    title: { display: true, text: 'Loss', color: '#55556a',
                              font: { family: "'Space Mono', monospace", size: 9 } },
                },
            },
        },
    });

    // Accuracy chart
    accChartInst = new Chart(document.getElementById('accChart'), {
        type: 'line',
        data: {
            labels: epochs,
            datasets: [{
                data:        history.acc,
                borderColor: '#3ecf8e',
                backgroundColor: 'rgba(62,207,142,0.08)',
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.4,
            }],
        },
        options: {
            ...chartDefaults,
            scales: {
                ...chartDefaults.scales,
                y: {
                    ...chartDefaults.scales.y,
                    min: 0, max: 1,
                    ticks: {
                        ...chartDefaults.scales.y.ticks,
                        callback: v => `${(v * 100).toFixed(0)}%`,
                    },
                    title: { display: true, text: 'Accuracy', color: '#55556a',
                              font: { family: "'Space Mono', monospace", size: 9 } },
                },
            },
        },
    });
}

/* ════════════════════════════════════════════════════════════
   ALL USERS PURCHASES PANEL
════════════════════════════════════════════════════════════ */

function renderAllUsersPurchases(interactions) {
    const container = document.getElementById('allUsersPurchasesList');
    if (!interactions || interactions.length === 0) {
        container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:0.73rem;
            color:var(--text-muted);padding:8px 0;">No interaction data.</p>`;
        return;
    }

    container.innerHTML = interactions.map(i => {
        const movie      = allMovies.find(m => m.id === i.movieId);
        const movieTitle = movie ? escHtml(movie.name) : shortUuid(i.movieId);
        const typeLabel  = capitalize(i.type || 'unknown');
        const typeClass  = (i.type || '').toLowerCase() === 'buy' ? 'pp-type-buy' : 'pp-type-rent';

        return `
            <div class="user-purchase-summary">
                <span style="color:var(--text-primary);font-weight:600;">${movieTitle}</span>
                &nbsp;
                <span class="${typeClass}">${typeLabel}</span>
                &nbsp;·&nbsp;
                <span style="color:var(--text-muted)">${shortUuid(i.customerId)}</span>
                &nbsp;·&nbsp;${formatDate(i.date)}
            </div>`;
    }).join('');
}

/* ════════════════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════════════════ */

function setButtonLoading(btn, label) {
    btn._originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span> ${label}`;
}

function restoreButton(btn, html) {
    btn.disabled = false;
    btn.innerHTML = html || btn._originalHTML || '';
}

function setStatus(el, type, html) {
    el.className = `status-line ${type}`;
    el.innerHTML = html;
    el.style.display = html ? 'flex' : 'none';
}

function showBanner(text) {
    const b = document.getElementById('recBanner');
    document.getElementById('recBannerText').textContent = text;
    b.style.display = 'flex';
}

function hideBanner() {
    document.getElementById('recBanner').style.display = 'none';
}

/* ── TOAST ──────────────────────────────────────────────── */

function toast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    const icon = { success: 'bi-check-circle', error: 'bi-x-circle', info: 'bi-info-circle' }[type] || 'bi-info-circle';

    const item = document.createElement('div');
    item.className = `toast-item ${type}`;
    item.innerHTML = `<i class="bi ${icon}"></i> ${escHtml(message)}`;
    container.appendChild(item);

    setTimeout(() => {
        item.style.transition = 'opacity 0.3s';
        item.style.opacity = '0';
        setTimeout(() => item.remove(), 300);
    }, duration);
}

/* ── DATE / MISC ────────────────────────────────────────── */

function parseDateToTimestamp(str) {
    if (!str) return 0;
    const mdy = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (mdy) return new Date(`${mdy[3]}-${mdy[1]}-${mdy[2]}`).getTime();
    return new Date(str).getTime() || 0;
}

function formatDate(str) {
    if (!str) return '—';
    const ts = parseDateToTimestamp(str);
    if (!ts) return escHtml(str);
    return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function miniStars(rating) {
    if (rating == null) return '—';
    const val = Math.round(rating);
    return Array.from({ length: 5 }, (_, i) =>
        `<i class="bi bi-star-fill ${i < val ? 'stars-fill' : 'stars-empty'}"></i>`
    ).join('');
}

function shortUuid(uuid) {
    if (!uuid) return '—';
    return escHtml(uuid.slice(0, 8)) + '…';
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
