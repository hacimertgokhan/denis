/**
 * Shell-like history navigation for an input (Up = older, Down = newer).
 * `entries` are most recent first. The draft typed before navigating is
 * restored when going past the newest entry.
 */
export class HistoryNav {
  constructor(entries = []) {
    this.entries = entries;
    this.index = -1; // -1 = editing the draft
    this.draft = "";
  }

  setEntries(entries) {
    this.entries = entries;
    this.reset();
  }

  reset() {
    this.index = -1;
    this.draft = "";
  }

  /** @returns {string|null} text to show, or null when nothing changes */
  up(current) {
    if (this.entries.length === 0) return null;
    if (this.index === -1) this.draft = current;
    if (this.index >= this.entries.length - 1) return null;
    this.index++;
    return this.entries[this.index];
  }

  down() {
    if (this.index === -1) return null;
    this.index--;
    return this.index === -1 ? this.draft : this.entries[this.index];
  }
}
