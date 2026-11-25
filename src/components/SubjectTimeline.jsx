import { useMemo, useRef, useState } from "react";
import { useHistory } from "@docusaurus/router";
import useBaseUrl from "@docusaurus/useBaseUrl";
import { ModalityLegend, UNKNOWN_MODALITY, compareModalities, modalityColor } from "./modalities";
import { compareLabels, formatNumber } from "./data";
import { dayValue, monthEndValue, shortMonth, useElementWidth } from "./charts";
import styles from "./Charts.module.css";

// Values of the Subject column that are not subjects
const NOT_SUBJECTS = new Set(["n/a", "Unknown"]);

const LABEL_WIDTH = 170;
const RIGHT = 16;
const AXIS_HEIGHT = 24;
const ROW_HEIGHT = 12;
const LANE_MIN_HEIGHT = 28;
const LANE_GAP = 8;
const MIN_WIDTH = 640;
const MIN_BAR_WIDTH = 8;
const DAY = 24 * 60 * 60 * 1000;

/**
 * When each subject's data was produced (or uploaded), by modality.
 *
 * files: [{ Subject, Modality, DatasetId, Produced, Uploaded }]
 * basis: "Produced" | "Uploaded"
 * months: the months to show, "YYYY-MM"
 * includeUnknown: whether to show files of unknown modality
 * linkParams: extra query parameters for links to the Files page
 */
