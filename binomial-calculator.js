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
  console.log('Binomial Calculator ready');
}

function setupViewToggle() {
  const chartBtn = $('#view-chart-btn');
  const tableBtn = $('#view-table-btn');
  
  if (chartBtn && tableBtn) {
    listen(chartBtn, 'click', () => switchView('chart'));
    listen(tableBtn, 'click', () => switchView('table'));
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

function handleStateChange(newState) {
  const { optionCalculations } = newState;
  if (!optionCalculations) return;
  
  renderResults(optionCalculations, newState);
  renderDynamicEquation(optionCalculations, newState);
  renderCharts(optionCalculations, newState);
  if (currentView === 'table') {
    renderTable(optionCalculations, newState);
  }
}

function renderResults(calc, params) {
  const container = $('#results-content');
  if (!container) return;
  
  container.innerHTML = `
    <div class="result-box call-option">
      <h5 class="result-title call-option">Call Option Price</h5>
      <div class="result-value" style="color: #3c6ae5;" aria-live="polite">${formatCurrency(calc.C0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at t=0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #6b7280;">
        <div>Hedge Ratio: ${calc.HRc.toFixed(4)}</div>
        <div style="margin-top: 0.25rem;">Payoffs: Up ${formatCurrency(calc.Cu)}, Down ${formatCurrency(calc.Cd)}</div>
      </div>
    </div>
    
    <div class="result-box put-option">
      <h5 class="result-title put-option">Put Option Price</h5>
      <div class="result-value" style="color: #7a46ff;" aria-live="polite">${formatCurrency(calc.P0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at t=0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #6b7280;">
        <div>Hedge Ratio: ${calc.HRp.toFixed(4)}</div>
        <div style="margin-top: 0.25rem;">Payoffs: Up ${formatCurrency(calc.Pu)}, Down ${formatCurrency(calc.Pd)}</div>
      </div>
    </div>
    
    <div class="result-box risk-neutral">
      <h5 class="result-title" style="font-size: 0.875rem; font-weight: 600;">Risk-Neutral Probability</h5>
      <div style="font-size: 1.5rem; font-family: monospace; color: #374151; font-weight: 600;">${formatPercentage(calc.p * 100)}</div>
      <div style="font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem;">
        Probability of up movement
      </div>
    </div>
  `;
}

function renderDynamicEquation(calc, params) {
  const container = $('#dynamic-mathml-equation');
  if (!container) return;
  
  const r = params.riskFreeRate / 100;
  const onePlusR = (1 + r).toFixed(4);
  
  const mathML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 1rem;">
      <div>
        <div style="font-weight: 600; margin-bottom: 0.5rem; color: #3c6ae5;">Call Hedge Ratio:</div>
        <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
          <mrow>
            <msub><mi>HR</mi><mi>C</mi></msub>
            <mo>=</mo>
            <mfrac>
              <mrow>
                <msub><mi>C</mi><mi>u</mi></msub>
                <mo>−</mo>
                <msub><mi>C</mi><mi>d</mi></msub>
              </mrow>
              <mrow>
                <msub><mi>S</mi><mi>u</mi></msub>
                <mo>−</mo>
                <msub><mi>S</mi><mi>d</mi></msub>
              </mrow>
            </mfrac>
            <mo>=</mo>
            <mfrac>
              <mrow>
                <mn>${calc.Cu.toFixed(2)}</mn>
                <mo>−</mo>
                <mn>${calc.Cd.toFixed(2)}</mn>
              </mrow>
              <mrow>
                <mn>${params.su.toFixed(2)}</mn>
                <mo>−</mo>
                <mn>${params.sd.toFixed(2)}</mn>
              </mrow>
            </mfrac>
            <mo>=</mo>
            <mn mathcolor="#3c6ae5">${calc.HRc.toFixed(4)}</mn>
          </mrow>
        </math>
        <div style="margin-top: 1rem; font-weight: 600; margin-bottom: 0.5rem; color: #3c6ae5;">Call Option Price:</div>
        <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
          <mrow>
            <msub><mi mathcolor="#3c6ae5">C</mi><mn>0</mn></msub>
            <mo>=</mo>
            <msub><mi>S</mi><mn>0</mn></msub>
            <mo>×</mo>
            <msub><mi>HR</mi><mi>C</mi></msub>
            <mo>−</mo>
            <mfrac>
              <mrow>
                <msub><mi>HR</mi><mi>C</mi></msub>
                <mo>×</mo>
                <msub><mi>S</mi><mi>u</mi></msub>
                <mo>−</mo>
                <msub><mi>C</mi><mi>u</mi></msub>
              </mrow>
              <mrow><mn>1</mn><mo>+</mo><mi>r</mi></mrow>
            </mfrac>
          </mrow>
        </math>
        <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
          <mrow>
            <mo>=</mo>
            <mn>${params.s0.toFixed(2)}</mn>
            <mo>×</mo>
            <mn>${calc.HRc.toFixed(4)}</mn>
            <mo>−</mo>
            <mfrac>
              <mrow>
                <mn>${calc.HRc.toFixed(4)}</mn>
                <mo>×</mo>
                <mn>${params.su.toFixed(2)}</mn>
                <mo>−</mo>
                <mn>${calc.Cu.toFixed(2)}</mn>
              </mrow>
              <mrow><mn>${onePlusR}</mn></mrow>
            </mfrac>
            <mo>=</mo>
            <mn mathcolor="#3c6ae5">${calc.C0.toFixed(2)}</mn>
          </mrow>
        </math>
      </div>
      
      <div>
        <div style="font-weight: 600; margin-bottom: 0.5rem; color: #7a46ff;">Put Hedge Ratio:</div>
        <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
          <mrow>
            <msub><mi>HR</mi><mi>P</mi></msub>
            <mo>=</mo>
            <mfrac>
              <mrow>
                <msub><mi>P</mi><mi>u</mi></msub>
                <mo>−</mo>
                <msub><mi>P</mi><mi>d</mi></msub>
              </mrow>
              <mrow>
                <msub><mi>S</mi><mi>u</mi></msub>
                <mo>−</mo>
                <msub><mi>S</mi><mi>d</mi></msub>
              </mrow>
            </mfrac>
            <mo>=</mo>
            <mfrac>
              <mrow>
                <mn>${calc.Pu.toFixed(2)}</mn>
                <mo>−</mo>
                <mn>${calc.Pd.toFixed(2)}</mn>
              </mrow>
              <mrow>
                <mn>${params.su.toFixed(2)}</mn>
                <mo>−</mo>
                <mn>${params.sd.toFixed(2)}</mn>
              </mrow>
            </mfrac>
            <mo>=</mo>
            <mn mathcolor="#7a46ff">${calc.HRp.toFixed(4)}</mn>
          </mrow>
        </math>
        <div style="margin-top: 1rem; font-weight: 600; margin-bottom: 0.5rem; color: #7a46ff;">Put Option Price:</div>
        <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
          <mrow>
            <msub><mi mathcolor="#7a46ff">P</mi><mn>0</mn></msub>
            <mo>=</mo>
            <msub><mi>S</mi><mn>0</mn></msub>
            <mo>×</mo>
            <msub><mi>HR</mi><mi>P</mi></msub>
            <mo>−</mo>
            <mfrac>
              <mrow>
                <msub><mi>HR</mi><mi>P</mi></msub>
                <mo>×</mo>
                <msub><mi>S</mi><mi>u</mi></msub>
                <mo>−</mo>
                <msub><mi>P</mi><mi>u</mi></msub>
              </mrow>
              <mrow><mn>1</mn><mo>+</mo><mi>r</mi></mrow>
            </mfrac>
          </mrow>
        </math>
        <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
          <mrow>
            <mo>=</mo>
            <mn>${params.s0.toFixed(2)}</mn>
            <mo>×</mo>
            <mn>${calc.HRp.toFixed(4)}</mn>
            <mo>−</mo>
            <mfrac>
              <mrow>
                <mn>${calc.HRp.toFixed(4)}</mn>
                <mo>×</mo>
                <mn>${params.su.toFixed(2)}</mn>
                <mo>−</mo>
                <mn>${calc.Pu.toFixed(2)}</mn>
              </mrow>
              <mrow><mn>${onePlusR}</mn></mrow>
            </mfrac>
            <mo>=</mo>
            <mn mathcolor="#7a46ff">${calc.P0.toFixed(2)}</mn>
          </mrow>
        </math>
      </div>
    </div>
  `;
  
  container.innerHTML = mathML;
}

function renderTable(calc, params) {
  const tbody = $('#table-body');
  if (!tbody) return;
  
  tbody.innerHTML = `
    <tr>
      <td><strong>Asset Price (S₀)</strong></td>
      <td>${formatCurrency(params.s0)}</td>
    </tr>
    <tr>
      <td><strong>Up-state (Sᵤ)</strong></td>
      <td>${formatCurrency(params.su)}</td>
    </tr>
    <tr>
      <td><strong>Down-state (Sᵨ)</strong></td>
      <td>${formatCurrency(params.sd)}</td>
    </tr>
    <tr>
      <td><strong>Strike Price (K)</strong></td>
      <td>${formatCurrency(params.strike)}</td>
    </tr>
    <tr>
      <td><strong>Risk-free Rate (r)</strong></td>
      <td>${formatPercentage(params.riskFreeRate)}</td>
    </tr>
    <tr style="background-color: #f3f4f6;">
      <td><strong>Risk-Neutral Probability (p)</strong></td>
      <td><strong>${formatPercentage(calc.p * 100)}</strong></td>
    </tr>
    <tr style="background-color: #eff6ff;">
      <td><strong>Call Option Price (C₀)</strong></td>
      <td><strong style="color: #3c6ae5;">${formatCurrency(calc.C0)}</strong></td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Call Hedge Ratio (HRc)</td>
      <td>${calc.HRc.toFixed(4)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Call Up Payoff (Cᵤ)</td>
      <td>${formatCurrency(calc.Cu)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Call Down Payoff (Cᵨ)</td>
      <td>${formatCurrency(calc.Cd)}</td>
    </tr>
    <tr style="background-color: #faf5ff;">
      <td><strong>Put Option Price (P₀)</strong></td>
      <td><strong style="color: #7a46ff;">${formatCurrency(calc.P0)}</strong></td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Put Hedge Ratio (HRp)</td>
      <td>${calc.HRp.toFixed(4)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Put Up Payoff (Pᵤ)</td>
      <td>${formatCurrency(calc.Pu)}</td>
    </tr>
    <tr>
      <td style="padding-left: 2rem;">Put Down Payoff (Pᵨ)</td>
      <td>${formatCurrency(calc.Pd)}</td>
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
          borderColor: '#059669',
          backgroundColor: '#059669',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Down Path',
          data: [params.s0, params.sd],
          borderColor: '#dc2626',
          backgroundColor: '#dc2626',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: getChartOptions('Asset Price (USD)', 'USD ')
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
          borderColor: '#059669',
          backgroundColor: '#059669',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Down Path',
          data: [calc.C0, calc.Cd],
          borderColor: '#dc2626',
          backgroundColor: '#dc2626',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: getChartOptions('Call Value (USD)', 'USD ')
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
          borderColor: '#059669',
          backgroundColor: '#059669',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Down Path',
          data: [calc.P0, calc.Pd],
          borderColor: '#dc2626',
          backgroundColor: '#dc2626',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        }
      ]
    },
    options: getChartOptions('Put Value (USD)', 'USD ')
  });
}

