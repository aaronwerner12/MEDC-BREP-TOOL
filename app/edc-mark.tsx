// McKinney EDC brand mark: a clean, standard Texas silhouette. Monochrome,
// inherits currentColor, so it renders white on the dark rail and Deep Harbor
// Teal in page headers.
export function EdcMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="16 10 70 78" fill="none" aria-hidden="true">
      <path
        d="M34 15 L47 15 L47 32 L53 33 L58 31 L63 33 L69 32 L74 34 L78 38 L80 45 L82 52 L76 58 L70 63 L64 68 L59 72 L56 82 L52 73 L47 69 L42 66 L38 63 L35 60 L33 62 L31 58 L26 53 L21 46 L28 42 L31 38 L34 35 Z"
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
