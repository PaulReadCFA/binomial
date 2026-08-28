import { state, setState, subscribe } from './binomial-modules/state.js';
import { calculateOptionMetrics } from './binomial-modules/calculations.js';
import { validateAll, updateFieldError, updateValidationSummary, hasErrors } from './binomial-modules/validation.js';
import {
  $,
  listen,
  debounce,
  formatCurrency,
  formatCurrencySpeech,
  formatPercentage,
  formatWithUnicodeMinus,
  clampNumericInputLength,
  applyTableRoles,
  NUMERIC_INPUT_MAX_CHARS
} from './binomial-modules/utils.js';
import { getChartTypography } from './chart-typography.js';
import { renderEquation } from './equation-render.js';
import { allFinite } from './validation-ui.js';
import {
  applyChartTableVisibility,
  updateToggleButtonStates,
  announceView,
  VIEW_ANNOUNCEMENTS,
} from './view-toggle.js';

// Register Chart.js datalabels plugin
Chart.register(ChartDataLabels);

let assetChart, callChart, putChart;
let currentView = 'chart';
const treeFocusIndices = new Map();

/** Curriculum chart label convention: 13px / 600 / Lato at the 18px design root. */
const CHART_FONT = { family: '', size: 13, weight: '600' };
// Colour coding — consistent across all areas of this EE:
//   up-state values  → green  (Su, Cu, Pu)
//   down-state values → red   (Sd, Cd, Pd)
//   current price    → neutral (S0 — distinct from up-state green)
//   call option      → blue   (C0, Cu, Cd, HRc, c0)
//   put option       → purple (P0, Pu, Pd, HRp, p0)
//   K, r             → neutral
const COLOR = {
  up:   '#047857',  // green  — Su and up-state values
  down: '#b91c1c',  // red    — Sd and down-state values
  call: '#1e40af',  // blue   — call option
  put:  '#6d28d9',  // purple — put option
  neutral: '#374151' // S0, K, r
};

// Unicode math-italic capital letters for chart data labels.
// These allow the variable letter to render italic while the
// surrounding number/equals/subscript text stays upright,
// without needing font-style: italic on the whole canvas label.
const ITALIC = {
  S: '\u{1D446}', // 𝑆  Mathematical Italic Capital S
  C: '\u{1D436}', // 𝐶  Mathematical Italic Capital C
  P: '\u{1D443}'  // 𝑃  Mathematical Italic Capital P
};
const SUB = {
  '0': '\u2080' // ₀ — t = 0 labels (𝑆₀, 𝐶₀, 𝑃₀); t = 1 uses “Up path” / “Down path” (matches legend & line colours)
};

/** Unicode minus (U+2212) for negative values in on-chart labels */
function formatChartValue(value, decimals = 2) {
  const s = Number(value).toFixed(decimals);
  return s.startsWith('-') ? `\u2212${s.slice(1)}` : s;
}

/**
 * t=1 up vs down values share one x-position; when they are equal or close in *data* terms,
 * their pixels coincide and datalabels overlap. Stagger whenever the gap is tiny relative
 * to the plotted y-span (not only when exactly equal — callers pass y0 + both branch values).
 */
function shouldStaggerEndLabels(y0, yUp, yDown, relativeRatio = 0.07) {
  const lo = Math.min(y0, yUp, yDown);
  const hi = Math.max(y0, yUp, yDown);
  const span = hi - lo;
  const gap = Math.abs(yUp - yDown);
  if (!Number.isFinite(y0) || !Number.isFinite(yUp) || !Number.isFinite(yDown)) return false;
  if (gap < 1e-9) return true;
  if (!(span > 1e-12)) return true;
  return gap / span < relativeRatio;
}

/** Same numeric payoff at t=1 for both paths — one dot, two datasets; datalabels must not duplicate. */
function terminalValuesCoincide(yUp, yDown) {
  return Math.abs(yUp - yDown) < 1e-9;
}

/** Table-only below this width (higher than 600px EEs so t=0 datalabels don’t crowd the y-axis on mid-width screens) */
const NARROW_BREAKPOINT = 768;

function isNarrow() {
  return window.innerWidth < NARROW_BREAKPOINT;
}

