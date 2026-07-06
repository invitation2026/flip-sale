// ==========================================
// FIREBASE CONFIG
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyDGJWdgj2GBL-44gXZ9W0mWnOfsczwPXdw",
    authDomain: "mobile-shop-9ea44.firebaseapp.com",
    databaseURL: "https://mobile-shop-9ea44-default-rtdb.firebaseio.com",
    projectId: "mobile-shop-9ea44",
    storageBucket: "mobile-shop-9ea44.firebasestorage.app",
    messagingSenderId: "902893829958",
    appId: "1:902893829958:web:f2f429ad9290c56f4d6f47",
    measurementId: "G-V4JQT7Z8T9"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==========================================
// STATE
// ==========================================
let inventoryList = [];
let filteredInventory = [];
let sellOrderData = null;

// ==========================================
// DOM REFS
// ==========================================
const toastEl = document.getElementById('toast');

// ==========================================
// TOAST
// ==========================================
function showToast(msg, type = 'info', duration = 3000) {
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
        if (isOnline) {
            container.className =
                'flex items-center gap-1.5 px-3 py-1 bg-green-50 rounded-full text-xs font-medium text-green-700';
            dot.className = 'w-2 h-2 bg-green-500 rounded-full pulse-ring';
            text.textContent = 'Online';
        } else {
            container.className =
                'flex items-center gap-1.5 px-3 py-1 bg-red-50 rounded-full text-xs font-medium text-red-700';
            dot.className = 'w-2 h-2 bg-red-500 rounded-full';
            text.textContent = 'Offline';
        }
    };
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
}

// ==========================================
// LOAD INVENTORY (unsold pickups)
// ==========================================
async function loadInventory() {
    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};
        inventoryList = Object.entries(data)
            .filter(([_, item]) => item.status === 'pickup' && !item.sold)
            .map(([id, item]) => ({ id, ...item }));
        inventoryList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        applySearch();
        updateStats();
    } catch (e) {
        console.error('Inventory error:', e);
        showToast('Error loading inventory', 'error');
    }
}

function applySearch() {
    const searchVal = document.getElementById('inventorySearch').value.trim().toLowerCase();
    let filtered = inventoryList;
    if (searchVal) {
        filtered = filtered.filter(item =>
            (item.orderId || '').toLowerCase().includes(searchVal) ||
            (item.phoneModel || '').toLowerCase().includes(searchVal)
        );
    }
    filteredInventory = filtered;
    renderInventory();
    document.getElementById('inventoryCount').textContent = filteredInventory.length + ' phones';
}

function clearSearch() {
    document.getElementById('inventorySearch').value = '';
    applySearch();
}

