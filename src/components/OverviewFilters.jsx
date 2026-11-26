import { useMemo } from "react";
import MultiSelect from "./MultiSelect";
import Segmented from "./Segmented";
import { emptyFilters, hasFilters } from "./useUrlFilters";
import { modalityColor } from "./modalities";
import { ARCHIVES, formatBytes } from "./data";
import { OVERVIEW_FILTERS, applyFilters, basisOf, sizeBy } from "./overview";
import styles from "./Filters.module.css";

// The filters of the home page and the Datasets page, from useOverview().
export default function OverviewFilters({ files, filters, setFilters, deferred, modalities }) {
  const update = (changes) => setFilters({ ...filters, ...changes });
  const basis = basisOf(deferred);
  const selectedBasis = basisOf(filters);

  // The size of the data for each option, within the other filters, so that
  // each size is what selecting it would show
  const modalitySizes = useMemo(
    () => sizeBy(applyFilters(files, { ...deferred, Modality: [] }, basis), "Modality"),
    [files, deferred, basis],
  );
  const archiveSizes = useMemo(
    () => sizeBy(applyFilters(files, { ...deferred, Archive: "" }, basis), "Archive"),
    [files, deferred, basis],
  );
  const monthOptions = useMemo(
    () => [...new Set(files.map((file) => file[selectedBasis].slice(0, 7)).filter(Boolean))].sort(),
    [files, selectedBasis],
  );

  return (
    <div className={styles.toolbar}>
      <MultiSelect
        label="Modality"
        allLabel="All modalities"
        selected={filters.Modality}
        onChange={(Modality) => update({ Modality })}
        options={modalities.map((name) => ({
          value: name,
          color: modalityColor(name),
          detail: formatBytes(modalitySizes.get(name) ?? 0),
        }))}
      />
      <label className={styles.filter}>
        <span>Archive</span>
        <select value={filters.Archive} onChange={(event) => update({ Archive: event.target.value })}>
          <option value="">All archives</option>
          {Object.entries(ARCHIVES).map(([archive, { host }]) => (
            <option key={archive} value={archive}>
              {host} ({formatBytes(archiveSizes.get(archive) ?? 0)})
            </option>
          ))}
        </select>
      </label>
      <div className={styles.filter}>
        <span>Dates</span>
        <Segmented
          label="Dates"
          value={filters.Dates === "uploaded" ? "uploaded" : ""}
          onChange={(Dates) => update({ Dates })}
          options={[
            { value: "", label: "Produced" },
            { value: "uploaded", label: "Uploaded" },
          ]}
        />
      </div>
      <label className={`${styles.filter} ${styles.month}`}>
        <span>From</span>
        <select value={filters.From} onChange={(event) => update({ From: event.target.value })}>
          <option value="">Earliest</option>
          {monthOptions.map((month) => (
            <option key={month} value={month}>
              {month}
            </option>
          ))}
        </select>
      </label>
      <label className={`${styles.filter} ${styles.month}`}>
        <span>To</span>
        <select value={filters.To} onChange={(event) => update({ To: event.target.value })}>
          <option value="">Latest</option>
          {monthOptions.map((month) => (
            <option key={month} value={month}>
              {month}
            </option>
          ))}
        </select>
      </label>
      {hasFilters(OVERVIEW_FILTERS, filters) && (
        <button type="button" className={styles.clear} onClick={() => setFilters(emptyFilters(OVERVIEW_FILTERS))}>
          Clear filters
        </button>
      )}
    </div>
  );
}
