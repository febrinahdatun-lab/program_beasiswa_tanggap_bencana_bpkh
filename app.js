/**
 * BMM & BPKH SYSTEM - APP ENGINE (JAVASCRIPT)
 * Handles: Multi-Page routing, Session caching, HTML template injections,
 * ApexCharts widgets, monitoring tables, sliding details drawer, and PDF compiling.
 */

// Application State
let appState = {
  rawData: [],
  filteredData: [],
  currentPage: 1,
  rowsPerPage: 10,
  currentSort: { column: 'nama', direction: 'asc' },
  selectedRespondent: null,
  campuses: [],
  isDarkTheme: false,
  charts: {},
  activePage: 'dashboard' // 'dashboard' or 'monitoring'
};

// Global Checklist Selections
let selectedIds = new Set();

// Colors matching BMM branding
const BMM_COLORS = {
  purple: '#5c178c',
  green: '#39b54a',
  purpleDark: '#4a1270',
  greenDark: '#2e943c',
  purpleLight: 'rgba(92, 23, 140, 0.08)',
  greenLight: 'rgba(57, 181, 74, 0.08)'
};

/**
 * Smart IPK Normalizer & Validator
 * Standardizes university GPA to 1 digit before comma and 2 digits after (X.XX)
 * Filters out high school scores, percentages, and texts.
 */
function cleanIPK(val) {
  if (val === undefined || val === null) return 0.0;
  let str = String(val).replace(/,/g, '.').trim();
  // Remove text inside parentheses (e.g. "(Semester 1)")
  str = str.replace(/\([^)]*\)/g, '').trim();
  // Match numbers (digits and periods)
  let matches = str.match(/\d+(\.\d+)?/);
  if (!matches) return 0.0;
  
  let numStr = matches[0].replace(/\./g, ''); // Get raw digits
  if (numStr.length === 0) return 0.0;
  
  // Normalize values that start with valid GPA digits (2, 3, 4)
  let first = numStr.charAt(0);
  if (first === '2' || first === '3' || first === '4') {
    if (numStr.length === 1) {
      return parseFloat(first + ".00");
    }
    let second = numStr.charAt(1);
    let third = numStr.length > 2 ? numStr.charAt(2) : '0';
    return parseFloat(first + "." + second + third);
  }
  
  // General decimal check
  let parsed = parseFloat(matches[0]);
  if (parsed >= 2.0 && parsed <= 4.0) {
    return parseFloat(parsed.toFixed(2));
  }
  return 0.0; // Filter out high school values (e.g., 1780, 91.3)
}

/**
 * Initialize Application
 */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  detectActivePage();
  setupCommonEventListeners();
  
  if (appState.activePage === 'monitoring') {
    await injectTemplates();
    setupMonitoringEventListeners();
  } else {
    setupDashboardEventListeners();
  }
  
  await loadData();
});

/**
 * Detect Current Page
 */
function detectActivePage() {
  const path = window.location.pathname;
  if (path.includes('monitoring.html')) {
    appState.activePage = 'monitoring';
  } else {
    appState.activePage = 'dashboard';
  }
}

/**
 * Theme Manager
 */
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light-theme';
  document.body.className = savedTheme;
  appState.isDarkTheme = savedTheme === 'dark-theme';
  updateThemeToggleIcon();
}

function toggleTheme() {
  appState.isDarkTheme = !appState.isDarkTheme;
  const themeClass = appState.isDarkTheme ? 'dark-theme' : 'light-theme';
  document.body.className = themeClass;
  localStorage.setItem('theme', themeClass);
  updateThemeToggleIcon();
  
  // Re-render charts to adjust colors (only on dashboard page)
  if (appState.activePage === 'dashboard' && appState.rawData.length > 0) {
    renderCharts();
  }
}

function updateThemeToggleIcon() {
  const icon = document.querySelector('#theme-toggle-btn i');
  if (icon) {
    icon.className = appState.isDarkTheme ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
}

/**
 * Setup Common Event Listeners (Header, Theme)
 */
function setupCommonEventListeners() {
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  const refreshBtn = document.getElementById('refresh-data-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadData(true));
}

/**
 * Setup Dashboard Page Listeners for Chart Toolbar actions (Fullscreen & Table View)
 */
function setupDashboardEventListeners() {
  document.querySelectorAll('.chart-action-btn.fullscreen-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.chart-card');
      const chartKey = card.id.replace('card-', '');
      
      if (card.classList.contains('fullscreen')) {
        card.classList.remove('fullscreen');
        document.body.classList.remove('fullscreen-overlay-active');
        btn.innerHTML = '<i class="fa-solid fa-expand"></i>';
      } else {
        // Close any other fullscreen charts
        document.querySelectorAll('.chart-card.fullscreen').forEach(other => {
          other.classList.remove('fullscreen');
          const otherBtn = other.querySelector('.fullscreen-btn');
          if (otherBtn) otherBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
        });
        card.classList.add('fullscreen');
        document.body.classList.add('fullscreen-overlay-active');
        btn.innerHTML = '<i class="fa-solid fa-compress"></i>';
      }
      
      // Trigger resize for ApexCharts to fit the new container size
      if (appState.charts[chartKey]) {
        setTimeout(() => {
          appState.charts[chartKey].windowResize();
        }, 150);
      }
    });
  });

  document.querySelectorAll('.chart-action-btn.toggle-table-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.chart-card');
      const chartKey = card.id.replace('card-', '');
      
      if (card.classList.contains('show-table')) {
        card.classList.remove('show-table');
        btn.classList.remove('active');
      } else {
        card.classList.add('show-table');
        btn.classList.add('active');
        renderChartDataTable(card, chartKey);
      }
    });
  });
}

/**
 * Renders an uppercase data table view of the respondents represented in a chart
 */
