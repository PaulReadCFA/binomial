/**
 * Shared chart/table toggle behaviour for CFA equation explorers.
 * Callers keep their own button and pane IDs; this module owns visibility,
 * toolbar tab order, and the view announcement.
 */

export const VIEW_ANNOUNCEMENTS = {
  chart: 'Chart view. Data table is hidden.',
  table: 'Table view. Chart and chart announcements are hidden.',
};

export function announceView(label, regionId = 'view-announcement') {
  const el = document.getElementById(regionId);
  if (!el) return;
  el.textContent = '';
  setTimeout(() => {
    el.textContent = label;
  }, 30);
}

export function updateToggleButtonStates({
  chartBtn,
  tableBtn,
  showingChart,
  forceTable = false,
} = {}) {
  if (!chartBtn || !tableBtn) return;

  const chartOn = !!showingChart && !forceTable;
  chartBtn.classList.toggle('active', chartOn);
  tableBtn.classList.toggle('active', !chartOn);
  chartBtn.setAttribute('aria-pressed', chartOn ? 'true' : 'false');
  tableBtn.setAttribute('aria-pressed', chartOn ? 'false' : 'true');
  chartBtn.disabled = !!forceTable;

  if (forceTable) {
    chartBtn.tabIndex = -1;
    tableBtn.tabIndex = 0;
  } else if (chartOn) {
    chartBtn.tabIndex = 0;
    tableBtn.tabIndex = -1;
  } else {
    chartBtn.tabIndex = -1;
    tableBtn.tabIndex = 0;
  }
}

export function applyChartTableVisibility({
  chartEl,
  tableEl,
  canvas,
  showChart,
  extraHideWithChart = [],
  extraHideWithTable = [],
} = {}) {
  if (!chartEl || !tableEl) return;

  if (showChart) {
    chartEl.style.display = 'block';
    tableEl.style.display = 'none';
    chartEl.removeAttribute('aria-hidden');
    tableEl.setAttribute('aria-hidden', 'true');
    extraHideWithTable.forEach((el) => el && el.removeAttribute('aria-hidden'));
    extraHideWithChart.forEach((el) => el && el.setAttribute('aria-hidden', 'true'));
    if (canvas) canvas.tabIndex = 0;
  } else {
    chartEl.style.display = 'none';
    tableEl.style.display = 'block';
    chartEl.setAttribute('aria-hidden', 'true');
    tableEl.removeAttribute('aria-hidden');
    extraHideWithTable.forEach((el) => el && el.setAttribute('aria-hidden', 'true'));
    extraHideWithChart.forEach((el) => el && el.removeAttribute('aria-hidden'));
    if (canvas) canvas.tabIndex = -1;
  }
}
