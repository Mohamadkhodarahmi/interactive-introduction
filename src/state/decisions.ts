import type { BehaviourMetrics, ExperienceState, InteractionStyle } from "./ExperienceState";

/**
 * Decision layer. The system never generates text — it only picks from predefined
 * actions. A future `JevDecisionProvider` can implement the same interface; it must
 * never touch Three.js directly, only return one of the predefined actions below.
 */

export type DecisionKind = "analyzeUser";

export interface DecisionContext {
  kind: DecisionKind;
  state: Readonly<ExperienceState>;
  metrics: Readonly<BehaviourMetrics>;
}

export const ANALYSIS_LINES: Record<InteractionStyle, string> = {
  explorer: "تو از اونایی هستی که همه‌چی رو باید ببینن، نه؟",
  direct: "خیلی سریع میری سر اصل مطلب.",
  observer: "قبل از اینکه کاری بکنی، اول مطمئن می‌شی.",
};

export interface Decision {
  /** One of the predefined actions for the given decision kind. */
  action: InteractionStyle;
  line: string;
  /** Normalised scores, for debugging / future providers. */
  scores: Record<InteractionStyle, number>;
}

export interface DecisionProvider {
  chooseNextAction(context: DecisionContext): Promise<Decision>;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export class LocalDecisionProvider implements DecisionProvider {
  async chooseNextAction({ state, metrics }: DecisionContext): Promise<Decision> {
    const scores: Record<InteractionStyle, number> = { explorer: 0, observer: 0, direct: 0 };

    // Exploration: optional taps, looking around, poking at locked things.
    scores.explorer += metrics.optionalInteractions * 1.0;
    scores.explorer += Math.min(metrics.lookDistance, 6) * 0.5;
    scores.explorer += metrics.doorAttempts * 0.6 + metrics.revisits * 0.6;
    if (state.exploredWindow) scores.explorer += 1;
    if (state.inspectedConsole) scores.explorer += 1;

    // Choice itself is the strongest single signal.
    if (state.signalChoice === "investigate") scores.observer += 3;
    if (state.signalChoice === "approach") scores.direct += 2.5;
    if (state.signalChoice === "ignore") scores.direct += 1.5;

    // Tempo: slow, deliberate reactions → observer; fast → direct.
    const reaction = avg(metrics.reactionTimes);
    if (reaction > 0) {
      if (reaction > 7000) scores.observer += 2;
      else if (reaction > 3500) scores.observer += 1;
      else if (reaction < 1800) scores.direct += 2;
      else scores.direct += 0.5;
    }

    const order: InteractionStyle[] = ["explorer", "observer", "direct"];
    let action: InteractionStyle = "observer";
    let best = -Infinity;
    for (const k of order) {
      if (scores[k] > best) {
        best = scores[k];
        action = k;
      }
    }
    return { action, line: ANALYSIS_LINES[action], scores };
  }
}
