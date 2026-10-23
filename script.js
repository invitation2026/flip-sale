// ================================================================
// Sales Manager · Flipkart + Cashify
// Dual Firebase · Returns Smart Search (brand-aware, multi-token)
// ================================================================

// ---------- FIREBASE ----------
const flipkartConfig = {
    apiKey: "AIzaSyDGJWdgj2GBL-44gXZ9W0mWnOfsczwPXdw",
    authDomain: "mobile-shop-9ea44.firebaseapp.com",
    databaseURL: "https://mobile-shop-9ea44-default-rtdb.firebaseio.com",
    projectId: "mobile-shop-9ea44",
    storageBucket: "mobile-shop-9ea44.firebasestorage.app",
    messagingSenderId: "902893829958",
    appId: "1:902893829958:web:f2f429ad9290c56f4d6f47",
    measurementId: "G-V4JQT7Z8T9"
};
firebase.initializeApp(flipkartConfig);
const flipkartDb = firebase.database();

const cashifyConfig = {
    apiKey: "AIzaSyD1XNPVJfKzPoNgxo5R33zxOCebH2H613w",
    authDomain: "cashify-1cea1.firebaseapp.com",
    databaseURL: "https://cashify-1cea1-default-rtdb.firebaseio.com",
    projectId: "cashify-1cea1",
    storageBucket: "cashify-1cea1.firebasestorage.app",
    messagingSenderId: "141846449557",
    appId: "1:141846449557:web:8afe3b2c843b1297a3fa9c",
    measurementId: "G-SNC5ELYPL6"
};
const cashifyApp = firebase.initializeApp(cashifyConfig, "cashifyApp");
const cashifyDb = cashifyApp.database();

// ---------- HELPERS ----------
function getDb(source) { return source === 'cashify' ? cashifyDb : flipkartDb; }
function getSourceLabel(source) { return source === 'cashify' ? 'Cashify' : 'Flipkart'; }

const COMMISSION_BRACKETS = [
    { min: 0, max: 10000, type: 'percentage', value: 10 },
    { min: 10001, max: 31000, type: 'percentage', value: 8 },
    { min: 31001, max: Infinity, type: 'fixed', value: 2500 }
];
function calculateCommission(purchasePrice) {
    if (!purchasePrice || purchasePrice <= 0) return 0;
    for (const b of COMMISSION_BRACKETS) {
        if (purchasePrice >= b.min && purchasePrice <= b.max) {
            if (b.type === 'percentage') return Math.round((purchasePrice * b.value) / 100);
            return b.value;
        }
    }
    return 0;
}
function getLocalYMD(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatTimeShort(d = new Date()) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function refreshIcons() { if (window.lucide) { try { lucide.createIcons(); } catch (e) {} } }

// ================================================================
// SMART SEARCH ENGINE — brand-aware, multi-token
// ================================================================

// Brand alias map — expand typed brand to all related sub-brands
const BRAND_ALIASES = {
    // Apple
    'apple':    ['apple', 'iphone'],
    'iphone':   ['iphone', 'apple'],
    // Samsung
    'samsung':  ['samsung', 'galaxy'],
    'galaxy':   ['galaxy', 'samsung'],
    // Xiaomi family
    'xiaomi':   ['xiaomi', 'redmi', 'poco', 'mi'],
    'redmi':    ['redmi', 'xiaomi', 'mi'],
    'poco':     ['poco', 'xiaomi', 'redmi'],
    'mi':       ['mi', 'xiaomi', 'redmi', 'poco'],
    // Google
    'google':   ['google', 'pixel'],
    'pixel':    ['pixel', 'google'],
    // Motorola
    'motorola': ['motorola', 'moto'],
    'moto':     ['moto', 'motorola'],
    // Vivo / iQOO
    'vivo':     ['vivo', 'iqoo'],
    'iqoo':     ['iqoo', 'vivo'],
    // Sony
    'sony':     ['sony', 'xperia'],
    'xperia':   ['xperia', 'sony'],
    // Asus
    'asus':     ['asus', 'zenfone', 'rog'],
    'zenfone':  ['zenfone', 'asus'],
    'rog':      ['rog', 'asus'],
    // Huawei
    'huawei':   ['huawei', 'honor'],
    'honor':    ['honor', 'huawei'],
    // Others (single-brand, listed for clarity)
    'oneplus':  ['oneplus'],
    'realme':   ['realme'],
    'oppo':     ['oppo'],
    'nokia':    ['nokia'],
    'nothing':  ['nothing'],
    'infinix':  ['infinix'],
    'tecno':    ['tecno'],
    'itel':     ['itel'],
    'lava':     ['lava'],
    'micromax': ['micromax'],
    'lenovo':   ['lenovo'],
    'lg':       ['lg'],
    'htc':      ['htc'],
    'blackberry': ['blackberry'],
    'panasonic': ['panasonic'],
    'alcatel':  ['alcatel'],
};

function normalizeSearchText(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')   // non-alphanumeric → space
        .replace(/\s+/g, ' ')
        .trim();
}

// Attach precomputed search blobs to a phone record (idempotent)
function decorateForSearch(item) {
    if (!item) return item;
    if (item._searchBlob !== undefined) return item;
    const parts = [
        item.phoneModel,
        item.brand,
        item.model,
        item.orderId,
        item.id,
        item.customerName,
        item.buyerName,
        item.imei,
        item.imei2,
        item.color,
        item.ram,
        item.storage,
        item.ramStorage,
        item.networkType,
    ].filter(Boolean);
    item._searchBlob = normalizeSearchText(parts.join(' '));
    item._searchBlobCompact = item._searchBlob.replace(/\s+/g, '');
    return item;
}

// Single token matches blob or its compact form or via brand aliases
function tokenMatchesBlob(tok, blob, compactBlob) {
    if (!tok) return false;
    // Direct substring
    if (blob.includes(tok)) return true;
    if (tok.length >= 3 && compactBlob.includes(tok)) return true;
    // Brand alias expansion
    const aliases = BRAND_ALIASES[tok];
    if (aliases) {
        for (const a of aliases) {
            const aNorm = normalizeSearchText(a);
            if (!aNorm) continue;
            if (blob.includes(aNorm)) return true;
            const aCompact = aNorm.replace(/\s+/g, '');
            if (aCompact.length >= 3 && compactBlob.includes(aCompact)) return true;
        }
    }
    return false;
}

// Main matcher
function phoneMatchesQuery(item, rawQuery) {
    const normQuery = normalizeSearchText(rawQuery);
    if (!normQuery) return true;

    const blob = item._searchBlob || '';
    const compactBlob = item._searchBlobCompact || '';
    const compactQuery = normQuery.replace(/\s+/g, '');
    const digits = String(rawQuery || '').replace(/\D/g, '');

    // 1. IMEI / orderId digit match (≥4 digits)
    if (digits.length >= 4) {
        const imei = String(item.imei || '').replace(/\D/g, '');
        const imei2 = String(item.imei2 || '').replace(/\D/g, '');
        const ord = String(item.orderId || item.id || '').replace(/\D/g, '');
        if (imei.includes(digits) || imei2.includes(digits) || ord.includes(digits)) return true;
    }

    // 2. Exact phrase (with spaces)
    if (blob.includes(normQuery)) return true;

    // 3. Exact phrase (compact — no spaces)
    if (compactQuery && compactBlob.includes(compactQuery)) return true;

    // 4. Token-based (each typed token must match via substring or brand alias)
    const tokens = normQuery.split(' ').filter(Boolean);
    if (!tokens.length) return false;
    for (const tok of tokens) {
        if (!tokenMatchesBlob(tok, blob, compactBlob)) return false;
    }
    return true;
}

// ================================================================
// STATE
// ================================================================
let currentView = 'inventory';
let currentSource = 'flipkart';
let inventoryList = [];
let filteredInventory = [];
let sellOrderData = null;
let isRefreshing = false;

const overheadCache = { flipkart: { ts: 0, value: 0 }, cashify: { ts: 0, value: 0 } };
const OVERHEAD_TTL = 10 * 60 * 1000;
const lastUpdatedBySource = { flipkart: null, cashify: null };

// Returns state — cache-first (no re-fetch per keystroke)
let allSoldPhonesBoth = [];
let filteredReturnResults = [];
let selectedReturnPhone = null;
let selectedExchangePhone = null;
let allExchangeInventoryBoth = [];
let returnsDataLoaded = false;
let returnSearchDebounce = null;
let exchangeSearchDebounce = null;

const MAX_RETURN_RESULTS = 150;
const MAX_EXCHANGE_RESULTS = 60;

const toastEl = document.getElementById('toast');

// ---------- TOAST ----------
function showToast(msg, type = 'info', duration = 3000) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'toast-fixed ' + type;
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ---------- CONNECTION ----------
function setupOfflineDetection() {
    const updateStatus = () => {
        const isOnline = navigator.onLine;
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        const container = document.getElementById('connectionStatus');
        if (!container) return;
        if (isOnline) {
            container.className = 'hidden sm:flex items-center gap-1.5 px-3 py-1 bg-green-50 rounded-full text-xs font-medium text-green-700';
            if (dot) dot.className = 'w-2 h-2 bg-green-500 rounded-full pulse-ring';
            if (text) text.textContent = 'Online';
        } else {
            container.className = 'hidden sm:flex items-center gap-1.5 px-3 py-1 bg-red-50 rounded-full text-xs font-medium text-red-700';
            if (dot) dot.className = 'w-2 h-2 bg-red-500 rounded-full';
            if (text) text.textContent = 'Offline';
        }
    };
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
}

// ================================================================
// VIEW TOGGLE
// ================================================================
function switchView(view) {
    if (view !== 'inventory' && view !== 'returns') return;
    if (currentView === view) return;
    currentView = view;

    document.getElementById('viewBtnInventory').classList.toggle('active', view === 'inventory');
    document.getElementById('viewBtnReturns').classList.toggle('active', view === 'returns');
    document.getElementById('inventoryView').style.display = view === 'inventory' ? 'block' : 'none';
    document.getElementById('returnsView').style.display = view === 'returns' ? 'block' : 'none';

    if (view === 'returns' && !returnsDataLoaded) {
        initReturnsView();
    }
    refreshIcons();
}

// ================================================================
// INVENTORY (unchanged)
// ================================================================
function switchSource(source) {
    if (source !== 'flipkart' && source !== 'cashify') return;
    if (currentSource === source) return;
    currentSource = source;

    document.querySelectorAll('#sourceTabs .source-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.source === source);
    });

    const accentClass = source === 'cashify' ? 'cashify-accent' : 'flipkart-accent';
    const statStock = document.getElementById('statCardStock');
    const statSold = document.getElementById('statCardSold');
    if (statStock) { statStock.classList.remove('flipkart-accent', 'cashify-accent'); statStock.classList.add(accentClass); }
    if (statSold) { statSold.classList.remove('flipkart-accent', 'cashify-accent'); statSold.classList.add(accentClass); }

    const searchInput = document.getElementById('inventorySearch');
    if (searchInput) searchInput.value = '';

    inventoryList = [];
    filteredInventory = [];
    renderInventory();
    loadInventory();
}

