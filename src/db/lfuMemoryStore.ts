import { logger } from '@/utils/logger';

export interface MemoryStoreEntry<T> {
  key: string;
  value: T;
  accessCount: number;
  lastAccessed: number;
}

/**
 * LFU (Least Frequently Used) Memory Store with Fan-Out Eviction.
 * Prevents exponential memory growth by automatically tracking usage frequency
 * and evicting/fanning out least-used keys when capacity is reached.
 */
export class LFUMemoryStore<T = any> {
  private store = new Map<string, MemoryStoreEntry<T>>();
  private readonly maxSize: number;
  private readonly onEvict?: (key: string, value: T) => void;

  constructor(maxSize = 500, onEvict?: (key: string, value: T) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }

  /**
   * Retrieves an item from the store and increments its access frequency count.
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    // Increment access frequency and update timestamp
    entry.accessCount += 1;
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  /**
   * Stores an item. If maximum capacity is reached, triggers LFU fan-out eviction.
   */
  set(key: string, value: T): void {
    const existing = this.store.get(key);
    if (existing) {
      existing.value = value;
      existing.accessCount += 1;
      existing.lastAccessed = Date.now();
      return;
    }

    // Check if store exceeds maxSize, perform fan-out eviction
    if (this.store.size >= this.maxSize) {
      this.evictLeastUsed();
    }

    this.store.set(key, {
      key,
      value,
      accessCount: 1,
      lastAccessed: Date.now(),
    });
  }

  /**
   * Identifies and evicts the least frequently used keys (breaking ties with oldest access time).
   * Fans out evicted entries to callback or logger.
   */
  evictLeastUsed(evictCount = Math.max(1, Math.floor(this.maxSize * 0.1))): string[] {
    if (this.store.size === 0) {
      return [];
    }

    // Sort entries by accessCount ascending, then by lastAccessed ascending (oldest first)
    const sortedEntries = Array.from(this.store.values()).sort((a, b) => {
      if (a.accessCount === b.accessCount) {
        return a.lastAccessed - b.lastAccessed;
      }
      return a.accessCount - b.accessCount;
    });

    const toEvict = sortedEntries.slice(0, evictCount);
    const evictedKeys: string[] = [];

    for (const entry of toEvict) {
      logger.warn(
        `[LFUMemoryStore] Fan-Out Eviction: Pruning least-used key "${entry.key}" (accessCount: ${entry.accessCount}, lastAccessed: ${new Date(entry.lastAccessed).toISOString()}) to prevent exponential memory growth.`
      );

      // Invoke optional fan-out callback (e.g. archiving or broadcasting eviction)
      if (this.onEvict) {
        try {
          this.onEvict(entry.key, entry.value);
        } catch (err: any) {
          logger.error(`[LFUMemoryStore] Error during onEvict fan-out for key "${entry.key}": ${err.message}`);
        }
      }

      this.store.delete(entry.key);
      evictedKeys.push(entry.key);
    }

    return evictedKeys;
  }

  /**
   * Checks if key exists in the store without modifying usage statistics.
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Deletes a key from the store.
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Returns all values currently in the store.
   */
  *values(): IterableIterator<T> {
    for (const entry of this.store.values()) {
      yield entry.value;
    }
  }

  /**
   * Returns all entries with their usage metrics for diagnostic inspections.
   */
  getDiagnostics(): Array<{ key: string; accessCount: number; lastAccessed: string }> {
    return Array.from(this.store.values()).map((e) => ({
      key: e.key,
      accessCount: e.accessCount,
      lastAccessed: new Date(e.lastAccessed).toISOString(),
    }));
  }

  /**
   * Clears the store.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Gets the current number of stored items.
   */
  get size(): number {
    return this.store.size;
  }
}