function applyViewportMode() {
  const chartBtn = $('#view-chart-btn');
  const tableBtn = $('#view-table-btn');
  if (!chartBtn || !tableBtn) return;
  const helper = $('#chart-helper-text');

  if (isNarrow()) {
    chartBtn.setAttribute('aria-disabled', 'true');
    chartBtn.removeAttribute('title');
    chartBtn.setAttribute('aria-describedby', 'chart-helper-text');
    if (helper) helper.style.display = 'block';
    switchView('table');
  } else {
    chartBtn.removeAttribute('aria-disabled');
    chartBtn.removeAttribute('title');
    chartBtn.removeAttribute('aria-describedby');
    tableBtn.removeAttribute('aria-disabled');
    tableBtn.removeAttribute('title');
    if (helper) helper.style.display = 'none';
    const chartViewEl = $('#chart-view');
    if (state.optionCalculations && currentView === 'chart' && chartViewEl && chartViewEl.style.display !== 'none') {
      renderCharts(state.optionCalculations, state);
    }
  }
  updateToggleButtonStates({
    chartBtn,
    tableBtn,
    showingChart: currentView === 'chart',
    forceTable: isNarrow(),
  });
}

function init() {
  console.log('Binomial Option Pricing Calculator initializing...');
  setupInputListeners();
  setupViewToggle();
  subscribe(handleStateChange);
  updateCalculations();
  applyViewportMode();
  runSelfTests();

  if (window.MathJax && window.MathJax.Hub) {
    MathJax.Hub.Queue(["Typeset", MathJax.Hub]);
  }

  listen(window, 'resize', debounce(fitDynamicEquations, 150));
  listen(window, 'resize', debounce(applyViewportMode, 200));

  console.log('Binomial Calculator ready');
}

function setupViewToggle() {
  const chartBtn = $('#view-chart-btn');
  const tableBtn = $('#view-table-btn');

  if (chartBtn && tableBtn) {
    listen(chartBtn, 'click', () => {
      if (!isNarrow()) {
        switchView('chart');
        chartBtn.focus();
      }
    });
    listen(tableBtn, 'click', () => {
      switchView('table');
      tableBtn.focus();
    });

    listen(chartBtn, 'keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        switchView('table');
        tableBtn.focus();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!isNarrow()) switchView('chart');
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (isNarrow()) return;
        switchView('chart');
        const firstChart = $('#asset-chart');
        if (firstChart) {
          firstChart.focus();
        }
      }
    });

    listen(tableBtn, 'keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!isNarrow()) {
          switchView('chart');
          chartBtn.focus();
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        switchView('table');
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchView('table');
        // The table itself is not focusable; its region wrapper carries tabindex="0".
        const tableRegion = $('#table-container');
        if (tableRegion) tableRegion.focus();
      }
    });
  }
}

function switchView(view) {
  if (view === 'chart' && isNarrow()) return;

  const previousView = currentView;
  currentView = view;
  const chartView = $('#chart-view');
  const tableView = $('#table-view');
  const chartBtn = $('#view-chart-btn');
  const tableBtn = $('#view-table-btn');

  applyChartTableVisibility({
    chartEl: chartView,
    tableEl: tableView,
    showChart: view === 'chart',
  });
  const showingChart = view === 'chart';
  ['asset-chart', 'call-chart', 'put-chart'].forEach((id) => {
    const canvas = $(`#${id}`);
    if (canvas) canvas.tabIndex = showingChart ? 0 : -1;
  });
  const pointAnnouncement = $('#chart-point-announcement');
  if (pointAnnouncement) {
    if (showingChart) {
      pointAnnouncement.textContent = '';
      pointAnnouncement.removeAttribute('aria-hidden');
    } else {
      pointAnnouncement.setAttribute('aria-hidden', 'true');
      pointAnnouncement.textContent = '';
    }
  }
  updateToggleButtonStates({
    chartBtn,
    tableBtn,
    showingChart: view === 'chart',
    forceTable: isNarrow(),
  });

  if (view === 'chart') {
    if (previousView !== 'chart') announceView(VIEW_ANNOUNCEMENTS.chart);
    // Canvases were display:none in table view — resize after layout so charts (and page width) stay stable
    requestAnimationFrame(() => {
      [assetChart, callChart, putChart].forEach((ch) => {
        if (ch && typeof ch.resize === 'function') ch.resize();
      });
    });
  } else {
    if (state.optionCalculations) {
      renderTable(state.optionCalculations, state);
    }
    if (previousView !== 'table') announceView(VIEW_ANNOUNCEMENTS.table);
  }
}

