import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { compareLabels, formatNumber } from "./data";
import InfoTip from "./InfoTip";
import styles from "./DataTable.module.css";

// A comma-separated list that collapses when it has many items.
export function ExpandableList({ items, limit = 12 }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return <span className={styles.muted}>—</span>;

  const visible = expanded ? items : items.slice(0, limit);
  const hidden = items.length - visible.length;

  return (
    <span className={styles.list}>
      {visible.join(", ")}
      {items.length > limit && (
        <button
          type="button"
          className={styles.listToggle}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : `+${formatNumber(hidden)} more`}
        </button>
      )}
    </span>
  );
}

function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return compareLabels(String(a ?? ""), String(b ?? ""));
}

function SortIndicator({ direction }) {
  const symbol = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕";
  return (
    <span aria-hidden="true" className={clsx(styles.sortIndicator, !direction && styles.sortIndicatorIdle)}>
      {symbol}
    </span>
  );
}

/**
 * A sortable (and optionally paginated) table.
 *
 * columns: [{ key, label, description?, align?, className?, render?(row), sortValue?(row), sortable? }]
 * A column's description is shown with an info button next to its header.
 * rowKey: (row) => unique key; rows keep their state (e.g. expanded lists) when re-sorted.
 * stackOnPhones: on narrow screens, show each row as a block of labeled lines
 * (headed by its first cell) instead of a table that scrolls sideways.
 */
export default function DataTable({
  columns,
  rows,
  caption,
  rowKey = (row) => row.id,
  initialSort = null,
  paginate = false,
  pageSizeOptions = [25, 50, 100, 250],
  defaultPageSize = 50,
  emptyMessage = "No rows match.",
  stackOnPhones = false,
}) {
  const wrapperRef = useRef(null);
  const [sort, setSort] = useState(initialSort);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    const getValue = column?.sortValue ?? ((row) => row[sort.key]);
    const direction = sort.direction === "desc" ? -1 : 1;
    return rows
      .map((row) => [getValue(row), row])
      .sort(([a], [b]) => direction * compareValues(a, b))
      .map(([, row]) => row);
  }, [rows, columns, sort]);

  // Go back to the first page whenever the rows or their order change.
  useEffect(() => setPage(0), [rows, sort, pageSize]);

  const pageCount = paginate ? Math.max(1, Math.ceil(sortedRows.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const start = paginate ? currentPage * pageSize : 0;
  const visibleRows = paginate ? sortedRows.slice(start, start + pageSize) : sortedRows;

  function goToPage(index) {
    setPage(index);
    // Bring the top of the table back into view when paging from the bottom.
    const wrapper = wrapperRef.current;
    if (wrapper && wrapper.getBoundingClientRect().top < 0) {
      wrapper.scrollIntoView({ block: "start" });
    }
  }

  function toggleSort(key) {
    setSort((previous) => {
      if (previous?.key !== key) return { key, direction: "asc" };
      if (previous.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  return (
    <div className={clsx(styles.wrapper, stackOnPhones && styles.stacked)} ref={wrapperRef}>
      <div className={styles.scroller}>
        <table className={styles.table}>
          {caption && <caption className={styles.caption}>{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) => {
                const direction = sort?.key === column.key ? sort.direction : null;
                const sortable = column.sortable !== false;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={clsx(column.align === "right" && styles.alignRight)}
                    aria-sort={direction ? (direction === "asc" ? "ascending" : "descending") : undefined}>
                    <span className={styles.header}>
                      {sortable ? (
                        <button type="button" className={styles.sortButton} onClick={() => toggleSort(column.key)}>
                          {column.label}
                          <SortIndicator direction={direction} />
                        </button>
                      ) : (
                        column.label
                      )}
                      {column.description && <InfoTip label={`About ${column.label}`}>{column.description}</InfoTip>}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={styles.empty}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr key={rowKey(row) ?? start + index}>
                  {columns.map((column) => {
                    const content = column.render ? column.render(row) : row[column.key];
                    return (
                      <td
                        key={column.key}
                        className={clsx(column.align === "right" && styles.alignRight, column.className)}
                        data-label={stackOnPhones ? (typeof column.label === "string" ? column.label : column.key) : undefined}>
                        {stackOnPhones ? <span className={styles.cellValue}>{content}</span> : content}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {paginate && sortedRows.length > 0 && (
        <div className={styles.pagination}>
          <label className={styles.pageSize}>
            Rows per page
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span className={styles.range}>
            {formatNumber(start + 1)}–{formatNumber(start + visibleRows.length)} of {formatNumber(sortedRows.length)}
          </span>
          <div className={styles.pageButtons}>
            <button type="button" onClick={() => goToPage(0)} disabled={currentPage === 0} aria-label="First page">
              «
            </button>
            <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0} aria-label="Previous page">
              ‹
            </button>
            <span className={styles.pageNumber}>
              Page {formatNumber(currentPage + 1)} of {formatNumber(pageCount)}
            </span>
            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= pageCount - 1}
              aria-label="Next page">
              ›
            </button>
            <button
              type="button"
              onClick={() => goToPage(pageCount - 1)}
              disabled={currentPage >= pageCount - 1}
              aria-label="Last page">
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
