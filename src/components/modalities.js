import { compareLabels } from "./data";

// Modalities in display order, each with a fixed color so that a modality
// keeps its color whatever the filters. The first six colors are slots 1-6 of
// a categorical palette validated for color-vision deficiencies when adjacent
// (e.g. stacked); "Unknown" is a neutral gray.
export const MODALITIES = [
  { name: "PS-OCT", color: "#257de0" },
  { name: "Dark field microscopy", color: "#f47230" },
  { name: "HiP-CT", color: "#00b894" },
  { name: "Diffusion MRI", color: "#f2a600" },
  { name: "Light sheet microscopy", color: "#ee7fac" },
  { name: "Blockface photo", color: "#008a17" },
  { name: "Unknown", color: "#b9bac2" },
];

export const UNKNOWN_MODALITY = "Unknown";
const FALLBACK_COLOR = "#8d9098";
const ORDER = MODALITIES.map(({ name }) => name);

export function modalityColor(name) {
  return MODALITIES.find((modality) => modality.name === name)?.color ?? FALLBACK_COLOR;
}

// Known modalities in display order, then any others alphabetically, with
// "Unknown" last.
export function compareModalities(a, b) {
  const rank = (name) => {
    const index = ORDER.indexOf(name);
    if (name === UNKNOWN_MODALITY) return ORDER.length + 1;
    return index === -1 ? ORDER.length : index;
  };
  return rank(a) - rank(b) || compareLabels(a, b);
}

export function ModalityLegend({ names, className }) {
  return (
    <div className={className} style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 1rem" }}>
      {names.map((name) => (
        <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: 2, background: modalityColor(name), flex: "none" }}
          />
          {name}
        </span>
      ))}
    </div>
  );
}
