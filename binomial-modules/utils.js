/**
 * Utility Functions Module
 * DOM helpers, formatting, and common utilities
 */

/**
 * Query selector shorthand
 * @param {string} selector - CSS selector
 * @returns {Element|null} DOM element
 */
export const $ = (selector) => document.querySelector(selector);

/**
 * Add event listener helper
 * @param {Element|string} element - DOM element or selector
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 */
export function listen(element, event, handler) {
  const el = typeof element === 'string' ? $(element) : element;
  if (el) {
    el.addEventListener(event, handler);
  }
}

/**
 * Debounce function calls
 * @param {Function} fn - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, wait = 300) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Format number as currency
 * @param {number} value - Numeric value
 * @param {boolean} signed - Include sign for negative values
 * @returns {string} Formatted currency string
 */
export function formatCurrency(value, signed = false) {
  const absValue = Math.abs(value);
  const formatted = absValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  
  if (value < 0) {
    return signed ? `-USD ${formatted}` : `(USD ${formatted})`;
  }
  return `USD ${formatted}`;
}

/**
 * Format number as percentage
 * @param {number} value - Numeric value (already as percentage, e.g., 6.5 for 6.5%)
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted percentage string
 */
export function formatPercentage(value, decimals = 2) {
  if (value == null || isNaN(value)) return '-';
  return value.toFixed(decimals) + '%';
}

/**
 * Create DOM element with attributes and content
 * @param {string} tag - HTML tag name
 * @param {Object} attrs - Element attributes
 * @param {string} content - Text content
 * @returns {Element} Created element
 */
export function createElement(tag, attrs = {}, content = '') {
  const element = document.createElement(tag);
  
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else {
      element.setAttribute(key, value);
    }
  });
  
  if (content) {
    element.textContent = content;
  }
  
  return element;
}

/**
 * Set HTML content safely
 * @param {Element} element - Target element
 * @param {string} html - HTML content
 */
export function setHTML(element, html) {
  element.innerHTML = html;
}

/**
 * Focus element after a delay
 * @param {Element} element - Element to focus
 * @param {number} delay - Delay in milliseconds
 */
export function focusElement(element, delay = 0) {
  if (!element) return;
  
  setTimeout(() => {
    element.focus();
  }, delay);
}

/**
 * Announce message to screen readers
 * @param {string} message - Message to announce
 */
export function announceToScreenReader(message) {
  const announcement = $('#view-announcement');
  if (announcement) {
    announcement.textContent = message;
    setTimeout(() => {
      announcement.textContent = '';
    }, 1000);
  }
}