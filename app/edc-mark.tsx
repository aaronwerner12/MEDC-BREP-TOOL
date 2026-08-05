// McKinney EDC brand mark: a Texas outline with a star over North Texas (where
// McKinney sits), echoing the MEDC logo. Monochrome and inherits currentColor,
// so it renders in white on the dark rail and in Deep Harbor Teal elsewhere.
export function EdcMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      {/* Texas silhouette (outline, like the logo). */}
      <path
        d="M28 12 L44 12 L44 24 L72 26 L80 34 L88 42 L84 53 L89 58 L80 67 L69 74 L61 88 L52 73 L40 65 L30 53 L24 47 L20 41 L26 35 L27 24 Z"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
      {/* Star over North Texas. */}
      <path
        d="M12 2 L14.7 8.5 L21.6 9.1 L16.3 13.6 L18 20.5 L12 16.8 L6 20.5 L7.7 13.6 L2.4 9.1 L9.3 8.5 Z"
        transform="translate(47 5) scale(0.95)"
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
