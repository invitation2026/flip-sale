// ================================================================
// Sales Manager · Flipkart + Cashify
// Dual Firebase integration — Flipkart (default) + Cashify (secondary)
// + Smart Return Management System (new)
// ================================================================

// ==========================================
// FIREBASE CONFIG — FLIPKART (default app)
// ==========================================
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

// ==========================================
// FIREBASE CONFIG — CASHIFY (secondary app)
// ==========================================
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

// ==========================================
// SOURCE HELPERS
// ==========================================
function getDb(source) {
    return source === 'cashify' ? cashifyDb : flipkartDb;
}
function getSourceLabel(source) {
    return source === 'cashify' ? 'Cashify' : 'Flipkart';
}
function getSourceTheme(source) {
    return source === 'cashify'
        ? { primary: '#12CAA7', dark: '#0FA88B', light: '#E6FAF6', soft: '#d1fae5', border: '#a7f3d0', text: '#0FA88B', pill: 'cashify', accent: 'cashify-accent', src: 'cashify-src' }
        : { primary: '#6366f1', dark: '#4f46e5', light: '#eef2ff', soft: '#e0e7ff', border: '#c7d2fe', text: '#4338ca', pill: 'flipkart', accent: 'flipkart-accent', src: 'flipkart-src' };
}

// ==========================================
// COMMISSION BRACKETS (Flipkart only)
// ==========================================
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

// ==========================================
// HELPERS
// ==========================================
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
function refreshIcons() {
    if (window.lucide) { try { lucide.createIcons(); } catch (e) {} }
}
function formatINR(num) {
    if (num === undefined || num === null || isNaN(num)) return '₹0';
    return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(num));
}

// ==========================================
// STATE
// ==========================================
let currentView = 'inventory';        // 'inventory' | 'returns'
let currentSource = 'flipkart';
let inventoryList = [];
let filteredInventory = [];
let sellOrderData = null;
let isRefreshing = false;

// Returns state
let returnSearchResults = [];
let selectedReturnPhone = null;
let exchangeSource = 'flipkart';
let exchangeInventoryList = [];
let isProcessingReturn = false;
let lastReturnMessage = '';

// Cache: overhead per phone for each source
const overheadCache = {
    flipkart: { ts: 0, value: 0 },
    cashify:  { ts: 0, value: 0 }
};
const OVERHEAD_TTL = 10 * 60 * 1000;
const lastUpdatedBySource = { flipkart: null, cashify: null };

// ==========================================
// DOM REFS
// ==========================================
const toastEl = document.getElementById('toast');

// ==========================================
// TOAST
// ==========================================
function showToast(msg, type = 'info', duration = 3000) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'toast-fixed ' + type;
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ==========================================
// CONNECTION STATUS
// ==========================================
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

// ==========================================
// VIEW SWITCHING  (Inventory / Returns)
// ==========================================
function switchView(view) {
    if (view !== 'inventory' && view !== 'returns') return;
    if (currentView === view) return;

    currentView = view;

    const invBtn = document.getElementById('viewBtnInventory');
    const retBtn = document.getElementById('viewBtnReturns');
    if (invBtn) invBtn.classList.toggle('active', view === 'inventory');
    if (retBtn) retBtn.classList.toggle('active', view === 'returns');

    document.getElementById('inventoryView').style.display = view === 'inventory' ? 'block' : 'none';
    document.getElementById('returnsView').style.display = view === 'returns' ? 'block' : 'none';

    updateSourceTabsForView();

    if (view === 'returns') {
        loadReturnsView();
        loadReturnsHistory();
    } else {
        loadInventory();
    }

    refreshIcons();
}

function updateSourceTabsForView() {
    const isReturns = currentView === 'returns';
    document.querySelectorAll('#sourceTabs .source-tab').forEach(tab => {
        const label = tab.querySelector('span:last-child');
        if (!label) return;
        const isFk = tab.dataset.source === 'flipkart';
        label.textContent = isFk
            ? (isReturns ? 'Flipkart Returns' : 'Flipkart')
            : (isReturns ? 'Cashify Returns' : 'Cashify');
    });
}

