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
   * Contact channels shown at the end (in this order). Links open in a new tab;
   * t.me links open the Telegram app directly on phones.
   */
  contacts: [
    { label: "Telegram", value: "@mohammadkhodarahmi", href: "https://t.me/mohammadkhodarahmi" },
    { label: "GitHub", value: "Mohamadkhodarahmi", href: "https://github.com/Mohamadkhodarahmi" },
  ] as { label: string; value: string; href: string }[],
};