function setupInputListeners() {
  const inputs = [
    { id: 's0', field: 's0' },
    { id: 'su', field: 'su' },
    { id: 'sd', field: 'sd' },
    { id: 'strike', field: 'strike' },
    { id: 'risk-free-rate', field: 'riskFreeRate' }
  ];

  inputs.forEach(({ id, field }) => {
    const input = $(`#${id}`);
    if (!input) return;

    const debouncedUpdate = debounce(() => {
      const value = parseFloat(input.value);
      const errors = validateAll({ ...state, [field]: value });
      updateFieldError('s0', errors.s0 || null);
      updateFieldError('su', errors.su || null);
      updateFieldError('sd', errors.sd || null);
      updateFieldError('strike', errors.strike || null);
      updateFieldError('risk-free-rate', errors.riskFreeRate || null);
      setState({ [field]: value, errors });
      updateValidationSummary(errors);
      updateCalculations();
    }, 300);

    const onInput = () => {
      clampNumericInputLength(input, NUMERIC_INPUT_MAX_CHARS);
      debouncedUpdate();
    };
    listen(input, 'input', onInput);
    listen(input, 'change', onInput);
  });
}

function updateCalculations() {
  const { s0, su, sd, strike, riskFreeRate, errors } = state;
  if (hasErrors(errors)) {
    setState({ optionCalculations: null });
    return;
  }

  try {
    const calculations = calculateOptionMetrics({ s0, su, sd, strike, riskFreeRate });
    if (!allFinite(
      calculations.C0,
      calculations.P0,
      calculations.HRc,
      calculations.HRp,
      calculations.Cu,
      calculations.Cd,
      calculations.Pu,
      calculations.Pd
    )) {
      setState({ optionCalculations: null });
      return;
    }
    setState({ optionCalculations: calculations });
  } catch (error) {
    console.error('Calculation error:', error);
    setState({ optionCalculations: null });
  }
}

// Scale down any .MathJax_Display block that is wider than its parent,
// so equations always fit without a horizontal scrollbar.
// Called after typesetting and on window resize.
function fitDynamicEquations() {
  const container = $('#dynamic-equation-container');
  if (!container) return;
  container.querySelectorAll('.MathJax_Display').forEach(function(el) {
    // Reset previous scaling so we measure the natural rendered width
    el.style.transform = '';
    el.style.marginBottom = '';
    const available = el.parentElement.clientWidth;
    const natural   = el.scrollWidth;
    if (natural > available && available > 0) {
      const scale = available / natural;
      el.style.transformOrigin = 'left top';
      el.style.transform       = `scale(${scale})`;
      // Compensate for the vertical space saved by shrinking
      el.style.marginBottom    = `-${el.offsetHeight * (1 - scale)}px`;
    }
  });
}

function announceCalculationsToScreenReader(calc) {
  const announcement = $('#sr-announcement');
  if (!announcement) return;
  announcement.textContent =
    `Updated: call ${formatCurrency(calc.C0)}, put ${formatCurrency(calc.P0)}.`;
}

function handleStateChange(newState) {
  const { optionCalculations } = newState;
  if (!optionCalculations) {
    clearCalculatedViews();
    return;
  }

  renderResults(optionCalculations, newState);
  renderDynamicEquation(optionCalculations, newState);
  if (!isNarrow()) {
    renderCharts(optionCalculations, newState);
  }
  if (currentView === 'table') {
    renderTable(optionCalculations, newState);
  }
  announceCalculationsToScreenReader(optionCalculations);
}

function clearCalculatedViews() {
  [assetChart, callChart, putChart].forEach(chart => {
    if (chart) chart.destroy();
  });
  assetChart = null;
  callChart = null;
  putChart = null;

  const results = $('#results-content');
  if (results) results.innerHTML = '';

  const equation = $('#dynamic-mathml-equation');
  if (equation) equation.innerHTML = '';

  const tableBody = $('#table-body');
  if (tableBody) tableBody.innerHTML = '';
}