function renderChartDataTable(cardEl, chartKey) {
  const tableWrapper = cardEl.querySelector('.chart-data-table-wrapper');
  if (!tableWrapper) return;

  // Render all active respondents inside a scrollable table with uppercase layout
  tableWrapper.innerHTML = `
    <table class="chart-data-table">
      <thead>
        <tr>
          <th>Nama Lengkap</th>
          <th>Jenis Kelamin</th>
          <th>Nama Kampus</th>
          <th>Semester</th>
          <th>Status Keaktifan</th>
        </tr>
      </thead>
      <tbody>
        ${appState.rawData.map(item => `
          <tr>
            <td><strong>${item.nama || ''}</strong></td>
            <td>${item.jenis_kelamin || ''}</td>
            <td>${item.kampus || ''}</td>
            <td>Semester ${item.semester || ''}</td>
            <td>${item.mhs_aktif || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

/**
 * Asynchronously fetch and inject drawer.html and pdf-template.html
 */
async function injectTemplates() {
  try {
    // Inject Details Drawer Markup Fragment
    const drawerPlaceholder = document.getElementById('drawer-placeholder');
    if (drawerPlaceholder) {
      const res = await fetch('drawer.html');
      if (!res.ok) throw new Error('Drawer file not found');
      drawerPlaceholder.innerHTML = await res.text();
    }

    // Inject PDF Report Template Markup Fragment
    const pdfPlaceholder = document.getElementById('pdf-template-placeholder');
    if (pdfPlaceholder) {
      const res = await fetch('pdf-template.html');
      if (!res.ok) throw new Error('PDF Template file not found');
      pdfPlaceholder.innerHTML = await res.text();
    }
  } catch (error) {
    console.error('Failed to inject HTML fragments:', error);
    if (window.location.protocol === 'file:') {
      alert('Pemberitahuan Developer: Fitur sliding panel & download PDF memerlukan server lokal (HTTP). Gunakan Live Server atau python web server untuk menjalankannya secara lokal.');
    }
  }
}

/**
 * Setup Monitoring Page Event Listeners
 */
function setupMonitoringEventListeners() {
  const closeBtn = document.getElementById('canvas-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeDetailsCanvas);
  
  const overlay = document.getElementById('canvas-overlay');
  if (overlay) overlay.addEventListener('click', closeDetailsCanvas);
  
  const downloadPdfBtn = document.getElementById('canvas-download-pdf-btn');
  if (downloadPdfBtn) downloadPdfBtn.addEventListener('click', downloadRespondentPDF);

  // Search/Filter events
  const searchInput = document.getElementById('table-search');
  if (searchInput) searchInput.addEventListener('input', () => {
    appState.currentPage = 1;
    applyTableFilters();
  });

  const campusFilter = document.getElementById('filter-campus');
  if (campusFilter) campusFilter.addEventListener('change', () => {
    appState.currentPage = 1;
    applyTableFilters();
  });

  const genderFilter = document.getElementById('filter-gender');
  if (genderFilter) genderFilter.addEventListener('change', () => {
    appState.currentPage = 1;
    applyTableFilters();
  });

  // Table pagination buttons
  const prevBtn = document.getElementById('pagination-prev');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    if (appState.currentPage > 1) {
      appState.currentPage--;
      renderTable();
    }
  });

  const nextBtn = document.getElementById('pagination-next');
  if (nextBtn) nextBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(appState.filteredData.length / appState.rowsPerPage);
    if (appState.currentPage < totalPages) {
      appState.currentPage++;
      renderTable();
    }
  });

  // Sorting columns
  document.querySelectorAll('.monitoring-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.getAttribute('data-sort');
      const direction = appState.currentSort.column === column && appState.currentSort.direction === 'asc' ? 'desc' : 'asc';
      appState.currentSort = { column, direction };
      
      document.querySelectorAll('.monitoring-table th i').forEach(icon => {
        icon.className = 'fa-solid fa-sort';
      });
      const icon = th.querySelector('i');
      icon.className = direction === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
      
      sortAndRenderTable();
    });
  });

  // Check-all checkbox listener
  const checkAll = document.getElementById('check-all');
  if (checkAll) {
    checkAll.addEventListener('change', (e) => {
      const checked = e.target.checked;
      const visibleCheckboxes = document.querySelectorAll('.row-checkbox');
      visibleCheckboxes.forEach(cb => {
        const id = parseInt(cb.getAttribute('data-id'));
        cb.checked = checked;
        if (checked) {
          selectedIds.add(id);
        } else {
          selectedIds.delete(id);
        }
      });
      updateBulkDownloadButton();
    });
  }

  // Bulk download button
  const bulkBtn = document.getElementById('bulk-download-pdf-btn');
  if (bulkBtn) {
    bulkBtn.addEventListener('click', downloadSelectedPDFs);
  }
}

/**
 * Data Ingestion & Session Cache Controller
 */
