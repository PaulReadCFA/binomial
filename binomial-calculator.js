import { state, setState, subscribe } from './binomial-modules/state.js';
import { calculateOptionMetrics } from './binomial-modules/calculations.js';
import { validateField, validateAll, updateFieldError, updateValidationSummary, hasErrors } from './binomial-modules/validation.js';
import { $, listen, debounce, formatCurrency, formatPercentage } from './binomial-modules/utils.js';

// Register Chart.js datalabels plugin
Chart.register(ChartDataLabels);

let assetChart, callChart, putChart;
let currentView = 'chart';

// Detect reduced-motion preference once at startup
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// System font stack for chart fonts
const CHART_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif";

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
  '0': '\u2080',  // ₀
  u:   '\u1D64'   // ᵤ  (no Unicode subscript d — use plain 'd')
};

function init() {
  console.log('Binomial Option Pricing Calculator initializing...');
  setupInputListeners();
  setupViewToggle();
  subscribe(handleStateChange);
  updateCalculations();
  runSelfTests();

  if (window.MathJax && window.MathJax.Hub) {
    MathJax.Hub.Queue(["Typeset", MathJax.Hub]);
  }

  listen(window, 'resize', debounce(fitDynamicEquations, 150));

  console.log('Binomial Calculator ready');
}

function setupViewToggle() {
  const chartBtn = $('#view-chart-btn');
  const tableBtn = $('#view-table-btn');

  if (chartBtn && tableBtn) {
    listen(chartBtn, 'click', () => switchView('chart'));
    listen(tableBtn, 'click', () => switchView('table'));

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
        switchView('chart');
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
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
        switchView('chart');
        chartBtn.focus();
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
  } else {
    if (chartView) chartView.style.display = 'none';
    if (tableView) tableView.style.display = 'block';
    if (chartBtn) { chartBtn.classList.remove('active'); chartBtn.setAttribute('aria-pressed', 'false'); }
    if (tableBtn) { tableBtn.classList.add('active'); tableBtn.setAttribute('aria-pressed', 'true'); }
    if (state.optionCalculations) {
      renderTable(state.optionCalculations, state);
    }
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

    listen(input, 'input', debouncedUpdate);
    listen(input, 'change', debouncedUpdate);
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
  renderCharts(optionCalculations, newState);
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
        Fair value at <i>t</i>=0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #4b5563;">
        <div>Hedge Ratio: ${calc.HRc.toFixed(4)}</div>
        <div style="margin-top: 0.25rem;">Payoffs: Up ${formatCurrency(calc.Cu)}, Down ${formatCurrency(calc.Cd)}</div>
      </div>
    </div>

    <div class="result-box put-option">
      <h5 class="result-title put-option">Put Option Price</h5>
      <div class="result-value" style="color: ${COLOR.put};">${formatCurrency(calc.P0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at <i>t</i>=0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #4b5563;">
        <div>Hedge Ratio: ${calc.HRp.toFixed(4)}</div>
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
      <div style="font-weight: 600; margin-bottom: 0.5rem; color: ${cl};">Call Hedge Ratio:</div>
      <p style="margin-left: 1rem;">$$\\color{${cl}}{\\text{HR}_{C}} = \\frac{\\color{${cl}}{${calc.Cu.toFixed(2)}} - \\color{${cl}}{${calc.Cd.toFixed(2)}}}{\\color{${up}}{${params.su.toFixed(2)}} - \\color{${down}}{${params.sd.toFixed(2)}}} = \\color{${cl}}{${calc.HRc.toFixed(4)}}$$</p>
    </div>

    <div style="margin-bottom: 1.5rem;">
      <div style="font-weight: 600; margin-bottom: 0.5rem; color: ${cl};">Call Option Price:</div>
      <p style="margin-left: 1rem;">$$\\color{${cl}}{c_0} = ${params.s0.toFixed(2)} \\times \\color{${cl}}{${calc.HRc.toFixed(4)}} - \\frac{\\color{${cl}}{${calc.HRc.toFixed(4)}} \\times \\color{${up}}{${params.su.toFixed(2)}} - \\color{${cl}}{${calc.Cu.toFixed(2)}}}{${onePlusR}} = \\color{${cl}}{${calc.C0.toFixed(2)}}$$</p>
    </div>

    <div style="margin-bottom: 1.5rem;">
      <div style="font-weight: 600; margin-bottom: 0.5rem; color: ${pu};">Put Hedge Ratio:</div>
      <p style="margin-left: 1rem;">$$\\color{${pu}}{\\text{HR}_{P}} = \\frac{\\color{${pu}}{${calc.Pu.toFixed(2)}} - \\color{${pu}}{${calc.Pd.toFixed(2)}}}{\\color{${up}}{${params.su.toFixed(2)}} - \\color{${down}}{${params.sd.toFixed(2)}}} = \\color{${pu}}{${calc.HRp.toFixed(4)}}$$</p>
    </div>

    <div style="margin-bottom: 0.5rem;">
      <div style="font-weight: 600; margin-bottom: 0.5rem; color: ${pu};">Put Option Price:</div>
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
    });
  }
}

