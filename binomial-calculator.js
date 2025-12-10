import { state, setState, subscribe } from './binomial-modules/state.js';
import { calculateOptionMetrics } from './binomial-modules/calculations.js';
import { validateField, validateAll, updateFieldError, updateValidationSummary, hasErrors } from './binomial-modules/validation.js';
import { $, listen, debounce, formatCurrency, formatPercentage } from './binomial-modules/utils.js';

let assetChart, callChart, putChart;

function init() {
  console.log('Binomial Option Pricing Calculator initializing...');
  setupInputListeners();
  subscribe(handleStateChange);
  updateCalculations();
  runSelfTests();
  console.log('Binomial Calculator ready');
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
        <div>Payoffs: Up ${formatCurrency(calc.Cu)}, Down ${formatCurrency(calc.Cd)}</div>
      </div>
    </div>
    
    <div class="result-box put-option">
      <h5 class="result-title put-option">Put Option Price</h5>
      <div class="result-value" style="color: #7a46ff;" aria-live="polite">${formatCurrency(calc.P0)}</div>
      <div class="result-description" style="font-size: 0.875rem; margin-top: 0.5rem;">
        Fair value at t=0
      </div>
      <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #6b7280;">
        <div>Payoffs: Up ${formatCurrency(calc.Pu)}, Down ${formatCurrency(calc.Pd)}</div>
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
  
  const mathML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 1rem;">
      <div>
        <div style="font-weight: 600; margin-bottom: 0.5rem; color: #3c6ae5;">Call Option:</div>
        <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
          <mrow>
            <msub><mi mathcolor="#3c6ae5">C</mi><mn>0</mn></msub>
            <mo>=</mo>
            <mfrac>
              <mrow>
                <mi>p</mi><msub><mi>C</mi><mi>u</mi></msub>
                <mo>+</mo>
                <mo>(</mo><mn>1</mn><mo>−</mo><mi>p</mi><mo>)</mo><msub><mi>C</mi><mi>d</mi></msub>
              </mrow>
              <mrow><mn>1</mn><mo>+</mo><mi>r</mi></mrow>
            </mfrac>
          </mrow>
        </math>
      </div>
      
      <div>
        <div style="font-weight: 600; margin-bottom: 0.5rem; color: #7a46ff;">Put Option:</div>
        <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
          <mrow>
            <msub><mi mathcolor="#7a46ff">P</mi><mn>0</mn></msub>
            <mo>=</mo>
            <mfrac>
              <mrow>
                <mi>p</mi><msub><mi>P</mi><mi>u</mi></msub>
                <mo>+</mo>
                <mo>(</mo><mn>1</mn><mo>−</mo><mi>p</mi><mo>)</mo><msub><mi>P</mi><mi>d</mi></msub>
              </mrow>
              <mrow><mn>1</mn><mo>+</mo><mi>r</mi></mrow>
            </mfrac>
          </mrow>
        </math>
      </div>
    </div>
    
    <div style="text-align: center; padding: 0.75rem; background: #f3f4f6; border-radius: 0.375rem; font-size: 0.875rem;">
      <div style="font-weight: 600; margin-bottom: 0.5rem;">Risk-Neutral Probability:</div>
      <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
        <mrow>
          <mi>p</mi>
          <mo>=</mo>
          <mfrac>
            <mrow>
              <mo>(</mo><mn>1</mn><mo>+</mo><mi>r</mi><mo>)</mo><msub><mi mathcolor="#059669">S</mi><mn>0</mn></msub>
              <mo>−</mo>
              <msub><mi mathcolor="#dc2626">S</mi><mi>d</mi></msub>
            </mrow>
            <mrow>
              <msub><mi mathcolor="#059669">S</mi><mi>u</mi></msub>
              <mo>−</mo>
              <msub><mi mathcolor="#dc2626">S</mi><mi>d</mi></msub>
            </mrow>
          </mfrac>
          <mo>=</mo>
          <mtext>${formatPercentage(calc.p * 100)}</mtext>
        </mrow>
      </math>
    </div>
  `;
  
  container.innerHTML = mathML;
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
    options: getChartOptions('Asset Price', '$')
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
    options: getChartOptions('Call Value', '$')
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
    options: getChartOptions('Put Value', '$')
  });
}

function getChartOptions(yLabel, prefix = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label}: ${prefix}${context.parsed.y.toFixed(2)}`
        }
      }
    },
    scales: {
      y: {
        title: { display: true, text: yLabel },
        ticks: { callback: (v) => `${prefix}${v.toFixed(2)}` }
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