function renderResults(calc, params) {
  const container = $('#results-content');
  if (!container) return;

  container.innerHTML = `
    <div class="result-box call-option">
      <h5 class="result-title call-option">Call Option Price</h5>
      <div class="result-value call-option-value">${formatCurrency(calc.C0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at 𝑡 = 0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #4b5563;">
        <div>Hedge Ratio: ${formatWithUnicodeMinus(calc.HRc, 4)}</div>
        <div style="margin-top: 0.25rem;">Payoffs: Up ${formatCurrency(calc.Cu)}, Down ${formatCurrency(calc.Cd)}</div>
      </div>
    </div>

    <div class="result-box put-option">
      <h5 class="result-title put-option">Put Option Price</h5>
      <div class="result-value put-option-value">${formatCurrency(calc.P0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at 𝑡 = 0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #4b5563;">
        <div>Hedge Ratio: ${formatWithUnicodeMinus(calc.HRp, 4)}</div>
        <div style="margin-top: 0.25rem;">Payoffs: Up ${formatCurrency(calc.Pu)}, Down ${formatCurrency(calc.Pd)}</div>
      </div>
    </div>
  `;
}

// Dynamic equations — full colour coding applied:
//   S0     → neutral (S0 is distinct from the up-state)
//   Su     → green
//   Sd     → red
//   c0, HRc, Cu, Cd, C0 → blue
//   p0, HRp, Pu, Pd, P0 → purple
function renderDynamicEquation(calc, params) {
  const container = $('#dynamic-mathml-equation');
  if (!container) return;

  const r = params.riskFreeRate / 100;
  const onePlusR = (1 + r).toFixed(4);
  const { up, down, call: cl, put: pu } = COLOR;

  const num = (value, color) => `<mn${color ? ` mathcolor="${color}"` : ''}>${value}</mn>`;
  const hedgeRatio = (suffix, payoffUp, payoffDown, result, color) =>
    `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
      <mrow>
        <msub><mtext mathcolor="${color}">HR</mtext><mi mathcolor="${color}">${suffix}</mi></msub>
        <mo>=</mo>
        <mfrac>
          <mrow>${num(payoffUp, color)}<mo>&#x2212;</mo>${num(payoffDown, color)}</mrow>
          <mrow>${num(params.su.toFixed(2), up)}<mo>&#x2212;</mo>${num(params.sd.toFixed(2), down)}</mrow>
        </mfrac>
        <mo>=</mo>${num(result, color)}
      </mrow>
    </math>`;
  const optionPrice = (symbol, hedge, payoffUp, result, color) =>
    `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
      <mrow>
        <msub><mi mathcolor="${color}">${symbol}</mi><mn mathcolor="${color}">0</mn></msub>
        <mo>=</mo>
        ${num(params.s0.toFixed(2))}
        <mo>&#x00D7;</mo>${num(hedge, color)}
        <mo>&#x2212;</mo>
        <mfrac>
          <mrow>
            ${num(hedge, color)}<mo>&#x00D7;</mo>${num(params.su.toFixed(2), up)}
            <mo>&#x2212;</mo>${num(payoffUp, color)}
          </mrow>
          ${num(onePlusR)}
        </mfrac>
        <mo>=</mo>${num(result, color)}
      </mrow>
    </math>`;

  const content = `
    <div style="margin-bottom: 1.5rem;">
      <div style="font-weight: 400; margin-bottom: 0.5rem;">Call Hedge Ratio:</div>
      <div style="margin-left: 1rem;">${hedgeRatio('C', calc.Cu.toFixed(2), calc.Cd.toFixed(2), calc.HRc.toFixed(4), cl)}</div>
    </div>

    <div style="margin-bottom: 1.5rem;">
      <div style="font-weight: 400; margin-bottom: 0.5rem;">Call Option Price:</div>
      <div style="margin-left: 1rem;">${optionPrice('c', calc.HRc.toFixed(4), calc.Cu.toFixed(2), calc.C0.toFixed(2), cl)}</div>
    </div>

    <div style="margin-bottom: 1.5rem;">
      <div style="font-weight: 400; margin-bottom: 0.5rem;">Put Hedge Ratio:</div>
      <div style="margin-left: 1rem;">${hedgeRatio('P', calc.Pu.toFixed(2), calc.Pd.toFixed(2), calc.HRp.toFixed(4), pu)}</div>
    </div>

    <div style="margin-bottom: 0.5rem;">
      <div style="font-weight: 400; margin-bottom: 0.5rem;">Put Option Price:</div>
      <div style="margin-left: 1rem;">${optionPrice('p', calc.HRp.toFixed(4), calc.Pu.toFixed(2), calc.P0.toFixed(2), pu)}</div>
    </div>
  `;

  // The shared mount holds the card's height and hides the raw MathML while
  // MathJax typesets, so the cards below stay put.
  renderEquation(container, content, {
    onTypeset: () => {
      fitDynamicEquations();
      // Label the equation region, not the card: the card is named by its
      // heading via aria-labelledby, which wins over aria-label and would
      // silently swallow the results.
      const region = $('#dynamic-equation-container');
      if (region) {
        region.setAttribute('aria-label',
          `Binomial Option Pricing Equations. ` +
          `Call hedge ratio: ${calc.HRc.toFixed(4)}. ` +
          `Call option price: ${formatCurrencySpeech(calc.C0)}. ` +
          `Put hedge ratio: ${calc.HRp.toFixed(4)}. ` +
          `Put option price: ${formatCurrencySpeech(calc.P0)}.`
        );
      }
    },
  });
}