// Table — colour coding applied; S0 row uses neutral (no colour on S0 symbol)
function renderTable(calc, params) {
  const tbody = $('#table-body');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td><strong>Asset Price (<i>S</i><sub>0</sub>)</strong></td>
      <td>${params.s0.toFixed(2)}</td>
    </tr>
    <tr>
      <td><strong>Up-State Price (<span style="color: ${COLOR.up};"><i>S</i><sub>u</sub></span>)</strong></td>
      <td>${params.su.toFixed(2)}</td>
    </tr>
    <tr>
      <td><strong>Down-State Price (<span style="color: ${COLOR.down};"><i>S</i><sub>d</sub></span>)</strong></td>
      <td>${params.sd.toFixed(2)}</td>
    </tr>
    <tr>
      <td><strong>Strike Price (<i>K</i>)</strong></td>
      <td>${params.strike.toFixed(2)}</td>
    </tr>
    <tr>
      <td><strong>Risk-Free Rate (<i>r</i>)</strong></td>
      <td>${params.riskFreeRate.toFixed(2)}%</td>
    </tr>
    <tr style="background-color: #eff6ff;">
      <td><strong>Call Option Price (<span style="color: ${COLOR.call};"><i>C</i><sub>0</sub></span>)</strong></td>
      <td><strong style="color: ${COLOR.call};">${calc.C0.toFixed(2)}</strong></td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Call Hedge Ratio (HR<sub><i>C</i></sub>)</td>
      <td>${calc.HRc.toFixed(4)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Call up payoff (<span style="color: ${COLOR.call};"><i>C</i><sub>u</sub></span>)</td>
      <td>${calc.Cu.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Call down payoff (<span style="color: ${COLOR.call};"><i>C</i><sub>d</sub></span>)</td>
      <td>${calc.Cd.toFixed(2)}</td>
    </tr>
    <tr style="background-color: #faf5ff;">
      <td><strong>Put Option Price (<span style="color: ${COLOR.put};"><i>P</i><sub>0</sub></span>)</strong></td>
      <td><strong style="color: ${COLOR.put};">${calc.P0.toFixed(2)}</strong></td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Put Hedge Ratio (HR<sub><i>P</i></sub>)</td>
      <td>${calc.HRp.toFixed(4)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Put up payoff (<span style="color: ${COLOR.put};"><i>P</i><sub>u</sub></span>)</td>
      <td>${calc.Pu.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Put down payoff (<span style="color: ${COLOR.put};"><i>P</i><sub>d</sub></span>)</td>
      <td>${calc.Pd.toFixed(2)}</td>
    </tr>
  `;
}

function renderCharts(calc, params) {
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
          return `${ITALIC.S}${SUB[0]} = ${value.toFixed(2)}`;
        }
        return datasetIndex === 0
          ? `${ITALIC.S}${SUB.u} = ${value.toFixed(2)}`  // Su
          : `${ITALIC.S}d = ${value.toFixed(2)}`;         // Sd (no Unicode subscript d)
      },
      false,
      assetLabelColor
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
          return `${ITALIC.C}${SUB[0]} = ${value.toFixed(2)}`;
        }
        return datasetIndex === 0
          ? `${ITALIC.C}${SUB.u} = ${value.toFixed(2)}`  // Cu
          : `${ITALIC.C}d = ${value.toFixed(2)}`;         // Cd
      },
      false,
      () => COLOR.call // all call labels are blue
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
          return `${ITALIC.P}${SUB[0]} = ${value.toFixed(2)}`;
        }
        return datasetIndex === 0
          ? `${ITALIC.P}${SUB.u} = ${value.toFixed(2)}`  // Pu
          : `${ITALIC.P}d = ${value.toFixed(2)}`;         // Pd
      },
      true,            // invertYAxis — down payoff appears visually lower
      () => COLOR.put  // all put labels are purple
    )
  });
}

// Shared chart options builder.
// labelColorFn: optional function(context) → colour string for datalabel text + pill border.
//               If null, defaults to neutral for t=0, dataset borderColor for t=1.
function getChartOptions(yLabel, prefix = '', hideYAxis = false, customLabelFormatter = null, invertYAxis = false, labelColorFn = null) {
  const defaultLabelColor = function(context) {
    return context.dataIndex === 0 ? COLOR.neutral : context.dataset.borderColor;
  };
  const resolvedLabelColor = labelColorFn || defaultLabelColor;

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: prefersReducedMotion ? { duration: 0 } : undefined,
    layout: {
      padding: { top: 40, right: 120, bottom: 25, left: 100 }
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
        // For asset chart: neutral at t=0, green/red at t=1.
        // For call/put charts: call blue / put purple throughout.
        color: resolvedLabelColor,
        font: {
          weight: 'bold',
          size: 15,
          // No style: 'italic' here — italic is conveyed by the Unicode
          // math-italic letter in the label string itself (e.g. 𝑆, 𝐶, 𝑃),
          // keeping the number/equals/subscript portions upright.
          family: CHART_FONT_FAMILY
        },
        backgroundColor: () => 'rgba(255, 255, 255, 0.9)',
        borderColor: resolvedLabelColor,
        borderWidth: 2,
        borderRadius: 4,
        padding: 6,
        formatter: customLabelFormatter || function(value) {
          return value.toFixed(2);
        },
        align: function(context) {
          const index = context.dataIndex;
          if (index === 0) return 'left';
          if (index === context.chart.data.labels.length - 1) return 'right';
          return 'center';
        },
        offset: 15,
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
          font: {
            size: 13,
            weight: '500',
            family: CHART_FONT_FAMILY
          }
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
          font: { size: 13, weight: '600', family: CHART_FONT_FAMILY }
        },
        ticks: {
          display: !hideYAxis,
          callback: (v) => v.toFixed(2),
          color: '#374151',
          font: { size: 13, weight: '500', family: CHART_FONT_FAMILY }
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