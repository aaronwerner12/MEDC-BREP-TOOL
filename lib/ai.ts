// Single switch for the optional AI features (company profile, briefing, news
// scan, employer discovery). The core of the desk -- pulling feeds, rules-based
// scoring, the risk index, the dashboard and digest -- never touches this and
// runs with no API key at all.
//
// AI is on when an Anthropic key is present AND it has not been explicitly
// turned off. To keep the key configured but disable the paid features, set
// ENABLE_AI_FEATURES to off (or false / 0 / no).
export function aiEnabled(): boolean {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  const flag = (process.env.ENABLE_AI_FEATURES ?? "").trim().toLowerCase();
  if (["off", "false", "0", "no", "disabled"].includes(flag)) return false;
  return true;
}

// Human-readable reason the AI features are unavailable, for graceful messages.
export function aiDisabledReason(): string {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "AI features are off. Set ANTHROPIC_API_KEY to enable profiles, briefings, and news.";
  }
  return "AI features are turned off (ENABLE_AI_FEATURES). Remove that flag to re-enable them.";
}