async function loadData(forceRefresh = false) {
  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = document.getElementById('data-status-text');
  
  if (statusIndicator) statusIndicator.className = 'status-indicator warning';
  if (statusText) statusText.innerText = 'Memuat Data...';
  
  const lastUpdatedEl = document.getElementById('meta-last-updated');
  if (lastUpdatedEl) lastUpdatedEl.innerText = new Date().toLocaleString('id-ID');

  try {
    let data = null;

    if (!forceRefresh) {
      const cached = sessionStorage.getItem('bmm_data_cache');
      if (cached) {
        data = JSON.parse(cached);
        if (statusText) statusText.innerText = 'Data Terload (Cache)';
        const sheetMeta = document.getElementById('meta-sheet-name');
        if (sheetMeta) sheetMeta.innerText = 'Google Sheets (Cached)';
        if (statusIndicator) statusIndicator.className = 'status-indicator online';
      }
    }

    if (!data) {
      if (CONFIG.API_URL && !CONFIG.USE_MOCK_DATA) {
        const response = await fetch(`${CONFIG.API_URL}?action=getData`);
        if (!response.ok) throw new Error('API request failed');
        const result = await response.json();
        if (result.status === 'error') throw new Error(result.message);
        data = result.data;
        
        if (statusText) statusText.innerText = 'Terhubung ke API';
        const sheetMeta = document.getElementById('meta-sheet-name');
        if (sheetMeta) sheetMeta.innerText = 'Google Sheets (Live)';
      } else {
        await new Promise(resolve => setTimeout(resolve, 600));
        data = MOCK_DATA;
        if (statusText) statusText.innerText = 'Mode Demo (Mock Data)';
        const sheetMeta = document.getElementById('meta-sheet-name');
        if (sheetMeta) sheetMeta.innerText = 'Contoh File CSV';
      }

      sessionStorage.setItem('bmm_data_cache', JSON.stringify(data));
    }

    // Clean & Standardize IPK immediately on loading data
    appState.rawData = data.map(item => {
      const cleanedVal = cleanIPK(item.ipk_display || item.ipk);
      return {
        ...item,
        ipk: cleanedVal,
        ipk_display: cleanedVal === 0 ? "0,00" : cleanedVal.toFixed(2).replace('.', ',')
      };
    });
    
    appState.filteredData = [...appState.rawData];
    
    if (appState.activePage === 'monitoring') {
      const uniqueCampuses = [...new Set(appState.rawData.map(item => item.kampus).filter(Boolean))].sort();
      appState.campuses = uniqueCampuses;
      populateCampusFilter(uniqueCampuses);
      applyTableFilters();
    } else {
      updateDashboard();
    }

    if (statusIndicator) statusIndicator.className = 'status-indicator online';

  } catch (error) {
    console.error('Data load error:', error);
    if (statusIndicator) statusIndicator.className = 'status-indicator offline';
    if (statusText) statusText.innerText = 'Koneksi Gagal';
    
    if (!CONFIG.USE_MOCK_DATA) {
      console.warn('API error. Falling back to mock data...');
      CONFIG.USE_MOCK_DATA = true;
      loadData(true);
    }
  }
}

/**
 * Populate Campus Select Filter Options (Monitoring Page)
 */
function populateCampusFilter(campuses) {
  const select = document.getElementById('filter-campus');
  if (!select) return;

  select.innerHTML = '<option value="">Semua Kampus</option>';
  campuses.forEach(campus => {
    const opt = document.createElement('option');
    opt.value = campus;
    opt.innerText = campus;
    select.appendChild(opt);
  });
}

/**
 * Update Dashboard View (Dashboard Page Only)
 */
function updateDashboard() {
  const total = appState.rawData.length;
  const totalEl = document.getElementById('kpi-total-responden');
  if (totalEl) totalEl.innerText = total;

  // Calculate Top 3 IPK (excluding zero values)
  const sortedByIpk = [...appState.rawData]
    .filter(item => item.ipk > 0)
    .sort((a, b) => b.ipk - a.ipk);
  const top3 = sortedByIpk.slice(0, 3);
  
  const listContainer = document.getElementById('kpi-top-ipk-list');
  if (listContainer) {
    listContainer.innerHTML = '';
    top3.forEach((item, index) => {
      const rankTitle = index === 0 ? 'TERBAIK 1' : index === 1 ? 'TERBAIK 2' : 'TERBAIK 3';
      const card = document.createElement('div');
      card.className = 'leaderboard-item';
      card.innerHTML = `
        <div class="rank-badge">${rankTitle}</div>
        <h4 title="${item.nama}">${item.nama}</h4>
        <span>${item.ipk_display} <span style="font-size:0.7rem; font-weight:500;">(${item.kampus})</span></span>
      `;
      listContainer.appendChild(card);
    });
  }

  renderCharts();
}

/**
 * Render ApexCharts widgets (Dashboard Page Only)
 */
