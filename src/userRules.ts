/**
 * Rules saved from the app ("Save as rule…", the explorer): a rule with its
 * parameter values and view baked in, kept in this browser's storage and listed
 * under "My rules". Exported and imported as .json files.
 */
import type { RuleDef } from './rule';

export interface UserRule {
  id: string;
  rule: RuleDef;
  saved: string;
}

const KEY = 'rdui.userRules';

export class UserRules {
  rules: UserRule[] = [];
  saveError: string | null = null;
  onChange: () => void = () => {};

  constructor() {
    try {
      this.rules = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    } catch {
      this.rules = [];
    }
  }

  get(id: string) {
    return this.rules.find((r) => r.id === id);
  }

  add(rule: RuleDef) {
    const u: UserRule = { id: Math.random().toString(36).slice(2, 10), rule, saved: new Date().toISOString() };
    this.rules.push(u);
    this.persist();
    return u;
  }

  remove(id: string) {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.persist();
  }

  /** A file holding one rule (or a list, from export of several). */
  import(text: string) {
    const j = JSON.parse(text);
    const list: RuleDef[] = Array.isArray(j) ? j.map((x) => x.rule ?? x) : [j.rule ?? j];
    for (const r of list) {
      if (!r.formula || !Array.isArray(r.reagents) || !Array.isArray(r.params)) throw new Error('not an rdui rule');
    }
    return list.map((r) => this.add(r));
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.rules));
      this.saveError = null;
    } catch (e) {
      this.saveError = `Couldn't save rules in this browser: ${(e as Error).message}`;
    }
    this.onChange();
  }
}