async function loadInventory() {
    const db = getDb(currentSource);
    showToast('🔄 Loading ' + getSourceLabel(currentSource) + ' inventory…', 'info', 1500);
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        inventoryList = Object.entries(data)
            .filter(([_, item]) => item.status === 'pickup' && !item.sold)
            .map(([id, item]) => ({ id, ...item, _source: currentSource }));
        inventoryList.sort((a, b) => {
            const ta = new Date(a.timestamp || 0).getTime() || 0;
            const tb = new Date(b.timestamp || 0).getTime() || 0;
            return tb - ta;
        });
        lastUpdatedBySource[currentSource] = Date.now();
        applySearch();
        updateStats(data);
        updateLastUpdatedLabel();
    } catch (e) {
        console.error('Inventory load error:', e);
        showToast('Error loading ' + getSourceLabel(currentSource) + ' inventory', 'error');
        const tbody = document.getElementById('inventoryTableBody');
        const cards = document.getElementById('inventoryCards');
        const errHtml = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Failed to load inventory</p></div>`;
        if (cards) cards.innerHTML = errHtml;
        if (tbody) tbody.innerHTML = `<tr><td colspan="7">${errHtml}</td></tr>`;
        refreshIcons();
    }
}

function updateStats(pickupsData) {
    if (!pickupsData) {
        getDb(currentSource).ref('pickups').once('value').then(snap => updateStats(snap.val() || {})).catch(() => {});
        return;
    }
    let soldCount = 0;
    Object.values(pickupsData).forEach(item => { if (item.sold === true) soldCount++; });
    const elInv = document.getElementById('statInventory');
    const elSold = document.getElementById('statSold');
    if (elInv) elInv.textContent = inventoryList.length;
    if (elSold) elSold.textContent = soldCount;
}

function updateLastUpdatedLabel() {
    const el = document.getElementById('lastUpdated');
    if (!el) return;
    const ts = lastUpdatedBySource[currentSource];
    if (!ts) { el.textContent = ''; return; }
    el.textContent = 'Updated ' + formatTimeShort(new Date(ts));
}

function applySearch() {
    const searchInput = document.getElementById('inventorySearch');
    const raw = (searchInput ? searchInput.value : '').trim().toLowerCase();
    if (!raw) {
        filteredInventory = [...inventoryList];
    } else {
        filteredInventory = inventoryList.filter(item => {
            const orderId = String(item.orderId || item.id || '').toLowerCase();
            const model = String(item.phoneModel || '').toLowerCase();
            const imei = String(item.imei || '').toLowerCase();
            const imei2 = String(item.imei2 || '').toLowerCase();
            const cust = String(item.customerName || '').toLowerCase();
            return orderId.includes(raw) || model.includes(raw) || imei.includes(raw) || imei2.includes(raw) || cust.includes(raw);
        });
    }
    renderInventory();
    const countEl = document.getElementById('inventoryCount');
    if (countEl) countEl.textContent = filteredInventory.length + ' phone' + (filteredInventory.length === 1 ? '' : 's');
}

function clearSearch() {
    const searchInput = document.getElementById('inventorySearch');
    if (searchInput) searchInput.value = '';
    applySearch();
}

function renderInventory() { renderMobileCards(); renderDesktopTable(); refreshIcons(); }

function renderMobileCards() {
    const container = document.getElementById('inventoryCards');
    if (!container) return;
    if (!filteredInventory.length) {
        container.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No inventory</p><p class="text-xs text-gray-400 mt-1">Phones picked up will appear here</p></div>`;
        return;
    }
    const srcClass = currentSource === 'cashify' ? 'cashify-src' : 'flipkart-src';
    const pillClass = currentSource === 'cashify' ? 'cashify' : 'flipkart';
    const pillLabel = getSourceLabel(currentSource);
    let html = '';
    filteredInventory.forEach(item => {
        const orderId = escapeHtml(item.orderId || item.id);
        const model = escapeHtml(item.phoneModel || '—');
        const imei = escapeHtml(item.imei || '—');
        const cust = escapeHtml(item.customerName || '—');
        html += `
            <div class="inventory-card ${srcClass}">
                <div class="flex items-start justify-between gap-2 mb-2 pl-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap mb-1">
                            <span class="src-pill ${pillClass}"><span class="dot"></span>${pillLabel}</span>
                        </div>
                        <div class="font-mono font-bold text-gray-800 text-sm truncate">${orderId}</div>
                        <div class="text-sm text-gray-700 font-medium truncate mt-0.5">${model}</div>
                    </div>
                </div>
                <div class="pl-2 space-y-1 text-xs text-gray-500">
                    <div class="flex items-center gap-1.5"><i data-lucide="hash" class="w-3 h-3 flex-shrink-0"></i><span class="font-mono truncate">${imei}</span></div>
                    <div class="flex items-center gap-1.5"><i data-lucide="user" class="w-3 h-3 flex-shrink-0"></i><span class="truncate">${cust}</span></div>
                </div>
                <div class="flex gap-2 mt-3 pl-2">
                    <button onclick="openSellModal('${item.id}')" class="btn-action success flex-1"><i data-lucide="badge-dollar-sign"></i> Sell</button>
                    <button onclick="viewOrderDetail('${item.id}', '${currentSource}')" class="btn-action view" title="View"><i data-lucide="eye"></i></button>
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

function renderDesktopTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    if (!filteredInventory.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No inventory</p></div></td></tr>`;
        return;
    }
    const pillClass = currentSource === 'cashify' ? 'cashify' : 'flipkart';
    const pillLabel = getSourceLabel(currentSource);
    let html = '';
    filteredInventory.forEach((item, idx) => {
        const orderId = escapeHtml(item.orderId || item.id);
        const model = escapeHtml(item.phoneModel || '—');
        const imei = escapeHtml(item.imei || '—');
        const cust = escapeHtml(item.customerName || '—');
        html += `
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
                <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
                <td class="py-3 px-4"><span class="src-pill ${pillClass}"><span class="dot"></span>${pillLabel}</span></td>
                <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${orderId}</td>
                <td class="py-3 px-4 text-gray-600 text-sm">${model}</td>
                <td class="py-3 px-4 font-mono text-xs text-gray-500">${imei}</td>
                <td class="py-3 px-4 text-gray-600 text-sm">${cust}</td>
                <td class="py-3 px-4">
                    <div class="flex items-center gap-2">
                        <button onclick="openSellModal('${item.id}')" class="btn-action success" style="padding:8px 14px;min-height:38px;font-size:12px;"><i data-lucide="badge-dollar-sign" style="width:16px;height:16px;"></i> Sell</button>
                        <button onclick="viewOrderDetail('${item.id}', '${currentSource}')" class="btn-action view" style="padding:8px 12px;min-height:38px;" title="View"><i data-lucide="eye" style="width:16px;height:16px;"></i></button>
                    </div>
                </td>
            </tr>`;
    });
    tbody.innerHTML = html;
}

