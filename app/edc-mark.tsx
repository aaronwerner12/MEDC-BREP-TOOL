// McKinney EDC brand mark: a clean, standard Texas silhouette. Monochrome,
// inherits currentColor, so it renders white on the dark rail and Deep Harbor
// Teal in page headers.
export function EdcMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="12 6 80 84" fill="none" aria-hidden="true">
      <path
        d="M18 42 L28 30 L28 12 L46 12 L46 22 L58 23 L66 21 L73 25 L79 29 L81 39 L85 46 L81 53 L74 60 L66 65 L59 71 L56 83 L50 70 L44 64 L39 61 L34 57 L30 54 L26 51 L23 49 Z"
        fill="currentColor"
      />
    </svg>
  );
}

// "McKinney EDC" wordmark lockup, echoing the logo: the mark, the heavy
// condensed name, and "EDC" flanked by flag bars. Monochrome (currentColor).
export function EdcWordmark() {
  return (
    <div className="edc-wordmark" aria-label="McKinney EDC">
      <span className="ew-name">McKINNEY</span>
      <span className="ew-edc">
        <span className="ew-bars" />
        EDC
        <span className="ew-bars" />
      </span>
    </div>
  );
}
