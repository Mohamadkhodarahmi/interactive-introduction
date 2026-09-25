/**
 * Experience state — pure data, independent of rendering.
 * Scenes and the director read/write through the store; nothing here touches Three.js.
 */

export type SignalChoice = "approach" | "investigate" | "ignore";
export type InteractionStyle = "explorer" | "observer" | "direct";

export interface ExperienceState {
  started: boolean;

  name: string;

  powerRestored: boolean;
  signalFound: boolean;
  memoryRestored: boolean;

  signalChoice: SignalChoice | null;

  interactionStyle: InteractionStyle | null;

  exploredWindow: boolean;
  inspectedConsole: boolean;

  completedScenes: string[];

  currentScene: string;
}

/** Behaviour metrics used by the decision provider. Not part of the public state contract. */
export interface BehaviourMetrics {
  /** Optional (non-required) interactions the user performed. */
  optionalInteractions: number;
  /** Total drag-to-look distance in normalised screen units. */
  lookDistance: number;
  /** Milliseconds between being prompted and acting, per prompt. */
  reactionTimes: number[];
  /** Taps on the locked door before it was unlocked. */
  doorAttempts: number;
  /** Memory fragments inspected more than once. */
  revisits: number;
  startedAt: number;
}

export const initialState = (): ExperienceState => ({
  started: false,
  name: "",
  powerRestored: false,
  signalFound: false,
  memoryRestored: false,
  signalChoice: null,
  interactionStyle: null,
  exploredWindow: false,
  inspectedConsole: false,
  completedScenes: [],
  currentScene: "arrival",
});

export const initialMetrics = (): BehaviourMetrics => ({
  optionalInteractions: 0,
  lookDistance: 0,
  reactionTimes: [],
  doorAttempts: 0,
  revisits: 0,
  startedAt: performance.now(),
});

type Listener = (state: Readonly<ExperienceState>, prev: Readonly<ExperienceState>) => void;

const NAME_KEY = "unknown-system:name";

export class ExperienceStore {
  private state: ExperienceState = initialState();
  metrics: BehaviourMetrics = initialMetrics();
  private listeners = new Set<Listener>();

  get(): Readonly<ExperienceState> {
    return this.state;
  }

  set(patch: Partial<ExperienceState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }

  completeScene(id: string): void {
    if (this.state.completedScenes.includes(id)) return;
    this.set({ completedScenes: [...this.state.completedScenes, id] });
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  recordOptional(): void {
    this.metrics.optionalInteractions++;
  }

  recordReaction(ms: number): void {
    this.metrics.reactionTimes.push(ms);
  }

  /** Name is stored locally only (v1 never sends it anywhere). */
  saveName(name: string): void {
    this.set({ name });
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* storage may be unavailable (private mode) — state still holds it */
    }
  }

  rememberedName(): string {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  }

  reset(): void {
    const prev = this.state;
    this.state = initialState();
    this.metrics = initialMetrics();
    for (const l of this.listeners) l(this.state, prev);
  }
}