function renderCharts() {
  if (!document.querySelector("#chart-gender")) return;

  const themeMode = appState.isDarkTheme ? 'dark' : 'light';
  const labelColor = appState.isDarkTheme ? '#94a3b8' : '#64748b';
  
  Object.values(appState.charts).forEach(chart => {
    if (chart && typeof chart.destroy === 'function') chart.destroy();
  });
  appState.charts = {};

  // 1. Gender Donut
  const genderCounts = countOccurrences(appState.rawData, 'jenis_kelamin');
  const genderOptions = {
    series: Object.values(genderCounts),
    labels: Object.keys(genderCounts),
    chart: { type: 'donut', height: 260 },
    theme: { mode: themeMode },
    colors: [BMM_COLORS.purple, BMM_COLORS.green, '#e2e8f0'],
    legend: { position: 'bottom', labels: { colors: labelColor } },
    plotOptions: {
      pie: {
        donut: {
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Total',
              color: labelColor,
              formatter: () => appState.rawData.length
            }
          }
        }
      }
    }
  };
  appState.charts.gender = new ApexCharts(document.querySelector("#chart-gender"), genderOptions);
  appState.charts.gender.render();

  // 2. Campus Column Chart
  const campusCounts = countOccurrences(appState.rawData, 'kampus');
  const sortedCampuses = Object.entries(campusCounts).sort((a, b) => b[1] - a[1]);
  const campusLabels = sortedCampuses.map(item => item[0]);
  const campusSeries = sortedCampuses.map(item => item[1]);
  
  const campusOptions = {
    series: [{ name: 'Responden', data: campusSeries }],
    chart: { type: 'bar', height: 260, toolbar: { show: false } },
    theme: { mode: themeMode },
    colors: [BMM_COLORS.purple],
    plotOptions: {
      bar: {
        borderRadius: 6,
        horizontal: false,
        columnWidth: '45%',
      }
    },
    dataLabels: { enabled: true },
    xaxis: {
      categories: campusLabels,
      labels: {
        show: true,
        rotate: -25,
        rotateAlways: false,
        style: { colors: labelColor, fontSize: '9px' }
      }
    },
    yaxis: {
      labels: { style: { colors: labelColor } }
    }
  };
  appState.charts.campus = new ApexCharts(document.querySelector("#chart-campus"), campusOptions);
  appState.charts.campus.render();

  // 3. Semester Column Chart (Custom sorted Semester 1 to Semester >8)
  const semesterCategories = [
    'Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 
    'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8', 'Semester >8'
  ];
  
  const semesterMap = {};
  semesterCategories.forEach(cat => { semesterMap[cat] = 0; });
  
  appState.rawData.forEach(item => {
    let sem = String(item.semester || "").trim();
    if (!sem) return;
    
    let key = '';
    if (sem === '1') key = 'Semester 1';
    else if (sem === '2') key = 'Semester 2';
    else if (sem === '3') key = 'Semester 3';
    else if (sem === '4') key = 'Semester 4';
    else if (sem === '5') key = 'Semester 5';
    else if (sem === '6') key = 'Semester 6';
    else if (sem === '7') key = 'Semester 7';
    else if (sem === '8') key = 'Semester 8';
    else if (sem === '>8' || sem === '8>' || sem.includes('>') || parseInt(sem) > 8) {
      key = 'Semester >8';
    } else {
      key = 'Semester ' + sem;
      if (semesterMap[key] === undefined) {
        semesterMap[key] = 0;
      }
    }
    if (key) semesterMap[key]++;
  });
  
  const semesterSeriesData = semesterCategories.map(cat => semesterMap[cat] || 0);
  
  const semesterOptions = {
    series: [{ name: 'Responden', data: semesterSeriesData }],
    chart: { type: 'bar', height: 260, toolbar: { show: false } },
    theme: { mode: themeMode },
    colors: [
      BMM_COLORS.purple, '#3b82f6', BMM_COLORS.green, '#f59e0b', 
      '#ec4899', '#6366f1', '#14b8a6', '#f43f5e', '#64748b'
    ],
    plotOptions: {
      bar: {
        borderRadius: 4,
        horizontal: false,
        columnWidth: '55%',
        distributed: true
      }
    },
    dataLabels: { enabled: true },
    legend: { show: false },
    xaxis: {
      categories: semesterCategories,
      labels: {
        show: true,
        rotate: -30,
        style: { colors: labelColor, fontSize: '9px' }
      }
    },
    yaxis: {
      labels: { style: { colors: labelColor } }
    }
  };
  appState.charts.semester = new ApexCharts(document.querySelector("#chart-semester"), semesterOptions);
  appState.charts.semester.render();

  // 4. Mahasiswa Aktif Donut
  const mhsCounts = countOccurrences(appState.rawData, 'mhs_aktif');
  const mhsOptions = {
    series: Object.values(mhsCounts),
    labels: Object.keys(mhsCounts),
    chart: { type: 'donut', height: 260 },
    theme: { mode: themeMode },
    colors: [BMM_COLORS.green, BMM_COLORS.purple, '#ef4444'],
    legend: { position: 'bottom', labels: { colors: labelColor } }
  };
  appState.charts.mhs = new ApexCharts(document.querySelector("#chart-active-status"), mhsOptions);
  appState.charts.mhs.render();

  // 5. Parent Income double bars
  const ayahIncomeGrouped = { 'Rp 0 - 1 Juta': 0, 'Rp 1 - 5 Juta': 0, 'Lainnya': 0 };
  const ibuIncomeGrouped = { 'Rp 0 - 1 Juta': 0, 'Rp 1 - 5 Juta': 0, 'Lainnya': 0 };

  appState.rawData.forEach(item => {
    const payA = item.penghasilan_ayah || "";
    if (payA.includes("0 s..d 1000.000") || payA.includes("0 s.d 1000")) {
      ayahIncomeGrouped['Rp 0 - 1 Juta']++;
    } else if (payA.includes("1000") && payA.includes("5000")) {
      ayahIncomeGrouped['Rp 1 - 5 Juta']++;
    } else {
      ayahIncomeGrouped['Lainnya']++;
    }

    const payI = item.penghasilan_ibu || "";
    if (payI.includes("0 s..d 1000.000") || payI.includes("0 s.d 1000")) {
      ibuIncomeGrouped['Rp 0 - 1 Juta']++;
    } else if (payI.includes("1000") && payI.includes("5000")) {
      ibuIncomeGrouped['Rp 1 - 5 Juta']++;
    } else {
      ibuIncomeGrouped['Lainnya']++;
    }
  });

  const incomeOptions = {
    series: [
      { name: 'Ayah', data: Object.values(ayahIncomeGrouped) },
      { name: 'Ibu', data: Object.values(ibuIncomeGrouped) }
    ],
    chart: { type: 'bar', height: 260, toolbar: { show: false } },
    theme: { mode: themeMode },
    colors: [BMM_COLORS.purple, BMM_COLORS.green],
    plotOptions: {
      bar: {
        horizontal: false,
        borderRadius: 4,
        columnWidth: '55%',
      }
    },
    xaxis: {
      categories: Object.keys(ayahIncomeGrouped),
      labels: { style: { colors: labelColor } }
    },
    yaxis: {
      labels: { style: { colors: labelColor } }
    },
    legend: { position: 'bottom', labels: { colors: labelColor } }
  };
  appState.charts.income = new ApexCharts(document.querySelector("#chart-parents-income"), incomeOptions);
  appState.charts.income.render();
}

/**
 * Group count occurrences helper
 */
