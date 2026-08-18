/**
 * In-memory metrics collector for counters and timings.
 *
 * In production, these would be exported to Prometheus or a similar system.
 * For now, they're stored in-memory and can be queried for testing.
 */

type LabelKey = string;

function labelKey(labels: Record<string, string>): LabelKey {
  return JSON.stringify(labels, Object.keys(labels).sort());
}

class MetricsCollector {
  private counters: Map<string, Map<LabelKey, number>> = new Map();
  private timings: Map<string, Map<LabelKey, number[]>> = new Map();

  reset(): void {
    this.counters.clear();
    this.timings.clear();
  }

  increment(name: string, labels: Record<string, string> = {}): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Map());
    }
    const key = labelKey(labels);
    const current = this.counters.get(name)!.get(key) ?? 0;
    this.counters.get(name)!.set(key, current + 1);
  }

  getCount(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(name)?.get(labelKey(labels)) ?? 0;
  }

  timing(name: string, valueMs: number, labels: Record<string, string> = {}): void {
    if (!this.timings.has(name)) {
      this.timings.set(name, new Map());
    }
    const key = labelKey(labels);
    const existing = this.timings.get(name)!.get(key) ?? [];
    existing.push(valueMs);
    this.timings.get(name)!.set(key, existing);
  }

  getTimings(name: string, labels: Record<string, string> = {}): number[] {
    return this.timings.get(name)?.get(labelKey(labels)) ?? [];
  }

  /**
   * Export all metrics as a flat array. Useful for debugging and testing.
   */
  export(): {
    type: "counter" | "timing";
    name: string;
    labels: Record<string, string>;
    value: number | number[];
  }[] {
    const result: {
      type: "counter" | "timing";
      name: string;
      labels: Record<string, string>;
      value: number | number[];
    }[] = [];
    for (const [name, labelMap] of this.counters) {
      for (const [key, value] of labelMap) {
        result.push({ type: "counter", name, labels: JSON.parse(key), value });
      }
    }
    for (const [name, labelMap] of this.timings) {
      for (const [key, value] of labelMap) {
        result.push({ type: "timing", name, labels: JSON.parse(key), value });
      }
    }
    return result;
  }
}

export const metrics = new MetricsCollector();
