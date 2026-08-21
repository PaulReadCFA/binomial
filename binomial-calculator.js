import { state, setState, subscribe } from './binomial-modules/state.js';
import { calculateOptionMetrics } from './binomial-modules/calculations.js';
import { validateField, validateAll, updateFieldError, updateValidationSummary, hasErrors } from './binomial-modules/validation.js';
import {
  $,
  listen,
  debounce,
  formatCurrency,
  formatPercentage,
  formatWithUnicodeMinus,
  clampNumericInputLength,
  NUMERIC_INPUT_MAX_CHARS,
  announceToScreenReader
} from './binomial-modules/utils.js';
import { getChartTypography } from './chart-typography.js';

// Register Chart.js datalabels plugin
Chart.register(ChartDataLabels);

let assetChart, callChart, putChart;
let currentView = 'chart';

// Detect reduced-motion preference once at startup
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    chartBtn.disabled = true;
    chartBtn.setAttribute('aria-disabled', 'true');
    chartBtn.removeAttribute('title');
    chartBtn.setAttribute('aria-describedby', 'chart-helper-text');
    if (helper) helper.style.display = 'block';
    switchView('table');
  } else {
    chartBtn.disabled = false;
    chartBtn.removeAttribute('aria-disabled');
    chartBtn.removeAttribute('title');
    chartBtn.removeAttribute('aria-describedby');
    tableBtn.disabled = false;
    tableBtn.removeAttribute('aria-disabled');
    tableBtn.removeAttribute('title');
    if (helper) helper.style.display = 'none';
    const chartViewEl = $('#chart-view');
    if (state.optionCalculations && currentView === 'chart' && chartViewEl && chartViewEl.style.display !== 'none') {
      renderCharts(state.optionCalculations, state);
    }
  }
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

    listen(tableBtn, 'focus', () => {
      if (document.activeElement === tableBtn && currentView === 'chart') {
        switchView('table');
      }
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
          const container = firstChart.closest('.binomial-chart-container');
          if (container) container.focus();
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
        const table = $('#binomial-table');
        if (table) table.focus();
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

  if (view === 'chart') {
    if (chartView) chartView.style.display = 'block';
    if (tableView) tableView.style.display = 'none';
    if (chartBtn) { chartBtn.classList.add('active'); chartBtn.setAttribute('aria-pressed', 'true'); }
    if (tableBtn) { tableBtn.classList.remove('active'); tableBtn.setAttribute('aria-pressed', 'false'); }
    if (previousView !== 'chart') announceToScreenReader('Chart view active');
    // Canvases were display:none in table view — resize after layout so charts (and page width) stay stable
    requestAnimationFrame(() => {
      [assetChart, callChart, putChart].forEach((ch) => {
        if (ch && typeof ch.resize === 'function') ch.resize();
      });
    });
  } else {
    if (chartView) chartView.style.display = 'none';
    if (tableView) tableView.style.display = 'block';
    if (chartBtn) { chartBtn.classList.remove('active'); chartBtn.setAttribute('aria-pressed', 'false'); }
    if (tableBtn) { tableBtn.classList.add('active'); tableBtn.setAttribute('aria-pressed', 'true'); }
    if (state.optionCalculations) {
      renderTable(state.optionCalculations, state);
    }
    if (previousView !== 'table') announceToScreenReader('Table view active');
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
      const error = validateField(field, value);
      updateFieldError(id, error);
      const errors = validateAll({ ...state, [field]: value });
      setState({ [field]: value, errors });
      updateValidationSummary(errors);
      if (!hasErrors(errors)) { updateCalculations(); }
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
  if (!optionCalculations) return;

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

function renderResults(calc, params) {
  const container = $('#results-content');
  if (!container) return;

  container.innerHTML = `
    <div class="result-box call-option">
      <h5 class="result-title call-option">Call Option Price</h5>
      <div class="result-value" style="color: ${COLOR.call};">${formatCurrency(calc.C0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at <i>t</i> = 0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #4b5563;">
        <div>Hedge Ratio: ${formatWithUnicodeMinus(calc.HRc, 4)}</div>
        <div style="margin-top: 0.25rem;">Payoffs: Up ${formatCurrency(calc.Cu)}, Down ${formatCurrency(calc.Cd)}</div>
      </div>
    </div>

    <div class="result-box put-option">
      <h5 class="result-title put-option">Put Option Price</h5>
      <div class="result-value" style="color: ${COLOR.put};">${formatCurrency(calc.P0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at <i>t</i> = 0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #4b5563;">
        <div>Hedge Ratio: ${formatWithUnicodeMinus(calc.HRp, 4)}</div>
        <div style="margin-top: 0.25rem;">Payoffs: Up ${formatCurrency(calc.Pu)}, Down ${formatCurrency(calc.Pd)}</div>
      </div>
    </div>
  `;
}

// Dynamic equations — full colour coding applied:
//   S0     → neutral (no \color; S0 is distinct from the up-state)
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

  const content = `
    <div style="margin-bottom: 1.5rem;">
      <div style="font-weight: 400; margin-bottom: 0.5rem;">Call Hedge Ratio:</div>
      <p style="margin-left: 1rem;">$$\\color{${cl}}{\\text{HR}_{C}} = \\frac{\\color{${cl}}{${calc.Cu.toFixed(2)}} - \\color{${cl}}{${calc.Cd.toFixed(2)}}}{\\color{${up}}{${params.su.toFixed(2)}} - \\color{${down}}{${params.sd.toFixed(2)}}} = \\color{${cl}}{${calc.HRc.toFixed(4)}}$$</p>
    </div>

    <div style="margin-bottom: 1.5rem;">
      <div style="font-weight: 400; margin-bottom: 0.5rem;">Call Option Price:</div>
      <p style="margin-left: 1rem;">$$\\color{${cl}}{c_0} = ${params.s0.toFixed(2)} \\times \\color{${cl}}{${calc.HRc.toFixed(4)}} - \\frac{\\color{${cl}}{${calc.HRc.toFixed(4)}} \\times \\color{${up}}{${params.su.toFixed(2)}} - \\color{${cl}}{${calc.Cu.toFixed(2)}}}{${onePlusR}} = \\color{${cl}}{${calc.C0.toFixed(2)}}$$</p>
    </div>

    <div style="margin-bottom: 1.5rem;">
      <div style="font-weight: 400; margin-bottom: 0.5rem;">Put Hedge Ratio:</div>
      <p style="margin-left: 1rem;">$$\\color{${pu}}{\\text{HR}_{P}} = \\frac{\\color{${pu}}{${calc.Pu.toFixed(2)}} - \\color{${pu}}{${calc.Pd.toFixed(2)}}}{\\color{${up}}{${params.su.toFixed(2)}} - \\color{${down}}{${params.sd.toFixed(2)}}} = \\color{${pu}}{${calc.HRp.toFixed(4)}}$$</p>
    </div>

    <div style="margin-bottom: 0.5rem;">
      <div style="font-weight: 400; margin-bottom: 0.5rem;">Put Option Price:</div>
      <p style="margin-left: 1rem;">$$\\color{${pu}}{p_0} = ${params.s0.toFixed(2)} \\times \\color{${pu}}{${calc.HRp.toFixed(4)}} - \\frac{\\color{${pu}}{${calc.HRp.toFixed(4)}} \\times \\color{${up}}{${params.su.toFixed(2)}} - \\color{${pu}}{${calc.Pu.toFixed(2)}}}{${onePlusR}} = \\color{${pu}}{${calc.P0.toFixed(2)}}$$</p>
    </div>
  `;

  container.style.visibility = 'hidden';
  container.innerHTML = content;

  if (window.MathJax && window.MathJax.Hub) {
    MathJax.Hub.Queue(["Typeset", MathJax.Hub, container]);
    MathJax.Hub.Queue(function() {
      fitDynamicEquations();
      container.style.visibility = 'visible';
      // Update the section's aria-label so SR users hear the results
      // immediately when they tab to the section — no input change needed.
      const section = $('#equation-card');
      if (section) {
        section.setAttribute('aria-label',
          `Binomial Option Pricing Equations. ` +
          `Call hedge ratio: ${calc.HRc.toFixed(4)}. ` +
          `Call option price: ${formatCurrency(calc.C0)}. ` +
          `Put hedge ratio: ${calc.HRp.toFixed(4)}. ` +
          `Put option price: ${formatCurrency(calc.P0)}.`
        );
      }
    });
  }
}

// Table-safe colours are darker than the chart fills so they retain AA
// contrast on both white and striped rows.
function renderTable(calc, params) {
  const tbody = $('#table-body');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <th scope="row">Asset Price (<i>S</i><sub>0</sub>)</th>
      <td>${params.s0.toFixed(2)}</td>
    </tr>
    <tr>
      <th scope="row" class="table-var-5">Up-State Price (<i>S</i><sub>u</sub>)</th>
      <td class="table-var-5">${params.su.toFixed(2)}</td>
    </tr>
    <tr>
      <th scope="row" class="table-var-red">Down-State Price (<i>S</i><sub>d</sub>)</th>
      <td class="table-var-red">${params.sd.toFixed(2)}</td>
    </tr>
    <tr>
      <th scope="row">Strike Price (<i>K</i>)</th>
      <td>${params.strike.toFixed(2)}</td>
    </tr>
    <tr>
      <th scope="row">Risk-Free Rate (<i>r</i>)</th>
      <td>${params.riskFreeRate.toFixed(2)}%</td>
    </tr>
    <tr class="table-section-start">
      <th scope="row" class="table-var-2">Call Option Price (<i>C</i><sub>0</sub>)</th>
      <td class="table-var-2"><strong>${calc.C0.toFixed(2)}</strong></td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-2">Call Hedge Ratio (HR<sub><i>C</i></sub>)</th>
      <td class="table-var-2">${formatWithUnicodeMinus(calc.HRc, 4)}</td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-2">Call up payoff (<i>C</i><sub>u</sub>)</th>
      <td class="table-var-2">${calc.Cu.toFixed(2)}</td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-2">Call down payoff (<i>C</i><sub>d</sub>)</th>
      <td class="table-var-2">${calc.Cd.toFixed(2)}</td>
    </tr>
    <tr class="table-section-start">
      <th scope="row" class="table-var-3">Put Option Price (<i>P</i><sub>0</sub>)</th>
      <td class="table-var-3"><strong>${calc.P0.toFixed(2)}</strong></td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-3">Put Hedge Ratio (HR<sub><i>P</i></sub>)</th>
      <td class="table-var-3">${formatWithUnicodeMinus(calc.HRp, 4)}</td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-3">Put up payoff (<i>P</i><sub>u</sub>)</th>
      <td class="table-var-3">${calc.Pu.toFixed(2)}</td>
    </tr>
    <tr>
      <th scope="row" class="table-submetric table-var-3">Put down payoff (<i>P</i><sub>d</sub>)</th>
      <td class="table-var-3">${calc.Pd.toFixed(2)}</td>
    </tr>
  `;
}

function renderCharts(calc, params) {
  const t = getChartTypography('curriculum');
  CHART_FONT.family = t.font.family;
  CHART_FONT.size = t.font.size;
  CHART_FONT.weight = t.font.weight;
  renderAssetChart(calc, params);
  renderCallChart(calc, params);
  renderPutChart(calc, params);
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
    animation: prefersReducedMotion ? { duration: 0 } : undefined,
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

function runSelfTests() {
  console.log('Running self-tests...');
  const tests = [
    {
      name: 'Binomial option pricing',
      inputs: { s0: 40, su: 56, sd: 32, strike: 50, riskFreeRate: 5 },
      expected: { callApprox: 4.19, putApprox: 11.43 }
    }
  ];

  tests.forEach(test => {
    try {
      const result = calculateOptionMetrics(test.inputs);
      let passed = true;
      if (test.expected.callApprox && Math.abs(result.C0 - test.expected.callApprox) > 0.1) passed = false;
      if (test.expected.putApprox  && Math.abs(result.P0 - test.expected.putApprox)  > 0.1) passed = false;
      console.log(`${passed ? '\u2713' : '\u2717'} ${test.name} ${passed ? 'passed' : 'failed'}`);
    } catch (error) {
      console.error(`\u2717 ${test.name} threw error:`, error);
    }
  });
  console.log('Self-tests complete');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { state, setState, updateCalculations };