function getChartOptions(yLabel, prefix = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        top: 35,
        right: 65,
        bottom: 25,
        left: 65
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
          size: 11
        },
        formatter: function(value) {
          return prefix + value.toFixed(2);
        },
        align: function(context) {
          const index = context.dataIndex;
          const value = context.dataset.data[index];
          const dataset = context.chart.data.datasets;
          
          // Find max and min values across all datasets at this point
          const values = dataset.map(ds => ds.data[index]);
          const maxValue = Math.max(...values);
          const minValue = Math.min(...values);
          const midValue = (maxValue + minValue) / 2;
          
          // For t=0 (first point)
          if (index === 0) {
            // If it's near the top, go right and slightly down
            if (value > midValue) {
              return 'right';
            }
            // If it's near the bottom, go right and slightly up
            else {
              return 'top';
            }
          }
          
          // For t=1 (last point)
          if (index === context.chart.data.labels.length - 1) {
            // If it's near the top, go left and slightly down
            if (value > midValue) {
              return 'left';
            }
            // If it's near the bottom, go left and slightly up
            else {
              return 'top';
            }
          }
          
          // For middle points (shouldn't happen in 2-point chart)
          if (value === maxValue) {
            return 'bottom';
          }
          if (value === minValue) {
            return 'top';
          }
          return 'center';
        },
        offset: 10,
        clamp: true
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#374151',
          font: { weight: 500 }
        },
        grid: {
          color: '#e5e7eb'
        }
      },
      y: {
        title: { 
          display: true, 
          text: yLabel,
          color: '#374151',
          font: { weight: 600 }
        },
        ticks: { 
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