function renderInventory() {
    const tbody = document.getElementById('inventoryTableBody');
    if (filteredInventory.length === 0) {
        tbody.innerHTML =
            `<tr><td colspan="5"><div class="empty-state"><i data-lucide="inbox"></i><p class="text-sm font-medium">No inventory</p><p class="text-xs text-gray-400">Phones picked up will appear here</p></div></td></tr>`;
        lucide.createIcons();
        return;
    }

    let html = '';
    filteredInventory.forEach((item, idx) => {
        html += `
            <tr class="order-row border-b border-gray-50">
                <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
                <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${item.orderId || item.id}</td>
                <td class="py-3 px-4 text-gray-600 text-sm">${item.phoneModel || '—'}</td>
                <td class="py-3 px-4 hidden sm:table-cell text-gray-600 text-sm">${item.customerName || '—'}</td>
                <td class="py-3 px-4">
                    <button onclick="openSellModal('${item.id}')" class="btn-action sell">
                        <i data-lucide="badge-dollar-sign"></i> Sell
                    </button>
                    <button onclick="viewOrderDetail('${item.id}')" class="btn-action view" title="View">
                        <i data-lucide="eye"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
    lucide.createIcons();
}

// ==========================================
// UPDATE STATS (simple counts & revenue)
// ==========================================
async function updateStats() {
    // We still fetch sold count and revenue for the stat cards,
    // but we hide revenue & profit as per user request? Actually the user said "revenue sold nahin dikhega, total profit nahin".
    // They only want In Stock and Sold count? But they mentioned "purchases ka price bhi nahin dikhega".
    // Let's keep only In Stock and Sold count, hide revenue and profit.
    // We'll just update Inventory count and Sold count.
    const snap = await db.ref('pickups').once('value');
    const data = snap.val() || {};
    let soldCount = 0;
    let revenue = 0,
        profit = 0;
    Object.values(data).forEach(item => {
        if (item.sold === true) {
            soldCount++;
            revenue += item.salePrice || 0;
            profit += item.profit || 0;
        }
    });
    document.getElementById('statInventory').textContent = inventoryList.length;
    document.getElementById('statSold').textContent = soldCount;
    // Still show revenue and profit? The user explicitly said "nahin dikhega". So we should hide those cards.
    // Instead of hiding, we can remove them from HTML. But we'll keep them hidden with CSS or remove them.
    // For simplicity, we'll set text to empty and hide the cards.
    // Better: remove the cards from HTML. But we already have them in the layout. We'll hide them with display:none.
    document.getElementById('statRevenue').parentElement.parentElement.style.display = 'none';
    document.getElementById('statProfit').parentElement.parentElement.style.display = 'none';
    // Also remove the grid columns: we have 4 cards, but we'll only show 2. We'll adjust grid to 2 columns.
    // We'll dynamically hide the revenue and profit cards.
    // Already we have grid-cols-1 sm:grid-cols-4; we'll change to sm:grid-cols-2.
    // But we already have the HTML with 4 cards. We'll just hide the last two.
    // Let's just hide them via JS after page load.
}

// Hide revenue and profit cards on load
document.addEventListener('DOMContentLoaded', () => {
    // The stats cards are in the grid. We'll hide revenue and profit by removing them.
    // But we already have them in the HTML. We'll set display:none via JS after DOM ready.
    const revenueCard = document.getElementById('statRevenue').closest('.stat-card');
    const profitCard = document.getElementById('statProfit').closest('.stat-card');
    if (revenueCard) revenueCard.style.display = 'none';
    if (profitCard) profitCard.style.display = 'none';
    // Adjust grid to 2 columns
    const statsGrid = document.querySelector('.grid.grid-cols-1.sm\\:grid-cols-4');
    if (statsGrid) {
        statsGrid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6';
    }
});

// Override updateStats to not show revenue/profit
function updateStats() {
    // Just update inventory and sold counts
    const snap = db.ref('pickups').once('value').then(snap => {
        const data = snap.val() || {};
        let soldCount = 0;
        Object.values(data).forEach(item => {
            if (item.sold === true) soldCount++;
        });
        document.getElementById('statInventory').textContent = inventoryList.length;
        document.getElementById('statSold').textContent = soldCount;
    });
}

// ==========================================
// SELL MODAL
// ==========================================
function openSellModal(orderId) {
    const order = inventoryList.find(item => item.id === orderId);
    if (!order) {
        showToast('Order not found in inventory', 'error');
        return;
    }
    sellOrderData = order;
    document.getElementById('sellOrderId').value = order.orderId || order.id;
    document.getElementById('sellModel').value = order.phoneModel || '—';
    document.getElementById('sellCustomer').value = order.customerName || '—';
    document.getElementById('sellSalePrice').value = '';
    document.getElementById('sellBuyerName').value = '';
    document.getElementById('sellBuyerContact').value = '';
    // Default date: today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sellSaleDate').value = today;
    document.getElementById('sellModal').style.display = 'flex';
    lucide.createIcons();
    // Focus on sale price
    setTimeout(() => document.getElementById('sellSalePrice').focus(), 300);
}

function closeSellModal() {
    document.getElementById('sellModal').style.display = 'none';
    sellOrderData = null;
}

async function confirmSell() {
    if (!sellOrderData) return;

    const salePrice = parseFloat(document.getElementById('sellSalePrice').value);
    const buyerName = document.getElementById('sellBuyerName').value.trim();
    const buyerContact = document.getElementById('sellBuyerContact').value.trim();
    const saleDate = document.getElementById('sellSaleDate').value;

    if (!salePrice || salePrice <= 0) {
        showToast('Please enter a valid sale price', 'error');
        return;
    }
    if (!buyerName) {
        showToast('Please enter buyer name', 'error');
        return;
    }

    // Confirm
    const confirm = await Swal.fire({
        title: 'Confirm Sale',
        html: `
            <div class="text-left space-y-1 text-sm">
                <p><strong>Order:</strong> ${sellOrderData.orderId}</p>
                <p><strong>Model:</strong> ${sellOrderData.phoneModel}</p>
                <p><strong>Sale Price:</strong> ₹${salePrice}</p>
                <p><strong>Buyer:</strong> ${buyerName}</p>
                <p><strong>Sale Date:</strong> ${saleDate}</p>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: '✅ Confirm Sale',
        cancelButtonText: 'Cancel'
    });
    if (!confirm.isConfirmed) return;

    try {
        const updates = {
            sold: true,
            salePrice: salePrice,
            buyerName: buyerName,
            buyerContact: buyerContact || '',
            saleDate: saleDate,
            saleTimestamp: new Date().toISOString()
        };
        await db.ref('pickups/' + sellOrderData.id).update(updates);
        showToast(`✅ Sold for ₹${salePrice}`, 'success');

        closeSellModal();
        await loadInventory();
        updateStats();

    } catch (e) {
        console.error('Sale error:', e);
        showToast('Error saving sale', 'error');
    }
}

