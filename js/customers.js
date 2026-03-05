/**
 * customers.js
 * ─────────────────────────────────────────────────────────────
 * Async API layer + table/UI logic for the Customers page.
 *
 * To point at a different environment, change HOST only:
 */
const HOST = 'http://localhost:3000';

/* ════════════════════════════════════════════════════════════
   API LAYER  –  all requests go through these helpers
════════════════════════════════════════════════════════════ */

/**
 * Base request wrapper.
 * @param {string} path   - e.g. '/customers' or '/customers/42'
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
        // Try to extract a server-side error message
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json();
            message = body.message || body.error || message;
        } catch (_) { /* ignore */ }
        throw new Error(message);
    }

    // 204 No Content — nothing to parse
    if (response.status === 204) return null;

    return response.json();
}

/** GET /customers — list all customers */
async function getAllCustomers() {
    return apiRequest('/customers');
}

/** GET /customers/:id — single customer */
async function getCustomerById(id) {
    return apiRequest(`/customers/${id}`);
}

/** POST /customers — create a new customer */
async function createCustomer(data) {
    return apiRequest('/customers', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

/** PATCH /customers/:id — full update */
async function updateCustomer(id, data) {
    return apiRequest(`/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

/** DELETE /customers/:id — remove a customer */
async function deleteCustomer(id) {
    return apiRequest(`/customers/${id}`, { method: 'DELETE' });
}

/* ════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════ */

let allCustomers   = [];   // master list from API
let filtered       = [];   // after search / gender filter
let sortKey        = 'name';
let sortAsc        = true;
let currentPage    = 1;
const PAGE_SIZE    = 10;

/* bootstrap modal instances (lazy-created) */
let viewModalInst, formModalInst, deleteModalInst;

/* ════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    // Bootstrap modal instances
    viewModalInst   = new bootstrap.Modal(document.getElementById('viewModal'));
    formModalInst   = new bootstrap.Modal(document.getElementById('formModal'));
    deleteModalInst = new bootstrap.Modal(document.getElementById('deleteModal'));

    // Live search & filter
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('genderFilter').addEventListener('change', applyFilters);

    loadCustomers();
});

/* ════════════════════════════════════════════════════════════
   LOAD & RENDER
════════════════════════════════════════════════════════════ */

async function loadCustomers() {
    showLoading();
    try {
        allCustomers = await getAllCustomers();
        applyFilters();
    } catch (err) {
        showError(`Failed to load customers: ${err.message}`);
        toast(`Error: ${err.message}`, 'error');
    }
}

function applyFilters() {
    const search = document.getElementById('searchInput').value.toLowerCase().trim();
    const gender = document.getElementById('genderFilter').value;

    filtered = allCustomers.filter(c => {
        const matchSearch = !search
            || c.name.toLowerCase().includes(search)
            || (c.country || '').toLowerCase().includes(search);
        const matchGender = !gender || c.gender === gender;
        return matchSearch && matchGender;
    });

    currentPage = 1;
    sortAndRender();
}

function sortAndRender() {
    filtered.sort((a, b) => {
        let va = a[sortKey] ?? '';
        let vb = b[sortKey] ?? '';
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ?  1 : -1;
        return 0;
    });

    document.getElementById('totalCount').textContent = filtered.length;
    renderTable();
    renderPagination();
}

function renderTable() {
    const tbody  = document.getElementById('customersBody');
    const start  = (currentPage - 1) * PAGE_SIZE;
    const page   = filtered.slice(start, start + PAGE_SIZE);

    if (page.length === 0) {
        tbody.innerHTML = `
            <tr class="state-row">
                <td colspan="5">
                    <i class="bi bi-inbox" style="font-size:1.6rem;display:block;margin-bottom:8px;"></i>
                    No customers found.
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = page.map(c => `
        <tr>
            <td>${escHtml(c.properties.name)}</td>
            <td class="muted">${c.properties.age ?? '—'}</td>
            <td>${genderBadge(c.properties.gender)}</td>
            <td>${countryCell(c.properties.country)}</td>
            <td>
                <div class="actions-cell">
                    <button class="btn-icon view" title="View details"   onclick="openViewModal('${c.properties.id}')">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button class="btn-icon edit" title="Edit customer"   onclick="openEditModal('${c.properties.id}')">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn-icon del"  title="Remove customer" onclick="openDeleteModal('${c.properties.id}', '${escHtml(c.properties.name)}')">
                        <i class="bi bi-trash3"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderPagination() {
    const total    = filtered.length;
    const pages    = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start    = Math.min((currentPage - 1) * PAGE_SIZE + 1, total);
    const end      = Math.min(currentPage * PAGE_SIZE, total);

    document.getElementById('paginationInfo').innerHTML =
        total === 0
            ? ''
            : `Showing <b>${start}–${end}</b> of <b>${total}</b>`;

    const btns = document.getElementById('paginationBtns');
    btns.innerHTML = '';

    // Prev
    const prev = paginationBtn('<i class="bi bi-chevron-left"></i>', currentPage === 1);
    prev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTable(); renderPagination(); } });
    btns.appendChild(prev);

    // Page numbers (show up to 5 around current)
    const range = pageRange(currentPage, pages);
    range.forEach(p => {
        if (p === '…') {
            const dots = document.createElement('button');
            dots.className = 'pg-btn';
            dots.disabled = true;
            dots.textContent = '…';
            btns.appendChild(dots);
        } else {
            const btn = paginationBtn(p, false, p === currentPage);
            btn.addEventListener('click', () => { currentPage = p; renderTable(); renderPagination(); });
            btns.appendChild(btn);
        }
    });

    // Next
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
    if (sortKey === key) {
        sortAsc = !sortAsc;
    } else {
        sortKey = key;
        sortAsc = true;
    }

    // Update header classes
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
        <div style="text-align:center;padding:20px;">
            <div class="spinner-ring"></div>
        </div>`;
    viewModalInst.show();

    try {
        let c = await getCustomerById(id);
        c = c[0]

        document.getElementById('viewModalBody').innerHTML = `
            <div class="detail-row">
                <span class="detail-label">Name</span>
                <span class="detail-value">${escHtml(c.properties.name)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Age</span>
                <span class="detail-value">${c.properties.age ?? '—'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Gender</span>
                <span class="detail-value">${genderBadge(c.properties.gender)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Country</span>
                <span class="detail-value">${countryCell(c.properties.country)}</span>
            </div>
            ${c.id ? `<div class="detail-row">
                <span class="detail-label">ID</span>
                <span class="detail-value" style="font-family:'Space Mono',monospace;font-size:0.78rem;color:var(--text-muted)">${c.properties.id}</span>
            </div>` : ''}
        `;

        // Wire "Edit" button in view modal
        document.getElementById('viewToEditBtn').onclick = () => {
            viewModalInst.hide();
            openEditModal(c.properties.id);
        };
    } catch (err) {
        document.getElementById('viewModalBody').innerHTML =
            `<p style="color:var(--accent-red);font-family:'Space Mono',monospace;font-size:0.8rem;">
                Error loading customer: ${err.message}
            </p>`;
    }
}

/* ════════════════════════════════════════════════════════════
   FORM MODAL  (New & Edit)
════════════════════════════════════════════════════════════ */

function openNewModal() {
    document.getElementById('formModalTitle').innerHTML =
        '<i class="bi bi-person-plus me-2" style="color:var(--accent-green)"></i>New Customer';
    document.getElementById('formCustomerId').value = '';
    document.getElementById('formName').value    = '';
    document.getElementById('formAge').value     = '';
    document.getElementById('formGender').value  = '';
    document.getElementById('formCountry').value = '';
    document.getElementById('formError').style.display = 'none';
    formModalInst.show();
}

async function openEditModal(id) {
    document.getElementById('formModalTitle').innerHTML =
        '<i class="bi bi-pencil me-2" style="color:var(--accent-yellow)"></i>Edit Customer';
    document.getElementById('formError').style.display = 'none';

    // Pre-fill from local cache if available; otherwise fetch
    let customer = allCustomers.find(c => String(c.id) === String(id));
    if (!customer) {
        try { customer = await getCustomerById(id); } catch (err) {
            toast(`Could not load customer: ${err.message}`, 'error');
            return;
        }
    }

    customer = customer[0]

    document.getElementById('formCustomerId').value = customer.properties.id;
    document.getElementById('formName').value       = customer.properties.name    || '';
    document.getElementById('formAge').value        = customer.properties.age     ?? '';
    document.getElementById('formGender').value     = customer.properties.gender  || '';
    document.getElementById('formCountry').value    = customer.properties.country || '';

    formModalInst.show();
}

async function submitForm() {
    const id      = document.getElementById('formCustomerId').value;
    const name    = document.getElementById('formName').value.trim();
    const age     = parseInt(document.getElementById('formAge').value, 10);
    const gender  = document.getElementById('formGender').value;
    const country = document.getElementById('formCountry').value.trim();
    const errEl   = document.getElementById('formError');

    // Basic validation
    if (!name || !country || !gender || isNaN(age)) {
        errEl.textContent = 'Please fill in all fields correctly.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';

    const btn = document.getElementById('formSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i> Saving…';

    const payload = { name, age, gender, country };

    try {
        if (id) {
            // Edit
            const updated = await updateCustomer(id, payload);
            const idx = allCustomers.findIndex(c => String(c.id) === String(id));
            if (idx !== -1) allCustomers[idx] = updated ?? { ...payload, id };
            toast('Customer updated successfully.', 'success');
        } else {
            // Create
            const created = await createCustomer(payload);
            allCustomers.push(created.properties ?? payload);
            toast('Customer created successfully.', 'success');
        }

        formModalInst.hide();
        loadCustomers();
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
    document.getElementById('deleteCustomerId').value  = id;
    document.getElementById('deleteCustomerName').textContent = name;
    deleteModalInst.show();
}

async function confirmDelete() {
    const id = document.getElementById('deleteCustomerId').value;
    try {
        await deleteCustomer(id);
        allCustomers = allCustomers.filter(c => String(c.id) !== String(id));
        deleteModalInst.hide();
        loadCustomers();
        toast('Customer removed.', 'success');
    } catch (err) {
        deleteModalInst.hide();
        toast(`Error: ${err.message}`, 'error');
    }
}

/* ════════════════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════════════════ */

function showLoading() {
    document.getElementById('customersBody').innerHTML = `
        <tr class="state-row">
            <td colspan="5">
                <div class="spinner-ring"></div><br>Loading customers…
            </td>
        </tr>`;
}

function showError(msg) {
    document.getElementById('customersBody').innerHTML = `
        <tr class="state-row">
            <td colspan="5">
                <i class="bi bi-exclamation-triangle" style="font-size:1.4rem;color:var(--accent-red);display:block;margin-bottom:8px;"></i>
                ${escHtml(msg)}
            </td>
        </tr>`;
}

function genderBadge(gender) {
    if (!gender) return '<span style="color:var(--text-muted)">—</span>';
    const icon = gender === 'female' ? 'bi-gender-female' : gender === 'male' ? 'bi-gender-male' : 'bi-gender-ambiguous';
    return `<span class="gender-badge ${gender}"><i class="bi ${icon}"></i>${gender}</span>`;
}

function countryCell(country) {
    if (!country) return '<span style="color:var(--text-muted)">—</span>';
    return `<div class="country-cell"><span>${escHtml(country)}</span></div>`;
}

/** Prevent XSS when injecting user data into innerHTML */
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* ── TOAST ─────────────────────────────────────────────── */

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
