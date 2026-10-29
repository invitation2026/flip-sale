// ================================================================
// Sales Manager · Flipkart + Cashify
// v4.1 — Reliable + Instant Sale + Flipkart/Outside Inventory Breakdown
// ----------------------------------------------------------------
// ✔ Instant sale flow (write-first, UI-first, background sync)
// ✔ In-memory SWR cache for pickups / users / attendance
// ✔ localStorage snapshot → instant paint on page reload
// ✔ Optimistic session restore (no login-screen flicker)
// ✔ Network-fault tolerant access checks (no false logouts)
// ✔ Overhead computed from cache (no blocking network reads)
// ✔ Request de-duplication + timeouts + graceful degradation
// ✔ Returns / exchange flow optimised (no redundant reads)
// ✔ WhatsApp sale message: Flipkart vs Outside Inventory breakdown
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
function hasSwal() { return typeof Swal !== 'undefined' && Swal && typeof Swal.fire === 'function'; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function withTimeout(promise, ms, fallbackValue) {
    return Promise.race([
        Promise.resolve(promise),
        new Promise((resolve, reject) => {
            setTimeout(() => {
                if (arguments.length >= 3) resolve(fallbackValue);
                else reject(new Error('timeout'));
            }, ms);
        })
    ]);
}

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

/**
 * Detect if a pickup record is an "Outside Pickup" (approved from outside_pickups
 * in the Flipkart Admin Panel). Mirrors the admin panel's isOutsidePickupItem
 * so both apps agree on which phones belong to "Outside Inventory".
 */
function isOutsidePickupItem(item) {
    if (!item || typeof item !== 'object') return false;
    const trueValue = v => v === true || String(v).toLowerCase() === 'true';
    if (trueValue(item.outsidePickup) || trueValue(item.isOutsidePickup) || trueValue(item.outside_pickup)) return true;
    if (item.approvedFromOutsidePickupAt !== undefined && item.approvedFromOutsidePickupAt !== null) return true;
    const src = String(item.source || item.pickupSource || item.pickupType || item.orderType || '').toLowerCase();
    return ['outside', 'outside_pickup', 'outside_pickups'].includes(src);
}

/**
 * Count unsold Flipkart-source inventory split into:
 *   • flipkart → regular order pickups (status = pickup, not sold, not outside)
 *   • outside  → outside pickups approved into inventory
 * Returns { flipkart, outside, total }.
 */
function getFlipkartInventoryBreakdown(data) {
    let flipkart = 0;
    let outside = 0;
    if (data) {
        for (const id in data) {
            const it = data[id];
            if (!it || it.status !== 'pickup' || it.sold) continue;
            if (isOutsidePickupItem(it)) outside++;
            else flipkart++;
        }
    }
    return { flipkart, outside, total: flipkart + outside };
}

let _iconTimer = null;
function refreshIcons() {
    if (_iconTimer) clearTimeout(_iconTimer);
    _iconTimer = setTimeout(() => {
        _iconTimer = null;
        if (window.lucide) { try { lucide.createIcons(); } catch (e) {} }
    }, 16);
}
function refreshIconsNow() {
    if (window.lucide) { try { lucide.createIcons(); } catch (e) {} }
}

// ================================================================
// SMART SEARCH ENGINE — brand-aware, multi-token
// ================================================================
const BRAND_ALIASES = {
    'apple': ['apple', 'iphone'],
    'iphone': ['iphone', 'apple'],
    'samsung': ['samsung', 'galaxy'],
    'galaxy': ['galaxy', 'samsung'],
    'xiaomi': ['xiaomi', 'redmi', 'poco', 'mi'],
    'redmi': ['redmi', 'xiaomi', 'mi'],
    'poco': ['poco', 'xiaomi', 'redmi'],
    'mi': ['mi', 'xiaomi', 'redmi', 'poco'],
    'google': ['google', 'pixel'],
    'pixel': ['pixel', 'google'],
    'motorola': ['motorola', 'moto'],
    'moto': ['moto', 'motorola'],
    'vivo': ['vivo', 'iqoo'],
    'iqoo': ['iqoo', 'vivo'],
    'sony': ['sony', 'xperia'],
    'xperia': ['xperia', 'sony'],
    'asus': ['asus', 'zenfone', 'rog'],
    'zenfone': ['zenfone', 'asus'],
    'rog': ['rog', 'asus'],
    'huawei': ['huawei', 'honor'],
    'honor': ['honor', 'huawei'],
    'oneplus': ['oneplus'],
    'realme': ['realme'],
    'oppo': ['oppo'],
    'nokia': ['nokia'],
    'nothing': ['nothing'],
    'infinix': ['infinix'],
    'tecno': ['tecno'],
    'itel': ['itel'],
    'lava': ['lava'],
    'micromax': ['micromax'],
    'lenovo': ['lenovo'],
    'lg': ['lg'],
    'htc': ['htc'],
    'blackberry': ['blackberry'],
    'panasonic': ['panasonic'],
    'alcatel': ['alcatel'],
};

function normalizeSearchText(str) {
    if (!str) return '';
    return String(str).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function decorateForSearch(item) {
    if (!item) return item;
    if (item._searchBlob !== undefined) return item;
    const parts = [item.phoneModel, item.brand, item.model, item.orderId, item.id,
        item.customerName, item.buyerName, item.imei, item.imei2, item.color,
        item.ram, item.storage, item.ramStorage, item.networkType].filter(Boolean);
    item._searchBlob = normalizeSearchText(parts.join(' '));
    item._searchBlobCompact = item._searchBlob.replace(/\s+/g, '');
    return item;
}

function tokenMatchesBlob(tok, blob, compactBlob) {
    if (!tok) return false;
    if (blob.includes(tok)) return true;
    if (tok.length >= 3 && compactBlob.includes(tok)) return true;
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

function phoneMatchesQuery(item, rawQuery) {
    const normQuery = normalizeSearchText(rawQuery);
    if (!normQuery) return true;
    const blob = item._searchBlob || '';
    const compactBlob = item._searchBlobCompact || '';
    const compactQuery = normQuery.replace(/\s+/g, '');
    const digits = String(rawQuery || '').replace(/\D/g, '');

    if (digits.length >= 4) {
        const imei = String(item.imei || '').replace(/\D/g, '');
        const imei2 = String(item.imei2 || '').replace(/\D/g, '');
        const ord = String(item.orderId || item.id || '').replace(/\D/g, '');
        if (imei.includes(digits) || imei2.includes(digits) || ord.includes(digits)) return true;
    }
    if (blob.includes(normQuery)) return true;
    if (compactQuery && compactBlob.includes(compactQuery)) return true;
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
let isSelling = false;

// Sales manager auth state
let currentSalesUser = null;
const SALES_AUTH_KEY = 'sales_manager_user';
let lastAccessVerifiedAt = 0;

// Access listener — immediate revoke detection
let accessRevokedFlag = false;
let accessListenerRef = null;
let fallbackCheckInterval = null;

const lastUpdatedBySource = { flipkart: null, cashify: null };

// Returns state
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

// ================================================================
// DATA LAYER — SWR CACHE (performance core)
// ================================================================
const PICKUPS_TTL = 25 * 1000;
const META_TTL = 5 * 60 * 1000;
const OVERHEAD_TTL = 10 * 60 * 1000;
const LS_INV_PREFIX = 'sm_inv_cache_v2_';
const LS_OVERHEAD_KEY = 'sm_overhead_v2';

const pickupsCache = {
    flipkart: { data: null, ts: 0, inflight: null },
    cashify: { data: null, ts: 0, inflight: null }
};
const metaCache = {
    flipkart: { users: null, usersTs: 0, attendance: null, attTs: 0, usersInflight: null, attInflight: null },
    cashify: { users: null, usersTs: 0, attendance: null, attTs: 0, usersInflight: null, attInflight: null }
};
const overheadCache = { flipkart: { ts: 0, value: 0 }, cashify: { ts: 0, value: 0 } };

function hydrateInventoryFromLS() {
    ['flipkart', 'cashify'].forEach(src => {
        try {
            const raw = localStorage.getItem(LS_INV_PREFIX + src);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && parsed.data && typeof parsed.data === 'object') {
                pickupsCache[src].data = parsed.data;
                pickupsCache[src].ts = 0;
            }
        } catch (_) {}
    });
}

function persistInventoryToLS(source, data) {
    try {
        const raw = JSON.stringify({ ts: Date.now(), data });
        if (raw.length > 2.5 * 1024 * 1024) return;
        localStorage.setItem(LS_INV_PREFIX + source, raw);
    } catch (_) {}
}

function hydrateOverheadFromLS() {
    try {
        const raw = localStorage.getItem(LS_OVERHEAD_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed) return;
        ['flipkart', 'cashify'].forEach(src => {
            if (parsed[src] && typeof parsed[src].value === 'number') {
                overheadCache[src] = { ts: parsed[src].ts || 0, value: parsed[src].value || 0 };
            }
        });
    } catch (_) {}
}

function persistOverheadToLS() {
    try { localStorage.setItem(LS_OVERHEAD_KEY, JSON.stringify(overheadCache)); } catch (_) {}
}

function fetchPickups(source) {
    const c = pickupsCache[source];
    if (c.inflight) return c.inflight;
    const p = getDb(source).ref('pickups').once('value').then(snap => {
        const data = snap.val() || {};
        c.data = data;
        c.ts = Date.now();
        persistInventoryToLS(source, data);
        return data;
    }).catch(err => {
        if (c.data) return c.data;
        throw err;
    }).then(res => { c.inflight = null; return res; },
        err => { c.inflight = null; throw err; });
    c.inflight = p;
    return p;
}

async function getPickups(source, force = false) {
    const c = pickupsCache[source];
    const isFresh = c.data && (Date.now() - c.ts) < PICKUPS_TTL;
    if (!force && isFresh) return c.data;
    if (!force && c.data) {
        fetchPickups(source).catch(() => {});
        return c.data;
    }
    return fetchPickups(source);
}

function patchPickupCache(source, id, patchObj) {
    const c = pickupsCache[source];
    if (c && c.data && c.data[id]) {
        c.data[id] = Object.assign({}, c.data[id], patchObj);
        persistInventoryToLS(source, c.data);
    }
}

function countUnsold(data) {
    let n = 0;
    if (!data) return 0;
    for (const k in data) {
        const it = data[k];
        if (it && it.status === 'pickup' && !it.sold) n++;
    }
    return n;
}

function fetchUsers(source) {
    const c = metaCache[source];
    if (c.usersInflight) return c.usersInflight;
    const p = getDb(source).ref('users').once('value').then(snap => {
        c.users = snap.val() || {};
        c.usersTs = Date.now();
        return c.users;
    }).catch(() => c.users || {}).then(r => { c.usersInflight = null; return r; },
        e => { c.usersInflight = null; throw e; });
    c.usersInflight = p;
    return p;
}

function fetchAttendance(source) {
    const c = metaCache[source];
    if (c.attInflight) return c.attInflight;
    const p = getDb(source).ref('attendance').once('value').then(snap => {
        c.attendance = snap.val() || {};
        c.attTs = Date.now();
        return c.attendance;
    }).catch(() => c.attendance || {}).then(r => { c.attInflight = null; return r; },
        e => { c.attInflight = null; throw e; });
    c.attInflight = p;
    return p;
}

async function getUsers(source, force = false) {
    const c = metaCache[source];
    if (!force && c.users && (Date.now() - c.usersTs) < META_TTL) return c.users;
    if (!force && c.users) { fetchUsers(source).catch(() => {}); return c.users; }
    return fetchUsers(source);
}

async function getAttendance(source, force = false) {
    const c = metaCache[source];
    if (!force && c.attendance && (Date.now() - c.attTs) < META_TTL) return c.attendance;
    if (!force && c.attendance) { fetchAttendance(source).catch(() => {}); return c.attendance; }
    return fetchAttendance(source);
}

function prefetchSourceData(source) {
    Promise.all([
        fetchPickups(source).catch(() => {}),
        fetchUsers(source).catch(() => {}),
        fetchAttendance(source).catch(() => {})
    ]).then(() => {
        computeOverheadPerPhone(source)
            .then(v => { overheadCache[source] = { ts: Date.now(), value: v }; persistOverheadToLS(); })
            .catch(() => {});
    }).catch(() => {});
}

// ================================================================
// OVERHEAD CALCULATION (pure CPU from cache)
// ================================================================
async function computeOverheadPerPhone(source) {
    const [users, attendance, pickups] = await Promise.all([
        getUsers(source), getAttendance(source), getPickups(source)
    ]);
    const today = new Date();
    let totalOverhead = 0;

    for (const uname of Object.keys(users || {})) {
        const uData = users[uname] || {};
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
        const attUser = (attendance && attendance[uname]) || {};
        while (cur <= today) {
            const ds = getLocalYMD(cur);
            const att = attUser[ds] || {};
            if (att.status === 'present' && att.salary_counted !== false) {
                totalOverhead += (att.half_day === true) ? perDaySalary * 0.5 : perDaySalary;
            }
            cur.setDate(cur.getDate() + 1);
        }
    }

    let totalPickupIncentives = 0;
    let totalRejectIncentives = 0;
    const pk = pickups || {};
    for (const id in pk) {
        const item = pk[id];
        if (!item || item.status === 'on_hold') continue;
        const agent = item.agent;
        if (!agent) continue;
        const uData = users[agent];
        if (!uData || (uData.role || 'agent') !== 'agent') continue;
        if (item.status === 'pickup') totalPickupIncentives += Number(uData.pickup_incentive) || 0;
        else if (item.status === 'rejected' && Boolean(item.incentive_approved)) totalRejectIncentives += Number(uData.reject_incentive) || 0;
    }
    totalOverhead += totalPickupIncentives + totalRejectIncentives;

    let totalSold = 0;
    for (const id in pk) {
        const item = pk[id];
        if (item && item.status === 'pickup' && item.sold) totalSold++;
    }
    return totalSold > 0 ? totalOverhead / totalSold : 0;
}

async function getOverheadPerPhone(source, force = false, timeoutMs = 1200) {
    const c = overheadCache[source];
    if (!force && c.ts && (Date.now() - c.ts) < OVERHEAD_TTL) return c.value;

    const computePromise = computeOverheadPerPhone(source).then(v => {
        overheadCache[source] = { ts: Date.now(), value: v };
        persistOverheadToLS();
        return v;
    }).catch(() => c.value || 0);

    if (!timeoutMs || timeoutMs <= 0) return computePromise;

    const timeoutPromise = delay(timeoutMs).then(() => c.value || 0);
    const result = await Promise.race([computePromise, timeoutPromise]);
    return result;
}

// ================================================================
// CONNECTION STATUS
// ================================================================
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
    if (accessRevokedFlag) { showLoginOverlay(); return; }
    if (currentView === view) return;
    currentView = view;

    document.getElementById('viewBtnInventory')?.classList.toggle('active', view === 'inventory');
    document.getElementById('viewBtnReturns')?.classList.toggle('active', view === 'returns');

    const inv = document.getElementById('inventoryView');
    const ret = document.getElementById('returnsView');
    if (inv) inv.style.display = view === 'inventory' ? 'block' : 'none';
    if (ret) ret.style.display = view === 'returns' ? 'block' : 'none';

    if (view === 'returns' && !returnsDataLoaded) initReturnsView();
    refreshIcons();
}

// ================================================================
// INVENTORY
// ================================================================
function switchSource(source) {
    if (!isStillAuthorized()) { showLoginOverlay(); return; }
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
    loadInventory({ force: false });
    prefetchSourceData(source);
}

function buildInventoryList(data, source) {
    const list = [];
    if (!data) return list;
    for (const id in data) {
        const item = data[id];
        if (!item) continue;
        if (item.status === 'pickup' && !item.sold) {
            list.push(Object.assign({ id }, item, { _source: source }));
        }
    }
    list.sort((a, b) => {
        const ta = new Date(a.timestamp || 0).getTime() || 0;
        const tb = new Date(b.timestamp || 0).getTime() || 0;
        return tb - ta;
    });
    return list;
}

async function loadInventory(opts) {
    const force = !!(opts && opts.force);
    const source = currentSource;
    try {
        const data = await getPickups(source, force);
        if (source !== currentSource) return;
        inventoryList = buildInventoryList(data, source);
        lastUpdatedBySource[source] = pickupsCache[source].ts || Date.now();
        applySearch();
        updateStats(data);
        updateLastUpdatedLabel();
    } catch (e) {
        console.error('Inventory load error:', e);
        showToast('Error loading ' + getSourceLabel(source) + ' inventory', 'error');
        const tbody = document.getElementById('inventoryTableBody');
        const cards = document.getElementById('inventoryCards');
        const errHtml = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Failed to load inventory</p><p class="text-xs text-gray-400 mt-1">Tap refresh to retry</p></div>`;
        if (cards) cards.innerHTML = errHtml;
        if (tbody) tbody.innerHTML = `<tr><td colspan="7">${errHtml}</td></tr>`;
        refreshIcons();
    }
}

function updateStats(pickupsData) {
    let soldCount = 0;
    if (pickupsData) {
        for (const k in pickupsData) {
            const item = pickupsData[k];
            if (item && item.sold === true) soldCount++;
        }
    }
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
        filteredInventory = inventoryList.slice();
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
        const safeId = String(item.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
                    <button onclick="openSellModal('${safeId}')" class="btn-action success flex-1"><i data-lucide="badge-dollar-sign"></i> Sell</button>
                    <button onclick="viewOrderDetail('${safeId}', '${currentSource}')" class="btn-action view" title="View"><i data-lucide="eye"></i></button>
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
        const safeId = String(item.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
                        <button onclick="openSellModal('${safeId}')" class="btn-action success" style="padding:8px 14px;min-height:38px;font-size:12px;"><i data-lucide="badge-dollar-sign" style="width:16px;height:16px;"></i> Sell</button>
                        <button onclick="viewOrderDetail('${safeId}', '${currentSource}')" class="btn-action view" style="padding:8px 12px;min-height:38px;" title="View"><i data-lucide="eye" style="width:16px;height:16px;"></i></button>
                    </div>
                </td>
            </tr>`;
    });
    tbody.innerHTML = html;
}

// ================================================================
// SELL MODAL
// ================================================================
function openSellModal(orderId) {
    if (!isStillAuthorized()) { showLoginOverlay(); return; }
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
    setTimeout(() => { const inp = document.getElementById('sellSalePrice'); if (inp) inp.focus(); }, 250);
}

function closeSellModal() {
    const modal = document.getElementById('sellModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    sellOrderData = null;
}

async function confirmSell() {
    if (isSelling) return;
    if (!isStillAuthorized()) { showLoginOverlay(); return; }
    if (!sellOrderData) return;

    const salePriceRaw = document.getElementById('sellSalePrice').value.trim();
    const buyerName = document.getElementById('sellBuyerName').value.trim();
    const buyerContact = document.getElementById('sellBuyerContact').value.trim();
    const saleDate = document.getElementById('sellSaleDate').value || getLocalYMD();
    const salePrice = parseFloat(salePriceRaw);

    if (!salePrice || salePrice <= 0 || isNaN(salePrice)) {
        showToast('Please enter a valid sale price', 'error');
        document.getElementById('sellSalePrice').focus();
        return;
    }
    if (!buyerName) {
        showToast('Please enter buyer name', 'error');
        document.getElementById('sellBuyerName').focus();
        return;
    }

    const order = sellOrderData;
    const source = currentSource;
    const sourceLabel = getSourceLabel(source);

    if (hasSwal()) {
        try {
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
                        <p style="margin-top:6px;font-size:12px;color:#64748b;">🧑‍💼 Recording as: <strong>${escapeHtml(currentSalesUser.name)}</strong> (${escapeHtml(currentSalesUser.username)})</p>
                    </div>`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#059669',
                cancelButtonColor: '#64748b',
                confirmButtonText: '✅ Confirm Sale',
                cancelButtonText: 'Cancel'
            });
            if (!confirm.isConfirmed) return;
        } catch (_) {}
    }

    isSelling = true;
    const confirmBtn = document.getElementById('confirmSellBtn');
    const originalBtnHtml = confirmBtn ? confirmBtn.innerHTML : '';
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner-sm" style="width:16px;height:16px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.35);"></span> Saving…';
    }

    try {
        let overheadTimedOut = false;
        const overheadCompute = computeOverheadPerPhone(source)
            .then(v => { overheadCache[source] = { ts: Date.now(), value: v }; persistOverheadToLS(); return v; })
            .catch(() => (overheadCache[source] && overheadCache[source].value) || 0);

        const cachedOverhead = (overheadCache[source] && overheadCache[source].value) || 0;
        const overhead = await Promise.race([
            overheadCompute,
            delay(1200).then(() => { overheadTimedOut = true; return cachedOverhead; })
        ]);

        const purchase = Number(order.value) || 0;
        const writePayload = {
            sold: true, returned: false,
            salePrice, buyerName, buyerContact: buyerContact || '', saleDate,
            saleTimestamp: new Date().toISOString(),
            salesBy: currentSalesUser.username,
            salesByName: currentSalesUser.name,
            overheadPerPhone: overhead
        };

        if (source === 'flipkart') {
            const commission = calculateCommission(purchase);
            const grossProfit = salePrice - purchase - commission;
            writePayload.commission = commission;
            writePayload.grossProfit = grossProfit;
            writePayload.finalNetProfit = grossProfit - overhead;
            writePayload.profit = grossProfit;
        } else {
            const coins = Number(order.coins) || 0;
            const rate = Number(order.coinValueRate) || 12.5;
            const coinsValue = (order.coinTotalValue !== undefined && order.coinTotalValue !== null) ? Number(order.coinTotalValue) : coins * rate;
            const actualCost = (order.actualTotalCost !== undefined && order.actualTotalCost !== null) ? Number(order.actualTotalCost) : purchase + coinsValue;
            const grossProfit = salePrice - actualCost;
            writePayload.grossProfit = grossProfit;
            writePayload.finalNetProfit = grossProfit - overhead;
        }

        await getDb(source).ref('pickups/' + order.id).update(writePayload);

        patchPickupCache(source, order.id, writePayload);
        pickupsCache[source].ts = pickupsCache[source].ts || Date.now();

        const stockCount = countUnsold(pickupsCache[source].data);
        const mergedItem = Object.assign({}, order, writePayload);
        const message = buildSaleMessage(mergedItem, salePrice, source, stockCount);

        inventoryList = inventoryList.filter(i => i.id !== order.id);
        lastUpdatedBySource[source] = Date.now();
        applySearch();
        updateStats(pickupsCache[source].data);
        updateLastUpdatedLabel();
        closeSellModal();
        showToast(`✅ Sold from ${sourceLabel} for ₹${salePrice.toLocaleString('en-IN')}`, 'success', 2200);

        showSaleSuccessModal(message).catch(() => {});

        setTimeout(() => {
            try {
                loadRecentSalesHistory();
                if (!returnsDataLoaded) { allSoldPhonesBoth = []; allExchangeInventoryBoth = []; }
                else { allSoldPhonesBoth = []; allExchangeInventoryBoth = []; returnsDataLoaded = false; }
                if (currentView === 'returns') loadReturnsHistory();
                loadReturnsInventoryCounts();
            } catch (_) {}
        }, 50);

        if (overheadTimedOut) {
            overheadCompute.then(v => {
                if (v && Math.abs(v - overhead) > 0.5) patchProfitWithOverhead(source, order.id, v, order, salePrice, writePayload);
            }).catch(() => {});
        }

        setTimeout(() => {
            fetchPickups(source).then(() => {
                if (currentSource === source) {
                    inventoryList = buildInventoryList(pickupsCache[source].data, source);
                    applySearch();
                    updateStats(pickupsCache[source].data);
                    updateLastUpdatedLabel();
                }
            }).catch(() => {});
        }, 1500);

    } catch (e) {
        console.error('Sale error:', e);
        showToast('Error saving sale. Please try again.', 'error');
    } finally {
        isSelling = false;
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = originalBtnHtml || '<i data-lucide="check-circle" class="w-4 h-4"></i> Confirm Sale';
            refreshIcons();
        }
    }
}

async function patchProfitWithOverhead(source, id, overheadValue, order, salePrice, writePayload) {
    try {
        let finalNetProfit;
        if (source === 'flipkart') {
            const purchase = Number(order.value) || 0;
            const commission = Number(writePayload.commission) || 0;
            finalNetProfit = salePrice - purchase - commission - overheadValue;
        } else {
            const purchase = Number(order.value) || 0;
            const coins = Number(order.coins) || 0;
            const rate = Number(order.coinValueRate) || 12.5;
            const coinsValue = (order.coinTotalValue !== undefined && order.coinTotalValue !== null) ? Number(order.coinTotalValue) : coins * rate;
            const actualCost = (order.actualTotalCost !== undefined && order.actualTotalCost !== null) ? Number(order.actualTotalCost) : purchase + coinsValue;
            finalNetProfit = salePrice - actualCost - overheadValue;
        }
        const patch = { finalNetProfit, overheadPerPhone: overheadValue };
        await getDb(source).ref('pickups/' + id).update(patch);
        patchPickupCache(source, id, patch);
    } catch (e) {
        console.warn('[SalesManager] Profit patch failed:', e);
    }
}

// ================================================================
// VIEW DETAIL
// ================================================================
async function viewOrderDetail(orderId, sourceOverride) {
    if (!isStillAuthorized()) { showLoginOverlay(); return; }
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    if (!modal || !content) return;
    const source = sourceOverride || currentSource;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const cached = pickupsCache[source].data && pickupsCache[source].data[orderId];
    if (cached) renderDetail(cached, orderId, source);
    else content.innerHTML = `<div class="text-center py-8 text-gray-400"><span class="spinner-sm"></span><p class="text-sm mt-2">Loading...</p></div>`;

    try {
        const snap = await withTimeout(getDb(source).ref('pickups/' + orderId).once('value'), 8000);
        const item = snap.val();
        if (!item) {
            if (!cached) {
                content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium">Order not found</p></div>`;
                refreshIcons();
            }
            return;
        }
        if (pickupsCache[source].data) pickupsCache[source].data[orderId] = item;
        renderDetail(item, orderId, source);
    } catch (err) {
        console.error('Detail load error:', err);
        if (!cached) {
            content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error loading details</p></div>`;
            refreshIcons();
            showToast('Error loading order details', 'error');
        }
    }
}

function renderDetail(item, orderId, source) {
    const content = document.getElementById('detailContent');
    if (!content) return;
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
            ${item.salesByName ? `<div class="detail-item"><div class="label">Sold By</div><div class="value">${escapeHtml(item.salesByName)}${item.salesBy ? ' <span style="color:#94a3b8;font-size:11px;">(' + escapeHtml(item.salesBy) + ')</span>' : ''}</div></div>` : ''}
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
}

function closeDetailModal() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

// ---------- REFRESH ----------
async function refreshInventory() {
    if (!isStillAuthorized()) { showLoginOverlay(); return; }
    if (isRefreshing) return;
    isRefreshing = true;
    showToast('🔄 Refreshing…', 'info', 1200);

    try {
        if (currentView === 'returns') {
            await Promise.all([
                getPickups('flipkart', true),
                getPickups('cashify', true)
            ]);
            await refreshSoldPhonesCache(true);
            renderReturnSearchResults(document.getElementById('returnSearch')?.value || '');
            await loadReturnsHistory();
            await loadReturnsInventoryCounts();
        } else {
            overheadCache[currentSource] = { ts: 0, value: 0 };
            await loadInventory({ force: true });
            prefetchSourceData(currentSource);
        }
        try { await loadRecentSalesHistory(true); } catch (_) {}
        showToast('✅ Refreshed', 'success', 1500);
    } catch (e) {
        showToast('Refresh failed — check connection', 'error');
    } finally {
        isRefreshing = false;
    }
}

// ================================================================
// RETURNS
// ================================================================
async function initReturnsView() {
    try {
        await Promise.all([refreshSoldPhonesCache(false), loadReturnsInventoryCounts()]);
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

async function refreshSoldPhonesCache(force = false) {
    const [fk, cf] = await Promise.all([
        getPickups('flipkart', force),
        getPickups('cashify', force)
    ]);
    const isSoldNotReturned = (item) => item && item.status === 'pickup' && item.sold === true && item.returned !== true;

    const fkSold = [];
    for (const id in fk) {
        const item = fk[id];
        if (isSoldNotReturned(item)) fkSold.push(decorateForSearch(Object.assign({ id }, item, { _source: 'flipkart' })));
    }
    const cfSold = [];
    for (const id in cf) {
        const item = cf[id];
        if (isSoldNotReturned(item)) cfSold.push(decorateForSearch(Object.assign({ id }, item, { _source: 'cashify' })));
    }

    allSoldPhonesBoth = [...fkSold, ...cfSold].sort((a, b) => {
        const ta = new Date(a.saleTimestamp || a.timestamp || 0).getTime() || 0;
        const tb = new Date(b.saleTimestamp || b.timestamp || 0).getTime() || 0;
        return tb - ta;
    });
}

async function loadReturnsInventoryCounts() {
    try {
        const [fk, cf] = await Promise.all([getPickups('flipkart'), getPickups('cashify')]);
        const fkEl = document.getElementById('flipkartInvCount');
        const cfEl = document.getElementById('cashifyInvCount');
        if (fkEl) fkEl.textContent = countUnsold(fk);
        if (cfEl) cfEl.textContent = countUnsold(cf);
    } catch (e) { console.warn('Counts load failed:', e); }
}

// ---------- RETURN SEARCH ----------
function handleReturnSearchInput(value) {
    clearTimeout(returnSearchDebounce);
    returnSearchDebounce = setTimeout(() => renderReturnSearchResults(value), 120);
}

function renderReturnSearchResults(query) {
    const container = document.getElementById('returnSearchResults');
    if (!container) return;

    const q = String(query || '').trim();
    let filtered = allSoldPhonesBoth;
    if (q) filtered = allSoldPhonesBoth.filter(item => phoneMatchesQuery(item, q));
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
        const safeId = String(item.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        html += `
            <div class="return-result-card ${isActive ? 'active' : ''}" onclick="selectReturnPhone('${safeId}', '${src}')">
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

function scrollToReturnSettlement() {
    const settlement = document.getElementById('returnTypeMoneyLabel');
    if (settlement) settlement.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
            loadExchangeInventoryBoth().then(() => renderExchangeResults('')).catch(() => {});
        } else {
            renderExchangeResults('');
        }
    }
}

// ---------- EXCHANGE INVENTORY ----------
async function loadExchangeInventoryBoth() {
    const [fk, cf] = await Promise.all([getPickups('flipkart'), getPickups('cashify')]);
    const isAvailable = (item) => item && item.status === 'pickup' && !item.sold;

    const fkAvail = [];
    for (const id in fk) if (isAvailable(fk[id])) fkAvail.push(decorateForSearch(Object.assign({ id }, fk[id], { _source: 'flipkart' })));
    const cfAvail = [];
    for (const id in cf) if (isAvailable(cf[id])) cfAvail.push(decorateForSearch(Object.assign({ id }, cf[id], { _source: 'cashify' })));

    allExchangeInventoryBoth = [...fkAvail, ...cfAvail].sort((a, b) =>
        String(a.phoneModel || '').localeCompare(String(b.phoneModel || ''))
    );
}

function handleExchangeSearchInput(value) {
    clearTimeout(exchangeSearchDebounce);
    exchangeSearchDebounce = setTimeout(() => renderExchangeResults(value), 120);
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
        const safeId = String(item.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        html += `
            <div class="exchange-pick-item ${isSel ? 'selected' : ''}" onclick="selectExchangePhone('${safeId}', '${src}')">
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
    if (!isStillAuthorized()) { showLoginOverlay(); return; }
    if (!selectedReturnPhone) { showToast('Please select a sold phone first', 'error'); return; }

    const returnDate = document.getElementById('returnDate').value || getLocalYMD();
    const type = document.querySelector('input[name="returnType"]:checked')?.value || 'money';
    let returnAmount = 0;
    let exchangePhone = null;

    if (type === 'money') {
        returnAmount = parseFloat(document.getElementById('returnAmount').value);
        if (!returnAmount || returnAmount <= 0 || isNaN(returnAmount)) {
            showToast('Enter a valid return amount', 'error');
            document.getElementById('returnAmount').focus();
            return;
        }
    } else {
        if (!selectedExchangePhone) { showToast('Please select an exchange phone', 'error'); return; }
        exchangePhone = selectedExchangePhone;
    }

    const original = selectedReturnPhone;
    const originalSource = original._source;
    const sourceLabel = getSourceLabel(originalSource);
    const originalSalePrice = Number(original.salePrice) || 0;

    if (hasSwal()) {
        try {
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
        } catch (_) {}
    }

    const btn = document.getElementById('processReturnBtn');
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-sm" style="width:16px;height:16px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.35);"></span> Processing...';
    }

    try {
        const originalDb = getDb(originalSource);
        const freshSnap = await withTimeout(originalDb.ref('pickups/' + original.id).once('value'), 8000).catch(() => null);
        const fresh = freshSnap ? freshSnap.val() : null;
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
            createdBy: 'sales-manager',
            createdByName: currentSalesUser ? currentSalesUser.name : '',
            createdByUsername: currentSalesUser ? currentSalesUser.username : ''
        };

        await originalDb.ref('returns/' + returnId).set(returnRecord);

        const originalPatch = {
            sold: false, returned: true, returnDate, returnId,
            lastSalePrice: originalSalePrice,
            lastSaleDate: original.saleDate || '',
            lastBuyerName: original.buyerName || '',
            salePrice: null, buyerName: null, buyerContact: null,
            saleDate: null, saleTimestamp: null,
            grossProfit: null, finalNetProfit: null, profit: null, commission: null
        };
        await originalDb.ref('pickups/' + original.id).update(originalPatch);
        patchPickupCache(originalSource, original.id, originalPatch);

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
                exchangeForOrderId: original.orderId || original.id,
                salesBy: currentSalesUser ? currentSalesUser.username : '',
                salesByName: currentSalesUser ? currentSalesUser.name : ''
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
            patchPickupCache(exchangePhone._source, exchangePhone.id, exchangePayload);
        }

        const fkCount = countUnsold(pickupsCache.flipkart.data);
        const cfCount = countUnsold(pickupsCache.cashify.data);
        returnRecord.inventoryCountFlipkart = fkCount;
        returnRecord.inventoryCountCashify = cfCount;

        const message = buildReturnMessage(returnRecord);

        allSoldPhonesBoth = [];
        allExchangeInventoryBoth = [];
        returnsDataLoaded = false;
        cancelReturnSelection();
        showToast('✅ Return processed', 'success', 2200);
        showReturnSuccessModal(message).catch(() => {});

        setTimeout(async () => {
            try {
                await refreshSoldPhonesCache(false);
                returnsDataLoaded = true;
                renderReturnSearchResults(document.getElementById('returnSearch')?.value || '');
                loadReturnsHistory();
                loadReturnsInventoryCounts();
                loadRecentSalesHistory();
                if (currentView === 'inventory') loadInventory({ force: false });
                originalDb.ref('returns/' + returnId).update({
                    inventoryCountFlipkart: countUnsold(pickupsCache.flipkart.data),
                    inventoryCountCashify: countUnsold(pickupsCache.cashify.data)
                }).catch(() => {});
            } catch (_) {}
        }, 100);

        setTimeout(() => {
            fetchPickups('flipkart').catch(() => {});
            fetchPickups('cashify').catch(() => {});
        }, 1200);

    } catch (e) {
        console.error('Return processing error:', e);
        showToast('Error processing return. Please try again.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnHtml || '<i data-lucide="check-circle"></i> Process Return';
            refreshIcons();
        }
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
    if (!hasSwal()) { copyTextToClipboard(message); return; }
    try {
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
    } catch (_) {}
}

async function copyTextToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('✅ Message copied to clipboard', 'success');
        return true;
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { document.execCommand('copy'); ok = true; showToast('✅ Message copied', 'success'); }
        catch (err) { showToast('Copy failed — please select manually', 'error'); }
        document.body.removeChild(ta);
        return ok;
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
            ...Object.keys(fkData).map(id => Object.assign({ id, _source: 'flipkart' }, fkData[id])),
            ...Object.keys(cfData).map(id => Object.assign({ id, _source: 'cashify' }, cfData[id]))
        ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60);

        const knownIds = {
            flipkart: new Set(Object.keys(pickupsCache.flipkart.data || {})),
            cashify: new Set(Object.keys(pickupsCache.cashify.data || {}))
        };
        const merged = candidates.filter(r => {
            const set = knownIds[r._source];
            if (!set || set.size === 0) return true;
            return !r.originalPickupId || set.has(r.originalPickupId);
        }).slice(0, 30);

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
            const safeId = String(r.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
                        <button onclick="viewReturnMessage('${src}', '${safeId}')" class="text-[10px] text-indigo-600 font-semibold hover:underline">View / Resend Message</button>
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
    if (!isStillAuthorized()) { showLoginOverlay(); return; }
    try {
        const snap = await withTimeout(getDb(source).ref('returns/' + returnId).once('value'), 8000);
        const record = snap.val();
        if (!record) { showToast('Return record not found', 'error'); return; }
        await showReturnSuccessModal(buildReturnMessage(record));
    } catch (e) {
        console.error(e);
        showToast('Failed to load return message', 'error');
    }
}

// ================================================================
// AUTHENTICATION — SALES MANAGEMENT LOGIN
// ================================================================

function injectLoginUI() {
    if (document.getElementById('salesLoginOverlay')) return;

    if (!document.getElementById('salesLoginStyles')) {
        const st = document.createElement('style');
        st.id = 'salesLoginStyles';
        st.textContent = `
            .sales-login-overlay {
                position: fixed; inset: 0; z-index: 99999;
                display: flex; align-items: center; justify-content: center;
                background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
                padding: 18px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .sales-login-box {
                background: #fff; border-radius: 24px;
                max-width: 400px; width: 100%; padding: 28px 24px;
                box-shadow: 0 30px 70px rgba(0,0,0,0.35);
            }
            .sales-login-logo {
                width: 64px; height: 64px; margin: 0 auto 14px;
                background: linear-gradient(135deg, #4f46e5, #7c3aed);
                border-radius: 18px;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 10px 28px rgba(79,70,229,0.4);
                font-size: 30px;
            }
            .sales-login-box h2 {
                font-size: 22px; font-weight: 800; color: #0f172a;
                text-align: center; margin-bottom: 4px;
            }
            .sales-login-box .sub {
                text-align: center; color: #94a3b8; font-size: 13px;
                margin-bottom: 22px;
            }
            .sales-login-field { margin-bottom: 14px; }
            .sales-login-field label {
                font-size: 12px; font-weight: 700; color: #334155;
                display: block; margin-bottom: 6px; letter-spacing: 0.3px;
            }
            .sales-login-field input {
                width: 100%; padding: 12px 14px;
                border: 2px solid #e2e8f0; border-radius: 12px;
                font-size: 15px; outline: none;
                transition: border 0.2s, box-shadow 0.2s;
                background: #fff; box-sizing: border-box;
            }
            .sales-login-field input:focus {
                border-color: #4f46e5;
                box-shadow: 0 0 0 3px rgba(79,70,229,0.1);
            }
            .sales-login-btn {
                width: 100%; padding: 14px;
                border: none; border-radius: 14px;
                font-size: 15px; font-weight: 700;
                color: #fff; cursor: pointer;
                background: linear-gradient(135deg, #4f46e5, #7c3aed);
                margin-top: 6px;
                transition: opacity 0.2s, transform 0.1s;
                font-family: inherit;
            }
            .sales-login-btn:active { transform: scale(0.97); }
            .sales-login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
            .sales-login-err {
                color: #dc2626; font-size: 12px;
                margin-top: 4px; text-align: center;
                display: none;
            }
            .sales-user-badge {
                display: inline-flex; align-items: center; gap: 6px;
                background: #eef2ff; color: #4338ca;
                padding: 5px 10px;
                border-radius: 24px;
                font-size: 12px; font-weight: 700;
                border: 1px solid #c7d2fe;
                max-width: 160px;
            }
            .sales-user-badge .uname {
                overflow: hidden; text-overflow: ellipsis;
                white-space: nowrap;
            }
            .sales-user-badge button {
                background: none; border: none; padding: 2px;
                color: #6366f1; cursor: pointer;
                display: inline-flex; align-items: center;
                flex-shrink: 0;
            }
            .sales-user-badge button:hover { color: #dc2626; }

            .sm-history-wrap { margin-top: 22px; margin-bottom: 22px; }
            .sm-history-head {
                display: flex; align-items: center; justify-content: space-between;
                padding: 14px 18px;
                background: linear-gradient(135deg, #eef2ff, #e0e7ff);
                border-radius: 16px 16px 0 0;
                border: 1px solid #c7d2fe;
                border-bottom: none;
            }
            .sm-history-head h3 {
                font-size: 14px; font-weight: 800; color: #3730a3;
                display: flex; align-items: center; gap: 8px;
                margin: 0;
            }
            .sm-history-head button {
                background: #fff; border: 1px solid #c7d2fe;
                color: #4f46e5; font-weight: 700; font-size: 11px;
                padding: 6px 12px; border-radius: 10px;
                cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
                font-family: inherit;
            }
            .sm-history-head button:active { transform: scale(0.96); }
            .sm-history-body {
                background: #fff;
                border: 1px solid #c7d2fe;
                border-radius: 0 0 16px 16px;
                padding: 10px;
                display: flex; flex-direction: column; gap: 8px;
            }
            .sm-history-item {
                padding: 12px 14px;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                transition: background 0.15s;
            }
            .sm-history-item:hover { background: #f1f5f9; }
            .sm-history-item .h-top {
                display: flex; align-items: flex-start; justify-content: space-between;
                gap: 8px; margin-bottom: 4px;
            }
            .sm-history-item .h-order {
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-weight: 800; font-size: 13px; color: #0f172a;
                word-break: break-all;
            }
            .sm-history-item .h-model {
                font-size: 13px; color: #334155;
                margin-top: 2px; font-weight: 600;
            }
            .sm-history-item .h-meta {
                font-size: 11px; color: #64748b;
                display: flex; flex-wrap: wrap; gap: 10px;
                margin-top: 4px;
            }
            .sm-history-item .h-meta strong { color: #0f172a; font-weight: 700; }
            .sm-history-item .h-actions {
                display: flex; gap: 6px; margin-top: 8px;
                flex-wrap: wrap;
            }
            .sm-history-btn {
                padding: 6px 12px; border-radius: 8px;
                border: none; cursor: pointer;
                font-size: 11px; font-weight: 700;
                display: inline-flex; align-items: center; gap: 4px;
                font-family: inherit;
            }
            .sm-history-btn.copy { background: #dcfce7; color: #166534; }
            .sm-history-btn.copy:hover { background: #bbf7d0; }
            .sm-history-btn.view { background: #e0e7ff; color: #3730a3; }
            .sm-history-btn.view:hover { background: #c7d2fe; }
            .sm-history-empty {
                padding: 24px 12px; text-align: center;
                color: #94a3b8; font-size: 13px;
            }
        `;
        document.head.appendChild(st);
    }

    const overlay = document.createElement('div');
    overlay.id = 'salesLoginOverlay';
    overlay.className = 'sales-login-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
        <div class="sales-login-box">
            <div class="sales-login-logo">🛒</div>
            <h2>Sales Manager</h2>
            <p class="sub">Login to manage sales &amp; returns</p>
            <div class="sales-login-field">
                <label>USERNAME</label>
                <input type="text" id="salesLoginUsername" autocomplete="username" placeholder="Enter username">
            </div>
            <div class="sales-login-field">
                <label>PASSWORD</label>
                <input type="password" id="salesLoginPassword" autocomplete="current-password" placeholder="Enter password">
            </div>
            <div id="salesLoginError" class="sales-login-err"></div>
            <button class="sales-login-btn" id="salesLoginBtn" onclick="attemptSalesLogin()">Login</button>
        </div>
    `;
    document.body.appendChild(overlay);

    setTimeout(() => {
        const u = document.getElementById('salesLoginUsername');
        const p = document.getElementById('salesLoginPassword');
        if (u) u.addEventListener('keydown', e => { if (e.key === 'Enter') p?.focus(); });
        if (p) p.addEventListener('keydown', e => { if (e.key === 'Enter') attemptSalesLogin(); });
    }, 50);
}

// ================================================================
// ACCESS CONTROL — Immediate Revoke + Fault-Tolerant Verify
// ================================================================
function verifySalesAccess(userData) {
    if (!userData) return { ok: false, reason: 'not_found' };
    if (userData.is_active === false) return { ok: false, reason: 'inactive' };
    if (userData.forceLogout === true) return { ok: false, reason: 'force_logout' };

    const role = userData.role || 'agent';

    if (role === 'admin') {
        if (userData.sales_access === false) return { ok: false, reason: 'no_access' };
        return { ok: true };
    }
    if (userData.sales_access === true) return { ok: true };
    return { ok: false, reason: 'no_access' };
}

function startAccessListener() {
    if (!currentSalesUser) return;
    stopAccessListener();
    accessRevokedFlag = false;

    const uname = currentSalesUser.username;
    console.log('[SalesManager] ✅ Access listener attached for:', uname);

    accessListenerRef = flipkartDb.ref('users/' + uname);
    accessListenerRef.on('value', snapshot => {
        const applyUpdate = (data) => {
            const access = verifySalesAccess(data);
            if (!access.ok) {
                let reason = 'Your Sales Management access has been revoked by admin.';
                if (access.reason === 'inactive') reason = 'Your account has been deactivated.';
                if (access.reason === 'force_logout') reason = 'You have been logged out by admin.';
                forceLogout(reason);
                if (access.reason === 'force_logout') {
                    setTimeout(() => {
                        flipkartDb.ref('users/' + uname + '/forceLogout').remove().catch(() => {});
                    }, 500);
                }
                return;
            }
            lastAccessVerifiedAt = Date.now();
            currentSalesUser.name = data.name || currentSalesUser.username;
            currentSalesUser.role = data.role || 'agent';
            currentSalesUser.isAdmin = (data.role || 'agent') === 'admin';
            try { localStorage.setItem(SALES_AUTH_KEY, JSON.stringify(currentSalesUser)); } catch (_) {}
        };

        if (!snapshot.exists()) {
            if (!navigator.onLine) return;
            withTimeout(flipkartDb.ref('users/' + uname).once('value'), 6000).then(fresh => {
                if (!fresh.exists()) forceLogout('Your account has been removed.');
                else applyUpdate(fresh.val());
            }).catch(() => {});
            return;
        }
        applyUpdate(snapshot.val());
    }, err => {
        console.warn('[SalesManager] Access listener error (ignored):', err && err.message);
    });
}

function stopAccessListener() {
    if (accessListenerRef) {
        try { accessListenerRef.off(); } catch (_) {}
        accessListenerRef = null;
    }
}

function forceLogout(reason) {
    console.log('[SalesManager] 🚪 forceLogout called:', reason);
    accessRevokedFlag = true;
    lastAccessVerifiedAt = 0;
    stopAccessListener();
    currentSalesUser = null;
    try { localStorage.removeItem(SALES_AUTH_KEY); } catch (_) {}
    document.querySelector('.sales-user-badge')?.remove();
    try { Swal.close(); } catch (_) {}
    try { closeSellModal(); } catch (_) {}
    try { closeDetailModal(); } catch (_) {}
    try { cancelReturnSelection(); } catch (_) {}
    showLoginOverlay();

    setTimeout(() => {
        if (!hasSwal()) { showToast(reason || 'Session ended', 'error', 4000); return; }
        Swal.fire({
            icon: 'warning',
            title: '🔒 Session Ended',
            text: reason || 'Your access has been revoked.',
            confirmButtonColor: '#dc2626',
            allowOutsideClick: false,
            allowEscapeKey: false
        }).catch(() => {});
    }, 100);
}

function isStillAuthorized() {
    return !accessRevokedFlag && currentSalesUser !== null;
}

async function assertSalesAccess() {
    if (!isStillAuthorized()) { showLoginOverlay(); return false; }
    if (Date.now() - lastAccessVerifiedAt < 60000) return true;

    try {
        const snap = await withTimeout(flipkartDb.ref('users/' + currentSalesUser.username).once('value'), 6000);
        if (!snap.exists()) { forceLogout('Your account has been removed.'); return false; }
        const access = verifySalesAccess(snap.val());
        if (!access.ok) {
            let reason = 'Sales Management access revoked.';
            if (access.reason === 'inactive') reason = 'Your account has been deactivated.';
            if (access.reason === 'force_logout') reason = 'You have been logged out by admin.';
            forceLogout(reason);
            return false;
        }
        lastAccessVerifiedAt = Date.now();
        return true;
    } catch (e) {
        console.warn('[SalesManager] Access check failed (offline tolerant):', e && e.message);
        return true;
    }
}

// ---------- LOGIN / LOGOUT ----------
async function attemptSalesLogin() {
    const userEl = document.getElementById('salesLoginUsername');
    const passEl = document.getElementById('salesLoginPassword');
    const errEl = document.getElementById('salesLoginError');
    const btn = document.getElementById('salesLoginBtn');

    const username = (userEl?.value || '').trim().toLowerCase();
    const password = (passEl?.value || '').trim();

    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (!username || !password) {
        if (errEl) { errEl.textContent = 'Enter username and password'; errEl.style.display = 'block'; }
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Logging in…'; }

    try {
        const snap = await withTimeout(flipkartDb.ref('users/' + username).once('value'), 10000);
        if (!snap.exists()) {
            if (errEl) { errEl.textContent = 'User not found'; errEl.style.display = 'block'; }
            return;
        }
        const userData = snap.val();
        if (userData.password !== password) {
            if (errEl) { errEl.textContent = 'Incorrect password'; errEl.style.display = 'block'; }
            return;
        }
        const access = verifySalesAccess(userData);
        if (!access.ok) {
            let msg = 'Access denied';
            if (access.reason === 'inactive') msg = 'Account inactive. Contact admin.';
            else if (access.reason === 'no_access') msg = 'Sales Management access not granted. Ask admin to enable it.';
            else if (access.reason === 'force_logout') msg = 'You were logged out by admin. Try again.';
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }

            if (access.reason === 'force_logout') {
                flipkartDb.ref('users/' + username + '/forceLogout').remove().catch(() => {});
            }
            return;
        }

        currentSalesUser = {
            username,
            name: userData.name || username,
            role: userData.role || 'agent',
            isAdmin: (userData.role || 'agent') === 'admin'
        };
        try { localStorage.setItem(SALES_AUTH_KEY, JSON.stringify(currentSalesUser)); } catch (_) {}
        accessRevokedFlag = false;
        lastAccessVerifiedAt = Date.now();
        startAccessListener();

        hideLoginOverlay();
        showUserBadge();
        showToast('✅ Welcome, ' + currentSalesUser.name, 'success');
        initAppAfterLogin();
    } catch (e) {
        console.error('Sales login error:', e);
        if (errEl) { errEl.textContent = 'Login failed. Check network.'; errEl.style.display = 'block'; }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
    }
}

function hideLoginOverlay() {
    const o = document.getElementById('salesLoginOverlay');
    if (o) o.style.display = 'none';
}

function showLoginOverlay() {
    const o = document.getElementById('salesLoginOverlay');
    if (!o) return;
    o.style.display = 'flex';
    const u = document.getElementById('salesLoginUsername');
    const p = document.getElementById('salesLoginPassword');
    if (u) u.value = '';
    if (p) p.value = '';
    setTimeout(() => u?.focus(), 200);
}

function showUserBadge() {
    if (!currentSalesUser) return;
    const refreshBtn = document.querySelector('button[onclick="refreshInventory()"]');
    if (!refreshBtn) return;
    const parent = refreshBtn.parentElement;
    if (!parent) return;
    parent.querySelector('.sales-user-badge')?.remove();

    const badge = document.createElement('div');
    badge.className = 'sales-user-badge';
    badge.innerHTML = `
        <span class="uname" title="${escapeHtml(currentSalesUser.name)} (${escapeHtml(currentSalesUser.username)})">${escapeHtml(currentSalesUser.name)}</span>
        <button onclick="logoutSalesUser()" title="Logout">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
    `;
    parent.insertBefore(badge, refreshBtn);
}

function logoutSalesUser() {
    stopAccessListener();
    accessRevokedFlag = false;
    lastAccessVerifiedAt = 0;
    currentSalesUser = null;
    try { localStorage.removeItem(SALES_AUTH_KEY); } catch (_) {}
    document.querySelector('.sales-user-badge')?.remove();
    showLoginOverlay();
    showToast('Logged out', 'info');
}

function initAppAfterLogin() {
    if (pickupsCache[currentSource].data) {
        inventoryList = buildInventoryList(pickupsCache[currentSource].data, currentSource);
        applySearch();
        updateStats(pickupsCache[currentSource].data);
    }
    loadInventory({ force: false });
    loadRecentSalesHistory();
    refreshIcons();

    setTimeout(() => prefetchSourceData('flipkart'), 300);
    setTimeout(() => prefetchSourceData('cashify'), 900);
}

async function checkSalesSession() {
    let parsed = null;
    try {
        const stored = localStorage.getItem(SALES_AUTH_KEY);
        if (!stored) return false;
        parsed = JSON.parse(stored);
        if (!parsed || !parsed.username) return false;
    } catch (_) { return false; }

    currentSalesUser = {
        username: parsed.username,
        name: parsed.name || parsed.username,
        role: parsed.role || 'agent',
        isAdmin: parsed.role === 'admin'
    };
    accessRevokedFlag = false;
    startAccessListener();

    setTimeout(async () => {
        if (!currentSalesUser || accessRevokedFlag) return;
        if (Date.now() - lastAccessVerifiedAt < 5000) return;
        try {
            const snap = await withTimeout(flipkartDb.ref('users/' + currentSalesUser.username).once('value'), 8000);
            if (!snap.exists()) {
                if (navigator.onLine) forceLogout('Your account has been removed.');
                return;
            }
            const access = verifySalesAccess(snap.val());
            if (!access.ok) {
                let reason = 'Your Sales Management access has been revoked by admin.';
                if (access.reason === 'inactive') reason = 'Your account has been deactivated.';
                if (access.reason === 'force_logout') reason = 'You have been logged out by admin.';
                forceLogout(reason);
            } else {
                lastAccessVerifiedAt = Date.now();
            }
        } catch (_) {}
    }, 1200);

    return true;
}

// ================================================================
// SALE WHATSAPP MESSAGE
// ================================================================
async function getSourceInventoryCount(source, force = false) {
    const data = await getPickups(source, force);
    return countUnsold(data);
}

/**
 * Build the WhatsApp sale message.
 *
 * Unchanged format — only the FINAL totals block differs:
 *   • Selling a Flipkart order pickup:
 *       📦 Flipkart Inventory: X units
 *       📦 Outside Inventory: Y units
 *       📊 Total: (X+Y) units
 *   • Selling an Outside Inventory phone (approved from outside_pickups):
 *       📦 Outside Inventory: Y units
 *       📦 Flipkart Inventory: X units
 *       📊 Total: (X+Y) units
 *   • Selling a Cashify phone: unchanged "Remaining Cashify Stock".
 */
function buildSaleMessage(item, salePrice, source, inventoryCount) {
    const sourceLabel = source === 'cashify' ? 'CASHIFY' : 'FLIPKART';
    const model = item.phoneModel || '—';
    const imei = item.imei || '—';
    const ramStorage = item.ramStorage
        || ((item.ram || item.storage) ? `${item.ram || '—'}/${item.storage || '—'}` : '—');
    const network = item.networkType || '—';
    const buyerName = item.buyerName || '—';
    const buyerContact = item.buyerContact || '';
    const saleDate = item.saleDate
        || (item.saleTimestamp ? new Date(item.saleTimestamp).toISOString().slice(0, 10) : '—');
    const salesByName = item.salesByName || item.salesBy || '(not tracked)';
    const salesByUname = item.salesBy || '';
    const pickupAgent = item.agent || '';

    const lines = [];
    lines.push(`🛒 *SALE COMPLETED — ${sourceLabel}*`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push(`📦 Order ID: ${item.orderId || item.id || '—'}`);
    lines.push(`📱 Model: ${model}`);
    lines.push(`🔖 IMEI: ${imei}`);
    lines.push(`💾 RAM/ROM: ${ramStorage}`);
    lines.push(`🌐 Network: ${network}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push(`💰 Sale Price: ₹${Number(salePrice).toLocaleString('en-IN')}`);
    lines.push(`👤 Buyer: ${buyerName}`);
    if (buyerContact) lines.push(`📞 Contact: ${buyerContact}`);
    lines.push(`📅 Sale Date: ${saleDate}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push(`🧑‍💼 Sold by: ${salesByName}${salesByUname ? ' (' + salesByUname + ')' : ''}`);
    if (pickupAgent && pickupAgent !== salesByUname) {
        lines.push(`🚚 Pickup Agent: ${pickupAgent}`);
    }
    lines.push('━━━━━━━━━━━━━━━━━━━━');

    if (source === 'flipkart') {
        // Compute current Flipkart vs Outside breakdown from cache
        // (the just-sold phone is already marked `sold:true` in cache, so
        // it's naturally excluded from these "remaining" counts)
        const breakdown = getFlipkartInventoryBreakdown(pickupsCache.flipkart.data);
        const soldFromOutside = isOutsidePickupItem(item);

        if (soldFromOutside) {
            lines.push(`📦 Outside Inventory: ${breakdown.outside} units`);
            lines.push(`📦 Flipkart Inventory: ${breakdown.flipkart} units`);
        } else {
            lines.push(`📦 Flipkart Inventory: ${breakdown.flipkart} units`);
            lines.push(`📦 Outside Inventory: ${breakdown.outside} units`);
        }
        lines.push(`📊 Total: ${breakdown.total} units`);
    } else {
        // Cashify source — keep existing single-line stock format
        lines.push(`📦 Remaining Cashify Stock: ${inventoryCount} units`);
    }
    lines.push('━━━━━━━━━━━━━━━━━━━━');

    return lines.join('\n');
}

async function showSaleSuccessModal(message) {
    if (!hasSwal()) { await copyTextToClipboard(message); return; }
    try {
        const result = await Swal.fire({
            title: '✅ Sale Recorded!',
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
    } catch (_) {}
}

// ================================================================
// RECENT SALES HISTORY
// ================================================================
function injectRecentHistoryUI() {
    if (document.getElementById('smHistoryWrap')) return;
    const mainContainer = document.querySelector('.max-w-6xl');
    if (!mainContainer) return;

    const wrap = document.createElement('div');
    wrap.id = 'smHistoryWrap';
    wrap.className = 'sm-history-wrap';
    wrap.innerHTML = `
        <div class="sm-history-head">
            <h3>🕒 Recent Sales History <span style="font-size:11px;font-weight:600;color:#6366f1;">(Last 7)</span></h3>
            <button onclick="loadRecentSalesHistory(true)">🔄 Refresh</button>
        </div>
        <div class="sm-history-body" id="smHistoryBody">
            <div class="sm-history-empty">Loading…</div>
        </div>
    `;
    mainContainer.appendChild(wrap);
}

async function loadRecentSalesHistory(force = false) {
    if (!currentSalesUser) return;
    const body = document.getElementById('smHistoryBody');
    if (!body) return;

    try {
        const [fk, cf] = await Promise.all([
            getPickups('flipkart', force),
            getPickups('cashify', force)
        ]);

        const isSold = (item) => item && item.sold === true && item.status === 'pickup';
        const all = [];
        for (const id in fk) if (isSold(fk[id])) all.push(Object.assign({ id, _source: 'flipkart' }, fk[id]));
        for (const id in cf) if (isSold(cf[id])) all.push(Object.assign({ id, _source: 'cashify' }, cf[id]));

        all.sort((a, b) => {
            const ta = new Date(a.saleTimestamp || 0).getTime() || 0;
            const tb = new Date(b.saleTimestamp || 0).getTime() || 0;
            return tb - ta;
        });

        renderRecentSalesHistory(all.slice(0, 7));
    } catch (e) {
        console.error('Recent sales load error:', e);
        body.innerHTML = '<div class="sm-history-empty">Failed to load recent sales</div>';
    }
}

function renderRecentSalesHistory(sales) {
    const body = document.getElementById('smHistoryBody');
    if (!body) return;

    if (!sales.length) {
        body.innerHTML = '<div class="sm-history-empty">No sales recorded yet</div>';
        return;
    }

    let html = '';
    sales.forEach(s => {
        const srcLabel = s._source === 'cashify' ? 'Cashify' : 'Flipkart';
        const pillColor = s._source === 'cashify' ? '#E6FAF6' : '#eef2ff';
        const pillText = s._source === 'cashify' ? '#0FA88B' : '#4338ca';
        const pillBorder = s._source === 'cashify' ? '#a7f3d0' : '#c7d2fe';

        const salePrice = Number(s.salePrice) || 0;
        const saleDate = s.saleDate
            || (s.saleTimestamp ? new Date(s.saleTimestamp).toISOString().slice(0, 10) : '—');
        const soldBy = s.salesByName || s.salesBy || s.agent || '—';
        const buyer = s.buyerName || '—';

        const safeId = String(s.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeSrc = s._source;

        html += `
            <div class="sm-history-item">
                <div class="h-top">
                    <div style="min-width:0;flex:1;">
                        <div class="h-order">${escapeHtml(s.orderId || s.id)}</div>
                        <div class="h-model">${escapeHtml(s.phoneModel || '—')}</div>
                    </div>
                    <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:800;background:${pillColor};color:${pillText};border:1px solid ${pillBorder};white-space:nowrap;">${srcLabel}</span>
                </div>
                <div class="h-meta">
                    <span>💰 <strong>₹${salePrice.toLocaleString('en-IN')}</strong></span>
                    <span>📅 ${escapeHtml(saleDate)}</span>
                    <span>🧑‍💼 ${escapeHtml(soldBy)}</span>
                    <span>👤 ${escapeHtml(buyer)}</span>
                </div>
                <div class="h-actions">
                    <button class="sm-history-btn copy" onclick="copySaleMessageForHistory('${safeSrc}', '${safeId}')">📋 Copy Message</button>
                    <button class="sm-history-btn view" onclick="viewOrderDetail('${safeId}', '${safeSrc}')">👁 View</button>
                </div>
            </div>
        `;
    });
    body.innerHTML = html;
}

async function copySaleMessageForHistory(source, id) {
    if (!isStillAuthorized()) { showLoginOverlay(); return; }
    try {
        let item = pickupsCache[source].data && pickupsCache[source].data[id];
        if (!item) {
            const snap = await withTimeout(getDb(source).ref('pickups/' + id).once('value'), 8000);
            item = snap.val();
        }
        if (!item) { showToast('Sale not found', 'error'); return; }
        const count = countUnsold(pickupsCache[source].data);
        const msg = buildSaleMessage(item, item.salePrice || 0, source, count);
        await copyTextToClipboard(msg);
    } catch (e) {
        console.error('History copy error:', e);
        showToast('Failed to copy message', 'error');
    }
}

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const bootTs = Date.now();

    hydrateInventoryFromLS();
    hydrateOverheadFromLS();

    setupOfflineDetection();
    injectLoginUI();
    injectRecentHistoryUI();
    refreshIconsNow();

    document.querySelectorAll('#sourceTabs .source-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.source === currentSource);
    });

    const hasSession = await checkSalesSession();

    if (hasSession) {
        hideLoginOverlay();
        showUserBadge();
        initAppAfterLogin();
    } else {
        showLoginOverlay();
        if (pickupsCache[currentSource].data) {
            inventoryList = buildInventoryList(pickupsCache[currentSource].data, currentSource);
            applySearch();
            updateStats(pickupsCache[currentSource].data);
        }
    }

    if (fallbackCheckInterval) clearInterval(fallbackCheckInterval);
    fallbackCheckInterval = setInterval(async () => {
        if (document.hidden) return;
        if (!currentSalesUser) return;
        if (accessRevokedFlag) return;
        if (!navigator.onLine) return;
        if (Date.now() - lastAccessVerifiedAt < 60000) return;

        try {
            const snap = await withTimeout(flipkartDb.ref('users/' + currentSalesUser.username).once('value'), 8000);
            if (!snap.exists()) { forceLogout('Your account has been removed.'); return; }
            const access = verifySalesAccess(snap.val());
            if (!access.ok) {
                let reason = 'Your Sales Management access has been revoked by admin.';
                if (access.reason === 'inactive') reason = 'Your account has been deactivated.';
                if (access.reason === 'force_logout') reason = 'You have been logged out by admin.';
                forceLogout(reason);
            } else {
                lastAccessVerifiedAt = Date.now();
            }
        } catch (_) {}
    }, 20000);

    setInterval(() => {
        if (document.hidden) return;
        if (!isStillAuthorized()) return;
        if (!navigator.onLine) return;
        if (currentView === 'inventory') loadInventory({ force: false });
        else if (currentView === 'returns') loadReturnsHistory();
        loadRecentSalesHistory(false);
    }, 60000);

    console.log(`[SalesManager] ✅ v4.1 initialized in ${Date.now() - bootTs}ms — cache-first, fault-tolerant, Flipkart/Outside breakdown`);
});

// ---------- MODAL OUTSIDE-CLICK + ESC ----------
const sellModalEl = document.getElementById('sellModal');
if (sellModalEl) sellModalEl.addEventListener('click', function (e) { if (e.target === this) closeSellModal(); });
const detailModalEl = document.getElementById('detailModal');
if (detailModalEl) detailModalEl.addEventListener('click', function (e) { if (e.target === this) closeDetailModal(); });
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSellModal(); closeDetailModal(); }
});

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

window.attemptSalesLogin = attemptSalesLogin;
window.logoutSalesUser = logoutSalesUser;
window.loadRecentSalesHistory = loadRecentSalesHistory;
window.copySaleMessageForHistory = copySaleMessageForHistory;

// ---------- PAGE-LIFECYCLE HYGIENE ----------
window.addEventListener('beforeunload', () => {
    stopAccessListener();
    if (fallbackCheckInterval) clearInterval(fallbackCheckInterval);
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isStillAuthorized() && navigator.onLine) {
        if (currentView === 'inventory') loadInventory({ force: false });
        loadRecentSalesHistory(false);
    }
});

// Version log for cache verification
console.log('[SalesManager] ✅ v4.1 loaded — Flipkart + Outside breakdown in WhatsApp sale message');