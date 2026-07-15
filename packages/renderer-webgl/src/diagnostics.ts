const DEFAULT_DIAGNOSTIC_CAPACITY = 64;
const DEFAULT_DIAGNOSTIC_KEY_LENGTH = 192;
const DEFAULT_DIAGNOSTIC_MESSAGE_LENGTH = 768;

export type BoundedDiagnosticDecision = "append" | "drop" | "increment";

export const boundedDiagnosticDecision = (
  existing: boolean,
  retained: number,
  capacity: number,
): BoundedDiagnosticDecision => {
  if (existing) return "increment";
  return retained < capacity ? "append" : "drop";
};

const saturatingIncrement = (value: number): number =>
  value < Number.MAX_SAFE_INTEGER ? value + 1 : value;

const diagnosticKeyHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const boundedDiagnosticKey = (key: string, maxLength: number): string => {
  if (key.length <= maxLength) return key;
  const suffix = `#${diagnosticKeyHash(key)}`;
  return `${key.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
};

const boundedDiagnosticMessage = (message: string, maxLength: number): string =>
  message.length <= maxLength
    ? message
    : `${message.slice(0, Math.max(0, maxLength - 1))}…`;

type MutableDiagnosticEntry = {
  count: number;
  readonly key: string;
  readonly message: string;
};

export interface DiagnosticOccurrenceSnapshot {
  readonly count: number;
  readonly key: string;
}

export interface BoundedDiagnosticSnapshot {
  readonly capacity: number;
  readonly dropped: number;
  readonly messages: readonly string[];
  readonly occurrences: readonly DiagnosticOccurrenceSnapshot[];
  readonly retained: number;
}

export type DiagnosticRecordResult = "appended" | "dropped" | "incremented";

/** Mutable shell around the pure fixed-capacity admission policy. */
export class BoundedDiagnosticLog {
  readonly #capacity: number;
  #dropped = 0;
  readonly #entries: MutableDiagnosticEntry[] = [];
  readonly #indices = new Map<string, number>();
  readonly #keyLength: number;
  readonly #messageLength: number;

  constructor(options: {
    readonly capacity?: number;
    readonly keyLength?: number;
    readonly messageLength?: number;
  } = {}) {
    this.#capacity = Math.max(0, Math.floor(options.capacity ?? DEFAULT_DIAGNOSTIC_CAPACITY));
    this.#keyLength = Math.max(16, Math.floor(options.keyLength ?? DEFAULT_DIAGNOSTIC_KEY_LENGTH));
    this.#messageLength = Math.max(16, Math.floor(options.messageLength ?? DEFAULT_DIAGNOSTIC_MESSAGE_LENGTH));
  }

  get latestMessage(): string | undefined {
    return this.#entries[this.#entries.length - 1]?.message;
  }

  record(key: string, message: string): DiagnosticRecordResult {
    const boundedKey = boundedDiagnosticKey(key, this.#keyLength);
    const existingIndex = this.#indices.get(boundedKey);
    const decision = boundedDiagnosticDecision(
      existingIndex !== undefined,
      this.#entries.length,
      this.#capacity,
    );

    if (decision === "increment") {
      const entry = this.#entries[existingIndex!];
      if (entry !== undefined) entry.count = saturatingIncrement(entry.count);
      return "incremented";
    }
    if (decision === "drop") {
      this.#dropped = saturatingIncrement(this.#dropped);
      return "dropped";
    }

    const entry = {
      count: 1,
      key: boundedKey,
      message: boundedDiagnosticMessage(message, this.#messageLength),
    };
    this.#indices.set(boundedKey, this.#entries.length);
    this.#entries.push(entry);
    return "appended";
  }

  snapshot(): BoundedDiagnosticSnapshot {
    const messages = Object.freeze(this.#entries.map((entry) => entry.message));
    const occurrences = Object.freeze(this.#entries.map((entry) => Object.freeze({
      count: entry.count,
      key: entry.key,
    })));
    return Object.freeze({
      capacity: this.#capacity,
      dropped: this.#dropped,
      messages,
      occurrences,
      retained: this.#entries.length,
    });
  }
}
