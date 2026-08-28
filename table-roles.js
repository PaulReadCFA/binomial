/**
 * Shared table ARIA roles — Equation Explorers
 *
 * Master lives at _shared/table-roles.js. Run ./scripts/sync-cfa-base.sh
 * after editing; never hand-edit the vendored copies.
 *
 * Below 48em the shared base reflows rows into cards with display:block,
 * which makes browsers drop the implicit table/row/cell roles. Without these
 * attributes a screen reader reads the card as a flat run of text instead of
 * announcing row and column positions. Harmless at wider widths, where the
 * roles simply restate the native semantics.
 *
 * An explicit table role owns only rows and rowgroups, so a <caption> inside
 * it reads as an unexpected owned element. Promote the caption to the table's
 * accessible name instead: aria-labelledby still reads hidden text, and
 * aria-hidden keeps the caption out of the owned set without an explicit role,
 * which ARIA in HTML forbids on <caption>.
 *
 * Usage:
 *   import { applyTableRoles } from '../table-roles.js';
 *   applyTableRoles(table);
 */

/**
 * Mirror the implicit table semantics as explicit ARIA roles.
 *
 * @param {Element|null} table - Table element to annotate
 */
export function applyTableRoles(table) {
  if (!table) return;

  table.setAttribute('role', 'table');

  const caption = table.querySelector('caption');
  if (caption) {
    if (!caption.id) caption.id = `${table.id || 'data-table'}-caption`;
    if (!table.hasAttribute('aria-label') && !table.hasAttribute('aria-labelledby')) {
      table.setAttribute('aria-labelledby', caption.id);
    }
    caption.setAttribute('aria-hidden', 'true');
  }

  table.querySelectorAll('thead, tbody, tfoot').forEach((group) => {
    group.setAttribute('role', 'rowgroup');
  });
  table.querySelectorAll('tr').forEach((row) => {
    row.setAttribute('role', 'row');
  });
  table.querySelectorAll('th').forEach((header) => {
    header.setAttribute(
      'role',
      header.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader'
    );
  });
  table.querySelectorAll('td').forEach((cell) => {
    cell.setAttribute('role', 'cell');
  });
  // colspan is ignored once the cells are display:block
  table.querySelectorAll('[colspan]').forEach((cell) => {
    cell.setAttribute('aria-colspan', cell.getAttribute('colspan'));
  });
}
