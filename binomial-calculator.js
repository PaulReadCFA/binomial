import { state, setState, subscribe } from './binomial-modules/state.js';
import { calculateOptionMetrics } from './binomial-modules/calculations.js';
import { validateField, validateAll, updateFieldError, updateValidationSummary, hasErrors } from './binomial-modules/validation.js';
import { $, listen, debounce, formatCurrency, formatPercentage } from './binomial-modules/utils.js';

// Register Chart.js datalabels plugin
Chart.register(ChartDataLabels);

let assetChart, callChart, putChart;
let currentView = 'chart'; // 'chart' or 'table'

function init() {
  console.log('Binomial Option Pricing Calculator initializing...');
  setupInputListeners();
  setupViewToggle();
  subscribe(handleStateChange);
  updateCalculations();
  runSelfTests();
  
  // Trigger MathJax rendering for static equations
  if (window.MathJax && window.MathJax.Hub) {
    MathJax.Hub.Queue(["Typeset", MathJax.Hub]);
  }
  
  console.log('Binomial Calculator ready');
}

function setupViewToggle() {
  const chartBtn = $('#view-chart-btn');
  const tableBtn = $('#view-table-btn');
  
  if (chartBtn && tableBtn) {
    listen(chartBtn, 'click', () => switchView('chart'));
    listen(tableBtn, 'click', () => switchView('table'));
    
    // Handle skip link to table button - switch to table view
    listen(tableBtn, 'focus', () => {
      // If coming from skip link, switch to table view
      if (document.activeElement === tableBtn && currentView === 'chart') {
        switchView('table');
      }
    });
    
    // Keyboard navigation for both buttons
    listen(chartBtn, 'keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        switchView('table');
        tableBtn.focus();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        // Stay on chart button, ensure chart view
        switchView('chart');
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchView('chart');
        // Focus on first chart
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
        // Stay on table button, ensure table view
        switchView('table');
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchView('table');
        // Focus on table
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
    if (chartBtn) {
      chartBtn.classList.add('active');
      chartBtn.setAttribute('aria-pressed', 'true');
    }
    if (tableBtn) {
      tableBtn.classList.remove('active');
      tableBtn.setAttribute('aria-pressed', 'false');
    }
  } else {
    if (chartView) chartView.style.display = 'none';
    if (tableView) tableView.style.display = 'block';
    if (chartBtn) {
      chartBtn.classList.remove('active');
      chartBtn.setAttribute('aria-pressed', 'false');
    }
    if (tableBtn) {
      tableBtn.classList.add('active');
      tableBtn.setAttribute('aria-pressed', 'true');
    }
    // Update table when switching to it
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

function announceCalculationsToScreenReader(calc) {
  const announcement = $('#sr-announcement');
  if (!announcement) return;
  
  announcement.textContent = 
    `Calculations updated. ` +
    `Call option price: ${formatCurrency(calc.C0)}. ` +
    `Put option price: ${formatCurrency(calc.P0)}. ` +
    `Risk-neutral probability: ${formatPercentage(calc.p * 100)}.`;
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
  
  // Announce changes to screen readers
  announceCalculationsToScreenReader(optionCalculations);
}

function renderResults(calc, params) {
  const container = $('#results-content');
  if (!container) return;
  
  container.innerHTML = `
    <div class="result-box call-option">
      <h5 class="result-title call-option">Call Option Price</h5>
      <div class="result-value" style="color: #1e40af;">${formatCurrency(calc.C0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at t=0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #4b5563;">
        <div>Hedge Ratio: ${calc.HRc.toFixed(4)}</div>
        <div style="margin-top: 0.25rem;">Payoffs: Up ${formatCurrency(calc.Cu)}, Down ${formatCurrency(calc.Cd)}</div>
      </div>
    </div>
    
    <div class="result-box put-option">
      <h5 class="result-title put-option">Put Option Price</h5>
      <div class="result-value" style="color: #6d28d9;">${formatCurrency(calc.P0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at t=0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #4b5563;">
        <div>Hedge Ratio: ${calc.HRp.toFixed(4)}</div>
        <div style="margin-top: 0.25rem;">Payoffs: Up ${formatCurrency(calc.Pu)}, Down ${formatCurrency(calc.Pd)}</div>
      </div>
    </div>
  `;
}

function renderDynamicEquation(calc, params) {
  const container = $('#dynamic-mathml-equation');
  if (!container) return;
  
  const r = params.riskFreeRate / 100;
  const onePlusR = (1 + r).toFixed(4);
  
  const content = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 1rem;">
      <div style="text-align: left;">
        <div style="font-weight: 600; margin-bottom: 0.75rem; color: #1e40af; font-size: 1rem;">Call Hedge Ratio:</div>
        <p style="margin-left: 1rem;">
          $$HR_C = \\frac{${calc.Cu.toFixed(2)} - ${calc.Cd.toFixed(2)}}{\\color{#047857}{${params.su.toFixed(2)}} - \\color{#b91c1c}{${params.sd.toFixed(2)}}} = \\color{#1e40af}{${calc.HRc.toFixed(4)}}$$
        </p>
        
        <div style="margin-top: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; color: #1e40af; font-size: 1rem;">Call Option Price:</div>
        <p style="margin-left: 1rem;">
          $$c_0 = \\color{#047857}{${params.s0.toFixed(2)}} \\times ${calc.HRc.toFixed(4)} - \\frac{${calc.HRc.toFixed(4)} \\times \\color{#047857}{${params.su.toFixed(2)}} - ${calc.Cu.toFixed(2)}}{${onePlusR}}$$
        </p>
        <p style="margin-left: 1rem; margin-top: 0.5rem;">
          $$= \\color{#1e40af}{${calc.C0.toFixed(2)}}$$
        </p>
      </div>
      
      <div style="text-align: left;">
        <div style="font-weight: 600; margin-bottom: 0.75rem; color: #6d28d9; font-size: 1rem;">Put Hedge Ratio:</div>
        <p style="margin-left: 1rem;">
          $$HR_P = \\frac{${calc.Pu.toFixed(2)} - ${calc.Pd.toFixed(2)}}{\\color{#047857}{${params.su.toFixed(2)}} - \\color{#b91c1c}{${params.sd.toFixed(2)}}} = \\color{#6d28d9}{${calc.HRp.toFixed(4)}}$$
        </p>
        
        <div style="margin-top: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; color: #6d28d9; font-size: 1rem;">Put Option Price:</div>
        <p style="margin-left: 1rem;">
          $$p_0 = \\color{#047857}{${params.s0.toFixed(2)}} \\times ${calc.HRp.toFixed(4)} - \\frac{${calc.HRp.toFixed(4)} \\times \\color{#047857}{${params.su.toFixed(2)}} - ${calc.Pu.toFixed(2)}}{${onePlusR}}$$
        </p>
        <p style="margin-left: 1rem; margin-top: 0.5rem;">
          $$= \\color{#6d28d9}{${calc.P0.toFixed(2)}}$$
        </p>
      </div>
    </div>
  `;
  
  container.innerHTML = content;
  
  // Typeset with MathJax
  if (window.MathJax && window.MathJax.Hub) {
    MathJax.Hub.Queue(["Typeset", MathJax.Hub, container]);
  }
}

function renderTable(calc, params) {
  const tbody = $('#table-body');
  if (!tbody) return;
  
  tbody.innerHTML = `
    <tr>
      <td><strong>Asset Price (<span style="color: #047857;">S<sub>0</sub></span>)</strong></td>
      <td>${params.s0.toFixed(2)}</td>
    </tr>
    <tr>
      <td><strong>Up-state (<span style="color: #047857;">S<sub>u</sub></span>)</strong></td>
      <td>${params.su.toFixed(2)}</td>
    </tr>
    <tr>
      <td><strong>Down-state (<span style="color: #b91c1c;">S<sub>d</sub></span>)</strong></td>
      <td>${params.sd.toFixed(2)}</td>
    </tr>
    <tr>
      <td><strong>Strike Price (K)</strong></td>
      <td>${params.strike.toFixed(2)}</td>
    </tr>
    <tr>
      <td><strong>Risk-free Rate (r)</strong></td>
      <td>${params.riskFreeRate.toFixed(2)}%</td>
    </tr>
    <tr style="background-color: #eff6ff;">
      <td><strong>Call Option Price (<span style="color: #1e40af;">C<sub>0</sub></span>)</strong></td>
      <td><strong style="color: #1e40af;">${calc.C0.toFixed(2)}</strong></td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Call Hedge Ratio (HR<sub>C</sub>)</td>
      <td>${calc.HRc.toFixed(4)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Call Up Payoff (<span style="color: #1e40af;">C<sub>u</sub></span>)</td>
      <td>${calc.Cu.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Call Down Payoff (<span style="color: #1e40af;">C<sub>d</sub></span>)</td>
      <td>${calc.Cd.toFixed(2)}</td>
    </tr>
    <tr style="background-color: #faf5ff;">
      <td><strong>Put Option Price (<span style="color: #6d28d9;">P<sub>0</sub></span>)</strong></td>
      <td><strong style="color: #6d28d9;">${calc.P0.toFixed(2)}</strong></td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Put Hedge Ratio (HR<sub>P</sub>)</td>
      <td>${calc.HRp.toFixed(4)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Put Up Payoff (<span style="color: #6d28d9;">P<sub>u</sub></span>)</td>
      <td>${calc.Pu.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Put Down Payoff (<span style="color: #6d28d9;">P<sub>d</sub></span>)</td>
      <td>${calc.Pd.toFixed(2)}</td>
    </tr>
  `;
}

function renderCharts(calc, params) {
  renderAssetChart(calc, params);
  renderCallChart(calc, params);
  renderPutChart(calc, params);
}

function renderAssetChart(calc, params) {
  const canvas = $('#asset-chart');
  if (!canvas) return;
  
  if (assetChart) assetChart.destroy();
  
  const ctx = canvas.getContext('2d');
  
  assetChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['t = 0', 't = 1'],
      datasets: [
        {
          label: 'Up Path',
          data: [params.s0, params.su],
          borderColor: '#047857',
          backgroundColor: '#047857',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8,
          datalabels: {
            labels: {
              title: null
            }
          }
        },
        {
          label: 'Down Path',
          data: [params.s0, params.sd],
          borderColor: '#b91c1c',
          backgroundColor: '#b91c1c',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8,
          datalabels: {
            labels: {
              title: null
            }
          }
        }
      ]
    },
    options: getChartOptions('Asset price (USD)', 'USD ', false, function(value, context) {
      const dataIndex = context.dataIndex;
      const datasetIndex = context.datasetIndex;
      
      if (dataIndex === 0) {
        return `S_0 = ${value.toFixed(2)}`;
      } else {
        if (datasetIndex === 0) {
          return `S_u = ${value.toFixed(2)}`;
        } else {
          return `S_d = ${value.toFixed(2)}`;
        }
      }
    }, false)
  });
}

function renderCallChart(calc, params) {
  const canvas = $('#call-chart');
  if (!canvas) return;
  
  if (callChart) callChart.destroy();
  
  const ctx = canvas.getContext('2d');
  
  callChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['t = 0', 't = 1'],
      datasets: [
        {
          label: 'Up Path',
          data: [calc.C0, calc.Cu],
          borderColor: '#047857',
          backgroundColor: '#047857',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Down Path',
          data: [calc.C0, calc.Cd],
          borderColor: '#b91c1c',
          backgroundColor: '#b91c1c',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: getChartOptions('Call option value (USD)', 'USD ', false, function(value, context) {
      const dataIndex = context.dataIndex;
      const datasetIndex = context.datasetIndex;
      
      if (dataIndex === 0) {
        return `C_0 = ${value.toFixed(2)}`;
      } else {
        if (datasetIndex === 0) {
          return `C_u = ${value.toFixed(2)}`;
        } else {
          return `C_d = ${value.toFixed(2)}`;
        }
      }
    }, false)
  });
}

function renderPutChart(calc, params) {
  const canvas = $('#put-chart');
  if (!canvas) return;
  
  if (putChart) putChart.destroy();
  
  const ctx = canvas.getContext('2d');
  
  putChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['t = 0', 't = 1'],
      datasets: [
        {
          label: 'Up Path',
          data: [calc.P0, calc.Pu],
          borderColor: '#047857',
          backgroundColor: '#047857',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Down Path',
          data: [calc.P0, calc.Pd],
          borderColor: '#b91c1c',
          backgroundColor: '#b91c1c',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: getChartOptions('Put option value (USD)', 'USD ', false, function(value, context) {
      const dataIndex = context.dataIndex;
      const datasetIndex = context.datasetIndex;
      
      if (dataIndex === 0) {
        return `P_0 = ${value.toFixed(2)}`;
      } else {
        if (datasetIndex === 0) {
          return `P_u = ${value.toFixed(2)}`;
        } else {
          return `P_d = ${value.toFixed(2)}`;
        }
      }
    }, false)  // Keep standard y-axis (not inverted)
  });
}

function getChartOptions(yLabel, prefix = '', hideYAxis = false, customLabelFormatter = null, invertYAxis = false) {
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        top: 40,
        right: 120,
        bottom: 25,
        left: 100
      }
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
        color: function(context) {
          return context.dataset.borderColor;
        },
        font: {
          weight: 'bold',
          size: 15
        },
        backgroundColor: function(context) {
          return 'rgba(255, 255, 255, 0.9)';
        },
        borderColor: function(context) {
          return context.dataset.borderColor;
        },
        borderWidth: 2,
        borderRadius: 4,
        padding: 6,
        formatter: customLabelFormatter || function(value) {
          return value.toFixed(2);
        },
        align: function(context) {
          const index = context.dataIndex;
          
          // For t=0 (first point)
          if (index === 0) {
            // Position to the left of the point
            return 'left';
          }
          
          // For t=1 (last point)
          if (index === context.chart.data.labels.length - 1) {
            // Position to the right of the point
            return 'right';
          }
          
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
          font: { weight: 500 }
        },
        grid: {
          color: '#e5e7eb',
          offset: true
        },
        offset: true
      },
      y: {
        display: !hideYAxis,
        reverse: invertYAxis,
        title: { 
          display: !hideYAxis, 
          text: yLabel,
          color: '#374151',
          font: { weight: 600 }
        },
        ticks: { 
          display: !hideYAxis,
          callback: (v) => v.toFixed(2),
          color: '#374151',
          font: { weight: 500 }
        },
        grid: {
          color: '#e5e7eb'
        }
      }
    }
  };
  
  return options;
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
      if (test.expected.callApprox) {
        const diff = Math.abs(result.C0 - test.expected.callApprox);
        if (diff > 0.1) passed = false;
      }
      if (test.expected.putApprox) {
        const diff = Math.abs(result.P0 - test.expected.putApprox);
        if (diff > 0.1) passed = false;
      }
      console.log(`${passed ? '✓' : '✗'} ${test.name} ${passed ? 'passed' : 'failed'}`);
    } catch (error) {
      console.error(`✗ ${test.name} threw error:`, error);
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