function countOccurrences(arr, key) {
  return arr.reduce((acc, item) => {
    let val = item[key] ? String(item[key]).trim() : 'N/A';
    if (val === '') val = 'N/A';
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Filter Table rows (Monitoring Page Only)
 */
function applyTableFilters() {
  const searchInput = document.getElementById('table-search');
  const campusFilter = document.getElementById('filter-campus');
  const genderFilter = document.getElementById('filter-gender');

  if (!searchInput) return;

  const query = searchInput.value.toLowerCase().trim();
  const campusVal = campusFilter.value;
  const genderVal = genderFilter.value;

  appState.filteredData = appState.rawData.filter(item => {
    const matchesSearch = 
      item.nama.toLowerCase().includes(query) || 
      item.kampus.toLowerCase().includes(query) || 
      item.alamat.toLowerCase().includes(query);
    
    const matchesCampus = !campusVal || item.kampus === campusVal;
    const matchesGender = !genderVal || item.jenis_kelamin === genderVal;

    return matchesSearch && matchesCampus && matchesGender;
  });

  sortAndRenderTable();
}

/**
 * Sort data cache and render table (Monitoring Page Only)
 */
function sortAndRenderTable() {
  const col = appState.currentSort.column;
  const dir = appState.currentSort.direction === 'asc' ? 1 : -1;

  appState.filteredData.sort((a, b) => {
    let valA = a[col];
    let valB = b[col];

    if (typeof valA === 'string') {
      return valA.localeCompare(valB) * dir;
    } else {
      return (valA - valB) * dir;
    }
  });

  renderTable();
}

/**
 * Render Data Table rows (Monitoring Page Only)
 */
function renderTable() {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  const startIdx = (appState.currentPage - 1) * appState.rowsPerPage;
  const endIdx = Math.min(startIdx + appState.rowsPerPage, appState.filteredData.length);
  const total = appState.filteredData.length;

  const pagStart = document.getElementById('pagination-start');
  const pagEnd = document.getElementById('pagination-end');
  const pagTotal = document.getElementById('pagination-total');

  if (pagStart) pagStart.innerText = total === 0 ? 0 : startIdx + 1;
  if (pagEnd) pagEnd.innerText = endIdx;
  if (pagTotal) pagTotal.innerText = total;

  tbody.innerHTML = '';

  if (total === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty-state">
          <i class="fa-solid fa-folder-open"></i>
          <p>Tidak ada data penerima yang cocok dengan pencarian.</p>
        </td>
      </tr>
    `;
    updatePaginationControls(0);
    return;
  }

  const pageData = appState.filteredData.slice(startIdx, endIdx);
  
  // Update header check-all checkbox state based on visible rows
  const checkAll = document.getElementById('check-all');
  if (checkAll) {
    const pageIds = pageData.map(item => item.id);
    checkAll.checked = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
  }

  pageData.forEach(item => {
    const isChecked = selectedIds.has(item.id) ? 'checked' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="checkbox-col" onclick="event.stopPropagation();">
        <input type="checkbox" class="row-checkbox" data-id="${item.id}" ${isChecked}>
      </td>
      <td><strong>${item.nama}</strong></td>
      <td>${item.kampus}</td>
      <td>Semester ${item.semester}</td>
      <td>
        <span class="rank-badge" style="font-size:0.8rem; padding: 2px 6px; border-radius:4px; background:var(--primary-light); color:var(--primary-color);">
          ${item.ipk_display}
        </span>
      </td>
      <td>
        <a href="${formatWhatsAppLink(item.whatsapp)}" target="_blank" class="wa-action-link" style="font-size:0.75rem;">
          <i class="fa-brands fa-whatsapp"></i> ${item.whatsapp}
        </a>
      </td>
      <td>
        <button class="action-view-btn" data-id="${item.id}">
          <i class="fa-solid fa-folder-open"></i> Buka Canvas
        </button>
      </td>
    `;
    
    // Checkbox click toggle selection
    const cb = tr.querySelector('.row-checkbox');
    cb.addEventListener('change', (e) => {
      toggleRowSelection(item.id, e.target.checked);
    });

    // Row click opens details (ignores clicks directly on checkbox or whatsapp links)
    tr.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'A' && e.target.parentElement.tagName !== 'A') {
        openDetailsCanvas(item);
      }
    });

    tbody.appendChild(tr);
  });

  const totalPages = Math.ceil(total / appState.rowsPerPage);
  updatePaginationControls(totalPages);
}

/**
 * Handle Checklist selection tracking
 */