// Must match the Value column header in index.html exactly.
const VALUE_COLUMN_LABEL = 'Value (USD / %)';

// Table-safe colours are darker than the chart fills so they retain AA
// contrast on both white and striped rows.
function renderTable(calc, params) {
  const tbody = $('#table-body');
  if (!tbody) return;

  // data-label mirrors the Value column header: it becomes the visible label
  // once the shared base reflows each row into a card below 768px. The metric
  // row headers already read as titles, so they need no label of their own.
  tbody.innerHTML = `
    <tr>
      <th scope="row">Asset Price (<i>S</i><sub>0</sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value">${params.s0.toFixed(2)}</span></td>
    </tr>
    <tr>
      <th scope="row" class="table-var-5">Up-State Price (<i>S</i><sub>u</sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-5">${params.su.toFixed(2)}</span></td>
    </tr>
    <tr>
      <th scope="row" class="table-var-red">Down-State Price (<i>S</i><sub>d</sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-red">${params.sd.toFixed(2)}</span></td>
    </tr>
    <tr>
      <th scope="row">Strike Price (<i>K</i>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value">${params.strike.toFixed(2)}</span></td>
    </tr>
    <tr>
      <th scope="row">Risk-Free Rate (<i>r</i>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value">${params.riskFreeRate.toFixed(2)}%</span></td>
    </tr>
    <tr class="table-section-start">
      <th scope="row" class="table-var-2">Call Option Price (<i>C</i><sub>0</sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-2"><strong>${calc.C0.toFixed(2)}</strong></span></td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-2">Call Hedge Ratio (HR<sub><i>C</i></sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-2">${formatWithUnicodeMinus(calc.HRc, 4)}</span></td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-2">Call up payoff (<i>C</i><sub>u</sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-2">${calc.Cu.toFixed(2)}</span></td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-2">Call down payoff (<i>C</i><sub>d</sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-2">${calc.Cd.toFixed(2)}</span></td>
    </tr>
    <tr class="table-section-start">
      <th scope="row" class="table-var-3">Put Option Price (<i>P</i><sub>0</sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-3"><strong>${calc.P0.toFixed(2)}</strong></span></td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-3">Put Hedge Ratio (HR<sub><i>P</i></sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-3">${formatWithUnicodeMinus(calc.HRp, 4)}</span></td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-3">Put up payoff (<i>P</i><sub>u</sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-3">${calc.Pu.toFixed(2)}</span></td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-3">Put down payoff (<i>P</i><sub>d</sub>)</th>
      <td data-label="${VALUE_COLUMN_LABEL}"><span class="cell-value table-var-3">${calc.Pd.toFixed(2)}</span></td>
    </tr>
  `;

  applyTableRoles($('#binomial-table'));
}

function renderCharts(calc, params) {
  const t = getChartTypography('curriculum');
  CHART_FONT.family = t.font.family;
  CHART_FONT.size = t.font.size;
  CHART_FONT.weight = t.font.weight;
  renderAssetChart(calc, params);
  renderCallChart(calc, params);
  renderPutChart(calc, params);
  setupTreeKeyboardNavigation();
}

