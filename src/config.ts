/**
 * Everything personal lives here so the experience can be re-authored without
 * touching scene code.
 */
export const CREATOR = {
  /** Shown in Persian lines: «من [name] هستم.» */
  name: "محمد",
  /** Shown on the laptop screen (monospace, uppercase). */
  nameLatin: "MOHAMAD KHODARAHMI",
  github: "https://github.com/Mohamadkhodarahmi",
  /**
   * Contact channels shown under «راه ارتباطی من». Empty entries are hidden.
   * Fill these in before deploying.
   */
  contacts: [
    { label: "GitHub", value: "Mohamadkhodarahmi", href: "https://github.com/Mohamadkhodarahmi" },
    { label: "Telegram", value: "", href: "" },
    { label: "Email", value: "", href: "" },
  ] as { label: string; value: string; href: string }[],
  /**
   * Where a visitor's optional contact goes.
   * - `endpoint`: any URL that accepts a JSON POST — e.g. a Formspree form
   *   ("https://formspree.io/f/xxxxxxx") or your own Telegram-bot worker.
   *   Payload: { name, contact, signalChoice, interactionStyle, at }.
   * - `email`: fallback — opens a pre-filled mail draft the visitor sends.
   * With neither set, the note is only kept on the visitor's device.
   */
  inbox: { endpoint: "", email: "" },
};
