import { createUniqueId, deepClone } from './presets';
import { CustomMapDocument, EditorHistoryEntrySnapshot, MapObject } from './types';

export interface EditorStateSnapshot {
  document: CustomMapDocument;
  selectedIds: string[];
}

interface HistoryEntry {
  label: string;
  timestamp: number;
  beforeJson: string;
  afterJson: string;
}

export class EditorHistory {
  private entries: HistoryEntry[] = [];
  private cursor = -1;
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  public push(label: string, before: EditorStateSnapshot, after: EditorStateSnapshot): void {
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);
    if (beforeJson === afterJson) return;

    if (this.cursor < this.entries.length - 1) {
      this.entries.splice(this.cursor + 1);
    }
    this.entries.push({
      label,
      timestamp: Date.now(),
      beforeJson,
      afterJson,
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.cursor = this.entries.length - 1;
  }

  public canUndo(): boolean {
    return this.cursor >= 0;
  }

  public canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  public undo(): { label: string; state: EditorStateSnapshot } | null {
    if (!this.canUndo()) return null;
    const entry = this.entries[this.cursor];
    this.cursor--;
    return { label: entry.label, state: JSON.parse(entry.beforeJson) as EditorStateSnapshot };
  }

  public redo(): { label: string; state: EditorStateSnapshot } | null {
    if (!this.canRedo()) return null;
    this.cursor++;
    const entry = this.entries[this.cursor];
    return { label: entry.label, state: JSON.parse(entry.afterJson) as EditorStateSnapshot };
  }

  public getUndoLabel(): string | null {
    return this.cursor >= 0 ? this.entries[this.cursor].label : null;
  }

  public getRedoLabel(): string | null {
    return this.cursor < this.entries.length - 1 ? this.entries[this.cursor + 1].label : null;
  }

  public exportSnapshots(): { entries: EditorHistoryEntrySnapshot[]; index: number } {
    return {
      entries: this.entries.map((e) => ({
        label: e.label,
        timestamp: e.timestamp,
        stateJson: JSON.stringify({ before: e.beforeJson, after: e.afterJson }),
      })),
      index: this.cursor,
    };
  }

  public restoreSnapshots(entries: EditorHistoryEntrySnapshot[], index: number): void {
    this.entries = entries.map((e) => {
      const parsed = JSON.parse(e.stateJson) as { before: string; after: string };
      return {
        label: e.label,
        timestamp: e.timestamp,
        beforeJson: parsed.before,
        afterJson: parsed.after,
      };
    });
    this.cursor = Math.max(-1, Math.min(this.entries.length - 1, index));
  }
}

export class EditorClipboard {
  private items: MapObject[] = [];

  public copy(objects: MapObject[]): number {
    this.items = objects.map((o) => deepClone(o));
    return this.items.length;
  }

  public hasItems(): boolean {
    return this.items.length > 0;
  }

  public paste(offset: [number, number, number] = [1.5, 0, 1.5]): MapObject[] {
    return this.items.map((o) => {
      const copy = deepClone(o);
      copy.id = createUniqueId('obj');
      copy.name = `${o.name} (Copy)`;
      copy.locked = false;
      copy.position = [
        Number((o.position[0] + offset[0]).toFixed(3)),
        Number((o.position[1] + offset[1]).toFixed(3)),
        Number((o.position[2] + offset[2]).toFixed(3)),
      ];
      return copy;
    });
  }
}

export class SelectionHistory {
  private stack: string[][] = [];
  private cursor = -1;

  public push(ids: string[]): void {
    const clean = [...ids];
    const cur = this.stack[this.cursor];
    if (cur && cur.length === clean.length && cur.every((v, i) => v === clean[i])) return;
    if (this.cursor < this.stack.length - 1) this.stack.splice(this.cursor + 1);
    this.stack.push(clean);
    if (this.stack.length > 40) this.stack.shift();
    this.cursor = this.stack.length - 1;
  }

  public canBack(): boolean {
    return this.cursor > 0;
  }

  public canForward(): boolean {
    return this.cursor < this.stack.length - 1;
  }

  public back(): string[] | null {
    if (!this.canBack()) return null;
    this.cursor--;
    return [...this.stack[this.cursor]];
  }

  public forward(): string[] | null {
    if (!this.canForward()) return null;
    this.cursor++;
    return [...this.stack[this.cursor]];
  }
}