function setupTreeKeyboardNavigation() {
  const configs = [
    {
      id: 'asset-chart',
      chart: () => assetChart,
      name: 'Asset price tree',
      values: () => [state.s0, state.su, state.sd],
      variables: ['S 0', 'S u', 'S d']
    },
    {
      id: 'call-chart',
      chart: () => callChart,
      name: 'Call option value tree',
      values: () => [state.optionCalculations?.C0, state.optionCalculations?.Cu, state.optionCalculations?.Cd],
      variables: ['C 0', 'C u', 'C d']
    },
    {
      id: 'put-chart',
      chart: () => putChart,
      name: 'Put option value tree',
      values: () => [state.optionCalculations?.P0, state.optionCalculations?.Pu, state.optionCalculations?.Pd],
      variables: ['P 0', 'P u', 'P d']
    }
  ];

  configs.forEach((config) => {
    const canvas = $(`#${config.id}`);
    if (!canvas) return;
    if (canvas._treeKeydown) canvas.removeEventListener('keydown', canvas._treeKeydown);
    if (canvas._treeFocus) canvas.removeEventListener('focus', canvas._treeFocus);
    if (canvas._treeBlur) canvas.removeEventListener('blur', canvas._treeBlur);

    const announce = () => {
      const index = treeFocusIndices.get(config.id) || 0;
      const value = config.values()[index];
      const stop = index === 0 ? 't equals 0, root' : `t equals 1, ${index === 1 ? 'up' : 'down'} state`;
      const region = $('#chart-point-announcement');
      if (region && Number.isFinite(value)) {
        region.textContent = `${config.name}. ${stop}, ${config.variables[index]} equals ${formatCurrencySpeech(value)}.`;
      }
      const chart = config.chart();
      if (!chart) return;
      const active = index === 0
        ? [{ datasetIndex: 0, index: 0 }]
        : [{ datasetIndex: index === 1 ? 0 : 1, index: 1 }];
      const point = chart.getDatasetMeta(active[0].datasetIndex).data[active[0].index];
      if (point) {
        chart.tooltip.setActiveElements(active, { x: point.x, y: point.y });
        chart.update('none');
      }
    };

    canvas._treeKeydown = (event) => {
      let index = treeFocusIndices.get(config.id) || 0;
      if (event.key === 'ArrowRight') index = Math.min(index + 1, 2);
      else if (event.key === 'ArrowLeft') index = Math.max(index - 1, 0);
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = 2;
      else return;
      event.preventDefault();
      treeFocusIndices.set(config.id, index);
      announce();
    };
    canvas._treeFocus = () => {
      treeFocusIndices.set(config.id, 0);
      announce();
    };
    canvas._treeBlur = () => {
      const chart = config.chart();
      if (chart) {
        chart.tooltip.setActiveElements([], { x: 0, y: 0 });
        chart.update('none');
      }
    };
    canvas.addEventListener('keydown', canvas._treeKeydown);
    canvas.addEventListener('focus', canvas._treeFocus);
    canvas.addEventListener('blur', canvas._treeBlur);
  });
}

// Asset price chart.
// Label colours: S0 → neutral, Su → green, Sd → red.
// The t=0 point is shared by both datasets; suppress the duplicate label
// from the second dataset (datasetIndex 1) by returning null.
function renderAssetChart(calc, params) {
  const canvas = $('#asset-chart');
  if (!canvas) return;

  if (assetChart) assetChart.destroy();

  const assetLabelColor = function(context) {
    if (context.dataIndex === 0) return COLOR.neutral;
    const last = context.chart.data.labels.length - 1;
    if (context.dataIndex === last && terminalValuesCoincide(params.su, params.sd)) {
      return COLOR.neutral;
    }
    return context.dataset.borderColor; // green for up, red for down
  };

  assetChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: ['\u{1D461} = 0', '\u{1D461} = 1'],
      datasets: [
        {
          label: 'Up path',
          data: [params.s0, params.su],
          borderColor: COLOR.up,
          backgroundColor: COLOR.up,
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Down path',
          data: [params.s0, params.sd],
          borderColor: COLOR.down,
          backgroundColor: COLOR.down,
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: getChartOptions(
      'Asset price (USD)', 'USD', false,
      function(value, context) {
        const { dataIndex, datasetIndex } = context;
        if (dataIndex === 0) {
          if (datasetIndex === 1) return null; // suppress duplicate S0 label
          return `${ITALIC.S}${SUB[0]} = ${formatChartValue(value)}`;
        }
        if (terminalValuesCoincide(params.su, params.sd)) {
          if (datasetIndex === 1) return null;
          return `Up / Down path = ${formatChartValue(value)}`;
        }
        return datasetIndex === 0
          ? `Up path = ${formatChartValue(value)}`
          : `Down path = ${formatChartValue(value)}`;
      },
      false,
      assetLabelColor,
      shouldStaggerEndLabels(params.s0, params.su, params.sd) && !terminalValuesCoincide(params.su, params.sd)
    )
  });
}