// ==========================================
// SOURCE SWITCHING
// ==========================================
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

    // Clear inventory search
    const searchInput = document.getElementById('inventorySearch');
    if (searchInput) searchInput.value = '';

    // Clear returns state
    returnSearchResults = [];
    selectedReturnPhone = null;
    const rSearch = document.getElementById('returnSearch');
    if (rSearch) rSearch.value = '';
    const rResults = document.getElementById('returnSearchResults');
    if (rResults) rResults.innerHTML = '';
    const rForm = document.getElementById('returnFormSection');
    if (rForm) { rForm.style.display = 'none'; rForm.innerHTML = ''; }

    if (currentView === 'returns') {
        loadReturnsView();
        loadReturnsHistory();
    } else {
        inventoryList = [];
        filteredInventory = [];
        renderInventory();
        loadInventory();
    }
}

// ==========================================
// LOAD INVENTORY
// ==========================================
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
    Object.values(pickupsData).forEach(item => { if (item.sold === true && item.status === 'pickup') soldCount++; });
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

// ==========================================
// SEARCH (inventory)
// ==========================================
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

// ==========================================
// RENDER INVENTORY
// ==========================================
function renderInventory() {
    renderMobileCards();
    renderDesktopTable();
    refreshIcons();
}

function renderMobileCards() {
    const container = document.getElementById('inventoryCards');
    if (!container) return;

    if (!filteredInventory.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox"></i>
                <p class="text-sm font-medium">No inventory</p>
                <p class="text-xs text-gray-400 mt-1">Phones picked up will appear here</p>
            </div>`;
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
                    <button onclick="viewOrderDetail('${item.id}')" class="btn-action view" title="View"><i data-lucide="eye"></i></button>
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
                        <button onclick="viewOrderDetail('${item.id}')" class="btn-action view" style="padding:8px 12px;min-height:38px;" title="View"><i data-lucide="eye" style="width:16px;height:16px;"></i></button>
                    </div>
                </td>
            </tr>`;
    });
    tbody.innerHTML = html;
}

// ==========================================
// OVERHEAD PER PHONE
// ==========================================
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

// ==========================================
// SELL MODAL (unchanged)
// ==========================================
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
            sold: true, salePrice, buyerName, buyerContact: buyerContact || '', saleDate,
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

        const db = getDb(source);
        await db.ref('pickups/' + order.id).update(writePayload);
        showToast(`✅ Sold from ${sourceLabel} for ₹${salePrice.toLocaleString('en-IN')}`, 'success');
        closeSellModal();
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