// ---------- OVERHEAD ----------
async function computeOverheadPerPhone(source) {
    const db = getDb(source);
    const [usersSnap, attendanceSnap, pickupsSnap] = await Promise.all([
        db.ref('users').once('value'),
        db.ref('attendance').once('value'),
        db.ref('pickups').once('value')
    ]);
    const users = usersSnap.val() || {};
    const attendance = attendanceSnap.val() || {};
    const pickups = pickupsSnap.val() || {};
    const today = new Date();
    let totalOverhead = 0;

    for (const [uname, uData] of Object.entries(users)) {
        const role = uData.role || 'agent';
        if (role !== 'agent') continue;
        const monthlySalary = Number(uData.salary) || 0;
        if (monthlySalary <= 0) continue;
        const perDaySalary = monthlySalary / 30;
        let joinDate = null;
        if (uData.joinDate) joinDate = new Date(uData.joinDate + 'T00:00:00');
        else if (uData.createdAt) joinDate = new Date(uData.createdAt);
        if (!joinDate || isNaN(joinDate)) joinDate = new Date(today);
        let cur = new Date(joinDate);
        while (cur <= today) {
            const ds = getLocalYMD(cur);
            const att = (attendance[uname] && attendance[uname][ds]) || {};
            const isPresent = att.status === 'present';
            const salaryCounted = att.salary_counted !== false;
            if (isPresent && salaryCounted) {
                totalOverhead += (att.half_day === true) ? perDaySalary * 0.5 : perDaySalary;
            }
            cur.setDate(cur.getDate() + 1);
        }
    }

    let totalPickupIncentives = 0;
    let totalRejectIncentives = 0;
    Object.values(pickups).forEach(item => {
        if (!item || item.status === 'on_hold') return;
        const agent = item.agent;
        if (!agent) return;
        const uData = users[agent];
        if (!uData || (uData.role || 'agent') !== 'agent') return;
        if (item.status === 'pickup') totalPickupIncentives += Number(uData.pickup_incentive) || 0;
        else if (item.status === 'rejected' && Boolean(item.incentive_approved)) totalRejectIncentives += Number(uData.reject_incentive) || 0;
    });
    totalOverhead += totalPickupIncentives + totalRejectIncentives;

    let totalSold = 0;
    Object.values(pickups).forEach(item => { if (item && item.status === 'pickup' && item.sold) totalSold++; });
    return totalSold > 0 ? totalOverhead / totalSold : 0;
}

async function getOverheadPerPhone(source, force = false) {
    const cached = overheadCache[source];
    if (!force && cached && cached.value > 0 && (Date.now() - cached.ts < OVERHEAD_TTL)) return cached.value;
    try {
        const value = await computeOverheadPerPhone(source);
        overheadCache[source] = { ts: Date.now(), value };
        return value;
    } catch (e) {
        console.warn('Overhead calc failed:', e);
        return cached ? cached.value : 0;
    }
}

// ---------- SELL MODAL ----------
function openSellModal(orderId) {
    const order = inventoryList.find(item => item.id === orderId);
    if (!order) { showToast('Order not found in inventory', 'error'); return; }
    sellOrderData = order;

    document.getElementById('sellOrderId').value = order.orderId || order.id;
    document.getElementById('sellModel').value = order.phoneModel || '—';
    document.getElementById('sellImei').value = order.imei || '—';
    document.getElementById('sellCustomer').value = order.customerName || '—';
    document.getElementById('sellSalePrice').value = '';
    document.getElementById('sellBuyerName').value = '';
    document.getElementById('sellBuyerContact').value = '';
    document.getElementById('sellSaleDate').value = getLocalYMD();

    const banner = document.getElementById('sellSourceBanner');
    if (banner) {
        if (currentSource === 'cashify') {
            banner.style.background = '#E6FAF6'; banner.style.color = '#0FA88B'; banner.style.border = '1px solid #a7f3d0';
            banner.innerHTML = `<span style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:#12CAA7;display:inline-block;"></span>Selling from Cashify</span><span>CASHIFY</span>`;
        } else {
            banner.style.background = '#eef2ff'; banner.style.color = '#4338ca'; banner.style.border = '1px solid #c7d2fe';
            banner.innerHTML = `<span style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:#6366f1;display:inline-block;"></span>Selling from Flipkart</span><span>FLIPKART</span>`;
        }
    }

    const modal = document.getElementById('sellModal');
    if (modal) modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    refreshIcons();
    setTimeout(() => { const inp = document.getElementById('sellSalePrice'); if (inp) inp.focus(); }, 300);
}