// Call option chart.
// All labels → call blue, regardless of up/down direction.
function renderCallChart(calc, params) {
  const canvas = $('#call-chart');
  if (!canvas) return;

  if (callChart) callChart.destroy();

  callChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: ['\u{1D461} = 0', '\u{1D461} = 1'],
      datasets: [
        {
          label: 'Up path',
          data: [calc.C0, calc.Cu],
          borderColor: COLOR.up,
          backgroundColor: COLOR.up,
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Down path',
          data: [calc.C0, calc.Cd],
          borderColor: COLOR.down,
          backgroundColor: COLOR.down,
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: getChartOptions(
      'Call option value (USD)', 'USD', false,
      function(value, context) {
        const { dataIndex, datasetIndex } = context;
        if (dataIndex === 0) {
          if (datasetIndex === 1) return null; // suppress duplicate C0 label
          return `${ITALIC.C}${SUB[0]} = ${formatChartValue(value)}`;
        }
        if (terminalValuesCoincide(calc.Cu, calc.Cd)) {
          if (datasetIndex === 1) return null;
          return `Up / Down path = ${formatChartValue(value)}`;
        }
        return datasetIndex === 0
          ? `Up path = ${formatChartValue(value)}`
          : `Down path = ${formatChartValue(value)}`;
      },
      false,
      (ctx) => {
        if (ctx.dataIndex === 0) return COLOR.call;
        const last = ctx.chart.data.labels.length - 1;
        if (ctx.dataIndex === last && terminalValuesCoincide(calc.Cu, calc.Cd)) return COLOR.call;
        return ctx.datasetIndex === 0 ? COLOR.up : COLOR.down;
      },
      shouldStaggerEndLabels(calc.C0, calc.Cu, calc.Cd) && !terminalValuesCoincide(calc.Cu, calc.Cd)
    )
  });
}

// Put option chart.
// Y-axis inverted so the down-state payoff (higher value) sits visually lower,
// matching the binomial tree convention in the reading material (p. 173):
// the green up-path line goes visually upward to Pu=0,
// and the red down-path line goes visually downward to Pd=18.
// All labels → put purple.
function renderPutChart(calc, params) {
  const canvas = $('#put-chart');
  if (!canvas) return;

  if (putChart) putChart.destroy();

  putChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: ['\u{1D461} = 0', '\u{1D461} = 1'],
      datasets: [
        {
          label: 'Up path',
          data: [calc.P0, calc.Pu],
          borderColor: COLOR.up,
          backgroundColor: COLOR.up,
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Down path',
          data: [calc.P0, calc.Pd],
          borderColor: COLOR.down,
          backgroundColor: COLOR.down,
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: getChartOptions(
      'Put option value (USD)', 'USD', false,
      function(value, context) {
        const { dataIndex, datasetIndex } = context;
        if (dataIndex === 0) {
          if (datasetIndex === 1) return null; // suppress duplicate P0 label
          return `${ITALIC.P}${SUB[0]} = ${formatChartValue(value)}`;
        }
        if (terminalValuesCoincide(calc.Pu, calc.Pd)) {
          if (datasetIndex === 1) return null;
          return `Up / Down path = ${formatChartValue(value)}`;
        }
        return datasetIndex === 0
          ? `Up path = ${formatChartValue(value)}`
          : `Down path = ${formatChartValue(value)}`;
      },
      true,            // invertYAxis — down payoff appears visually lower
      (ctx) => {
        if (ctx.dataIndex === 0) return COLOR.put;
        const last = ctx.chart.data.labels.length - 1;
        if (ctx.dataIndex === last && terminalValuesCoincide(calc.Pu, calc.Pd)) return COLOR.put;
        return ctx.datasetIndex === 0 ? COLOR.up : COLOR.down;
      },
      shouldStaggerEndLabels(calc.P0, calc.Pu, calc.Pd) && !terminalValuesCoincide(calc.Pu, calc.Pd)
    )
  });
}

