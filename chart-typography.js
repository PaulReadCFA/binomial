/**
 * Canvas / Chart.js type that tracks the reader's HTML root font size.
 *
 * Chart.js and ctx.font only accept CSS pixels. html { font-size: 112.5% }
 * is 18px at a 16px browser default; this helper scales from that baseline
 * so a raised default (24px → 27px root, 32px → 36px root) enlarges axes
 * and in-chart pills the same way as the rest of the page.
 *
 * Profiles keep the designed default sizes:
 *   curriculum — 13px / 600 at an 18px root
 *   exemplar   — 16px / normal at an 18px root
 *
 * Call getChartTypography() at the start of every renderChart, not at
 * module load. Copy this file from _shared/ via ./scripts/sync-cfa-base.sh;
 * do not import across explorer folders (each repo must stay portable).
 */

export const CHART_BASE_ROOT_PX = 18;

export const CHART_FONT_FAMILY =
  "'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function getRootFontPx() {
  if (typeof document === 'undefined') return CHART_BASE_ROOT_PX;
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || CHART_BASE_ROOT_PX;
}

export function scaledChartPx(px, rootPx = getRootFontPx()) {
  return Math.max(1, Math.round(px * rootPx / CHART_BASE_ROOT_PX));
}

/**
 * Kern (px) that cancels math-italic sidebearings inside roman parentheses.
 * Use with fillTightParenVar so canvas titles match legend "Name (r)".
 */
export function mathItalicParenKernPx(rootPx = getRootFontPx()) {
  return scaledChartPx(2, rootPx);
}

/**
 * Draw `before + italic + after` (e.g. "Required return (" + 𝑟 + ") %")
 * with tight parentheses. Caller should set font, fillStyle, and textBaseline.
 * `textAlign` is ignored; pass `align: 'center'` to center on `x`.
 * @returns {number} advance width after kerning
 */
export function fillTightParenVar(ctx, before, italic, after, x, y, align = 'left') {
  const kern = mathItalicParenKernPx();
  const wBefore = ctx.measureText(before).width;
  const wVar = ctx.measureText(italic).width;
  const width = wBefore + wVar + ctx.measureText(after).width - 2 * kern;
  const left = align === 'center' ? x - width / 2 : x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  ctx.fillText(before, left, y);
  ctx.fillText(italic, left + wBefore - kern, y);
  ctx.fillText(after, left + wBefore - kern + wVar - kern, y);
  ctx.textAlign = prevAlign;
  return width;
}

/**
 * @param {'curriculum'|'exemplar'} [profile='curriculum']
 */
export function getChartTypography(profile = 'curriculum') {
  const rootPx = getRootFontPx();
  const isExemplar = profile === 'exemplar';
  const size = scaledChartPx(isExemplar ? 16 : 13, rootPx);
  const weight = isExemplar ? 'normal' : '600';
  const font = isExemplar
    ? { family: CHART_FONT_FAMILY, size }
    : { family: CHART_FONT_FAMILY, size, weight };
  const fontCss = `${isExemplar ? '400' : weight} ${size}px ${CHART_FONT_FAMILY}`;
  const padX = scaledChartPx(8, rootPx);
  const padY = scaledChartPx(5, rootPx);

  return {
    profile,
    rootPx,
    font,
    fontCss,
    pill: {
      padX,
      padY,
      boxHeight: size + padY * 2,
    },
    subscript: {
      size: scaledChartPx(9, rootPx),
      shift: scaledChartPx(3, rootPx),
    },
  };
}