// ==========================================
// VIEW ORDER DETAIL (with IMEI visible)
// ==========================================
function viewOrderDetail(orderId) {
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    modal.style.display = 'flex';
    content.innerHTML = `<div class="text-center py-8"><span class="spinner-sm"></span><p class="text-sm text-gray-400 mt-2">Loading...</p></div>`;

    db.ref('pickups/' + orderId).once('value').then(snap => {
        const item = snap.val();
        if (!item) {
            content.innerHTML =
                `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium">Order not found</p></div>`;
            return;
        }

        const statusLabel = item.status || 'unknown';
        const isSold = item.sold === true;
        const statusDisplay = isSold ? 'Sold' :
            statusLabel === 'pickup' ? 'Pickup' :
            statusLabel === 'rejected' ? 'Rejected' : 'Pending';
        const statusClass = isSold ? 'sold' :
            statusLabel === 'pickup' ? 'available' :
            statusLabel === 'rejected' ? 'rejected' : 'reschedule';

        let saleHtml = '';
        if (isSold) {
            saleHtml = `
                <div class="detail-item"><div class="label">Sale Price</div><div class="value">₹${item.salePrice || 0}</div></div>
                <div class="detail-item"><div class="label">Buyer</div><div class="value">${item.buyerName || '—'}</div></div>
                <div class="detail-item"><div class="label">Buyer Contact</div><div class="value">${item.buyerContact || '—'}</div></div>
                <div class="detail-item"><div class="label">Sale Date</div><div class="value">${item.saleDate || '—'}</div></div>
            `;
        }

        let html = `
            <div class="flex items-center gap-3 mb-4">
                <span class="badge-status ${statusClass} text-sm px-4 py-1.5">${statusDisplay}</span>
                <span class="font-mono font-bold text-gray-800 text-sm">${item.orderId || orderId}</span>
            </div>
            <div class="detail-grid">
                <div class="detail-item"><div class="label">Phone Model</div><div class="value">${item.phoneModel || '—'}</div></div>
                <div class="detail-item"><div class="label">IMEI</div><div class="value font-mono text-xs">${item.imei || '—'}</div></div>
                ${item.imei2 ? `<div class="detail-item"><div class="label">IMEI 2</div><div class="value font-mono text-xs">${item.imei2}</div></div>` : ''}
                <div class="detail-item"><div class="label">Purchase Price</div><div class="value">₹${item.value || 0}</div></div>
                <div class="detail-item"><div class="label">Customer</div><div class="value">${item.customerName || '—'}</div></div>
                <div class="detail-item"><div class="label">Reason</div><div class="value">${item.reason || '—'}</div></div>
                <div class="detail-item"><div class="label">Time (IST)</div><div class="value text-xs">${item.timestampIST || item.timestamp || '—'}</div></div>
                ${saleHtml}
            </div>
        `;
        content.innerHTML = html;
        lucide.createIcons();
    }).catch(err => {
        content.innerHTML =
            `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Error loading details</p></div>`;
        showToast('Error loading details', 'error');
    });
}

function closeDetailModal() {
    document.getElementById('detailModal').style.display = 'none';
}

// ==========================================
// REFRESH
// ==========================================
async function refreshInventory() {
    showToast('🔄 Refreshing...', 'info');
    await loadInventory();
    await updateStats();
    showToast('✅ Refreshed', 'success');
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setupOfflineDetection();
    lucide.createIcons();

    // Hide revenue and profit cards
    document.querySelectorAll('.stat-card').forEach((card, index) => {
        if (index >= 2) { // revenue and profit are index 2 and 3
            card.style.display = 'none';
        }
    });
    // Adjust grid columns
    const grid = document.querySelector('.grid.grid-cols-1.sm\\:grid-cols-4');
    if (grid) {
        grid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6';
    }

    loadInventory();
    updateStats();

    // Auto-refresh every 60 seconds
    setInterval(() => {
        loadInventory();
        updateStats();
    }, 60000);

    console.log('✅ Sales Manager (simple) ready');
    showToast('👋 Welcome to Sales Manager', 'info', 2000);
});

// Click outside modals to close
document.getElementById('sellModal').addEventListener('click', function(e) {
    if (e.target === this) closeSellModal();
});
document.getElementById('detailModal').addEventListener('click', function(e) {
    if (e.target === this) closeDetailModal();
});

// ESC key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeSellModal();
        closeDetailModal();
    }
});

// Re-render icons after dynamic content
setInterval(() => lucide.createIcons(), 3000);
