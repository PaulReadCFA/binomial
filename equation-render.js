/**
 * Shared equation mount — Equation Explorers
 *
 * Master lives at _shared/equation-render.js. Run ./scripts/sync-cfa-base.sh
 * after editing; never hand-edit the vendored copies.
 *
 * Swapping the dynamic equation's markup shoves every card below it up and
 * back down for a frame or two: the mount collapses while MathJax works, and
 * browsers that render the raw <math> source natively first draw it taller
 * than the typeset result. This pins the mount's slot at its outgoing height
 * in both directions, hides the mount while the source markup sits in the
 * DOM, and releases the pin once the typeset equation has painted.
 *
 * Usage:
 *   import { renderEquation } from '../equation-render.js';
 *   renderEquation(mount, mathML, { onTypeset: () => announce(result) });
 */

/* Waiting only on MathJax would leave a card frozen — and its equation hidden
   — if the typeset never completes, so every render arms this fallback. It is
   a hang guard, not a deadline: MathJax runs one serial queue, and a mount
   caught behind several queued equations has been seen to finish around
   1.3s, so releasing earlier than this would expose the untypeset source. */
const PIN_TIMEOUT_MS = 2500;

/* The element that should hold its height: the card slot around the mount,
   not the mount itself, so a taller or shorter equation still reflows. */
function reservationBox(mount, reserve) {
  if (reserve) return reserve;
  if (typeof mount.closest === 'function') {
    const slot = mount.closest('.equation-container, .formula-box');
    if (slot) return slot;
  }
  return mount.parentElement || mount;
}

/* Renders overlap when input arrives while MathJax is still working. The most
   recent render owns the pin: earlier ones must not restore the height out
   from under it, and whoever owns it restores the styles the page started
   with, not the pinned ones. */
const pins = new WeakMap();

function pin(box) {
  const current = pins.get(box);
  const token = {};

  if (current) {
    pins.set(box, { token, saved: current.saved });
    return token;
  }

  const saved = {
    minHeight: box.style.minHeight,
    maxHeight: box.style.maxHeight,
    overflow: box.style.overflow,
  };
  const height = box.getBoundingClientRect().height;
  if (height > 0) {
    box.style.minHeight = `${height}px`;
    box.style.maxHeight = `${height}px`;
    /* The mount is hidden while pinned, so clipping an over-tall intermediate
       render is invisible. */
    box.style.overflow = 'hidden';
  }
  pins.set(box, { token, saved });
  return token;
}

function unpin(box, token) {
  const current = pins.get(box);
  if (!current || current.token !== token) return;
  pins.delete(box);
  box.style.minHeight = current.saved.minHeight;
  box.style.maxHeight = current.saved.maxHeight;
  box.style.overflow = current.saved.overflow;
}

/**
 * Swap and typeset several equation mounts in one pass, holding the layout
 * still for all of them. Use when a card renders more than one equation.
 *
 * @param {Array<{mount: Element, markup: string, reserve?: Element}>} entries
 * @param {{onTypeset?: Function}} [options]
 */
export function renderEquationGroup(entries, options = {}) {
  const items = (entries || []).filter((entry) => entry && entry.mount);
  if (items.length === 0) {
    if (typeof options.onTypeset === 'function') options.onTypeset();
    return;
  }

  const held = items.map(({ mount, markup, reserve }) => {
    const box = reservationBox(mount, reserve);
    const token = pin(box);
    mount.style.visibility = 'hidden';
    mount.innerHTML = markup;
    return { mount, box, token };
  });

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timeout);

    held.forEach(({ mount }) => {
      mount.style.visibility = '';
    });
    /* Paint the typeset equation at the pinned height first, then hand the
       height back to CSS so the responsive rules still apply. */
    requestAnimationFrame(() => {
      held.forEach(({ box, token }) => unpin(box, token));
    });
    if (typeof options.onTypeset === 'function') options.onTypeset();
  };
  const timeout = setTimeout(release, PIN_TIMEOUT_MS);

  const hub = typeof window !== 'undefined' && window.MathJax && window.MathJax.Hub;
  if (!hub) {
    release();
    return;
  }

  held.forEach(({ mount }) => hub.Queue(['Typeset', hub, mount]));
  hub.Queue(release);
}

/**
 * Swap and typeset one equation mount without shifting the page.
 *
 * @param {Element} mount element whose innerHTML holds the MathML
 * @param {string} markup MathML source
 * @param {{reserve?: Element, onTypeset?: Function}} [options]
 */
export function renderEquation(mount, markup, options = {}) {
  renderEquationGroup([{ mount, markup, reserve: options.reserve }], options);
}
