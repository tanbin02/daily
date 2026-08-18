// ========== Constants & State ==========
    const STORAGE_KEY = 'daily_expense_tracker_v1';
    const CATEGORIES = ['Food','Transportation','Shopping','Bills','Entertainment','Education','Health','Travel','Other'];

    // Simple keyword → category mapping for auto-detect
    const CATEGORY_HINTS = {
      Food: ['lunch','dinner','breakfast','food','meal','coffee','tea','restaurant','cafe','snack','biryani','pizza','burger','grocery','groceries','rice','dal'],
      Transportation: ['uber','pathao','bus','taxi','cng','rickshaw','metro','train','fuel','petrol','diesel','transport','fare','ride'],
      Shopping: ['shopping','clothes','shirt','shoes','market','bazar','amazon','daraz','purchase'],
      Bills: ['bill','electricity','gas','water','internet','wifi','mobile','recharge','rent','utility'],
      Entertainment: ['movie','cinema','netflix','game','concert','party','spotify'],
      Education: ['book','course','tuition','school','college','university','exam','study'],
      Health: ['medicine','doctor','hospital','pharmacy','clinic','dental','health'],
      Travel: ['hotel','flight','ticket','tour','trip','vacation','airbnb']
    };

    let expenses = [];
    let currentStep = 1;
    let draft = { amount: 0, reason: '', category: '', date: '', notes: '' };
    let monthlyChart = null;

    // ========== Helpers ==========
    function formatBDT(n) {
      return '৳ ' + Number(n).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function parseAmount(str) {
      if (!str) return NaN;
      // Remove commas, spaces, currency symbols
      const cleaned = String(str).replace(/[^\d.-]/g, '');
      return parseFloat(cleaned);
    }

    function todayISO() {
      const d = new Date();
      // Use local date (BD is +06)
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    function formatDisplayDate(iso) {
      if (!iso) return '—';
      const [y, m, d] = iso.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
    }

    function startOfWeek(d) {
      const date = new Date(d);
      const day = date.getDay(); // 0=Sun
      const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Monday start
      return new Date(date.setDate(diff));
    }

    function isSameDay(iso1, iso2) {
      return iso1 === iso2;
    }

    function isThisWeek(iso) {
      const d = new Date(iso + 'T12:00:00');
      const now = new Date();
      const start = startOfWeek(now);
      start.setHours(0,0,0,0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23,59,59,999);
      return d >= start && d <= end;
    }

    function isThisMonth(iso) {
      const d = new Date(iso + 'T12:00:00');
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }

    function detectCategory(reason) {
      const lower = reason.toLowerCase();
      for (const [cat, words] of Object.entries(CATEGORY_HINTS)) {
        if (words.some(w => lower.includes(w))) return cat;
      }
      return '';
    }

    function showToast(msg, type = 'success') {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'toast show ' + type;
      setTimeout(() => t.classList.remove('show'), 2800);
    }

    // ========== Persistence ==========
    function loadExpenses() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        expenses = raw ? JSON.parse(raw) : [];
        // Ensure sorted newest first
        expenses.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      } catch {
        expenses = [];
      }
    }

    function saveExpenses() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
    }

    // ========== UI Updates ==========
    function updateSummary() {
      const today = todayISO();
      let tToday = 0, tWeek = 0, tMonth = 0, tAll = 0;
      const catTotals = {};

      expenses.forEach(e => {
        const amt = Number(e.amount) || 0;
        tAll += amt;
        if (isSameDay(e.date, today)) tToday += amt;
        if (isThisWeek(e.date)) tWeek += amt;
        if (isThisMonth(e.date)) tMonth += amt;
        catTotals[e.category] = (catTotals[e.category] || 0) + amt;
      });

      document.getElementById('totalToday').textContent = formatBDT(tToday);
      document.getElementById('totalWeek').textContent = formatBDT(tWeek);
      document.getElementById('totalMonth').textContent = formatBDT(tMonth);
      document.getElementById('totalOverall').textContent = formatBDT(tAll);

      // Category bars
      const breakdown = document.getElementById('catBreakdown');
      const cats = Object.entries(catTotals).sort((a,b) => b[1] - a[1]);
      if (cats.length === 0) {
        breakdown.innerHTML = '';
      } else {
        const max = Math.max(...cats.map(c => c[1]), 1);
        let html = '<h3>By Category</h3>';
        cats.forEach(([name, val]) => {
          const pct = (val / max) * 100;
          html += `
            <div class="cat-bar-row">
              <span class="name">${name}</span>
              <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
              <span class="val">${formatBDT(val)}</span>
            </div>`;
        });
        breakdown.innerHTML = html;
      }

      // Always refresh chart
      updateMonthlyChart();
    }

    function getMonthlyData() {
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const now = new Date();
      const labels = [];
      const keys = []; // 'YYYY-MM'
      const totals = {};

      // Build last 12 months (oldest → newest)
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
        keys.push(key);
        labels.push(label);
        totals[key] = 0;
      }

      expenses.forEach(e => {
        if (!e.date || e.date.length < 7) return;
        const key = e.date.slice(0, 7); // YYYY-MM
        if (totals.hasOwnProperty(key)) {
          totals[key] += Number(e.amount) || 0;
        }
      });

      return {
        labels,
        data: keys.map(k => totals[k])
      };
    }

    function updateMonthlyChart() {
      const { labels, data } = getMonthlyData();
      const ctx = document.getElementById('monthlyChart');
      if (!ctx) return;

      const chartData = {
        labels,
        datasets: [{
          label: 'Spending (BDT)',
          data,
          backgroundColor: 'rgba(59, 130, 246, 0.65)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
          hoverBackgroundColor: 'rgba(6, 182, 212, 0.8)'
        }]
      };

      const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a2332',
            titleColor: '#e8eef7',
            bodyColor: '#e8eef7',
            borderColor: '#2d3a4f',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => '৳ ' + Number(ctx.raw).toLocaleString('en-BD', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(45, 58, 79, 0.5)', drawBorder: false },
            ticks: { color: '#8b9bb4', font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(45, 58, 79, 0.5)', drawBorder: false },
            ticks: {
              color: '#8b9bb4',
              font: { size: 11 },
              callback: (v) => {
                if (v >= 1000) return '৳' + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
                return '৳' + v;
              }
            }
          }
        },
        animation: { duration: 450 }
      };

      if (monthlyChart) {
        monthlyChart.data = chartData;
        monthlyChart.update();
      } else {
        monthlyChart = new Chart(ctx, {
          type: 'bar',
          data: chartData,
          options
        });
      }
    }

    function renderList() {
      const list = document.getElementById('expenseList');
      if (expenses.length === 0) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="icon">📭</div>
            <div>No expenses yet.<br>Enter an amount on the left to start.</div>
          </div>`;
        return;
      }

      list.innerHTML = expenses.map(e => `
        <div class="expense-item">
          <div>
            <div class="reason">${escapeHtml(e.reason)}</div>
            <div class="meta">
              <span>${formatDisplayDate(e.date)}</span>
              <span class="cat-pill">${escapeHtml(e.category || 'Other')}</span>
            </div>
          </div>
          <div class="amount">${formatBDT(e.amount)}</div>
          ${e.notes ? `<div class="notes">${escapeHtml(e.notes)}</div>` : ''}
        </div>
      `).join('');
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function goToStep(step) {
      currentStep = step;
      for (let i = 1; i <= 4; i++) {
        document.getElementById('step' + i).classList.toggle('hidden', i !== step);
      }
      document.querySelectorAll('.step-dot').forEach(dot => {
        const s = Number(dot.dataset.step);
        dot.classList.toggle('active', s === step);
        dot.classList.toggle('done', s < step);
      });

      // Previews
      const fmt = formatBDT(draft.amount);
      document.getElementById('amountPreview').textContent = fmt;
      document.getElementById('amountPreview2').textContent = fmt;
      document.getElementById('amountPreview3').textContent = fmt;

      if (step === 3) {
        // Auto-detect category if empty
        if (!draft.category) {
          const detected = detectCategory(draft.reason);
          if (detected) {
            document.getElementById('categorySelect').value = detected;
            draft.category = detected;
          }
        } else {
          document.getElementById('categorySelect').value = draft.category;
        }
        if (!document.getElementById('dateInput').value) {
          document.getElementById('dateInput').value = todayISO();
        }
      }

      if (step === 4) {
        const cat = draft.category || document.getElementById('categorySelect').value || 'Other';
        const dateVal = document.getElementById('dateInput').value || todayISO();
        document.getElementById('confirmSummary').innerHTML = `
          <strong>${formatBDT(draft.amount)}</strong> — ${escapeHtml(draft.reason)}<br>
          <span style="color:var(--text-muted)">${escapeHtml(cat)} · ${formatDisplayDate(dateVal)}</span>
        `;
      }
    }

    function resetForm() {
      draft = { amount: 0, reason: '', category: '', date: '', notes: '' };
      document.getElementById('amountInput').value = '';
      document.getElementById('reasonInput').value = '';
      document.getElementById('categorySelect').value = '';
      document.getElementById('dateInput').value = '';
      document.getElementById('notesInput').value = '';
      goToStep(1);
      document.getElementById('amountInput').focus();
    }

    // ========== Event Handlers ==========
    document.getElementById('btnNext1').addEventListener('click', () => {
      const amt = parseAmount(document.getElementById('amountInput').value);
      if (isNaN(amt) || amt <= 0) {
        showToast('Please enter a valid amount greater than 0', 'error');
        document.getElementById('amountInput').focus();
        return;
      }
      draft.amount = amt;
      goToStep(2);
      document.getElementById('reasonInput').focus();
    });

    document.getElementById('amountInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btnNext1').click();
    });

    document.getElementById('btnBack2').addEventListener('click', () => goToStep(1));
    document.getElementById('btnNext2').addEventListener('click', () => {
      const reason = document.getElementById('reasonInput').value.trim();
      if (!reason) {
        showToast('Please enter what the expense was for', 'error');
        document.getElementById('reasonInput').focus();
        return;
      }
      draft.reason = reason;
      goToStep(3);
    });

    document.getElementById('reasonInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btnNext2').click();
    });

    document.getElementById('btnBack3').addEventListener('click', () => goToStep(2));
    document.getElementById('btnNext3').addEventListener('click', () => {
      let cat = document.getElementById('categorySelect').value;
      if (!cat) {
        cat = detectCategory(draft.reason) || 'Other';
        document.getElementById('categorySelect').value = cat;
      }
      draft.category = cat;
      draft.date = document.getElementById('dateInput').value || todayISO();
      goToStep(4);
    });

    document.getElementById('btnBack4').addEventListener('click', () => goToStep(3));

    document.getElementById('btnSave').addEventListener('click', () => {
      draft.notes = document.getElementById('notesInput').value.trim();
      draft.category = draft.category || document.getElementById('categorySelect').value || 'Other';
      draft.date = draft.date || document.getElementById('dateInput').value || todayISO();

      const entry = {
        id: Date.now(),
        amount: draft.amount,
        reason: draft.reason,
        category: draft.category,
        date: draft.date,
        notes: draft.notes,
        createdAt: new Date().toISOString()
      };

      expenses.unshift(entry); // newest first
      // Keep sorted by date desc
      expenses.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      saveExpenses();
      updateSummary();
      renderList();
      showToast(`Recorded: ${formatBDT(entry.amount)} — ${entry.reason}`);
      resetForm();
    });

    // Export CSV
    document.getElementById('btnExportCsv').addEventListener('click', () => {
      if (expenses.length === 0) {
        showToast('No expenses to export', 'error');
        return;
      }
      const header = ['Date','Amount (BDT)','Expense Reason','Category','Notes'];
      const rows = expenses.map(e => [
        e.date,
        e.amount,
        `"${(e.reason || '').replace(/"/g, '""')}"`,
        e.category,
        `"${(e.notes || '').replace(/"/g, '""')}"`
      ]);
      const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expenses_${todayISO()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV downloaded');
    });

    // Export simple Excel-compatible (HTML table → .xls)
    document.getElementById('btnExportExcel').addEventListener('click', () => {
      if (expenses.length === 0) {
        showToast('No expenses to export', 'error');
        return;
      }
      let table = `<table border="1"><thead><tr>
        <th>Date</th><th>Amount (BDT)</th><th>Expense Reason</th><th>Category</th><th>Notes</th>
      </tr></thead><tbody>`;
      expenses.forEach(e => {
        table += `<tr>
          <td>${e.date}</td>
          <td>${e.amount}</td>
          <td>${escapeHtml(e.reason)}</td>
          <td>${escapeHtml(e.category)}</td>
          <td>${escapeHtml(e.notes || '')}</td>
        </tr>`;
      });
      table += '</tbody></table>';

      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
        <head><meta charset="UTF-8"></head><body>${table}</body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expenses_${todayISO()}.xls`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Excel file downloaded');
    });

    // Clear all
    document.getElementById('btnClearAll').addEventListener('click', () => {
      if (expenses.length === 0) return;
      if (confirm('Delete ALL expense records permanently? This cannot be undone.')) {
        expenses = [];
        saveExpenses();
        updateSummary();
        renderList();
        showToast('All records cleared');
      }
    });

    // ========== Init ==========
    loadExpenses();
    updateSummary();
    renderList();
    document.getElementById('amountInput').focus();