function toggleRowSelection(id, checked) {
  if (checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
  updateBulkDownloadButton();
  
  // Sync check-all checkbox header state
  const checkAll = document.getElementById('check-all');
  if (checkAll) {
    const startIdx = (appState.currentPage - 1) * appState.rowsPerPage;
    const endIdx = Math.min(startIdx + appState.rowsPerPage, appState.filteredData.length);
    const pageData = appState.filteredData.slice(startIdx, endIdx);
    const pageIds = pageData.map(item => item.id);
    checkAll.checked = pageIds.length > 0 && pageIds.every(pid => selectedIds.has(pid));
  }
}

function updateBulkDownloadButton() {
  const btn = document.getElementById('bulk-download-pdf-btn');
  if (!btn) return;
  btn.disabled = selectedIds.size === 0;
  btn.innerText = `Unduh PDF Terpilih (${selectedIds.size})`;
}

/**
 * Render Page Pagination numbers (Monitoring Page Only)
 */
function updatePaginationControls(totalPages) {
  const prevBtn = document.getElementById('pagination-prev');
  const nextBtn = document.getElementById('pagination-next');
  const container = document.getElementById('pagination-pages');
  
  if (!prevBtn || !nextBtn || !container) return;

  prevBtn.disabled = appState.currentPage === 1 || totalPages === 0;
  nextBtn.disabled = appState.currentPage === totalPages || totalPages === 0;

  container.innerHTML = '';
  if (totalPages <= 1) return;

  let startPage = Math.max(1, appState.currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement('button');
    btn.className = `page-btn ${appState.currentPage === i ? 'active' : ''}`;
    btn.innerText = i;
    btn.addEventListener('click', () => {
      appState.currentPage = i;
      renderTable();
    });
    container.appendChild(btn);
  }
}

/**
 * Normalize WhatsApp Links
 */
function formatWhatsAppLink(phoneStr) {
  if (!phoneStr) return '#';
  let cleaned = String(phoneStr).replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  return `https://wa.me/${cleaned}`;
}

/**
 * Extract Google Drive file ID
 */
function extractDriveId(url) {
  if (!url) return null;
  let match = url.match(/[?&]id=([^&]+)/);
  if (match) return match[1].trim();
  match = url.match(/\/d\/([^\/]+)/);
  if (match) return match[1].trim();
  return null;
}

/**
 * Open Sliding Details Workspace
 */
function openDetailsCanvas(respondent) {
  appState.selectedRespondent = respondent;
  
  const nameHead = document.getElementById('canvas-nama-header');
  if (!nameHead) return;

  document.getElementById('canvas-nama-header').innerText = respondent.nama;
  document.getElementById('canvas-kampus-header').innerText = respondent.kampus;
  
  document.getElementById('canvas-nama').innerText = respondent.nama;
  document.getElementById('canvas-kampus').innerText = respondent.kampus;
  
  const waAnchor = document.getElementById('canvas-whatsapp');
  waAnchor.href = formatWhatsAppLink(respondent.whatsapp);
  document.getElementById('canvas-whatsapp-text').innerText = respondent.whatsapp;
  
  document.getElementById('canvas-alamat').innerText = respondent.alamat;
  document.getElementById('canvas-tempat-tinggal').innerText = respondent.tempat_tinggal;
  document.getElementById('canvas-semester').innerText = respondent.semester;
  document.getElementById('canvas-ipk').innerText = respondent.ipk_display;
  document.getElementById('canvas-ukt').innerText = respondent.ukt;

  document.getElementById('canvas-ayah').innerText = respondent.nama_ayah || 'N/A';
  document.getElementById('canvas-job-ayah').innerText = respondent.pekerjaan_ayah || 'N/A';
  document.getElementById('canvas-income-ayah').innerText = respondent.penghasilan_ayah || 'N/A';
  document.getElementById('canvas-ibu').innerText = respondent.nama_ibu || 'N/A';
  document.getElementById('canvas-job-ibu').innerText = respondent.pekerjaan_ibu || 'N/A';
  document.getElementById('canvas-income-ibu').innerText = respondent.penghasilan_ibu || 'N/A';

  // Load File Previews
  loadFilePreview(respondent.ktp, 'preview-ktp', 'btn-open-ktp');
  loadFilePreview(respondent.surat_rekomendasi, 'preview-rekomendasi', 'btn-open-rekomendasi');
  loadMultipleFilePreviews(respondent.foto_rumah, 'preview-rumah', 'btn-open-rumah-container');

  // Toggle Drawer CSS classes
  document.getElementById('canvas-overlay').classList.add('open');
  document.getElementById('canvas-drawer').classList.add('open');
}

function closeDetailsCanvas() {
  const overlay = document.getElementById('canvas-overlay');
  const drawer = document.getElementById('canvas-drawer');
  if (overlay) overlay.classList.remove('open');
  if (drawer) drawer.classList.remove('open');
  appState.selectedRespondent = null;
}

/**
 * Individual attachment loader for Canvas Details
 */
function loadFilePreview(url, previewBoxId, openBtnId) {
  const box = document.getElementById(previewBoxId);
  const openBtn = document.getElementById(openBtnId);
  
  if (!box) return;

  openBtn.href = url || '#';
  openBtn.style.display = url ? 'inline-flex' : 'none';

  if (!url) {
    box.innerHTML = '<div style="padding:15px; text-align:center;">Tidak ada dokumen.</div>';
    return;
  }

  const fileId = extractDriveId(url);
  if (!fileId) {
    box.innerHTML = '<div style="padding:15px; text-align:center; font-size:0.75rem;">Format link salah.</div>';
    return;
  }

  box.innerHTML = '<div class="skeleton-image"></div>';
  const thumbUrl = `https://drive.google.com/thumbnail?sz=w400&id=${fileId}`;
  
  const img = new Image();
  img.onload = () => {
    box.innerHTML = '';
    img.className = img.naturalWidth > img.naturalHeight ? 'is-landscape' : 'is-portrait';
    box.appendChild(img);
  };
  img.onerror = () => {
    fetchBase64FromAPI(fileId, box);
  };
  img.src = thumbUrl;
}

/**
 * Gallery loader for House photos
 */
function loadMultipleFilePreviews(urlsStr, previewBoxId, linksContainerId) {
  const box = document.getElementById(previewBoxId);
  const linkContainer = document.getElementById(linksContainerId);
  
  if (!box || !linkContainer) return;

  box.innerHTML = '';
  linkContainer.innerHTML = '';

  if (!urlsStr) {
    box.innerHTML = '<div style="padding:15px; text-align:center;">Tidak ada foto dokumentasi.</div>';
    return;
  }

  const urls = urlsStr.split(',').map(u => u.trim()).filter(Boolean);
  if (urls.length === 0) {
    box.innerHTML = '<div style="padding:15px; text-align:center;">Tidak ada foto dokumentasi.</div>';
    return;
  }

  urls.forEach((url, index) => {
    const fileId = extractDriveId(url);
    if (!fileId) return;

    const btn = document.createElement('a');
    btn.href = url;
    btn.target = '_blank';
    btn.className = 'gallery-open-btn';
    btn.innerHTML = `<i class="fa-solid fa-up-right-from-square"></i> Foto ${index + 1}`;
    linkContainer.appendChild(btn);

    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'skeleton-image';
    imgWrapper.style.width = '100px';
    imgWrapper.style.height = '100%';
    imgWrapper.style.borderRadius = '6px';
    box.appendChild(imgWrapper);

    const thumbUrl = `https://drive.google.com/thumbnail?sz=w200&id=${fileId}`;
    const img = new Image();
    img.onload = () => {
      imgWrapper.className = '';
      imgWrapper.innerHTML = '';
      img.className = img.naturalWidth > img.naturalHeight ? 'is-landscape' : 'is-portrait';
      imgWrapper.appendChild(img);
    };
    img.onerror = () => {
      fetchBase64FromAPI(fileId, imgWrapper, true);
    };
    img.src = thumbUrl;
  });
}

/**
 * Google Apps Script Proxy file retriever with PDF contentType layout styling
 */
async function fetchBase64FromAPI(fileId, containerElement, isGalleryItem = false) {
  if (!CONFIG.API_URL || CONFIG.USE_MOCK_DATA) {
    containerElement.innerHTML = `<div style="padding:5px; text-align:center; font-size:0.7rem; color:var(--text-muted);"><i class="fa-solid fa-eye-slash"></i> Offline (Demo)</div>`;
    return;
  }

  try {
    const response = await fetch(`${CONFIG.API_URL}?action=getFile&id=${fileId}`);
    const result = await response.json();
    
    if (result.status === 'success') {
      if (result.contentType === 'application/pdf') {
        containerElement.innerHTML = `
          <div class="pdf-doc-placeholder">
            <i class="fa-solid fa-file-pdf"></i>
            <span>DOKUMEN REKOMENDASI (PDF)</span>
            <span style="font-size: 7px; color: var(--text-secondary); margin-top: 2px;">Tinjau via tombol buka</span>
          </div>
        `;
        return;
      }
      
      const img = document.createElement('img');
      img.src = `data:${result.contentType};base64,${result.base64}`;
      img.onload = () => {
        img.className = img.naturalWidth > img.naturalHeight ? 'is-landscape' : 'is-portrait';
      };
      if (isGalleryItem) containerElement.className = '';
      containerElement.innerHTML = '';
      containerElement.appendChild(img);
    } else {
      throw new Error(result.message);
    }
  } catch (err) {
    containerElement.innerHTML = `<div style="padding:5px; text-align:center; font-size:0.65rem; color:var(--accent-red);"><i class="fa-solid fa-triangle-exclamation"></i> Gagal</div>`;
  }
}

/**
 * Single PDF Report Downloader Button Action
 */
async function downloadRespondentPDF() {
  const item = appState.selectedRespondent;
  if (!item) return;

  const downloadBtn = document.getElementById('canvas-download-pdf-btn');
  const oldBtnText = downloadBtn.innerHTML;
  
  downloadBtn.disabled = true;
  downloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mempersiapkan PDF...';

  try {
    await executePDFDownloadDirectly(item);
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Gagal mengunduh formulir PDF.');
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = oldBtnText;
  }
}

/**
 * Sequentially download checked files showing a beautiful progress bar overlay modal
 */
async function downloadSelectedPDFs() {
  if (selectedIds.size === 0) return;
  
  const ids = Array.from(selectedIds);
  const total = ids.length;
  
  const modal = document.getElementById('download-progress-modal');
  const bar = document.getElementById('download-progress-bar');
  const status = document.getElementById('download-progress-status');
  
  if (modal) modal.classList.add('show');
  
  const bulkBtn = document.getElementById('bulk-download-pdf-btn');
  if (bulkBtn) bulkBtn.disabled = true;

  try {
    for (let i = 0; i < total; i++) {
      const id = ids[i];
      const respondent = appState.rawData.find(item => item.id === id);
      if (!respondent) continue;
      
      const percent = Math.round((i / total) * 100);
      if (bar) bar.style.width = `${percent}%`;
      if (status) status.innerText = `Mengunduh Laporan ${i + 1} dari ${total} (${percent}%) - ${respondent.nama}`;
      
      appState.selectedRespondent = respondent;
      await executePDFDownloadDirectly(respondent);
      
      // Delay to let browser trigger download and render images cleanly
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    if (bar) bar.style.width = '100%';
    if (status) status.innerText = `Selesai Mengunduh ${total} Laporan!`;
    
    setTimeout(() => {
      if (modal) modal.classList.remove('show');
      selectedIds.clear();
      updateBulkDownloadButton();
      
      const checkAll = document.getElementById('check-all');
      if (checkAll) checkAll.checked = false;
      
      renderTable();
    }, 1200);

  } catch (error) {
    console.error('Error during bulk download:', error);
    alert('Terjadi kesalahan saat mengunduh beberapa PDF.');
    if (modal) modal.classList.remove('show');
  } finally {
    if (bulkBtn) bulkBtn.disabled = false;
  }
}

/**
 * Compiles dynamic fields and compiles them into a single A4 optimized PDF page using html2pdf
 */
async function executePDFDownloadDirectly(item) {
  // Fill printable A4 fields
  document.getElementById('pdf-reg-id').innerText = item.id;
  document.getElementById('pdf-timestamp').innerText = item.timestamp;
  document.getElementById('pdf-nama').innerText = item.nama;
  document.getElementById('pdf-sig-nama').innerText = item.nama;
  
  document.getElementById('pdf-kampus').innerText = item.kampus;
  document.getElementById('pdf-semester').innerText = item.semester;
  document.getElementById('pdf-ipk').innerText = item.ipk_display;
  document.getElementById('pdf-whatsapp').innerText = item.whatsapp;
  document.getElementById('pdf-alamat').innerText = item.alamat;
  document.getElementById('pdf-tempat-tinggal').innerText = item.tempat_tinggal;
  document.getElementById('pdf-ukt').innerText = item.ukt;

  document.getElementById('pdf-ayah').innerText = item.nama_ayah || '-';
  document.getElementById('pdf-job-ayah').innerText = item.pekerjaan_ayah || '-';
  document.getElementById('pdf-income-ayah').innerText = item.penghasilan_ayah || '-';
  
  document.getElementById('pdf-ibu').innerText = item.nama_ibu || '-';
  document.getElementById('pdf-job-ibu').innerText = item.pekerjaan_ibu || '-';
  document.getElementById('pdf-income-ibu').innerText = item.penghasilan_ibu || '-';
  
  document.getElementById('pdf-sig-date').innerText = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  // Load and cache PDF attachment images with orientation detection
  await Promise.all([
    loadPDFImage(item.ktp, 'pdf-img-ktp', 'LAMPIRAN 1: FOTO KTP'),
    loadPDFImage(item.surat_rekomendasi, 'pdf-img-rekomendasi', 'LAMPIRAN 2: SURAT REKOMENDASI KAMPUS'),
    loadPDFGallery(item.foto_rumah, 'pdf-img-rumah')
  ]);

  const element = document.getElementById('pdf-report-template');
  element.style.display = 'block';

  // 1-page PDF options
  const pdfOptions = {
    margin: [6, 6, 6, 6],
    filename: `Formulir_Pemulihan_${item.nama.replace(/\s+/g, '_')}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  await html2pdf().set(pdfOptions).from(element).save();
  element.style.display = 'none';
}

/**
 * Dynamic loader of PDF images supporting PDF placeholder boxes and auto-orientation detection
 */
async function loadPDFImage(url, targetWrapperId, labelText) {
  const wrapper = document.getElementById(targetWrapperId);
  if (!wrapper) return;
  wrapper.innerHTML = '';
  
  if (!url) {
    wrapper.innerHTML = '<span class="image-placeholder">Dokumen tidak diunggah</span>';
    return;
  }

  const fileId = extractDriveId(url);
  if (!fileId) {
    wrapper.innerHTML = '<span class="image-placeholder">Tautan dokumen salah</span>';
    return;
  }

  if (CONFIG.API_URL && !CONFIG.USE_MOCK_DATA) {
    try {
      const response = await fetch(`${CONFIG.API_URL}?action=getFile&id=${fileId}`);
      const result = await response.json();
      if (result.status === 'success') {
        if (result.contentType === 'application/pdf') {
          wrapper.innerHTML = `
            <div class="pdf-doc-placeholder">
              <i class="fa-solid fa-file-pdf"></i>
              <strong>LAMPIRAN REKOMENDASI (PDF)</strong>
              <span style="font-size:7pt; color: #4b5563; margin-top:2px;">Dokumen asli terlampir secara elektronik</span>
            </div>
          `;
          return;
        }
        
        const img = document.createElement('img');
        img.src = `data:${result.contentType};base64,${result.base64}`;
        img.alt = labelText;
        img.onload = () => {
          img.className = img.naturalWidth > img.naturalHeight ? 'is-landscape' : 'is-portrait';
        };
        wrapper.innerHTML = '';
        wrapper.appendChild(img);
        return;
      }
    } catch (err) {
      console.warn('Base64 fetch failed:', err);
    }
  }

  // Fallback public thumbnail
  const img = document.createElement('img');
  img.src = `https://drive.google.com/thumbnail?sz=w600&id=${fileId}`;
  img.alt = labelText;
  img.onload = () => {
    img.className = img.naturalWidth > img.naturalHeight ? 'is-landscape' : 'is-portrait';
  };
  img.setAttribute('crossorigin', 'anonymous');
  wrapper.innerHTML = '';
  wrapper.appendChild(img);
}

/**
 * Dynamic loader of PDF photo galleries supporting auto-orientation detection
 */
async function loadPDFGallery(urlsStr, targetWrapperId) {
  const wrapper = document.getElementById(targetWrapperId);
  if (!wrapper) return;
  wrapper.innerHTML = '';

  if (!urlsStr) {
    wrapper.innerHTML = '<span class="image-placeholder">Dokumentasi rumah tidak diunggah</span>';
    return;
  }

  const urls = urlsStr.split(',').map(u => u.trim()).filter(Boolean);
  if (urls.length === 0) {
    wrapper.innerHTML = '<span class="image-placeholder">Dokumentasi rumah tidak diunggah</span>';
    return;
  }

  for (let url of urls) {
    const fileId = extractDriveId(url);
    if (!fileId) continue;

    let imageLoaded = false;
    if (CONFIG.API_URL && !CONFIG.USE_MOCK_DATA) {
      try {
        const response = await fetch(`${CONFIG.API_URL}?action=getFile&id=${fileId}`);
        const result = await response.json();
        if (result.status === 'success') {
          const img = document.createElement('img');
          img.src = `data:${result.contentType};base64,${result.base64}`;
          img.alt = "Foto Rumah Terdampak";
          img.onload = () => {
            img.className = img.naturalWidth > img.naturalHeight ? 'is-landscape' : 'is-portrait';
          };
          wrapper.appendChild(img);
          imageLoaded = true;
        }
      } catch (err) {
        console.warn(err);
      }
    }

    if (!imageLoaded) {
      const img = document.createElement('img');
      img.src = `https://drive.google.com/thumbnail?sz=w400&id=${fileId}`;
      img.alt = "Foto Rumah Terdampak";
      img.setAttribute('crossorigin', 'anonymous');
      img.onload = () => {
        img.className = img.naturalWidth > img.naturalHeight ? 'is-landscape' : 'is-portrait';
      };
      wrapper.appendChild(img);
    }
  }
}
