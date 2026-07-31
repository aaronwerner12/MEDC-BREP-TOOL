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

// Turn a raw Anthropic/API error into a short, plain message for the UI. The SDK
// surfaces billing and auth problems as a JSON blob; translate the common ones
// so a user sees "out of credits" instead of a 400 body.
export function friendlyAiError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const low = msg.toLowerCase();
  if (low.includes("credit balance is too low") || low.includes("billing")) {
    return "AI features are paused: the Anthropic API credit balance is too low. Add credits in the Anthropic Console, or set ENABLE_AI_FEATURES=off to hide these buttons. The rest of the desk is unaffected.";
  }
  if (low.includes("401") || low.includes("authentication") || low.includes("invalid x-api-key")) {
    return "AI features could not authenticate. Check ANTHROPIC_API_KEY in your environment.";
  }
  if (low.includes("429") || low.includes("rate limit")) {
    return "AI features hit a rate limit. Wait a moment and try again.";
  }
  if (low.includes("overloaded") || low.includes("529")) {
    return "The AI service is temporarily overloaded. Try again shortly.";
  }
  return msg || "AI request failed.";
}
