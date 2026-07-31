// Shared signal shapes. Every adapter produces NormalizedSignal[]; the scorer
// turns those into ScoredSignal[]; the ingester writes ScoredSignal to Neon.
// The scorer and ingester never need to know which feed produced a signal.

export type SignalTier = "authoritative" | "indicative";

export type SignalType = "risk" | "growth" | "neutral";

// What an adapter reports. Adapters are pure: they fetch a feed and map it to
// this shape. They never classify (that is the scorer's job) and never invent
// a signal the feed did not actually return.
export interface NormalizedSignal {
  source: string; // 'usaspending' | 'costar' | 'twc_warn' | 'sec_edgar' | 'permits'
  tier: SignalTier;
  externalId: string; // feed's native id, used for dedupe via unique(source, external_id)
  companyName: string; // name as the feed reports it (matched to an employer later)
  observedText: string; // the factual text the scorer classifies
  sourceUrl?: string;
  eventDate?: string; // when the underlying event happened (ISO date); defaults to now
  raw?: unknown; // original feed payload, stored as jsonb
}

// What the scorer produces: the normalized signal plus classification and the
// resolved employer id (null when no watchlist match).
export interface ScoredSignal extends NormalizedSignal {
  employerId: number | null;
  signalType: SignalType;
  category: string;
  priority: number; // 0-100
  summary: string;
  recommendedAction: string;
  talkingPoint: string;
}