// ==========================================
// VIEW ORDER DETAIL (unchanged)
// ==========================================
async function viewOrderDetail(orderId) {
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    if (!modal || !content) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    content.innerHTML = `<div class="text-center py-8 text-gray-400"><span class="spinner-sm"></span><p class="text-sm mt-2">Loading...</p></div>`;

    try {
        const db = getDb(currentSource);
        const snap = await db.ref('pickups/' + orderId).once('value');
        const item = snap.val();
        if (!item) { content.innerHTML = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium">Order not found</p></div>`; refreshIcons(); return; }

        const statusLabel = item.status || 'unknown';
        const isSold = item.sold === true;
        const isReturned = item.returned === true;

        let statusDisplay, statusClass;
        if (isReturned) { statusDisplay = 'Returned'; statusClass = 'sold'; }
        else if (isSold) { statusDisplay = 'Sold'; statusClass = 'sold'; }
        else if (statusLabel === 'pickup') { statusDisplay = 'Pickup'; statusClass = 'available'; }
        else if (statusLabel === 'rejected') { statusDisplay = 'Rejected'; statusClass = 'rejected'; }
        else { statusDisplay = 'Pending'; statusClass = 'available'; }

        const sourceLabel = getSourceLabel(currentSource);
        const pillClass = currentSource === 'cashify' ? 'cashify' : 'flipkart';

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

// ==========================================
// REFRESH
// ==========================================
async function refreshInventory() {
    if (isRefreshing) return;
    isRefreshing = true;
    showToast('🔄 Refreshing…', 'info', 1200);
    overheadCache[currentSource] = { ts: 0, value: 0 };

    if (currentView === 'returns') {
        await Promise.all([loadReturnsView(), loadReturnsHistory()]);
    } else {
        await loadInventory();
    }

    isRefreshing = false;
    showToast('✅ Refreshed', 'success', 1500);
}

// ================================================================
// ================================================================
// ============ RETURNS SYSTEM (NEW) ==============================
// ================================================================
// ================================================================

// ==========================================
// INVENTORY COUNTS (both platforms, live from data)
// ==========================================
async function getInventoryCount(source) {
    try {
        const db = getDb(source);
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        let count = 0;
        Object.values(data).forEach(item => {
            if (item && item.status === 'pickup' && !item.sold) count++;
        });
        return count;
    } catch (e) {
        console.warn('Count error for ' + source, e);
        return 0;
    }
}

async function loadInventoryCounts() {
    const [fk, cf] = await Promise.all([getInventoryCount('flipkart'), getInventoryCount('cashify')]);
    const fkEl = document.getElementById('flipkartInvCount');
    const cfEl = document.getElementById('cashifyInvCount');
    if (fkEl) fkEl.textContent = fk;
    if (cfEl) cfEl.textContent = cf;
    return { flipkart: fk, cashify: cf };
}

// ==========================================
// RETURNS VIEW LOAD
// ==========================================
async function loadReturnsView() {
    updateReturnsBanner();
    await loadInventoryCounts();
    returnSearchResults = [];
    selectedReturnPhone = null;
    const rSearch = document.getElementById('returnSearch');
    if (rSearch) rSearch.value = '';
    const rResults = document.getElementById('returnSearchResults');
    if (rResults) rResults.innerHTML = '';
    const rForm = document.getElementById('returnFormSection');
    if (rForm) { rForm.style.display = 'none'; rForm.innerHTML = ''; }
}

function updateReturnsBanner() {
    const banner = document.getElementById('returnsBanner');
    const title = document.getElementById('returnsBannerTitle');
    const subtitle = document.getElementById('returnsBannerSubtitle');
    const icon = document.getElementById('returnsBannerIcon');
    const iconBg = document.getElementById('returnsBannerIconBg');
    if (!banner) return;

    if (currentSource === 'cashify') {
        banner.style.borderLeftColor = '#12CAA7';
        if (icon) icon.style.color = '#0FA88B';
        if (iconBg) iconBg.style.background = '#E6FAF6';
        if (title) title.textContent = 'Cashify Returns';
        if (subtitle) subtitle.textContent = 'Search and process return of Cashify-sold phones';
    } else {
        banner.style.borderLeftColor = '#6366f1';
        if (icon) icon.style.color = '#6366f1';
        if (iconBg) iconBg.style.background = '#eef2ff';
        if (title) title.textContent = 'Flipkart Returns';
        if (subtitle) subtitle.textContent = 'Search and process return of Flipkart-sold phones';
    }
}

// ==========================================
// SEARCH SOLD PHONES
// ==========================================
async function searchSoldPhones() {
    const input = document.getElementById('returnSearch');
    const query = (input ? input.value : '').trim();
    if (!query) { showToast('Enter IMEI or model to search', 'error'); return; }

    const resultsEl = document.getElementById('returnSearchResults');
    if (resultsEl) resultsEl.innerHTML = `<div class="glass rounded-2xl p-6 text-center text-gray-400 text-sm"><span class="spinner-sm"></span> Searching...</div>`;

    try {
        const db = getDb(currentSource);
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};

        const lower = query.toLowerCase();
        const digits = query.replace(/\D/g, '');

        returnSearchResults = Object.entries(data)
            .filter(([_, item]) => {
                if (!item) return false;
                if (item.status !== 'pickup') return false;
                if (item.sold !== true) return false;
                if (item.returned === true) return false; // already returned
                return true;
            })
            .map(([id, item]) => ({ id, ...item }))
            .filter(item => {
                const imei = String(item.imei || '');
                const imei2 = String(item.imei2 || '');
                const model = String(item.phoneModel || '').toLowerCase();
                const orderId = String(item.orderId || item.id || '').toLowerCase();

                if (model.includes(lower)) return true;
                if (orderId.includes(lower)) return true;
                if (imei.includes(query) || imei2.includes(query)) return true;
                if (digits.length >= 4) {
                    if (imei.endsWith(digits) || imei2.endsWith(digits)) return true;
                }
                return false;
            })
            .sort((a, b) => {
                const ta = new Date(a.saleTimestamp || a.timestamp || 0).getTime() || 0;
                const tb = new Date(b.saleTimestamp || b.timestamp || 0).getTime() || 0;
                return tb - ta;
            });

        renderReturnSearchResults();
    } catch (e) {
        console.error('Search error:', e);
        if (resultsEl) resultsEl.innerHTML = `<div class="glass rounded-2xl p-6 text-center text-red-500 text-sm">Error searching. Please try again.</div>`;
        showToast('Search failed', 'error');
    }
}

function clearReturnSearch() {
    const rSearch = document.getElementById('returnSearch');
    if (rSearch) rSearch.value = '';
    returnSearchResults = [];
    selectedReturnPhone = null;
    const rResults = document.getElementById('returnSearchResults');
    if (rResults) rResults.innerHTML = '';
    const rForm = document.getElementById('returnFormSection');
    if (rForm) { rForm.style.display = 'none'; rForm.innerHTML = ''; }
}

function renderReturnSearchResults() {
    const container = document.getElementById('returnSearchResults');
    if (!container) return;

    if (!returnSearchResults.length) {
        container.innerHTML = `<div class="glass rounded-2xl p-6 text-center text-gray-400 text-sm">
            <i data-lucide="search-x" class="w-6 h-6 mx-auto mb-2" style="color:#cbd5e1;"></i>
            No matching sold phones found.<br>Try a different IMEI (last 4 / full) or model name.
        </div>`;
        refreshIcons();
        return;
    }

    const pillClass = currentSource === 'cashify' ? 'cashify' : 'flipkart';
    const sourceLabel = getSourceLabel(currentSource);

    let html = `<div class="glass rounded-2xl p-3 shadow-sm border border-gray-100 space-y-2">`;
    html += `<p class="text-xs font-bold text-gray-500 px-2 py-1">${returnSearchResults.length} matching sold phone${returnSearchResults.length > 1 ? 's' : ''}</p>`;
    returnSearchResults.forEach(item => {
        const salePrice = Number(item.salePrice) || 0;
        const saleDate = item.saleDate || (item.saleTimestamp ? getLocalYMD(new Date(item.saleTimestamp)) : '—');
        html += `
            <div class="return-result-card" onclick="selectReturnPhone('${item.id}')">
                <div class="flex items-start justify-between gap-2 mb-1">
                    <div class="min-w-0 flex-1">
                        <div class="font-mono font-bold text-gray-800 text-sm truncate">${escapeHtml(item.orderId || item.id)}</div>
                        <div class="text-sm text-gray-700 font-medium truncate mt-0.5">${escapeHtml(item.phoneModel || '—')}</div>
                    </div>
                    <span class="src-pill ${pillClass}"><span class="dot"></span>${sourceLabel}</span>
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

// ==========================================
// SELECT RETURN PHONE
// ==========================================
function selectReturnPhone(pickupId) {
    const item = returnSearchResults.find(r => r.id === pickupId);
    if (!item) { showToast('Phone not found in results', 'error'); return; }
    selectedReturnPhone = item;
    renderReturnForm();
}

function cancelReturnSelection() {
    selectedReturnPhone = null;
    const rForm = document.getElementById('returnFormSection');
    if (rForm) { rForm.style.display = 'none'; rForm.innerHTML = ''; }
}

// ==========================================
// RENDER RETURN FORM
// ==========================================
function renderReturnForm() {
    const section = document.getElementById('returnFormSection');
    if (!section) return;

    if (!selectedReturnPhone) {
        section.style.display = 'none';
        section.innerHTML = '';
        return;
    }

    const phone = selectedReturnPhone;
    const sourceLabel = getSourceLabel(currentSource);
    const pillClass = currentSource === 'cashify' ? 'cashify' : 'flipkart';
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

        <!-- Selected Phone Details -->
        <div class="mb-4">
            <div class="flex items-center gap-2 flex-wrap mb-2">
                <span class="src-pill ${pillClass}"><span class="dot"></span>${sourceLabel}</span>
                <span class="font-mono font-bold text-gray-800 text-sm">${escapeHtml(phone.orderId || phone.id)}</span>
            </div>
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="label">Phone Model</div>
                    <div class="value">${escapeHtml(phone.phoneModel || '—')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">IMEI</div>
                    <div class="value font-mono text-xs">${escapeHtml(phone.imei || '—')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">Original Sale Price</div>
                    <div class="value green">₹${salePrice.toLocaleString('en-IN')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">Original Sale Date</div>
                    <div class="value">${escapeHtml(saleDate)}</div>
                </div>
                ${phone.buyerName ? `<div class="detail-item full"><div class="label">Buyer</div><div class="value">${escapeHtml(phone.buyerName)}</div></div>` : ''}
            </div>
        </div>

        <hr class="my-4 border-gray-100">

        <!-- Return Date -->
        <div class="mb-3">
            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Return Date</label>
            <input type="date" id="returnDate" class="input-field" value="${getLocalYMD()}" />
        </div>

        <!-- Settlement Type -->
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

        <!-- Money Section -->
        <div id="moneySection">
            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Amount Returned to Customer (₹) *</label>
            <input type="number" id="returnAmount" class="input-field" placeholder="Enter amount returned" min="0" step="1" />
        </div>

        <!-- Exchange Section -->
        <div id="exchangeSection" style="display:none;">
            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Exchange Phone Source *</label>
            <div class="flex gap-2 mt-1 mb-3">
                <button type="button" onclick="onExchangeSourceChange('flipkart')" id="exSrcFlipkart" class="exchange-src-btn" style="border-color:#6366f1;background:#eef2ff;color:#4338ca;">Flipkart</button>
                <button type="button" onclick="onExchangeSourceChange('cashify')" id="exSrcCashify" class="exchange-src-btn">Cashify</button>
            </div>
            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Select Exchange Phone *</label>
            <select id="exchangePhoneSelect" class="input-field" onchange="onExchangePhoneSelect()">
                <option value="">Loading...</option>
            </select>
            <div id="exchangePhoneDetails" class="mt-3"></div>
        </div>

        <!-- Submit -->
        <div class="flex gap-2 mt-4">
            <button onclick="cancelReturnSelection()" class="btn-action view flex-1">Cancel</button>
            <button onclick="submitReturn()" id="processReturnBtn" class="btn-action success flex-1">
                <i data-lucide="check-circle"></i> Process Return
            </button>
        </div>
    `;

    refreshIcons();
    onExchangeSourceChange('flipkart'); // load exchange inventory
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
}

async function onExchangeSourceChange(source) {
    exchangeSource = source;
    const fkBtn = document.getElementById('exSrcFlipkart');
    const cfBtn = document.getElementById('exSrcCashify');

    if (fkBtn) {
        fkBtn.style.cssText = `flex:1;padding:10px;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;transition:all 0.2s;border:2px solid ${source === 'flipkart' ? '#6366f1' : '#e2e8f0'};background:${source === 'flipkart' ? '#eef2ff' : '#fff'};color:${source === 'flipkart' ? '#4338ca' : '#64748b'};`;
    }
    if (cfBtn) {
        cfBtn.style.cssText = `flex:1;padding:10px;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;transition:all 0.2s;border:2px solid ${source === 'cashify' ? '#12CAA7' : '#e2e8f0'};background:${source === 'cashify' ? '#E6FAF6' : '#fff'};color:${source === 'cashify' ? '#0FA88B' : '#64748b'};`;
    }

    await loadExchangeInventory(source);
}

async function loadExchangeInventory(source) {
    const select = document.getElementById('exchangePhoneSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Loading...</option>';

    try {
        const db = getDb(source);
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};

        exchangeInventoryList = Object.entries(data)
            .filter(([_, item]) => item && item.status === 'pickup' && !item.sold)
            .map(([id, item]) => ({
                id,
                orderId: item.orderId || id,
                model: item.phoneModel || '—',
                imei: item.imei || '—',
                value: Number(item.value) || 0,
                source
            }))
            .sort((a, b) => String(a.model).localeCompare(String(b.model)));

        if (!exchangeInventoryList.length) {
            select.innerHTML = `<option value="">No phones available in ${source === 'cashify' ? 'Cashify' : 'Flipkart'} inventory</option>`;
            return;
        }

        select.innerHTML = '<option value="">-- Select a phone from ' + (source === 'cashify' ? 'Cashify' : 'Flipkart') + ' --</option>' +
            exchangeInventoryList.map(p => `<option value="${p.id}">${escapeHtml(p.orderId)} | ${escapeHtml(p.model)} | ${escapeHtml(p.imei)} | ₹${p.value.toLocaleString('en-IN')}</option>`).join('');
    } catch (e) {
        console.error('Load exchange inventory error:', e);
        select.innerHTML = '<option value="">Error loading inventory</option>';
    }
}

function onExchangePhoneSelect() {
    const select = document.getElementById('exchangePhoneSelect');
    const detailsEl = document.getElementById('exchangePhoneDetails');
    if (!select || !detailsEl) return;

    const id = select.value;
    if (!id) { detailsEl.innerHTML = ''; return; }

    const phone = exchangeInventoryList.find(p => p.id === id);
    if (!phone) { detailsEl.innerHTML = ''; return; }

    detailsEl.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item"><div class="label">Order ID</div><div class="value font-mono text-xs">${escapeHtml(phone.orderId)}</div></div>
            <div class="detail-item"><div class="label">Model</div><div class="value">${escapeHtml(phone.model)}</div></div>
            <div class="detail-item"><div class="label">IMEI</div><div class="value font-mono text-xs">${escapeHtml(phone.imei)}</div></div>
            <div class="detail-item"><div class="label">Source</div><div class="value">${phone.source === 'cashify' ? 'Cashify' : 'Flipkart'}</div></div>
        </div>
    `;
}

// ==========================================
// SUBMIT RETURN
// ==========================================
async function submitReturn() {
    if (isProcessingReturn) return;
    if (!selectedReturnPhone) { showToast('Please select a sold phone first', 'error'); return; }

    const returnDate = document.getElementById('returnDate').value || getLocalYMD();
    const type = document.querySelector('input[name="returnType"]:checked')?.value || 'money';

    let returnAmount = 0;
    let exchangePickupId = null;
    let exchangePhone = null;
    let exchangeSrc = null;

    if (type === 'money') {
        returnAmount = parseFloat(document.getElementById('returnAmount').value);
        if (!returnAmount || returnAmount <= 0 || isNaN(returnAmount)) { showToast('Enter a valid return amount', 'error'); document.getElementById('returnAmount').focus(); return; }
    } else {
        exchangeSrc = exchangeSource;
        exchangePickupId = document.getElementById('exchangePhoneSelect').value;
        if (!exchangePickupId) { showToast('Please select an exchange phone', 'error'); return; }
        exchangePhone = exchangeInventoryList.find(p => p.id === exchangePickupId);
        if (!exchangePhone) { showToast('Exchange phone not found', 'error'); return; }
    }

    const original = selectedReturnPhone;
    const source = currentSource;
    const sourceLabel = getSourceLabel(source);
    const originalSalePrice = Number(original.salePrice) || 0;

    // Confirm dialog
    const confirmHtml = `
        <div style="text-align:left;font-size:13px;line-height:1.6;">
            <div style="margin-bottom:8px;">
                <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;background:${source === 'cashify' ? '#E6FAF6' : '#eef2ff'};color:${source === 'cashify' ? '#0FA88B' : '#4338ca'};border:1px solid ${source === 'cashify' ? '#a7f3d0' : '#c7d2fe'};">${sourceLabel.toUpperCase()} RETURN</span>
            </div>
            <p><strong>Order:</strong> ${escapeHtml(original.orderId || original.id)}</p>
            <p><strong>Model:</strong> ${escapeHtml(original.phoneModel || '—')}</p>
            <p><strong>IMEI:</strong> ${escapeHtml(original.imei || '—')}</p>
            <p><strong>Original Sale:</strong> ₹${originalSalePrice.toLocaleString('en-IN')}</p>
            <hr style="margin:8px 0;">
            <p><strong>Return Date:</strong> ${escapeHtml(returnDate)}</p>
            ${type === 'money'
                ? `<p><strong>Return Amount:</strong> ₹${returnAmount.toLocaleString('en-IN')} (Cash to customer)</p>`
                : `<p><strong>Exchange Phone:</strong> ${escapeHtml(exchangePhone.model)} (${escapeHtml(exchangePhone.imei)})</p>
                   <p><strong>Exchange Source:</strong> ${exchangeSrc === 'cashify' ? 'Cashify' : 'Flipkart'}</p>`}
            <p style="margin-top:8px;color:#dc2626;font-size:12px;"><strong>⚠️ Inventory will be updated automatically.</strong></p>
        </div>`;

    const confirm = await Swal.fire({
        title: 'Confirm Return Processing',
        html: confirmHtml,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: '✅ Yes, Process Return',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;

    isProcessingReturn = true;
    const btn = document.getElementById('processReturnBtn');
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm" style="width:16px;height:16px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.35);"></span> Processing...'; }

    try {
        const originalDb = getDb(source);

        // Safety re-check: still valid?
        const freshSnap = await originalDb.ref('pickups/' + original.id).once('value');
        const fresh = freshSnap.val();
        if (!fresh || fresh.sold !== true || fresh.returned === true) {
            showToast('This phone is no longer eligible for return', 'error');
            return;
        }

        const returnId = 'ret_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        // Build return record
        const returnRecord = {
            returnId,
            source,
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
            exchangePhoneSource: type === 'exchange' ? exchangeSrc : null,
            exchangePickupId: type === 'exchange' ? exchangePickupId : null,
            exchangeOrderId: type === 'exchange' ? exchangePhone.orderId : null,
            exchangeModel: type === 'exchange' ? exchangePhone.model : null,
            exchangeImei: type === 'exchange' ? exchangePhone.imei : null,
            createdAt: Date.now(),
            createdBy: 'sales-manager'
        };

        // 1) Save return record first
        await originalDb.ref('returns/' + returnId).set(returnRecord);

        // 2) Update original phone (back to inventory)
        await originalDb.ref('pickups/' + original.id).update({
            sold: false,
            returned: true,
            returnDate,
            returnId,
            lastSalePrice: originalSalePrice,
            lastSaleDate: original.saleDate || '',
            lastBuyerName: original.buyerName || '',
            salePrice: null,
            buyerName: null,
            buyerContact: null,
            saleDate: null,
            saleTimestamp: null,
            grossProfit: null,
            finalNetProfit: null,
            profit: null,
            commission: null
        });

        // 3) Update exchange phone (mark as sold/given in exchange)
        if (type === 'exchange') {
            const exchangeDb = getDb(exchangeSrc);
            const exchangePayload = {
                sold: true,
                salePrice: 0,
                buyerName: 'Exchange for ' + (original.orderId || original.id),
                buyerContact: '',
                saleDate: returnDate,
                saleTimestamp: new Date().toISOString(),
                soldVia: 'exchange',
                exchangeForReturnId: returnId,
                exchangeForOrderId: original.orderId || original.id
            };
            if (exchangeSrc === 'flipkart') {
                exchangePayload.commission = 0;
                exchangePayload.grossProfit = 0;
                exchangePayload.finalNetProfit = 0;
                exchangePayload.profit = 0;
            } else {
                exchangePayload.grossProfit = 0;
                exchangePayload.finalNetProfit = 0;
            }
            await exchangeDb.ref('pickups/' + exchangePickupId).update(exchangePayload);
        }

        // 4) Get updated counts (live from actual data)
        const counts = await loadInventoryCounts();

        // 5) Update return record with counts
        await originalDb.ref('returns/' + returnId).update({
            inventoryCountFlipkart: counts.flipkart,
            inventoryCountCashify: counts.cashify
        });
        returnRecord.inventoryCountFlipkart = counts.flipkart;
        returnRecord.inventoryCountCashify = counts.cashify;

        // 6) Build WhatsApp message
        const message = buildReturnMessage(returnRecord);
        lastReturnMessage = message;

        // 7) Refresh UI
        cancelReturnSelection();
        returnSearchResults = [];
        renderReturnSearchResults();
        await Promise.all([loadInventory(), loadReturnsHistory()]);

        // 8) Show success modal
        showReturnSuccessModal(message);

    } catch (e) {
        console.error('Return processing error:', e);
        showToast('Error processing return. Please try again.', 'error');
    } finally {
        isProcessingReturn = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnHtml || '<i data-lucide="check-circle"></i> Process Return';
            refreshIcons();
        }
    }
}

// ==========================================
// WHATSAPP MESSAGE BUILDER
// ==========================================
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

// ==========================================
// RETURN SUCCESS MODAL
// ==========================================
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

    if (result.isConfirmed) {
        await copyTextToClipboard(message);
    } else if (result.isDenied) {
        openWhatsApp(message);
    }
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
    const url = 'https://wa.me/?text=' + encodeURIComponent(message);
    window.open(url, '_blank');
}

// ==========================================
// RETURN HISTORY
// ==========================================
async function loadReturnsHistory() {
    const container = document.getElementById('returnsHistoryList');
    if (!container) return;
    container.innerHTML = `<div class="text-center py-6 text-gray-400 text-sm"><span class="spinner-sm"></span> Loading...</div>`;

    try {
        const db = getDb(currentSource);
        const snap = await db.ref('returns').once('value');
        const data = snap.val() || {};

        const returns = Object.entries(data)
            .map(([id, item]) => ({ id, ...item }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, 20);

        if (!returns.length) {
            container.innerHTML = `<div class="text-center py-8 text-gray-400 text-sm">No returns recorded yet for ${getSourceLabel(currentSource)}</div>`;
            return;
        }

        let html = '<div class="space-y-2">';
        returns.forEach(r => {
            const returnInfo = r.returnType === 'money'
                ? `💵 ₹${(Number(r.returnAmount) || 0).toLocaleString('en-IN')} returned`
                : `📱 ${escapeHtml(r.exchangeModel || '—')} (${r.exchangePhoneSource === 'cashify' ? 'Cashify' : 'Flipkart'})`;

            html += `
                <div class="return-history-item">
                    <div class="flex items-start justify-between gap-2 mb-1">
                        <div class="min-w-0 flex-1">
                            <div class="font-mono font-bold text-gray-800 text-sm truncate">${escapeHtml(r.originalOrderId || '—')}</div>
                            <div class="text-sm text-gray-700 truncate mt-0.5">${escapeHtml(r.originalModel || '—')}</div>
                        </div>
                        <span class="text-xs text-gray-500 whitespace-nowrap">${escapeHtml(r.returnDate || '—')}</span>
                    </div>
                    <div class="text-xs text-gray-600 mt-1">${returnInfo}</div>
                    <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                        <span class="text-[10px] text-gray-400">Original Sale: ₹${(Number(r.originalSalePrice) || 0).toLocaleString('en-IN')}</span>
                        <button onclick="viewReturnMessage('${r.id}')" class="text-[10px] text-indigo-600 font-semibold hover:underline">View / Resend Message</button>
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

async function viewReturnMessage(returnId) {
    try {
        const db = getDb(currentSource);
        const snap = await db.ref('returns/' + returnId).once('value');
        const record = snap.val();
        if (!record) { showToast('Return record not found', 'error'); return; }
        const message = buildReturnMessage(record);
        await showReturnSuccessModal(message);
    } catch (e) {
        console.error(e);
        showToast('Failed to load return message', 'error');
    }
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setupOfflineDetection();
    refreshIcons();

    document.querySelectorAll('#sourceTabs .source-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.source === currentSource);
    });

    updateSourceTabsForView();
    loadInventory();

    setInterval(() => {
        if (document.hidden) return;
        if (currentView === 'inventory') loadInventory();
        else { loadReturnsView(); loadReturnsHistory(); }
    }, 60000);

    showToast('👋 Sales Manager ready', 'info', 2000);
    console.log('✅ Sales Manager (dual-source + returns) initialized');
});

// ==========================================
// MODAL OUTSIDE-CLICK + ESC
// ==========================================
const sellModalEl = document.getElementById('sellModal');
if (sellModalEl) sellModalEl.addEventListener('click', function (e) { if (e.target === this) closeSellModal(); });

const detailModalEl = document.getElementById('detailModal');
if (detailModalEl) detailModalEl.addEventListener('click', function (e) { if (e.target === this) closeDetailModal(); });

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSellModal(); closeDetailModal(); }
});

// ==========================================
// EXPOSE FOR INLINE HANDLERS
// ==========================================
window.switchSource = switchSource;
window.switchView = switchView;
window.applySearch = applySearch;
window.clearSearch = clearSearch;
window.openSellModal = openSellModal;
window.closeSellModal = closeSellModal;
window.confirmSell = confirmSell;
window.viewOrderDetail = viewOrderDetail;
window.closeDetailModal = closeDetailModal;
window.refreshInventory = refreshInventory;

// Returns
window.searchSoldPhones = searchSoldPhones;
window.clearReturnSearch = clearReturnSearch;
window.selectReturnPhone = selectReturnPhone;
window.cancelReturnSelection = cancelReturnSelection;
window.onReturnTypeChange = onReturnTypeChange;
window.onExchangeSourceChange = onExchangeSourceChange;
window.onExchangePhoneSelect = onExchangePhoneSelect;
window.submitReturn = submitReturn;
window.loadReturnsHistory = loadReturnsHistory;
window.viewReturnMessage = viewReturnMessage;