export default function SubjectTimeline({ files, basis, months, includeUnknown, linkParams = {} }) {
  const scrollRef = useRef(null);
  const containerWidth = useElementWidth(scrollRef);
  const [active, setActive] = useState(null);
  const history = useHistory();
  const filesPath = useBaseUrl("/files");

  const lanes = useMemo(() => {
    const bySubject = new Map();
    for (const file of files) {
      const date = file[basis];
      if (!date || NOT_SUBJECTS.has(file.Subject)) continue;
      if (file.Modality === UNKNOWN_MODALITY && !includeUnknown) continue;
      if (!bySubject.has(file.Subject)) bySubject.set(file.Subject, new Map());
      const byModality = bySubject.get(file.Subject);
      const item = byModality.get(file.Modality) ?? { first: date, last: date, files: 0, datasets: new Set() };
      if (date < item.first) item.first = date;
      if (date > item.last) item.last = date;
      item.files += 1;
      item.datasets.add(file.DatasetId);
      byModality.set(file.Modality, item);
    }
    return [...bySubject]
      .map(([subject, byModality]) => {
        const items = [...byModality]
          .map(([modality, item]) => ({ subject, modality, ...item }))
          .sort((a, b) => compareModalities(a.modality, b.modality));
        const datasets = [...new Set(items.flatMap((item) => [...item.datasets]))].sort(compareLabels);
        const first = items.reduce((min, item) => (item.first < min ? item.first : min), items[0].first);
        return { subject, items, datasets, first };
      })
      .sort((a, b) => a.first.localeCompare(b.first) || compareLabels(a.subject, b.subject));
  }, [files, basis, includeUnknown]);

  const legendNames = [...new Set(lanes.flatMap((lane) => lane.items.map((item) => item.modality)))].sort(compareModalities);
  const verb = basis.toLowerCase();

  function open(item) {
    const params = new URLSearchParams({ ...linkParams, subject: item.subject, modality: item.modality });
    history.push(`${filesPath}?${params}`);
  }

  let plot = null;
  if (containerWidth > 0 && lanes.length > 0 && months.length > 0) {
    const width = Math.max(MIN_WIDTH, containerWidth);
    const start = dayValue(`${months[0]}-01`);
    const end = monthEndValue(months[months.length - 1]);
    const x = (ms) => LABEL_WIDTH + ((ms - start) / (end - start)) * (width - LABEL_WIDTH - RIGHT);
    const laneHeight = (lane) => Math.max(lane.items.length * ROW_HEIGHT, LANE_MIN_HEIGHT) + LANE_GAP;
    const height = AXIS_HEIGHT + lanes.reduce((sum, lane) => sum + laneHeight(lane), 0);
    const quarterly = months.length > 8;

    let laneTop = AXIS_HEIGHT;
    const positions = new Map();
    const laneElements = lanes.map((lane) => {
      const top = laneTop;
      laneTop += laneHeight(lane);
      return (
        <g key={lane.subject}>
          <text x="0" y={top + 10} fontSize="12" fill="var(--ifm-font-color-base)">
            {lane.subject}
          </text>
          <text x="0" y={top + 23} fontSize="10" fill="var(--ifm-color-emphasis-600)">
            {lane.datasets.length > 2 ? `${lane.datasets.slice(0, 2).join(", ")} +${lane.datasets.length - 2}` : lane.datasets.join(", ")}
          </text>
          {lane.items.map((item, k) => {
            const cy = top + k * ROW_HEIGHT + 6;
            const x1 = x(dayValue(item.first));
            const x2 = x(dayValue(item.last) + DAY);
            const isDot = x2 - x1 < MIN_BAR_WIDTH;
            const key = `${item.subject}|${item.modality}`;
            const center = (x1 + x2) / 2;
            positions.set(key, { start: isDot ? center : x1, end: isDot ? center : x2, top: cy, item });
            const range = item.first === item.last ? item.first : `${item.first} to ${item.last}`;
            return (
              <g
                key={item.modality}
                className={styles.hit}
                tabIndex={0}
                role="link"
                aria-label={`${item.subject}, ${item.modality}: ${verb} ${range}, ${formatNumber(item.files)} files. View files.`}
                onPointerEnter={() => setActive(key)}
                onFocus={() => setActive(key)}
                onBlur={() => setActive(null)}
                onClick={() => open(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open(item);
                  }
                }}>
                <rect
                  className={styles.focusRing}
                  x={Math.min(x1, (x1 + x2) / 2 - 8) - 2}
                  y={cy - 6}
                  width={Math.max(x2 - x1, 16) + 4}
                  height={ROW_HEIGHT}
                  rx="4"
                  fill="transparent"
                />
                {isDot ? (
                  <circle cx={(x1 + x2) / 2} cy={cy} r="4.5" fill={modalityColor(item.modality)} stroke="var(--ifm-background-color)" strokeWidth="2" />
                ) : (
                  <rect x={x1} y={cy - 4} width={x2 - x1} height="8" rx="4" fill={modalityColor(item.modality)} />
                )}
              </g>
            );
          })}
          <line x1="0" x2={width} y1={laneTop - LANE_GAP / 2} y2={laneTop - LANE_GAP / 2} stroke="var(--ifm-color-emphasis-200)" />
        </g>
      );
    });

    const ticks = months.filter((month) => !quarterly || ["01", "04", "07", "10"].includes(month.slice(5, 7)));

    plot = (
      <>
        <svg width={width} height={height} role="group" aria-label={`Subjects' data ${verb} over time, by modality`}>
          {ticks.map((month) => {
            const tx = x(dayValue(`${month}-01`));
            const isYear = month.endsWith("-01");
            return (
              <g key={month}>
                <line
                  x1={tx}
                  x2={tx}
                  y1={AXIS_HEIGHT - 6}
                  y2={height}
                  stroke={isYear ? "var(--ifm-color-emphasis-400)" : "var(--ifm-color-emphasis-200)"}
                />
                <text
                  x={tx + 4}
                  y={AXIS_HEIGHT - 10}
                  fontSize="11"
                  fontWeight={isYear ? 600 : 400}
                  fill={isYear ? "var(--ifm-font-color-base)" : "var(--ifm-color-emphasis-700)"}>
                  {shortMonth(month)}
                  {isYear ? ` ${month.slice(0, 4)}` : ""}
                </text>
              </g>
            );
          })}
          {laneElements}
        </svg>
        {active && positions.has(active) && (() => {
          const { start, end, top, item } = positions.get(active);
          // Beside the bar: after its end, or before its start near the right edge
          const onRight = end < width - 240;
          return (
            <div
              className={styles.tooltip}
              style={{
                left: onRight ? end + 10 : undefined,
                right: onRight ? undefined : width - start + 10,
                top: Math.max(0, top - 18),
              }}>
              <div className={styles.tooltipTitle}>
                {item.subject} · {item.modality}
              </div>
              <div>
                <strong>{item.first === item.last ? item.first : `${item.first} – ${item.last}`}</strong>
              </div>
              <div>
                {formatNumber(item.files)} {item.files === 1 ? "file" : "files"} · {[...item.datasets].sort(compareLabels).join(", ")}
              </div>
              <div className={styles.hint}>Select to view files</div>
            </div>
          );
        })()}
      </>
    );
  }

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>Subject timeline</h3>
        <span className={styles.description}>
          When each subject's data was {verb}, by modality. Select a bar to see its files.
        </span>
      </div>
      {lanes.length > 0 && <ModalityLegend names={legendNames} className={styles.legend} />}
      <div className={styles.scroll} ref={scrollRef} onPointerLeave={() => setActive(null)}>
        {lanes.length === 0 ? <div className={styles.empty}>No dated files with a subject match these filters.</div> : plot}
      </div>
      {!includeUnknown && (
        <p className={styles.note}>Files of unknown modality are left out unless “Unknown” is selected in the Modality filter.</p>
      )}
    </section>
  );
}