// Shared chart options builder.
// labelColorFn: optional function(context) → colour string for datalabel text + pill border.
//               If null, defaults to neutral for t=0, dataset borderColor for t=1.
// staggerEndLabels: when true, separate overlapping t=1 labels (same value on both paths).
function getChartOptions(yLabel, prefix = '', hideYAxis = false, customLabelFormatter = null, invertYAxis = false, labelColorFn = null, staggerEndLabels = false) {
  const defaultLabelColor = function(context) {
    return context.dataIndex === 0 ? COLOR.neutral : context.dataset.borderColor;
  };
  const resolvedLabelColor = labelColorFn || defaultLabelColor;

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { duration: 0 } : undefined,
    layout: {
      padding: { top: 44, right: 100, bottom: 28, left: 88 }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label}: ${prefix}${context.parsed.y.toFixed(2)}`
        }
      },
      datalabels: {
        display: true,
        // Colour the datalabel text and pill border using the resolved colour function.
        // Asset: neutral at t=0, green/red at t=1. Call/put: option colour at t=0; path colour at t=1 (matches lines).
        color: resolvedLabelColor,
        font: {
          weight: CHART_FONT.weight,
          size: CHART_FONT.size,
          // No style: 'italic' here — italic is conveyed by the Unicode
          // math-italic letter in the label string itself (e.g. 𝑆, 𝐶, 𝑃),
          // keeping the number/equals/subscript portions upright.
          family: CHART_FONT.family
        },
        backgroundColor: () => 'rgba(255, 255, 255, 0.9)',
        borderColor: resolvedLabelColor,
        borderWidth: 2,
        borderRadius: 4,
        padding: 6,
        formatter: customLabelFormatter || function(value) {
          return value.toFixed(2);
        },
        anchor: function(context) {
          const last = context.chart.data.labels.length - 1;
          // Overlapping t=1 points: pin to the marker centre so labels are not pulled to one side.
          if (staggerEndLabels && context.dataIndex === last) return 'center';
          return 'center';
        },
        align: function(context) {
          const n = context.chart.data.labels.length;
          const last = n - 1;
          if (staggerEndLabels && context.dataIndex === last) {
            return 'center';
          }
          const index = context.dataIndex;
          // t=0 is on the plot’s left — "left" align shoves labels outside the chart; use "right" into the plot.
          if (index === 0) return 'right';
          if (index === last) return 'right';
          return 'center';
        },
        offset: function(context) {
          const n = context.chart.data.labels.length;
          const last = n - 1;
          const base = 15;
          if (staggerEndLabels && context.dataIndex === last) {
            // Pure vertical separation in px (+y is down). No horizontal shift.
            const bump = 22;
            return {
              x: 0,
              y: context.datasetIndex === 0 ? -bump : bump
            };
          }
          return base;
        },
        clamp: false
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#374151',
          // No style: 'italic' — the Unicode italic t (\u{1D461}) in the
          // label string handles the italic appearance without italicising
          // the numerals, equals sign, and spaces.
          font: CHART_FONT
        },
        grid: { color: '#e5e7eb', offset: true },
        offset: true
      },
      y: {
        display: !hideYAxis,
        reverse: invertYAxis,
        title: {
          display: !hideYAxis,
          text: yLabel,
          color: '#374151',
          font: CHART_FONT
        },
        ticks: {
          display: !hideYAxis,
          callback: (v) => v.toFixed(2),
          color: '#374151',
          font: CHART_FONT
        },
        grid: { color: '#e5e7eb' }
      }
    }
  };
}

function logSelfTest(name, passed, detail) {
  if (passed) console.log(`✓ ${name}`);
  else console.warn(`✗ ${name}${detail ? ': ' + detail : ''}`);
}

function runSelfTests() {
  console.log('Running self-tests...');
  const result = calculateOptionMetrics({ s0: 40, su: 56, sd: 32, strike: 50, riskFreeRate: 5 });
  logSelfTest('Defaults → call ≈ 2.38', Math.abs(result.C0 - 2.38) <= 0.1, `got ${result.C0}`);
  logSelfTest('Defaults → put ≈ 10.00', Math.abs(result.P0 - 10) <= 0.1, `got ${result.P0}`);
  logSelfTest('Valid outputs are finite', Number.isFinite(result.C0) && Number.isFinite(result.P0) && Number.isFinite(result.p));

  const empty = validateAll({ s0: NaN, su: 56, sd: 32, strike: 50, riskFreeRate: 5 });
  logSelfTest('Empty current price is required', Boolean(empty.s0));

  const tree = validateAll({ s0: 40, su: 30, sd: 32, strike: 50, riskFreeRate: 5 });
  logSelfTest('Up-state must exceed down-state', Boolean(tree.su));

  const pOut = validateAll({ s0: 40, su: 56, sd: 32, strike: 50, riskFreeRate: 100 });
  logSelfTest('Rate that puts p outside [0, 1] is rejected', Boolean(pOut.riskFreeRate));

  console.log('Self-tests complete');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { state, setState, updateCalculations };