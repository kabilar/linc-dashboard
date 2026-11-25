import { useMemo, useRef, useState } from "react";
import DataTable from "./DataTable";
import Segmented from "./Segmented";
import { ModalityLegend, modalityColor } from "./modalities";
import { formatBytes, formatNumber } from "./data";
import { formatCompact, longMonth, niceStep, shortMonth, useElementWidth } from "./charts";
import styles from "./Charts.module.css";

const HEIGHT = 300;
const MARGIN = { top: 12, right: 8, bottom: 40, left: 60 };
const GAP = 2; // surface gap between stacked segments
const RADIUS = 4;
const MAX_BAR_WIDTH = 24;

const METRICS = {
  files: { label: "Files", value: (cell) => cell.files, format: formatNumber, tick: formatCompact },
  size: {
    label: "Size",
    value: (cell) => cell.bytes,
    format: formatBytes,
    tick: (bytes) => (bytes === 0 ? "0" : formatBytes(bytes).replace(".0 ", " ")),
  },
};

// A column segment; the top segment of a column gets rounded top corners.
function segmentPath(x, y, width, height, rounded) {
  const r = rounded ? Math.min(RADIUS, height, width / 2) : 0;
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/**
 * Files (or bytes) per month, stacked by modality.
 *
 * files: [{ Modality, size, Produced, Uploaded }]
 * basis: "Produced" | "Uploaded"
 * months: the months to show, "YYYY-MM"
 * modalities: modality names in stacking order
 */
export default function ActivityChart({ files, basis, months, modalities }) {
  const [metric, setMetric] = useState("files");
  const [view, setView] = useState("chart");
  const [active, setActive] = useState(null);
  const plotRef = useRef(null);
  const width = useElementWidth(plotRef);

  const { byMonth, undated } = useMemo(() => {
    const result = new Map(months.map((month) => [month, new Map()]));
    let missing = 0;
    for (const file of files) {
      const date = file[basis];
      if (!date) {
        missing += 1;
        continue;
      }
      const row = result.get(date.slice(0, 7));
      if (!row) continue;
      const cell = row.get(file.Modality) ?? { files: 0, bytes: 0 };
      cell.files += 1;
      cell.bytes += file.size;
      row.set(file.Modality, cell);
    }
    return { byMonth: result, undated: missing };
  }, [files, basis, months]);

  const { value, format, tick } = METRICS[metric];
  const shown = modalities.filter((modality) => months.some((month) => byMonth.get(month).has(modality)));
  const valueOf = (month, modality) => {
    const cell = byMonth.get(month).get(modality);
    return cell ? value(cell) : 0;
  };
  const totals = months.map((month) => shown.reduce((sum, modality) => sum + valueOf(month, modality), 0));
  const verb = basis.toLowerCase();

  const tableColumns = [
    { key: "month", label: "Month", render: (row) => longMonth(row.month) },
    ...shown.map((modality) => ({
      key: modality,
      label: modality,
      align: "right",
      render: (row) => (row[modality] ? format(row[modality]) : "—"),
    })),
    { key: "total", label: "Total", align: "right", render: (row) => format(row.total) },
  ];
  const tableRows = months
    .map((month, index) => ({
      id: month,
      month,
      total: totals[index],
      ...Object.fromEntries(shown.map((modality) => [modality, valueOf(month, modality)])),
    }))
    .filter((row) => row.total > 0);

  let chart = null;
  if (width > 0 && shown.length > 0) {
    const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
    const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const max = Math.max(...totals);
    const step = niceStep(max);
    const tickCount = Math.max(1, Math.ceil(max / step));
    const top = tickCount * step;
    const y = (v) => MARGIN.top + innerHeight - (v / top) * innerHeight;
    const band = innerWidth / months.length;
    const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, band * 0.6));
    const labelEvery = band >= 30 ? 1 : band >= 12 ? 3 : 6;

    chart = (
      <svg width={width} height={HEIGHT} role="group" aria-label={`${METRICS[metric].label} ${verb} per month, by modality`}>
        {Array.from({ length: tickCount + 1 }, (_, i) => i * step).map((t) => (
          <g key={t}>
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--ifm-color-emphasis-400)" : "var(--ifm-color-emphasis-200)"}
            />
            <text x={MARGIN.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ifm-color-emphasis-700)">
              {tick(t)}
            </text>
          </g>
        ))}

        {months.map((month, i) => {
          const center = MARGIN.left + band * (i + 0.5);
          const x = center - barWidth / 2;
          const monthNumber = Number(month.slice(5, 7));
          const segments = shown.map((modality) => [modality, valueOf(month, modality)]).filter(([, v]) => v > 0);
          let base = 0;
          return (
            <g key={month}>
              {active === i && (
                <rect
                  x={MARGIN.left + band * i}
                  y={MARGIN.top}
                  width={band}
                  height={innerHeight}
                  fill="var(--ifm-color-primary)"
                  opacity="0.07"
                />
              )}
              {segments.map(([modality, v], j) => {
                const y1 = y(base + v);
                const height = Math.max(1, y(base) - y1 - (j > 0 ? GAP : 0));
                base += v;
                return (
                  <path
                    key={modality}
                    d={segmentPath(x, y1, barWidth, height, j === segments.length - 1)}
                    fill={modalityColor(modality)}
                  />
                );
              })}
              {(labelEvery === 1 || (monthNumber - 1) % labelEvery === 0) && (
                <text x={center} y={HEIGHT - MARGIN.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--ifm-color-emphasis-700)">
                  {shortMonth(month)}
                </text>
              )}
              {(monthNumber === 1 || i === 0) && (
                <text
                  x={center}
                  y={HEIGHT - MARGIN.bottom + 31}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="var(--ifm-font-color-base)">
                  {month.slice(0, 4)}
                </text>
              )}
              <g
                className={styles.hit}
                tabIndex={0}
                role="img"
                aria-label={`${longMonth(month)}: ${format(totals[i])} ${METRICS[metric].label.toLowerCase()} ${verb}${
                  segments.length ? ` (${segments.map(([m, v]) => `${m} ${format(v)}`).join(", ")})` : ""
                }`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}>
                <rect
                  className={styles.focusRing}
                  x={MARGIN.left + band * i + 1}
                  y={MARGIN.top}
                  width={Math.max(1, band - 2)}
                  height={innerHeight}
                  fill="transparent"
                  rx="3"
                />
              </g>
            </g>
          );
        })}
      </svg>
    );

    if (active !== null && active < months.length) {
      const month = months[active];
      const rows = shown.map((modality) => [modality, valueOf(month, modality)]).filter(([, v]) => v > 0);
      const center = MARGIN.left + band * (active + 0.5);
      const onRight = center < width * 0.6;
      chart = (
        <>
          {chart}
          <div
            className={styles.tooltip}
            style={{
              left: onRight ? center + band / 2 + 6 : undefined,
              right: onRight ? undefined : width - center + band / 2 + 6,
              top: MARGIN.top,
            }}>
            <div className={styles.tooltipTitle}>
              {longMonth(month)} · {verb}
            </div>
            {rows.length === 0 && <div className={styles.hint}>Nothing {verb}</div>}
            {rows.map(([modality, v]) => (
              <div key={modality} className={styles.tooltipRow}>
                <span className={styles.key} style={{ background: modalityColor(modality) }} />
                <strong>{format(v)}</strong>
                <span>{modality}</span>
              </div>
            ))}
            {rows.length > 1 && (
              <div className={`${styles.tooltipRow} ${styles.tooltipTotal}`}>
                <span className={styles.key} />
                <strong>{format(totals[active])}</strong>
                <span>{metric === "files" ? "files" : "in total"}</span>
              </div>
            )}
          </div>
        </>
      );
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>Activity over time</h3>
        <span className={styles.description}>Data {verb} each month, by modality.</span>
        <div className={styles.toggles}>
          <Segmented
            small
            label="Measure"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "files", label: "Files" },
              { value: "size", label: "Size" },
            ]}
          />
          <Segmented
            small
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
      </div>

      {view === "chart" && shown.length > 0 && <ModalityLegend names={shown} className={styles.legend} />}
      {/* Always mounted, so that its width is known when switching views. */}
      <div className={styles.plot} ref={plotRef} onPointerLeave={() => setActive(null)}>
        {shown.length === 0 ? (
          <div className={styles.empty}>No dated files match these filters.</div>
        ) : view === "table" ? (
          <DataTable columns={tableColumns} rows={tableRows} />
        ) : (
          chart
        )}
      </div>

      {undated > 0 && (
        <p className={styles.note}>
          {formatNumber(undated)} {undated === 1 ? "file has" : "files have"} no {verb} date yet and{" "}
          {undated === 1 ? "isn't" : "aren't"} shown.
        </p>
      )}
    </section>
  );
}