function closeSellModal() {
    const modal = document.getElementById('sellModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    sellOrderData = null;
}

async function confirmSell() {
    if (!sellOrderData) return;
    const salePriceRaw = document.getElementById('sellSalePrice').value.trim();
    const buyerName = document.getElementById('sellBuyerName').value.trim();
    const buyerContact = document.getElementById('sellBuyerContact').value.trim();
    const saleDate = document.getElementById('sellSaleDate').value || getLocalYMD();
    const salePrice = parseFloat(salePriceRaw);

    if (!salePrice || salePrice <= 0 || isNaN(salePrice)) { showToast('Please enter a valid sale price', 'error'); document.getElementById('sellSalePrice').focus(); return; }
    if (!buyerName) { showToast('Please enter buyer name', 'error'); document.getElementById('sellBuyerName').focus(); return; }

    const order = sellOrderData;
    const source = currentSource;
    const sourceLabel = getSourceLabel(source);

    const confirm = await Swal.fire({
        title: 'Confirm Sale',
        html: `
            <div style="text-align:left;font-size:14px;line-height:1.7;">
                <div style="margin-bottom:6px;">
                    <span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;letter-spacing:0.4px;background:${source === 'cashify' ? '#E6FAF6' : '#eef2ff'};color:${source === 'cashify' ? '#0FA88B' : '#4338ca'};border:1px solid ${source === 'cashify' ? '#a7f3d0' : '#c7d2fe'};">${sourceLabel.toUpperCase()}</span>
                </div>
                <p><strong>Order:</strong> ${escapeHtml(order.orderId || order.id)}</p>
                <p><strong>Model:</strong> ${escapeHtml(order.phoneModel || '—')}</p>
                <p><strong>Sale Price:</strong> ₹${salePrice.toLocaleString('en-IN')}</p>
                <p><strong>Buyer:</strong> ${escapeHtml(buyerName)}</p>
                <p><strong>Sale Date:</strong> ${escapeHtml(saleDate)}</p>
            </div>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: '✅ Confirm Sale',
        cancelButtonText: 'Cancel'
    });

    if (!confirm.isConfirmed) return;

    const confirmBtn = document.getElementById('confirmSellBtn');
    const originalBtnHtml = confirmBtn ? confirmBtn.innerHTML : '';
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.innerHTML = '<span class="spinner-sm" style="width:16px;height:16px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.35);"></span> Saving…'; }

    try {
        const overhead = await getOverheadPerPhone(source, false);
        const purchase = Number(order.value) || 0;
        let writePayload = {
            sold: true, returned: false,
            salePrice, buyerName, buyerContact: buyerContact || '', saleDate,
            saleTimestamp: new Date().toISOString()
        };

        if (source === 'flipkart') {
            const commission = calculateCommission(purchase);
            const grossProfit = salePrice - purchase - commission;
            const finalProfit = grossProfit - overhead;
            writePayload.commission = commission;
            writePayload.grossProfit = grossProfit;
            writePayload.finalNetProfit = finalProfit;
            writePayload.profit = grossProfit;
        } else {
            const coins = Number(order.coins) || 0;
            const rate = Number(order.coinValueRate) || 12.5;
            const coinsValue = (order.coinTotalValue !== undefined && order.coinTotalValue !== null) ? Number(order.coinTotalValue) : coins * rate;
            const actualCost = (order.actualTotalCost !== undefined && order.actualTotalCost !== null) ? Number(order.actualTotalCost) : purchase + coinsValue;
            const grossProfit = salePrice - actualCost;
            const finalProfit = grossProfit - overhead;
            writePayload.grossProfit = grossProfit;
            writePayload.finalNetProfit = finalProfit;
        }

        await getDb(source).ref('pickups/' + order.id).update(writePayload);
        showToast(`✅ Sold from ${sourceLabel} for ₹${salePrice.toLocaleString('en-IN')}`, 'success');
        closeSellModal();

        // Invalidate returns cache
        allSoldPhonesBoth = [];
        allExchangeInventoryBoth = [];
        returnsDataLoaded = false;

        await loadInventory();
    } catch (e) {
        console.error('Sale error:', e);
        showToast('Error saving sale. Please try again.', 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = originalBtnHtml || '<i data-lucide="check-circle" class="w-4 h-4"></i> Confirm Sale';
            refreshIcons();
        }
    }
}

// ---------- VIEW DETAIL ----------
async function viewOrderDetail(orderId, sourceOverride) {
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    if (!modal || !content) return;
    const source = sourceOverride || currentSource;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    content.innerHTML = `<div class="text-center py-8 text-gray-400"><span class="spinner-sm"></span><p class="text-sm mt-2">Loading...</p></div>`;

    try {
        const snap = await getDb(source).ref('pickups/' + orderId).once('value');
        const item = snap.val();
        if (!item) { content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium">Order not found</p></div>`; refreshIcons(); return; }

        const statusLabel = item.status || 'unknown';
        const isSold = item.sold === true;
        const isReturned = item.returned === true;
        let statusDisplay, statusClass;
        if (isReturned && !isSold) { statusDisplay = 'Returned'; statusClass = 'sold'; }
        else if (isSold) { statusDisplay = 'Sold'; statusClass = 'sold'; }
        else if (statusLabel === 'pickup') { statusDisplay = 'Pickup'; statusClass = 'available'; }
        else if (statusLabel === 'rejected') { statusDisplay = 'Rejected'; statusClass = 'rejected'; }
        else { statusDisplay = 'Pending'; statusClass = 'available'; }

        const sourceLabel = getSourceLabel(source);
        const pillClass = source === 'cashify' ? 'cashify' : 'flipkart';

        let saleHtml = '';
        if (isSold || isReturned) {
            saleHtml = `
                <div class="detail-item"><div class="label">Sale Price</div><div class="value">₹${Number(item.salePrice || item.lastSalePrice || 0).toLocaleString('en-IN')}</div></div>
                <div class="detail-item"><div class="label">Buyer</div><div class="value">${escapeHtml(item.buyerName || item.lastBuyerName || '—')}</div></div>
                <div class="detail-item"><div class="label">Sale Date</div><div class="value">${escapeHtml(item.saleDate || item.lastSaleDate || '—')}</div></div>
                ${isReturned ? `<div class="detail-item"><div class="label">Return Date</div><div class="value" style="color:#dc2626;">${escapeHtml(item.returnDate || '—')}</div></div>` : ''}
            `;
        }
        const ramStorage = item.ramStorage ? escapeHtml(item.ramStorage) : (item.ram && item.storage ? escapeHtml(item.ram + ' / ' + item.storage) : '—');
        content.innerHTML = `
            <div class="flex items-center gap-2 flex-wrap mb-4">
                <span class="badge-status ${statusClass} text-sm px-4 py-1.5">${statusDisplay}</span>
                <span class="src-pill ${pillClass}"><span class="dot"></span>${sourceLabel}</span>
                <span class="font-mono font-bold text-gray-800 text-sm">${escapeHtml(item.orderId || orderId)}</span>
            </div>
            <div class="detail-grid">
                <div class="detail-item"><div class="label">Phone Model</div><div class="value">${escapeHtml(item.phoneModel || '—')}</div></div>
                <div class="detail-item"><div class="label">IMEI</div><div class="value font-mono text-xs">${escapeHtml(item.imei || '—')}</div></div>
                ${item.imei2 ? `<div class="detail-item"><div class="label">IMEI 2</div><div class="value font-mono text-xs">${escapeHtml(item.imei2)}</div></div>` : ''}
                <div class="detail-item"><div class="label">RAM / Storage</div><div class="value">${ramStorage}</div></div>
                <div class="detail-item"><div class="label">Network</div><div class="value">${escapeHtml(item.networkType || '—')}</div></div>
                <div class="detail-item"><div class="label">Customer</div><div class="value">${escapeHtml(item.customerName || '—')}</div></div>
                <div class="detail-item"><div class="label">Reason</div><div class="value">${escapeHtml(item.reason || '—')}</div></div>
                <div class="detail-item"><div class="label">Time (IST)</div><div class="value text-xs">${escapeHtml(item.timestampIST || item.timestamp || '—')}</div></div>
                ${item.agent ? `<div class="detail-item"><div class="label">Agent</div><div class="value">${escapeHtml(item.agent)}</div></div>` : ''}
                ${saleHtml}
            </div>`;
        refreshIcons();
    } catch (err) {
        console.error('Detail load error:', err);
        content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error loading details</p></div>`;
        refreshIcons();
        showToast('Error loading order details', 'error');
    }
}

function closeDetailModal() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

// ---------- REFRESH (view-aware) ----------
async function refreshInventory() {
    if (isRefreshing) return;
    isRefreshing = true;
    showToast('🔄 Refreshing…', 'info', 1200);

    if (currentView === 'returns') {
        await refreshSoldPhonesCache();
        renderReturnSearchResults(document.getElementById('returnSearch')?.value || '');
        await loadReturnsHistory();
        await loadReturnsInventoryCounts();
    } else {
        overheadCache[currentSource] = { ts: 0, value: 0 };
        await loadInventory();
    }
    isRefreshing = false;
    showToast('✅ Refreshed', 'success', 1500);
}

// ================================================================
// RETURNS — Smart Search (brand-aware)
// ================================================================
async function initReturnsView() {
    try {
        await Promise.all([refreshSoldPhonesCache(), loadReturnsInventoryCounts()]);
        returnsDataLoaded = true;
        renderReturnSearchResults('');
        await loadReturnsHistory();
    } catch (e) {
        console.error('initReturnsView error:', e);
        const resultsEl = document.getElementById('returnSearchResults');
        if (resultsEl) resultsEl.innerHTML = `<div class="glass rounded-2xl p-6 text-center text-red-500 text-sm">Failed to load. Tap refresh to retry.</div>`;
    }
    refreshIcons();
}

async function refreshSoldPhonesCache() {
    const [fkSnap, cfSnap] = await Promise.all([
        flipkartDb.ref('pickups').once('value'),
        cashifyDb.ref('pickups').once('value')
    ]);
    const fk = fkSnap.val() || {};
    const cf = cfSnap.val() || {};
    const isSoldNotReturned = (item) =>
        item && item.status === 'pickup' && item.sold === true && item.returned !== true;

    const fkSold = Object.entries(fk)
        .filter(([_, item]) => isSoldNotReturned(item))
        .map(([id, item]) => decorateForSearch({ id, ...item, _source: 'flipkart' }));
    const cfSold = Object.entries(cf)
        .filter(([_, item]) => isSoldNotReturned(item))
        .map(([id, item]) => decorateForSearch({ id, ...item, _source: 'cashify' }));

    allSoldPhonesBoth = [...fkSold, ...cfSold].sort((a, b) => {
        const ta = new Date(a.saleTimestamp || a.timestamp || 0).getTime() || 0;
        const tb = new Date(b.saleTimestamp || b.timestamp || 0).getTime() || 0;
        return tb - ta;
    });
}

async function loadReturnsInventoryCounts() {
    try {
        const [fkSnap, cfSnap] = await Promise.all([
            flipkartDb.ref('pickups').once('value'),
            cashifyDb.ref('pickups').once('value')
        ]);
        const countUnsold = (data) => {
            let n = 0;
            Object.values(data || {}).forEach(item => { if (item && item.status === 'pickup' && !item.sold) n++; });
            return n;
        };
        const fkEl = document.getElementById('flipkartInvCount');
        const cfEl = document.getElementById('cashifyInvCount');
        if (fkEl) fkEl.textContent = countUnsold(fkSnap.val());
        if (cfEl) cfEl.textContent = countUnsold(cfSnap.val());
    } catch (e) { console.warn('Counts load failed:', e); }
}

// ---------- RETURN SEARCH ----------
function handleReturnSearchInput(value) {
    clearTimeout(returnSearchDebounce);
    returnSearchDebounce = setTimeout(() => renderReturnSearchResults(value), 150);
}

function renderReturnSearchResults(query) {
    const container = document.getElementById('returnSearchResults');
    if (!container) return;

    const q = String(query || '').trim();
    let filtered = allSoldPhonesBoth;
    if (q) {
        filtered = allSoldPhonesBoth.filter(item => phoneMatchesQuery(item, q));
    }
    filteredReturnResults = filtered;

    const infoEl = document.getElementById('returnSearchInfo');
    const countEl = document.getElementById('returnSearchCount');
    const total = allSoldPhonesBoth.length;

    if (infoEl) {
        if (!q) infoEl.textContent = `All sold phones · ${total} from both platforms`;
        else infoEl.textContent = `${filtered.length} match${filtered.length !== 1 ? 'es' : ''} for "${q}"`;
    }
    if (countEl) countEl.textContent = total > 0 ? `${total} sold` : '';

    if (!total) {
        container.innerHTML = `<div class="glass rounded-2xl p-6 text-center text-gray-400 text-sm">
            <i data-lucide="package" class="w-7 h-7 mx-auto mb-2" style="color:#cbd5e1;"></i>
            No sold phones yet on either platform.
        </div>`;
        refreshIcons();
        return;
    }
    if (!filtered.length) {
        container.innerHTML = `<div class="glass rounded-2xl p-6 text-center text-gray-400 text-sm">
            <i data-lucide="search-x" class="w-7 h-7 mx-auto mb-2" style="color:#cbd5e1;"></i>
            No matches for "${escapeHtml(q)}". Try a different model, brand, IMEI, or order ID.
        </div>`;
        refreshIcons();
        return;
    }

    const shown = filtered.slice(0, MAX_RETURN_RESULTS);
    const capped = filtered.length > MAX_RETURN_RESULTS;

    let html = `<div class="glass rounded-2xl p-3 shadow-sm border border-gray-100 space-y-2">`;
    html += `<p class="text-xs font-bold text-gray-500 px-2 py-1">${filtered.length} sold phone${filtered.length !== 1 ? 's' : ''} · Flipkart + Cashify${capped ? ` · showing first ${MAX_RETURN_RESULTS} — type more to narrow` : ''}</p>`;

    shown.forEach(item => {
        const src = item._source;
        const pillClass = src === 'cashify' ? 'cashify' : 'flipkart';
        const srcLabel = src === 'cashify' ? 'Cashify' : 'Flipkart';
        const salePrice = Number(item.salePrice) || 0;
        const saleDate = item.saleDate || (item.saleTimestamp ? getLocalYMD(new Date(item.saleTimestamp)) : '—');
        const isActive = selectedReturnPhone && selectedReturnPhone.id === item.id && selectedReturnPhone._source === src;

        html += `
            <div class="return-result-card ${isActive ? 'active' : ''}" onclick="selectReturnPhone('${item.id}', '${src}')">
                <div class="flex items-start justify-between gap-2 mb-1">
                    <div class="min-w-0 flex-1">
                        <div class="font-mono font-bold text-gray-800 text-sm truncate">${escapeHtml(item.orderId || item.id)}</div>
                        <div class="text-sm text-gray-700 font-medium truncate mt-0.5">${escapeHtml(item.phoneModel || '—')}</div>
                    </div>
                    <span class="src-pill ${pillClass}"><span class="dot"></span>${srcLabel}</span>
                </div>
                <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mt-1">
                    <span><i data-lucide="hash" class="w-3 h-3 inline"></i> ${escapeHtml(item.imei || '—')}</span>
                    <span class="text-green-700 font-semibold">₹${salePrice.toLocaleString('en-IN')}</span>
                    <span>${escapeHtml(saleDate)}</span>
                </div>
            </div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
    refreshIcons();
}

function clearReturnSearch() {
    const input = document.getElementById('returnSearch');
    if (input) input.value = '';
    renderReturnSearchResults('');
}

// ---------- SELECT RETURN PHONE ----------
function scrollToReturnSettlement() {
    const settlement = document.getElementById('returnTypeMoneyLabel');
    if (settlement) settlement.scrollIntoView({ behavior: 'instant', block: 'center' });
}

function selectReturnPhone(id, source) {
    if (selectedReturnPhone && selectedReturnPhone.id === id && selectedReturnPhone._source === source) {
        scrollToReturnSettlement();
        return;
    }
    const phone = allSoldPhonesBoth.find(p => p.id === id && p._source === source);
    if (!phone) { showToast('Phone not found', 'error'); return; }
    selectedReturnPhone = phone;
    selectedExchangePhone = null;
    document.querySelectorAll('#returnSearchResults .return-result-card').forEach(el => el.classList.remove('active'));
    renderReturnForm();
    scrollToReturnSettlement();
}

function cancelReturnSelection() {
    selectedReturnPhone = null;
    selectedExchangePhone = null;
    const section = document.getElementById('returnFormSection');
    if (section) { section.style.display = 'none'; section.innerHTML = ''; }
    document.querySelectorAll('#returnSearchResults .return-result-card').forEach(el => el.classList.remove('active'));
}

// ---------- RETURN FORM ----------
function renderReturnForm() {
    const section = document.getElementById('returnFormSection');
    if (!section) return;
    if (!selectedReturnPhone) { section.style.display = 'none'; section.innerHTML = ''; return; }

    const phone = selectedReturnPhone;
    const origSrc = phone._source;
    const sourceLabel = getSourceLabel(origSrc);
    const pillClass = origSrc === 'cashify' ? 'cashify' : 'flipkart';
    const salePrice = Number(phone.salePrice) || 0;
    const saleDate = phone.saleDate || (phone.saleTimestamp ? getLocalYMD(new Date(phone.saleTimestamp)) : '—');

    section.style.display = 'block';
    section.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <h4 class="font-bold text-gray-800 text-sm flex items-center gap-2">
                <i data-lucide="corner-down-left" class="w-4 h-4 text-red-600"></i>
                Process Return
            </h4>
            <button onclick="cancelReturnSelection()" class="text-xs text-red-600 font-semibold hover:underline">Cancel</button>
        </div>
        <div class="mb-4">
            <div class="flex items-center gap-2 flex-wrap mb-2">
                <span class="src-pill ${pillClass}"><span class="dot"></span>${sourceLabel}</span>
                <span class="font-mono font-bold text-gray-800 text-sm">${escapeHtml(phone.orderId || phone.id)}</span>
            </div>
            <div class="detail-grid">
                <div class="detail-item"><div class="label">Phone Model</div><div class="value">${escapeHtml(phone.phoneModel || '—')}</div></div>
                <div class="detail-item"><div class="label">IMEI</div><div class="value font-mono text-xs">${escapeHtml(phone.imei || '—')}</div></div>
                <div class="detail-item"><div class="label">Original Sale Price</div><div class="value green">₹${salePrice.toLocaleString('en-IN')}</div></div>
                <div class="detail-item"><div class="label">Original Sale Date</div><div class="value">${escapeHtml(saleDate)}</div></div>
                ${phone.buyerName ? `<div class="detail-item full"><div class="label">Buyer</div><div class="value">${escapeHtml(phone.buyerName)}</div></div>` : ''}
            </div>
        </div>
        <hr class="my-4 border-gray-100">
        <div class="mb-3">
            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Return Date</label>
            <input type="date" id="returnDate" class="input-field" value="${getLocalYMD()}" />
        </div>
        <div class="mb-3">
            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Return Settlement *</label>
            <div class="flex flex-col sm:flex-row gap-2 mt-1">
                <label class="return-type-label selected-money" id="returnTypeMoneyLabel">
                    <input type="radio" name="returnType" value="money" checked onchange="onReturnTypeChange()" />
                    <span>💵 Money Given</span>
                </label>
                <label class="return-type-label" id="returnTypeExchangeLabel">
                    <input type="radio" name="returnType" value="exchange" onchange="onReturnTypeChange()" />
                    <span>📱 Phone Exchange</span>
                </label>
            </div>
        </div>
        <div id="moneySection">
            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Amount Returned to Customer (₹) *</label>
            <input type="number" id="returnAmount" class="input-field" placeholder="Enter amount returned" min="0" step="1" />
        </div>
        <div id="exchangeSection" style="display:none;">
            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">
                Exchange Phone *
                <span class="text-gray-400 font-normal normal-case">(Flipkart or Cashify inventory)</span>
            </label>
            <div class="relative mt-1 mb-2">
                <input type="text" id="exchangePhoneSearch" class="input-field pr-10" placeholder="🔍 Search IMEI / model / brand / order ID..." autocomplete="off" oninput="handleExchangeSearchInput(this.value)" />
                <button type="button" onclick="clearExchangeSearchInput()" class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            </div>
            <p class="text-[11px] text-gray-400 mb-2" id="exchangeSearchInfo">Loading available inventory…</p>
            <div id="exchangeSearchResults" class="max-h-64 overflow-y-auto border border-gray-200 rounded-xl bg-white"></div>
            <div id="exchangePhoneDetails" class="mt-3"></div>
        </div>
        <div class="flex gap-2 mt-4">
            <button onclick="cancelReturnSelection()" class="btn-action view flex-1">Cancel</button>
            <button onclick="submitReturn()" id="processReturnBtn" class="btn-action success flex-1">
                <i data-lucide="check-circle"></i> Process Return
            </button>
        </div>
    `;
    refreshIcons();
}

function onReturnTypeChange() {
    const type = document.querySelector('input[name="returnType"]:checked')?.value || 'money';
    const moneySection = document.getElementById('moneySection');
    const exchangeSection = document.getElementById('exchangeSection');
    const moneyLabel = document.getElementById('returnTypeMoneyLabel');
    const exchangeLabel = document.getElementById('returnTypeExchangeLabel');
    if (moneySection) moneySection.style.display = type === 'money' ? 'block' : 'none';
    if (exchangeSection) exchangeSection.style.display = type === 'exchange' ? 'block' : 'none';
    if (moneyLabel) moneyLabel.classList.toggle('selected-money', type === 'money');
    if (exchangeLabel) exchangeLabel.classList.toggle('selected-exchange', type === 'exchange');

    if (type === 'exchange') {
        if (!allExchangeInventoryBoth.length) {
            loadExchangeInventoryBoth().then(() => renderExchangeResults(''));
        } else {
            renderExchangeResults('');
        }
    }
}

// ---------- EXCHANGE INVENTORY ----------
async function loadExchangeInventoryBoth() {
    const [fkSnap, cfSnap] = await Promise.all([
        flipkartDb.ref('pickups').once('value'),
        cashifyDb.ref('pickups').once('value')
    ]);
    const fk = fkSnap.val() || {};
    const cf = cfSnap.val() || {};
    const isAvailable = (item) => item && item.status === 'pickup' && !item.sold;

    const fkAvail = Object.entries(fk)
        .filter(([_, item]) => isAvailable(item))
        .map(([id, item]) => decorateForSearch({ id, ...item, _source: 'flipkart' }));
    const cfAvail = Object.entries(cf)
        .filter(([_, item]) => isAvailable(item))
        .map(([id, item]) => decorateForSearch({ id, ...item, _source: 'cashify' }));

    allExchangeInventoryBoth = [...fkAvail, ...cfAvail].sort((a, b) =>
        String(a.phoneModel || '').localeCompare(String(b.phoneModel || ''))
    );
}

function handleExchangeSearchInput(value) {
    clearTimeout(exchangeSearchDebounce);
    exchangeSearchDebounce = setTimeout(() => renderExchangeResults(value), 150);
}

function renderExchangeResults(query) {
    const container = document.getElementById('exchangeSearchResults');
    const infoEl = document.getElementById('exchangeSearchInfo');
    if (!container) return;

    const q = String(query || '').trim();
    let matches = allExchangeInventoryBoth;
    if (q) matches = matches.filter(item => phoneMatchesQuery(item, q));

    if (infoEl) {
        if (!q) infoEl.textContent = `${matches.length} available · type to filter`;
        else infoEl.textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''}`;
    }
    if (!matches.length) {
        container.innerHTML = `<div class="p-4 text-center text-gray-400 text-xs">${q ? 'No matching phones' : 'No available inventory'}</div>`;
        return;
    }

    const shown = matches.slice(0, MAX_EXCHANGE_RESULTS);
    const capped = matches.length > MAX_EXCHANGE_RESULTS;
    let html = '';
    shown.forEach(item => {
        const src = item._source;
        const pillClass = src === 'cashify' ? 'cashify' : 'flipkart';
        const srcLabel = src === 'cashify' ? 'Cashify' : 'Flipkart';
        const isSel = selectedExchangePhone && selectedExchangePhone.id === item.id && selectedExchangePhone._source === src;
        html += `
            <div class="exchange-pick-item ${isSel ? 'selected' : ''}" onclick="selectExchangePhone('${item.id}', '${src}')">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <span class="src-pill ${pillClass}"><span class="dot"></span>${srcLabel}</span>
                            <span class="font-mono text-[10px] text-gray-500">${escapeHtml(item.orderId || item.id)}</span>
                        </div>
                        <div class="font-semibold text-xs text-gray-800 truncate">${escapeHtml(item.phoneModel || '—')}</div>
                        <div class="text-[10px] text-gray-500 font-mono">${escapeHtml(item.imei || '—')}</div>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <div class="text-xs font-bold text-green-700">₹${(Number(item.value) || 0).toLocaleString('en-IN')}</div>
                        ${isSel ? '<div class="text-[10px] text-indigo-600 font-bold mt-0.5">✓ Selected</div>' : ''}
                    </div>
                </div>
            </div>`;
    });
    if (capped) html += `<div class="p-3 text-center text-xs text-gray-400">+${matches.length - MAX_EXCHANGE_RESULTS} more — type to narrow</div>`;
    container.innerHTML = html;
}

function selectExchangePhone(id, source) {
    const phone = allExchangeInventoryBoth.find(p => p.id === id && p._source === source);
    if (!phone) return;
    selectedExchangePhone = phone;
    const input = document.getElementById('exchangePhoneSearch');
    renderExchangeResults(input ? input.value : '');

    const detailsEl = document.getElementById('exchangePhoneDetails');
    if (detailsEl) {
        const pillClass = source === 'cashify' ? 'cashify' : 'flipkart';
        const srcLabel = source === 'cashify' ? 'Cashify' : 'Flipkart';
        detailsEl.innerHTML = `
            <div class="p-3 bg-green-50 border border-green-200 rounded-xl">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-bold text-green-800">✅ Exchange phone selected</span>
                    <button type="button" onclick="clearExchangeSelection()" class="text-xs text-red-600 font-semibold">Change</button>
                </div>
                <div class="flex items-center gap-2 flex-wrap mb-1.5">
                    <span class="src-pill ${pillClass}"><span class="dot"></span>${srcLabel}</span>
                    <span class="font-mono text-xs text-gray-700">${escapeHtml(phone.orderId || phone.id)}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div><span class="text-gray-500">Model:</span> <strong>${escapeHtml(phone.phoneModel || '—')}</strong></div>
                    <div><span class="text-gray-500">Value:</span> <strong class="text-green-700">₹${(Number(phone.value) || 0).toLocaleString('en-IN')}</strong></div>
                    <div class="col-span-2"><span class="text-gray-500">IMEI:</span> <strong class="font-mono text-[11px]">${escapeHtml(phone.imei || '—')}</strong></div>
                </div>
            </div>
        `;
    }
    refreshIcons();
}

function clearExchangeSelection() {
    selectedExchangePhone = null;
    const detailsEl = document.getElementById('exchangePhoneDetails');
    if (detailsEl) detailsEl.innerHTML = '';
    const input = document.getElementById('exchangePhoneSearch');
    renderExchangeResults(input ? input.value : '');
}

function clearExchangeSearchInput() {
    const input = document.getElementById('exchangePhoneSearch');
    if (input) input.value = '';
    renderExchangeResults('');
}

// ---------- SUBMIT RETURN ----------
async function submitReturn() {
    if (!selectedReturnPhone) { showToast('Please select a sold phone first', 'error'); return; }
    const returnDate = document.getElementById('returnDate').value || getLocalYMD();
    const type = document.querySelector('input[name="returnType"]:checked')?.value || 'money';
    let returnAmount = 0;
    let exchangePhone = null;

    if (type === 'money') {
        returnAmount = parseFloat(document.getElementById('returnAmount').value);
        if (!returnAmount || returnAmount <= 0 || isNaN(returnAmount)) { showToast('Enter a valid return amount', 'error'); document.getElementById('returnAmount').focus(); return; }
    } else {
        if (!selectedExchangePhone) { showToast('Please select an exchange phone', 'error'); return; }
        exchangePhone = selectedExchangePhone;
    }

    const original = selectedReturnPhone;
    const originalSource = original._source;
    const sourceLabel = getSourceLabel(originalSource);
    const originalSalePrice = Number(original.salePrice) || 0;

    const confirm = await Swal.fire({
        title: 'Confirm Return Processing',
        html: `
            <div style="text-align:left;font-size:13px;line-height:1.6;">
                <div style="margin-bottom:8px;">
                    <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;background:${originalSource === 'cashify' ? '#E6FAF6' : '#eef2ff'};color:${originalSource === 'cashify' ? '#0FA88B' : '#4338ca'};border:1px solid ${originalSource === 'cashify' ? '#a7f3d0' : '#c7d2fe'};">${sourceLabel.toUpperCase()} RETURN</span>
                </div>
                <p><strong>Order:</strong> ${escapeHtml(original.orderId || original.id)}</p>
                <p><strong>Model:</strong> ${escapeHtml(original.phoneModel || '—')}</p>
                <p><strong>IMEI:</strong> ${escapeHtml(original.imei || '—')}</p>
                <p><strong>Original Sale:</strong> ₹${originalSalePrice.toLocaleString('en-IN')}</p>
                <hr style="margin:8px 0;">
                <p><strong>Return Date:</strong> ${escapeHtml(returnDate)}</p>
                ${type === 'money'
                    ? `<p><strong>Return Amount:</strong> ₹${returnAmount.toLocaleString('en-IN')} (Cash to customer)</p>`
                    : `<p><strong>Exchange Phone:</strong> ${escapeHtml(exchangePhone.phoneModel)} (${escapeHtml(exchangePhone.imei)})</p>
                       <p><strong>Exchange Source:</strong> ${getSourceLabel(exchangePhone._source)}</p>`}
                <p style="margin-top:8px;color:#dc2626;font-size:12px;"><strong>⚠️ Inventory will be updated automatically.</strong></p>
            </div>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: '✅ Yes, Process Return',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;

    const btn = document.getElementById('processReturnBtn');
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm" style="width:16px;height:16px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.35);"></span> Processing...'; }

    try {
        const originalDb = getDb(originalSource);
        const freshSnap = await originalDb.ref('pickups/' + original.id).once('value');
        const fresh = freshSnap.val();
        if (!fresh || fresh.sold !== true || fresh.returned === true) {
            showToast('This phone is no longer eligible for return', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = originalBtnHtml; refreshIcons(); }
            return;
        }

        const returnId = 'ret_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const returnRecord = {
            returnId,
            source: originalSource,
            originalPickupId: original.id,
            originalOrderId: original.orderId || original.id,
            originalModel: original.phoneModel || '—',
            originalImei: original.imei || '—',
            originalSalePrice,
            originalSaleDate: original.saleDate || (original.saleTimestamp ? getLocalYMD(new Date(original.saleTimestamp)) : '—'),
            originalBuyerName: original.buyerName || '',
            returnDate,
            returnType: type,
            returnAmount: type === 'money' ? returnAmount : 0,
            exchangePhoneSource: type === 'exchange' ? exchangePhone._source : null,
            exchangePickupId: type === 'exchange' ? exchangePhone.id : null,
            exchangeOrderId: type === 'exchange' ? (exchangePhone.orderId || exchangePhone.id) : null,
            exchangeModel: type === 'exchange' ? (exchangePhone.phoneModel || '—') : null,
            exchangeImei: type === 'exchange' ? (exchangePhone.imei || '—') : null,
            createdAt: Date.now(),
            createdBy: 'sales-manager'
        };

        await originalDb.ref('returns/' + returnId).set(returnRecord);

        await originalDb.ref('pickups/' + original.id).update({
            sold: false, returned: true, returnDate, returnId,
            lastSalePrice: originalSalePrice,
            lastSaleDate: original.saleDate || '',
            lastBuyerName: original.buyerName || '',
            salePrice: null, buyerName: null, buyerContact: null,
            saleDate: null, saleTimestamp: null,
            grossProfit: null, finalNetProfit: null, profit: null, commission: null
        });

        if (type === 'exchange' && exchangePhone) {
            const exchangeDb = getDb(exchangePhone._source);
            const exchangePayload = {
                sold: true, salePrice: 0,
                buyerName: 'Exchange for ' + (original.orderId || original.id),
                buyerContact: '',
                saleDate: returnDate,
                saleTimestamp: new Date().toISOString(),
                soldVia: 'exchange',
                exchangeForReturnId: returnId,
                exchangeForOrderId: original.orderId || original.id
            };
            if (exchangePhone._source === 'flipkart') {
                exchangePayload.commission = 0;
                exchangePayload.grossProfit = 0;
                exchangePayload.finalNetProfit = 0;
                exchangePayload.profit = 0;
            } else {
                exchangePayload.grossProfit = 0;
                exchangePayload.finalNetProfit = 0;
            }
            await exchangeDb.ref('pickups/' + exchangePhone.id).update(exchangePayload);
        }

        const [fkSnap2, cfSnap2] = await Promise.all([
            flipkartDb.ref('pickups').once('value'),
            cashifyDb.ref('pickups').once('value')
        ]);
        const countUnsold = (data) => {
            let n = 0;
            Object.values(data || {}).forEach(item => { if (item && item.status === 'pickup' && !item.sold) n++; });
            return n;
        };
        const fkCount = countUnsold(fkSnap2.val());
        const cfCount = countUnsold(cfSnap2.val());

        await originalDb.ref('returns/' + returnId).update({
            inventoryCountFlipkart: fkCount,
            inventoryCountCashify: cfCount
        });
        returnRecord.inventoryCountFlipkart = fkCount;
        returnRecord.inventoryCountCashify = cfCount;

        const message = buildReturnMessage(returnRecord);

        allSoldPhonesBoth = [];
        allExchangeInventoryBoth = [];
        returnsDataLoaded = false;

        cancelReturnSelection();
        await refreshSoldPhonesCache();
        returnsDataLoaded = true;
        renderReturnSearchResults(document.getElementById('returnSearch')?.value || '');
        await Promise.all([loadReturnsHistory(), loadReturnsInventoryCounts()]);
        if (currentView === 'inventory') loadInventory();

        showReturnSuccessModal(message);
    } catch (e) {
        console.error('Return processing error:', e);
        showToast('Error processing return. Please try again.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalBtnHtml || '<i data-lucide="check-circle"></i> Process Return'; refreshIcons(); }
    }
}

// ---------- WHATSAPP MESSAGE ----------
function buildReturnMessage(r) {
    const L = [];
    L.push('🔄 *RETURN*');
    L.push('');
    L.push(`📋 Order ID: ${r.originalOrderId}`);
    L.push(`📱 Model: ${r.originalModel}`);
    L.push(`💰 Sale Amount: ₹${(Number(r.originalSalePrice) || 0).toLocaleString('en-IN')}`);
    L.push(`📅 Sale Date: ${r.originalSaleDate}`);
    L.push('');
    L.push(`📅 Return Date: ${r.returnDate}`);
    L.push('');
    if (r.returnType === 'money') {
        L.push(`💵 Return Amount: ₹${(Number(r.returnAmount) || 0).toLocaleString('en-IN')}`);
    } else {
        L.push(`📱 Exchange Phone: ${r.exchangeModel || '—'}`);
        L.push(`📦 From: ${r.exchangePhoneSource === 'cashify' ? 'Cashify' : 'Flipkart'} Inventory`);
    }
    L.push('');
    L.push('📊 *Updated Inventory:*');
    L.push(`   • Flipkart: ${r.inventoryCountFlipkart} units`);
    L.push(`   • Cashify: ${r.inventoryCountCashify} units`);
    return L.join('\n');
}

async function showReturnSuccessModal(message) {
    const result = await Swal.fire({
        title: '✅ Return Processed Successfully',
        html: `
            <div style="text-align:left;">
                <p style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">WhatsApp Message Preview</p>
                <pre class="whatsapp-preview-box">${escapeHtml(message)}</pre>
            </div>`,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: '📋 Copy Message',
        denyButtonText: '📱 Open WhatsApp',
        cancelButtonText: 'Close',
        confirmButtonColor: '#059669',
        denyButtonColor: '#25D366',
        cancelButtonColor: '#64748b',
        width: 'min(560px, 96vw)'
    });
    if (result.isConfirmed) await copyTextToClipboard(message);
    else if (result.isDenied) openWhatsApp(message);
}

async function copyTextToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('✅ Message copied to clipboard', 'success');
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast('✅ Message copied', 'success'); }
        catch (err) { showToast('Copy failed — please select manually', 'error'); }
        document.body.removeChild(ta);
    }
}

function openWhatsApp(message) {
    window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank');
}

// ---------- RETURNS HISTORY ----------
async function loadReturnsHistory() {
    const container = document.getElementById('returnsHistoryList');
    if (!container) return;
    try {
        const [fkSnap, cfSnap] = await Promise.all([
            flipkartDb.ref('returns').once('value'),
            cashifyDb.ref('returns').once('value')
        ]);
        const fkData = fkSnap.val() || {};
        const cfData = cfSnap.val() || {};
        const candidates = [
            ...Object.entries(fkData).map(([id, r]) => ({ id, _source: 'flipkart', ...r })),
            ...Object.entries(cfData).map(([id, r]) => ({ id, _source: 'cashify', ...r }))
        ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const merged = [];
        for (let offset = 0; offset < candidates.length && merged.length < 30; offset += 30) {
            const batch = candidates.slice(offset, offset + 30);
            const originalPickups = await Promise.all(batch.map(r =>
                r.originalPickupId
                    ? getDb(r._source).ref('pickups/' + r.originalPickupId).once('value')
                    : Promise.resolve(null)
            ));
            batch.forEach((r, index) => {
                if (originalPickups[index]?.exists()) merged.push(r);
            });
        }

        if (!merged.length) {
            container.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">No returns recorded yet on either platform</div>`;
            return;
        }

        let html = '<div class="space-y-2">';
        merged.forEach(r => {
            const src = r._source || r.source || 'flipkart';
            const pillClass = src === 'cashify' ? 'cashify' : 'flipkart';
            const srcLabel = src === 'cashify' ? 'Cashify' : 'Flipkart';
            const returnInfo = r.returnType === 'money'
                ? `💵 ₹${(Number(r.returnAmount) || 0).toLocaleString('en-IN')} returned`
                : `📱 ${escapeHtml(r.exchangeModel || '—')} (${r.exchangePhoneSource === 'cashify' ? 'Cashify' : 'Flipkart'})`;
            html += `
                <div class="return-history-item">
                    <div class="flex items-start justify-between gap-2 mb-1">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 flex-wrap mb-0.5">
                                <span class="src-pill ${pillClass}"><span class="dot"></span>${srcLabel}</span>
                                <span class="font-mono font-bold text-gray-800 text-xs">${escapeHtml(r.originalOrderId || '—')}</span>
                            </div>
                            <div class="text-sm text-gray-700 truncate mt-0.5">${escapeHtml(r.originalModel || '—')}</div>
                        </div>
                        <span class="text-xs text-gray-500 whitespace-nowrap">${escapeHtml(r.returnDate || '—')}</span>
                    </div>
                    <div class="text-xs text-gray-600 mt-1">${returnInfo}</div>
                    <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                        <span class="text-[10px] text-gray-400">Original Sale: ₹${(Number(r.originalSalePrice) || 0).toLocaleString('en-IN')}</span>
                        <button onclick="viewReturnMessage('${src}', '${r.id}')" class="text-[10px] text-indigo-600 font-semibold hover:underline">View / Resend Message</button>
                    </div>
                </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
        refreshIcons();
    } catch (e) {
        console.error('Load returns history error:', e);
        container.innerHTML = `<div class="text-center py-6 text-red-400 text-sm">Failed to load returns</div>`;
    }
}

async function viewReturnMessage(source, returnId) {
    try {
        const snap = await getDb(source).ref('returns/' + returnId).once('value');
        const record = snap.val();
        if (!record) { showToast('Return record not found', 'error'); return; }
        await showReturnSuccessModal(buildReturnMessage(record));
    } catch (e) {
        console.error(e);
        showToast('Failed to load return message', 'error');
    }
}

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
    setupOfflineDetection();
    refreshIcons();

    document.querySelectorAll('#sourceTabs .source-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.source === currentSource);
    });

    loadInventory();

    // Auto-refresh — view-aware; never touches returns search input/form
    setInterval(() => {
        if (document.hidden) return;
        if (currentView === 'inventory') loadInventory();
        else loadReturnsHistory();
    }, 60000);

    showToast('👋 Sales Manager ready', 'info', 2000);
    console.log('✅ Sales Manager initialized — brand-aware smart search');
});

// ---------- MODAL OUTSIDE-CLICK + ESC ----------
const sellModalEl = document.getElementById('sellModal');
if (sellModalEl) sellModalEl.addEventListener('click', function (e) { if (e.target === this) closeSellModal(); });
const detailModalEl = document.getElementById('detailModal');
if (detailModalEl) detailModalEl.addEventListener('click', function (e) { if (e.target === this) closeDetailModal(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSellModal(); closeDetailModal(); } });

// ---------- EXPOSE FOR INLINE HANDLERS ----------
window.switchView = switchView;
window.switchSource = switchSource;
window.applySearch = applySearch;
window.clearSearch = clearSearch;
window.openSellModal = openSellModal;
window.closeSellModal = closeSellModal;
window.confirmSell = confirmSell;
window.viewOrderDetail = viewOrderDetail;
window.closeDetailModal = closeDetailModal;
window.refreshInventory = refreshInventory;

window.handleReturnSearchInput = handleReturnSearchInput;
window.clearReturnSearch = clearReturnSearch;
window.selectReturnPhone = selectReturnPhone;
window.cancelReturnSelection = cancelReturnSelection;
window.onReturnTypeChange = onReturnTypeChange;
window.handleExchangeSearchInput = handleExchangeSearchInput;
window.selectExchangePhone = selectExchangePhone;
window.clearExchangeSelection = clearExchangeSelection;
window.clearExchangeSearchInput = clearExchangeSearchInput;
window.submitReturn = submitReturn;
window.loadReturnsHistory = loadReturnsHistory;
window.viewReturnMessage = viewReturnMessage;