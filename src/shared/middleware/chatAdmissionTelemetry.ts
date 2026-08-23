import { createLogger } from "../utils/logger";

export type ChatAdmissionShedReason = "queue_timeout" | "queued_bytes_budget";

export interface ChatAdmissionShedEvent {
  reason: ChatAdmissionShedReason;
  activeHeavy: number;
  waiting: number;
  queuedBytes: number;
  lane: string;
}

export type ChatAdmissionShedSink = (event: ChatAdmissionShedEvent) => void;

const shedLog = createLogger("chat-admission");

function defaultChatAdmissionShedSink(event: ChatAdmissionShedEvent): void {
  shedLog.warn(event, "structural chat admission shed (chat_admission_busy)");
}

/** In-memory counters and structured logging for capacity-driven admission sheds. */
export class ChatAdmissionTelemetry {
  #total = 0;
  #byReason = new Map<ChatAdmissionShedReason, number>();

  constructor(private readonly onShed: ChatAdmissionShedSink = defaultChatAdmissionShedSink) {}

  get total(): number {
    return this.#total;
  }

  get byReason(): Record<string, number> {
    return Object.fromEntries(this.#byReason);
  }

  record(event: ChatAdmissionShedEvent): void {
    this.#total += 1;
    this.#byReason.set(event.reason, (this.#byReason.get(event.reason) ?? 0) + 1);
    this.onShed(event);
  }
}
