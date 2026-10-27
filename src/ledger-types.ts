import type { GameMessage } from "./game.js";

export const LEDGER_VERSION = 1;
export const LEDGER_PARSER_VERSION = 11;
export type LedgerState =
  | "prepared"
  | "submitted"
  | "confirmed"
  | "rejected"
  | "unresolved"
  | "not_dispatched";
export interface LedgerCall {
  toolCallId: string;
  toolName: string;
  sessionId?: string;
}
export interface LedgerReference {
  contextId: string;
  through: number;
}
export interface LedgerContext {
  id: string;
  session: string;
  runtime: string;
  toolCallId: string | null;
  toolName: string | null;
  at: number;
}
export interface LedgerOperation {
  id: string;
  contextId: string;
  command: string | null;
  kind: "command" | "history";
  at: number;
}
export interface LedgerObservation {
  id: number;
  message: GameMessage;
  firstEventId?: number;
  firstObservedAt?: number;
  originalSourceId?: string;
}
export interface LedgerFact {
  line: number;
  kind: string;
  value: unknown;
  basis: "observed" | "derived" | "unknown";
}
export interface LedgerEvent {
  id: number;
  contextId: string;
  operationId: string | null;
  at: number;
  kind: "seen" | "state" | "gap" | "metric" | "usage";
  data: Record<string, unknown>;
}
export interface LedgerData {
  contexts: LedgerContext[];
  operations: LedgerOperation[];
  observations: LedgerObservation[];
  facts: {
    observationId: number;
    parserVersion: number;
    facts: LedgerFact[];
  }[];
  events: LedgerEvent[];
  compactions?: Omit<
    import("./ledger-retention.js").RetentionCheckpoint,
    "events"
  >[];
  externalEvents: number;
  externalBarriers?: { id: number; at: number }[];
  diagnostics: string[];
}
export interface LedgerAccounting {
  operationId: string;
  state: LedgerState;
  confirmedMpCost: number | null;
  operationalEligibility: false;
  mpAfter: number | null;
  hpAfter: number | null;
  complete: boolean;
  reasons: string[];
}
export interface LedgerTicket {
  identify?: (telegramUserId: string | undefined) => undefined;
  observe: (
    messages: readonly GameMessage[],
    phase: "before" | "after" | "history",
  ) => undefined;
  dispatch: (command?: string) => undefined;
  finish: (sent: boolean, failed?: boolean) => LedgerAccounting;
}
export interface LedgerSink {
  readonly requiresIdentity?: boolean;
  begin: (
    kind: "command" | "history",
    command: string | null,
    call?: LedgerCall,
  ) => LedgerTicket;
  watch: (
    messages: readonly GameMessage[],
    omitted: number,
    telegramUserId?: string,
  ) => void;
  original: (
    messages: readonly GameMessage[],
    sourceId: string,
    call?: LedgerCall,
    telegramUserId?: string,
  ) => void;
  operationIds: (toolCallId: string) => string[];
}
