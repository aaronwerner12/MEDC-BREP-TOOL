// McKinney EDC brand mark: a clean five-point Lone Star (the star from the MEDC
// logo). Monochrome, inherits currentColor, so it renders white on the dark
// rail and Deep Harbor Teal in page headers. Crisp at any size.
export function EdcMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path
        d="M50 6 L60.3 35.8 L91.8 36.4 L66.6 55.4 L75.9 85.6 L50 67.5 L24.1 85.6 L33.4 55.4 L8.2 36.4 L39.7 35.8 Z"
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
