/**
 * interactions.js
 * ─────────────────────────────────────────────────────────────
 * Async API layer + table/UI logic for the Interactions page.
 *
 * To point at a different environment, change HOST only:
 */
const HOST = 'http://localhost:3000';

/* ════════════════════════════════════════════════════════════
   API LAYER
════════════════════════════════════════════════════════════ */

/**
 * Base request wrapper.
 * @param {string} path   - e.g. '/interactions' or '/interactions/:id'
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

/** GET /interactions — list all interactions */
async function getAllInteractions() {
    return apiRequest('/interactions');
}

/** GET /customers — list all customers */
async function getAllCustomers() {
    return apiRequest('/customers');
}

/** GET /movies — list all movies */
async function getAllMovies() {
    return apiRequest('/movies');
}

/** GET /interactions/:id — single interaction */
async function getInteractionById(id) {
    return apiRequest(`/interactions/${id}`);
}

/**
 * POST /interactions/:customerId/buy/:movieId
 * Body: { date, rating }
 */
async function buyMovie(customerId, movieId, data) {
    return apiRequest(`/interactions/${customerId}/buy/${movieId}`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

/**
 * POST /interactions/:customerId/rent/:movieId
 * Body: { date, rating }
 */
async function rentMovie(customerId, movieId, data) {
    return apiRequest(`/interactions/${customerId}/rent/${movieId}`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

/**
 * PATCH /interactions/:id
 * Body: { date, rating, customerId, movieId }
 */
async function updateInteraction(id, data) {
    return apiRequest(`/interactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

/** DELETE /interactions/:id */
async function deleteInteraction(id) {
    return apiRequest(`/interactions/${id}`, { method: 'DELETE' });
}

/* Side-effect-free lookups used to resolve UUIDs to names in the form */
async function fetchCustomerById(id) {
    return apiRequest(`/customers/${id}`);
}

async function fetchMovieById(id) {
    return apiRequest(`/movies/${id}`);
}

/* ════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════ */

let allInteractions = [];
let allCustomers = [];
let allMovies = [];
let filtered        = [];
let sortKey         = 'date';
let sortAsc         = false;       // newest first by default
let currentPage     = 1;
const PAGE_SIZE     = 10;

let viewModalInst, newModalInst, editModalInst, deleteModalInst;

// Debounce timers for UUID lookup
const lookupTimers = {};

/* ════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    viewModalInst   = new bootstrap.Modal(document.getElementById('viewModal'));
    newModalInst    = new bootstrap.Modal(document.getElementById('newModal'));
    editModalInst   = new bootstrap.Modal(document.getElementById('editModal'));
    deleteModalInst = new bootstrap.Modal(document.getElementById('deleteModal'));

    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('typeFilter').addEventListener('change', applyFilters);
    document.getElementById('ratingFilter').addEventListener('change', applyFilters);

    // Default date to today for new interactions
    document.getElementById('newDate').value = todayInputDate();

    loadInteractions();
});

/* ════════════════════════════════════════════════════════════
   LOAD & RENDER
════════════════════════════════════════════════════════════ */

async function loadInteractions() {
    showLoading();
    try {
        allInteractions = await getAllInteractions();
        allCustomers = await getAllCustomers();
        allMovies = await getAllMovies();

        editCustomerId.innerHTML = allCustomers.map(c => `<option value="${c.properties.id}">${c.properties.name}</option>`).join('');
        editMovieId.innerHTML = allMovies.map(m => `<option value="${m.properties.id}">${m.properties.name}</option>`).join('');

        newCustomerId.innerHTML = allCustomers.map(c => `<option value="${c.properties.id}">${c.properties.name}</option>`).join('');
        newMovieId.innerHTML = allMovies.map(m => `<option value="${m.properties.id}">${m.properties.name}</option>`).join('');

        applyFilters();
    } catch (err) {
        showError(`Failed to load interactions: ${err.message}`);
        toast(`Error: ${err.message}`, 'error');
    }
}

function applyFilters() {
    const search    = document.getElementById('searchInput').value.toLowerCase().trim();
    const type      = document.getElementById('typeFilter').value;
    const minRating = parseInt(document.getElementById('ratingFilter').value || '0', 10);

    filtered = allInteractions.filter(i => {
        const matchSearch = !search
            || (i.customerId || '').toLowerCase().includes(search)
            || (i.movieId    || '').toLowerCase().includes(search);
        const matchType   = !type   || (i.type || '').toLowerCase() === type;
        const matchRating = !minRating || (i.rating || 0) >= minRating;
        return matchSearch && matchType && matchRating;
    });

    currentPage = 1;
    sortAndRender();
}

function sortAndRender() {
    filtered.sort((a, b) => {
        let va = a[sortKey] ?? '';
        let vb = b[sortKey] ?? '';

        if (sortKey === 'rating') {
            va = parseFloat(va) || 0;
            vb = parseFloat(vb) || 0;
        } else if (sortKey === 'date') {
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
    const tbody = document.getElementById('interactionsBody');
    const start = (currentPage - 1) * PAGE_SIZE;
    const page  = filtered.slice(start, start + PAGE_SIZE);

    if (page.length === 0) {
        tbody.innerHTML = `
            <tr class="state-row">
                <td colspan="6">
                    <i class="bi bi-arrow-left-right" style="font-size:1.6rem;display:block;margin-bottom:8px;"></i>
                    No interactions found.
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = page.map(i => `
        <tr>
            <td>${typeBadge(i.properties.type)}</td>
            <td><div class="uuid-cell"><abbr title="${escHtml(i.properties.customerId || '')}">${escHtml(allCustomers.find(c => c.properties.id === i.properties.customerId)?.properties.name || '')}</abbr></div></td>
            <td><div class="uuid-cell"><abbr title="${escHtml(i.properties.movieId || '')}">${escHtml(allMovies.find(m => m.properties.id === i.properties.movieId)?.properties.name || '')}</abbr></div></td>
            <td class="muted">${formatDate(i.properties.date)}</td>
            <td>${starRating(i.properties.rating)}</td>
            <td>
                <div class="actions-cell">
                    <button class="btn-icon view" title="View details"       onclick="openViewModal('${i.properties.id}')">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button class="btn-icon edit" title="Edit interaction"   onclick="openEditModal('${i.properties.id}')">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn-icon del"  title="Remove interaction" onclick="openDeleteModal('${i.properties.id}')">
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
            const d = document.createElement('button');
            d.className = 'pg-btn'; d.disabled = true; d.textContent = '…';
            btns.appendChild(d);
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
        let i = await getInteractionById(id);
        i = i[0]

        document.getElementById('viewModalBody').innerHTML = `
            <div class="detail-section-title">Transaction</div>
            <div class="detail-row">
                <span class="detail-label">Type</span>
                <span class="detail-value">${typeBadge(i.properties.type)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Date</span>
                <span class="detail-value">${formatDate(i.properties.date)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Rating</span>
                <span class="detail-value">${starRating(i.properties.rating)}</span>
            </div>
            <div class="detail-section-title" style="margin-top:10px;">References</div>
            <div class="detail-row">
                <span class="detail-label">Customer</span>
                <span class="detail-value">
                    <span class="uuid-cell" style="max-width:none;font-size:0.75rem;">${escHtml(i.properties.customerId || '—')}</span>
                </span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Movie</span>
                <span class="detail-value">
                    <span class="uuid-cell" style="max-width:none;font-size:0.75rem;">${escHtml(i.properties.movieId || '—')}</span>
                </span>
            </div>
            ${i.id ? `
            <div class="detail-section-title" style="margin-top:10px;">Meta</div>
            <div class="detail-row">
                <span class="detail-label">ID</span>
                <span class="detail-value" style="font-family:'Space Mono',monospace;font-size:0.72rem;color:var(--text-muted)">${i.properties.id}</span>
            </div>` : ''}
        `;

        document.getElementById('viewToEditBtn').onclick = () => {
            viewModalInst.hide();
            openEditModal(id);
        };
    } catch (err) {
        document.getElementById('viewModalBody').innerHTML =
            `<p style="color:var(--accent-red);font-family:'Space Mono',monospace;font-size:0.8rem;">
                Error loading interaction: ${err.message}
            </p>`;
    }
}

/* ════════════════════════════════════════════════════════════
   NEW INTERACTION MODAL  (Buy / Rent)
════════════════════════════════════════════════════════════ */

function openNewModal() {
    document.getElementById('newCustomerId').value = '';
    document.getElementById('newMovieId').value    = '';
    document.getElementById('newDate').value       = todayInputDate();
    document.getElementById('newRating').value     = '3';
    document.getElementById('newRatingVal').textContent = '3';
    document.getElementById('newFormError').style.display = 'none';
    document.getElementById('customerResolved').innerHTML = '';
    document.getElementById('movieResolved').innerHTML    = '';

    selectType('buy');   // default to buy
    newModalInst.show();
}

/** Toggle buy/rent styling and update the submit button label */
function selectType(type) {
    document.getElementById('newType').value = type;

    const labelBuy  = document.getElementById('labelBuy');
    const labelRent = document.getElementById('labelRent');

    if (type === 'buy') {
        labelBuy.className  = 'selected-buy';
        labelRent.className = '';
        document.getElementById('newSubmitLabel').textContent = 'Record Buy';
    } else {
        labelBuy.className  = '';
        labelRent.className = 'selected-rent';
        document.getElementById('newSubmitLabel').textContent = 'Record Rent';
    }
}

async function submitNew() {
    const type       = document.getElementById('newType').value;
    const customerId = document.getElementById('newCustomerId').value.trim();
    const movieId    = document.getElementById('newMovieId').value.trim();
    const date       = formatDateForApi(document.getElementById('newDate').value);
    const rating     = parseInt(document.getElementById('newRating').value, 10);
    const errEl      = document.getElementById('newFormError');

    if (!customerId || !movieId || !date) {
        errEl.textContent = 'Customer ID, Movie ID and Date are required.';
        errEl.style.display = 'block';
        return;
    }

    if (!isValidUuid(customerId) || !isValidUuid(movieId)) {
        errEl.textContent = 'Customer ID and Movie ID must be valid UUIDs.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';

    const btn = document.getElementById('newSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i> Saving…';

    const payload = { date, rating };

    try {
        let created;
        if (type === 'buy') {
            created = await buyMovie(customerId, movieId, payload);
        } else {
            created = await rentMovie(customerId, movieId, payload);
        }

        if (created) allInteractions.unshift(created);
        newModalInst.hide();
        loadInteractions();
        toast(`${capitalize(type)} interaction recorded.`, 'success');
    } catch (err) {
        errEl.textContent = `Error: ${err.message}`;
        errEl.style.display = 'block';
        toast(`Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-check-lg me-1"></i> <span id="newSubmitLabel">${capitalize(type)}</span>`;
    }
}

/* ════════════════════════════════════════════════════════════
   EDIT INTERACTION MODAL
════════════════════════════════════════════════════════════ */

async function openEditModal(id) {
    document.getElementById('editFormError').style.display = 'none';

    let interaction = allInteractions.find(i => String(i.id) === String(id));
    if (!interaction) {
        try { interaction = await getInteractionById(id); } catch (err) {
            toast(`Could not load interaction: ${err.message}`, 'error');
            return;
        }
    }
    interaction = interaction[0]

    document.getElementById('editInteractionId').value = interaction.properties.id;
    document.getElementById('editCustomerId').value    = interaction.properties.customerId || '';
    document.getElementById('editMovieId').value       = interaction.properties.movieId    || '';
    document.getElementById('editDate').value          = toInputDate(interaction.properties.date);
    document.getElementById('editRating').value        = interaction.properties.rating     ?? 3;
    document.getElementById('editRatingVal').textContent = interaction.properties.rating   ?? 3;

    editModalInst.show();
}

async function submitEdit() {
    const id         = document.getElementById('editInteractionId').value;
    const customerId = document.getElementById('editCustomerId').value.trim();
    const movieId    = document.getElementById('editMovieId').value.trim();
    const date       = formatDateForApi(document.getElementById('editDate').value);
    const rating     = parseInt(document.getElementById('editRating').value, 10);
    const errEl      = document.getElementById('editFormError');

    if (!customerId || !movieId || !date) {
        errEl.textContent = 'Customer ID, Movie ID and Date are required.';
        errEl.style.display = 'block';
        return;
    }

    if (!isValidUuid(customerId) || !isValidUuid(movieId)) {
        errEl.textContent = 'Customer ID and Movie ID must be valid UUIDs.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';

    const btn = document.getElementById('editSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i> Saving…';

    const payload = { date, rating, customerId, movieId };

    try {
        const updated = await updateInteraction(id, payload);
        const idx = allInteractions.findIndex(i => String(i.id) === String(id));
        if (idx !== -1) allInteractions[idx] = updated ?? { ...payload, id };
        editModalInst.hide();
        loadInteractions();
        toast('Interaction updated.', 'success');
    } catch (err) {
        errEl.textContent = `Error: ${err.message}`;
        errEl.style.display = 'block';
        toast(`Error: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Save Changes';
    }
}

/* ════════════════════════════════════════════════════════════
   DELETE MODAL
════════════════════════════════════════════════════════════ */

function openDeleteModal(id) {
    document.getElementById('deleteInteractionId').textContent  = id;
    document.getElementById('deleteInteractionIdHidden').value  = id;
    deleteModalInst.show();
}

async function confirmDelete() {
    const id = document.getElementById('deleteInteractionIdHidden').value;
    try {
        await deleteInteraction(id);
        allInteractions = allInteractions.filter(i => String(i.id) !== String(id));
        deleteModalInst.hide();
        loadInteractions();
        toast('Interaction removed.', 'success');
    } catch (err) {
        deleteModalInst.hide();
        toast(`Error: ${err.message}`, 'error');
    }
}

/* ════════════════════════════════════════════════════════════
   UUID LOOKUP  (resolves IDs to names in the new form)
════════════════════════════════════════════════════════════ */

/**
 * Debounced resolver — waits 600ms after the user stops typing
 * before hitting the API, to avoid hammering with every keystroke.
 */
function debounceLookup(kind, value) {
    clearTimeout(lookupTimers[kind]);
    const resolvedEl = document.getElementById(kind === 'customer' ? 'customerResolved' : 'movieResolved');

    if (!isValidUuid(value.trim())) {
        resolvedEl.innerHTML = '';
        return;
    }

    resolvedEl.innerHTML = `<span class="resolved-chip"><i class="bi bi-hourglass-split"></i> Looking up…</span>`;

    lookupTimers[kind] = setTimeout(async () => {
        try {
            const data = kind === 'customer'
                ? await fetchCustomerById(value.trim())
                : await fetchMovieById(value.trim());

            const label = kind === 'customer'
                ? (data.name || 'Unknown customer')
                : (data.name || 'Unknown movie');

            const icon = kind === 'customer' ? 'bi-person-check' : 'bi-film';

            resolvedEl.innerHTML = `
                <span class="resolved-chip">
                    <i class="bi ${icon}"></i> ${escHtml(label)}
                </span>`;
        } catch (_) {
            resolvedEl.innerHTML = `
                <span class="resolved-chip" style="color:var(--accent-red);border-color:rgba(247,90,90,0.3);">
                    <i class="bi bi-exclamation-circle"></i> Not found
                </span>`;
        }
    }, 600);
}

/* ════════════════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════════════════ */

function showLoading() {
    document.getElementById('interactionsBody').innerHTML = `
        <tr class="state-row">
            <td colspan="6">
                <div class="spinner-ring"></div><br>Loading interactions…
            </td>
        </tr>`;
}

function showError(msg) {
    document.getElementById('interactionsBody').innerHTML = `
        <tr class="state-row">
            <td colspan="6">
                <i class="bi bi-exclamation-triangle" style="font-size:1.4rem;color:var(--accent-red);display:block;margin-bottom:8px;"></i>
                ${escHtml(msg)}
            </td>
        </tr>`;
}

function typeBadge(type) {
    if (!type) return '<span style="color:var(--text-muted)">—</span>';
    const t = type.toLowerCase();
    if (t === 'buy')  return `<span class="type-badge buy"><i class="bi bi-bag-check"></i>Buy</span>`;
    if (t === 'rent') return `<span class="type-badge rent"><i class="bi bi-clock-history"></i>Rent</span>`;
    return `<span class="type-badge">${escHtml(type)}</span>`;
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

/** Abbreviate a UUID to first 8 chars for compact display */
function shortUuid(uuid) {
    if (!uuid) return '—';
    return escHtml(uuid.slice(0, 8)) + '…';
}

/* ── DATE UTILS ─────────────────────────────────────────── */

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

function toInputDate(str) {
    if (!str) return '';
    const ts = parseDateToTimestamp(str);
    if (!ts) return '';
    return new Date(ts).toISOString().split('T')[0];
}

/** YYYY-MM-DD (from <input type="date">) → MM/DD/YYYY (API format) */
function formatDateForApi(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    if (!y || !m || !d) return str;
    return `${m}/${d}/${y}`;
}

function todayInputDate() {
    return new Date().toISOString().split('T')[0];
}

/* ── UUID VALIDATION ────────────────────────────────────── */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(str) {
    return UUID_REGEX.test(str);
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
