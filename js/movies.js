/**
 * movies.js
 * ─────────────────────────────────────────────────────────────
 * Async API layer + table/UI logic for the Movies page.
 *
 * To point at a different environment, change HOST only:
 */
const HOST = 'https://rental-movies-api.vercel.app';

/* ════════════════════════════════════════════════════════════
   API LAYER
════════════════════════════════════════════════════════════ */

/**
 * Base request wrapper.
 * @param {string} path    - e.g. '/movies' or '/movies/42'
 * @param {RequestInit} options
 * @returns {Promise<any>} parsed JSON body
 */
async function apiRequest(path, options = {}) {
    const url = `${HOST}${path}`;

    const defaultHeaders = { 'Content-Type': 'application/json' };

    const response = await fetch(url, {
        ...options,
        headers: { ...defaultHeaders, ...(options.headers || {}) },
    });

    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json();
            message = body.message || body.error || message;
        } catch (_) { /* ignore */ }
        throw new Error(message);
    }

    if (response.status === 204) return null;

    return response.json();
}

/** GET /movies */
async function getAllMovies() {
    return apiRequest('/movies');
}

/** GET /movies/:id */
async function getMovieById(id) {
    return apiRequest(`/movies/${id}`);
}

/** POST /movies */
async function createMovie(data) {
    return apiRequest('/movies', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

/** PATCH /movies/:id */
async function updateMovie(id, data) {
    return apiRequest(`/movies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

/** DELETE /movies/:id */
async function deleteMovie(id) {
    return apiRequest(`/movies/${id}`, { method: 'DELETE' });
}

/* ════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════ */

let allMovies   = [];   // master list from API
let filtered    = [];   // after search / filters
let sortKey     = 'name';
let sortAsc     = true;
let currentPage = 1;
const PAGE_SIZE = 10;

let viewModalInst, formModalInst, deleteModalInst;

/* ════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    viewModalInst   = new bootstrap.Modal(document.getElementById('viewModal'));
    formModalInst   = new bootstrap.Modal(document.getElementById('formModal'));
    deleteModalInst = new bootstrap.Modal(document.getElementById('deleteModal'));

    // Live search & filters
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('genreFilter').addEventListener('change', applyFilters);
    document.getElementById('languageFilter').addEventListener('change', applyFilters);
    document.getElementById('ratingFilter').addEventListener('change', applyFilters);

    // Slug auto-generation from title
    document.getElementById('formName').addEventListener('input', function () {
        const slugField = document.getElementById('formSlug');
        // Only auto-fill if slug is empty or was previously auto-generated
        if (!slugField.dataset.manual) {
            slugField.value = slugify(this.value);
        }
    });

    // Once user manually edits slug, stop auto-generating
    document.getElementById('formSlug').addEventListener('input', function () {
        this.dataset.manual = this.value ? 'true' : '';
    });

    loadMovies();
});

/* ════════════════════════════════════════════════════════════
   LOAD & RENDER
════════════════════════════════════════════════════════════ */

async function loadMovies() {
    showLoading();
    try {
        allMovies = await getAllMovies();
        populateFilterDropdowns();
        applyFilters();
    } catch (err) {
        showError(`Failed to load movies: ${err.message}`);
        toast(`Error: ${err.message}`, 'error');
    }
}

/** Populate genre & language dropdowns from actual data */
function populateFilterDropdowns() {
    const genres    = [...new Set(allMovies.map(m => m.genre).filter(Boolean))].sort();
    const languages = [...new Set(allMovies.map(m => m.language).filter(Boolean))].sort();

    const genreFilter = document.getElementById('genreFilter');
    genres.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        genreFilter.appendChild(opt);
    });

    const langFilter = document.getElementById('languageFilter');
    languages.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.toLowerCase();
        opt.textContent = capitalize(l);
        langFilter.appendChild(opt);
    });
}

function applyFilters() {
    const search   = document.getElementById('searchInput').value.toLowerCase().trim();
    const genre    = document.getElementById('genreFilter').value;
    const language = document.getElementById('languageFilter').value;
    const minRating = parseInt(document.getElementById('ratingFilter').value || '0', 10);

    filtered = allMovies.filter(m => {
        const matchSearch = !search
            || (m.name     || '').toLowerCase().includes(search)
            || (m.director || '').toLowerCase().includes(search)
            || (m.genre    || '').toLowerCase().includes(search);
        const matchGenre    = !genre    || m.genre === genre;
        const matchLanguage = !language || (m.language || '').toLowerCase() === language;
        const matchRating   = !minRating || (m.rating  || 0) >= minRating;
        return matchSearch && matchGenre && matchLanguage && matchRating;
    });

    currentPage = 1;
    sortAndRender();
}

function sortAndRender() {
    filtered.sort((a, b) => {
        let va = a[sortKey] ?? '';
        let vb = b[sortKey] ?? '';

        // Numeric sort for these fields
        if (['rating', 'durationMinutes', 'price'].includes(sortKey)) {
            va = parseFloat(va) || 0;
            vb = parseFloat(vb) || 0;
        } else if (sortKey === 'releaseDate') {
            va = parseDateToTimestamp(va);
            vb = parseDateToTimestamp(vb);
        } else {
            va = String(va).toLowerCase();
            vb = String(vb).toLowerCase();
        }

        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ?  1 : -1;
        return 0;
    });

    document.getElementById('totalCount').textContent = filtered.length;
    renderTable();
    renderPagination();
}

function renderTable() {
    const tbody = document.getElementById('moviesBody');
    const start = (currentPage - 1) * PAGE_SIZE;
    const page  = filtered.slice(start, start + PAGE_SIZE);

    if (page.length === 0) {
        tbody.innerHTML = `
            <tr class="state-row">
                <td colspan="9">
                    <i class="bi bi-film" style="font-size:1.6rem;display:block;margin-bottom:8px;"></i>
                    No movies found.
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = page.map(m => `
        <tr>
            <td>
                <div style="font-weight:600;">${escHtml(m.properties.name)}</div>
                ${m.properties.slug ? `<span class="slug-chip">${escHtml(m.properties.slug)}</span>` : ''}
            </td>
            <td>${genreBadge(m.properties.genre)}</td>
            <td class="muted">${formatDate(m.properties.releaseDate)}</td>
            <td class="muted">${capitalize(m.properties.language || '—')}</td>
            <td class="duration-cell">
                ${m.properties.durationMinutes ? `<i class="bi bi-clock me-1" style="font-size:0.72rem;"></i>${m.properties.durationMinutes} min` : '—'}
            </td>
            <td>${starRating(m.properties.rating)}</td>
            <td class="price-cell">${m.properties.price != null ? `$${parseFloat(m.properties.price).toFixed(2)}` : '—'}</td>
            <td class="muted">${escHtml(m.properties.director || '—')}</td>
            <td>
                <div class="actions-cell">
                    <button class="btn-icon view" title="View details"  onclick="openViewModal('${m.properties.id}')">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button class="btn-icon edit" title="Edit movie"    onclick="openEditModal('${m.properties.id}')">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn-icon del"  title="Remove movie"  onclick="openDeleteModal('${m.properties.id}', '${escHtml(m.properties.name)}')">
                        <i class="bi bi-trash3"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderPagination() {
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = Math.min((currentPage - 1) * PAGE_SIZE + 1, total);
    const end   = Math.min(currentPage * PAGE_SIZE, total);

    document.getElementById('paginationInfo').innerHTML =
        total === 0 ? '' : `Showing <b>${start}–${end}</b> of <b>${total}</b>`;

    const btns = document.getElementById('paginationBtns');
    btns.innerHTML = '';

    const prev = paginationBtn('<i class="bi bi-chevron-left"></i>', currentPage === 1);
    prev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTable(); renderPagination(); } });
    btns.appendChild(prev);

    pageRange(currentPage, pages).forEach(p => {
        if (p === '…') {
            const dots = document.createElement('button');
            dots.className = 'pg-btn';
            dots.disabled  = true;
            dots.textContent = '…';
            btns.appendChild(dots);
        } else {
            const btn = paginationBtn(p, false, p === currentPage);
            btn.addEventListener('click', () => { currentPage = p; renderTable(); renderPagination(); });
            btns.appendChild(btn);
        }
    });

    const next = paginationBtn('<i class="bi bi-chevron-right"></i>', currentPage === pages);
    next.addEventListener('click', () => { if (currentPage < pages) { currentPage++; renderTable(); renderPagination(); } });
    btns.appendChild(next);
}

function paginationBtn(label, disabled = false, active = false) {
    const btn = document.createElement('button');
    btn.className = 'pg-btn' + (active ? ' active' : '');
    btn.innerHTML = label;
    btn.disabled  = disabled;
    return btn;
}

function pageRange(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
    if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '…', current - 1, current, current + 1, '…', total];
}

/* ════════════════════════════════════════════════════════════
   SORTING
════════════════════════════════════════════════════════════ */

function sortTable(key) {
    sortAsc = sortKey === key ? !sortAsc : true;
    sortKey = key;

    document.querySelectorAll('thead th').forEach(th => th.classList.remove('sorted'));
    const th = document.getElementById(`th-${key}`);
    if (th) {
        th.classList.add('sorted');
        th.querySelector('.sort-icon').className =
            `bi ${sortAsc ? 'bi-chevron-up' : 'bi-chevron-down'} sort-icon`;
    }

    sortAndRender();
}

/* ════════════════════════════════════════════════════════════
   VIEW MODAL
════════════════════════════════════════════════════════════ */

async function openViewModal(id) {
    document.getElementById('viewModalBody').innerHTML = `
        <div style="text-align:center;padding:24px;">
            <div class="spinner-ring"></div>
        </div>`;
    viewModalInst.show();

    try {
        let m = await getMovieById(id);
        m = m[0]

        document.getElementById('viewModalBody').innerHTML = `
            <div class="movie-poster-wrap">
                <span class="poster-placeholder"><i class="bi bi-film"></i></span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Title</span>
                <span class="detail-value" style="font-weight:700;">${escHtml(m.properties.name)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Director</span>
                <span class="detail-value">${escHtml(m.properties.director || '—')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Genre</span>
                <span class="detail-value">${genreBadge(m.properties.genre)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Release</span>
                <span class="detail-value">${formatDate(m.properties.releaseDate)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Language</span>
                <span class="detail-value">${capitalize(m.properties.language || '—')}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Duration</span>
                <span class="detail-value">${m.properties.durationMinutes ? `${m.properties.durationMinutes} min` : '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Rating</span>
                <span class="detail-value">${starRating(m.properties.rating)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Price</span>
                <span class="detail-value price-cell">${m.properties.price != null ? `$${parseFloat(m.properties.price).toFixed(2)}` : '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Slug</span>
                <span class="detail-value"><span class="slug-chip">${escHtml(m.properties.slug || '—')}</span></span>
            </div>
            ${m.id ? `<div class="detail-row">
                <span class="detail-label">ID</span>
                <span class="detail-value" style="font-family:'Space Mono',monospace;font-size:0.75rem;color:var(--text-muted)">${m.properties.id}</span>
            </div>` : ''}
        `;

        document.getElementById('viewToEditBtn').onclick = () => {
            viewModalInst.hide();
            openEditModal(id);
        };
    } catch (err) {
        document.getElementById('viewModalBody').innerHTML =
            `<p style="color:var(--accent-red);font-family:'Space Mono',monospace;font-size:0.8rem;">
                Error loading movie: ${err.message}
            </p>`;
    }
}

/* ════════════════════════════════════════════════════════════
   FORM MODAL  (New & Edit)
════════════════════════════════════════════════════════════ */

function openNewModal() {
    document.getElementById('formModalTitle').innerHTML =
        '<i class="bi bi-plus-circle me-2" style="color:var(--accent-green)"></i>New Movie';

    document.getElementById('formMovieId').value   = '';
    document.getElementById('formName').value      = '';
    document.getElementById('formDirector').value  = '';
    document.getElementById('formGenre').value     = '';
    document.getElementById('formLanguage').value  = '';
    document.getElementById('formReleaseDate').value = '';
    document.getElementById('formDuration').value  = '';
    document.getElementById('formPrice').value     = '';
    document.getElementById('formRating').value    = '3';
    document.getElementById('formRatingVal').textContent = '3';
    document.getElementById('formSlug').value      = '';
    document.getElementById('formSlug').dataset.manual = '';
    document.getElementById('formError').style.display = 'none';

    formModalInst.show();
}

async function openEditModal(id) {
    document.getElementById('formModalTitle').innerHTML =
        '<i class="bi bi-pencil me-2" style="color:var(--accent-yellow)"></i>Edit Movie';
    document.getElementById('formError').style.display = 'none';

    let movie = allMovies.find(m => String(m.id) === String(id));
    if (!movie) {
        try { movie = await getMovieById(id); } catch (err) {
            toast(`Could not load movie: ${err.message}`, 'error');
            return;
        }
    }

    movie = movie[0]

    document.getElementById('formMovieId').value   = movie.properties.id;
    document.getElementById('formName').value      = movie.properties.name          || '';
    document.getElementById('formDirector').value  = movie.properties.director      || '';
    document.getElementById('formGenre').value     = movie.properties.genre         || '';
    document.getElementById('formLanguage').value  = movie.properties.language      || '';
    document.getElementById('formReleaseDate').value = toInputDate(movie.properties.releaseDate);
    document.getElementById('formDuration').value  = movie.properties.durationMinutes ?? '';
    document.getElementById('formPrice').value     = movie.properties.price         ?? '';
    document.getElementById('formRating').value    = movie.properties.rating        ?? 3;
    document.getElementById('formRatingVal').textContent = movie.properties.rating  ?? 3;
    document.getElementById('formSlug').value      = movie.properties.slug          || '';
    document.getElementById('formSlug').dataset.manual = movie.properties.slug ? 'true' : '';
    formModalInst.show();
}

async function submitForm() {
    const id       = document.getElementById('formMovieId').value;
    const name     = document.getElementById('formName').value.trim();
    const director = document.getElementById('formDirector').value.trim();
    const genre    = document.getElementById('formGenre').value.trim();
    const language = document.getElementById('formLanguage').value.trim();
    const releaseDate     = formatDateForApi(document.getElementById('formReleaseDate').value);
    const durationMinutes = parseInt(document.getElementById('formDuration').value, 10);
    const price    = parseFloat(document.getElementById('formPrice').value);
    const rating   = parseInt(document.getElementById('formRating').value, 10);
    const slug     = document.getElementById('formSlug').value.trim() || slugify(name);
    const errEl    = document.getElementById('formError');

    // Validation
    if (!name || !genre || !language || isNaN(durationMinutes) || isNaN(price)) {
        errEl.textContent = 'Please fill in all required fields (title, genre, language, duration, price).';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';

    const btn = document.getElementById('formSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i> Saving…';

    const payload = { name, director, genre, language, releaseDate, durationMinutes, price, rating, slug };

    try {
        if (id) {
            const updated = await updateMovie(id, payload);
            const idx = allMovies.findIndex(m => String(m.id) === String(id));
            if (idx !== -1) allMovies[idx] = updated ?? { ...payload, id };
            toast('Movie updated successfully.', 'success');
        } else {
            const created = await createMovie(payload);
            allMovies.push(created.properties ?? payload);
            toast('Movie created successfully.', 'success');
        }

        formModalInst.hide();
        populateFilterDropdowns(); // refresh dropdowns if new genre/language added
        loadMovies();
    } catch (err) {
        errEl.textContent = `Error: ${err.message}`;
        errEl.style.display = 'block';
        toast(`Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Save';
    }
}

/* ════════════════════════════════════════════════════════════
   DELETE MODAL
════════════════════════════════════════════════════════════ */

function openDeleteModal(id, name) {
    document.getElementById('deleteMovieId').value       = id;
    document.getElementById('deleteMovieName').textContent = name;
    deleteModalInst.show();
}

async function confirmDelete() {
    const id = document.getElementById('deleteMovieId').value;
    try {
        await deleteMovie(id);
        allMovies = allMovies.filter(m => String(m.id) !== String(id));
        deleteModalInst.hide();
        loadMovies();
        toast('Movie removed.', 'success');
    } catch (err) {
        deleteModalInst.hide();
        toast(`Error: ${err.message}`, 'error');
    }
}

/* ════════════════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════════════════ */

function showLoading() {
    document.getElementById('moviesBody').innerHTML = `
        <tr class="state-row">
            <td colspan="9">
                <div class="spinner-ring"></div><br>Loading movies…
            </td>
        </tr>`;
}

function showError(msg) {
    document.getElementById('moviesBody').innerHTML = `
        <tr class="state-row">
            <td colspan="9">
                <i class="bi bi-exclamation-triangle" style="font-size:1.4rem;color:var(--accent-red);display:block;margin-bottom:8px;"></i>
                ${escHtml(msg)}
            </td>
        </tr>`;
}

/** Map genre names to badge colours */
const GENRE_COLORS = {
    action:     { bg: 'rgba(247,90,90,0.12)',    color: '#f75a5a',  border: 'rgba(247,90,90,0.3)'    },
    adventure:  { bg: 'rgba(247,201,79,0.12)',   color: '#f7c94f',  border: 'rgba(247,201,79,0.3)'   },
    comedy:     { bg: 'rgba(62,207,142,0.12)',   color: '#3ecf8e',  border: 'rgba(62,207,142,0.3)'   },
    drama:      { bg: 'rgba(167,139,250,0.12)',  color: '#a78bfa',  border: 'rgba(167,139,250,0.3)'  },
    horror:     { bg: 'rgba(180,60,60,0.15)',    color: '#e05555',  border: 'rgba(180,60,60,0.4)'    },
    thriller:   { bg: 'rgba(100,100,200,0.12)',  color: '#7b8cde',  border: 'rgba(100,100,200,0.3)'  },
    romance:    { bg: 'rgba(240,100,160,0.12)',  color: '#f064a0',  border: 'rgba(240,100,160,0.3)'  },
    scifi:      { bg: 'rgba(79,142,247,0.12)',   color: '#4f8ef7',  border: 'rgba(79,142,247,0.3)'   },
    'sci-fi':   { bg: 'rgba(79,142,247,0.12)',   color: '#4f8ef7',  border: 'rgba(79,142,247,0.3)'   },
    animation:  { bg: 'rgba(255,170,50,0.12)',   color: '#ffaa32',  border: 'rgba(255,170,50,0.3)'   },
    documentary:{ bg: 'rgba(80,160,120,0.12)',   color: '#50a078',  border: 'rgba(80,160,120,0.3)'   },
};

function genreBadge(genre) {
    if (!genre) return '<span style="color:var(--text-muted)">—</span>';
    const key    = genre.toLowerCase();
    const colors = GENRE_COLORS[key] || { bg: 'rgba(136,136,170,0.1)', color: '#8888aa', border: 'rgba(136,136,170,0.25)' };
    return `<span class="genre-badge" style="background:${colors.bg};color:${colors.color};border:1px solid ${colors.border};">${escHtml(genre)}</span>`;
}

function starRating(rating) {
    if (rating == null) return '<span style="color:var(--text-muted)">—</span>';
    const max = 5;
    const val = Math.round(rating);
    const stars = Array.from({ length: max }, (_, i) =>
        `<i class="bi bi-star-fill ${i < val ? 'star-fill' : 'star-empty'}"></i>`
    ).join('');
    return `<span class="star-rating">${stars}<span class="star-label">${rating}/5</span></span>`;
}

/* ── DATE UTILS ─────────────────────────────────────────── */

/**
 * Try to parse a date string in various formats and return a timestamp.
 * Supports MM/DD/YYYY and YYYY-MM-DD.
 */
function parseDateToTimestamp(str) {
    if (!str) return 0;
    // MM/DD/YYYY
    const mdy = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (mdy) return new Date(`${mdy[3]}-${mdy[1]}-${mdy[2]}`).getTime();
    return new Date(str).getTime() || 0;
}

/**
 * Display a date string nicely (e.g. "Jul 14, 2008").
 * Accepts MM/DD/YYYY or YYYY-MM-DD.
 */
function formatDate(str) {
    if (!str) return '—';
    const ts = parseDateToTimestamp(str);
    if (!ts) return escHtml(str);
    return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Convert any date string to YYYY-MM-DD for <input type="date"> */
function toInputDate(str) {
    if (!str) return '';
    const ts = parseDateToTimestamp(str);
    if (!ts) return '';
    const d = new Date(ts);
    return d.toISOString().split('T')[0];
}

/**
 * Convert YYYY-MM-DD (from input) back to MM/DD/YYYY for the API,
 * matching the format in the sample payload.
 */
function formatDateForApi(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    if (!y || !m || !d) return str;
    return `${m}/${d}/${y}`;
}

/* ── SLUG ───────────────────────────────────────────────── */

function slugify(str) {
    return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

/* ── MISC ───────────────────────────────────────────────── */

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
