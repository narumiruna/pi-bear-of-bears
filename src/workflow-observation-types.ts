import type { GameMessage } from "./game.js";
import type { parseInventory } from "./inventory.js";
import type { homeFacts, statusFacts } from "./workflow-parsers.js";

export const OBSERVATION_CHANNELS = [
  "status",
  "tower",
  "room",
  "home",
  "skills",
  "inventory",
] as const;
export type ObservationChannel = (typeof OBSERVATION_CHANNELS)[number];

export interface Source {
  originalSourceId?: string;
  messageId: number;
  revision: string;
  date: number;
  observedAt: number;
}
export interface Invalidator {
  kind:
    | "explicit"
    | "non_query_request"
    | "outgoing_change"
    | "unknown_bot_reply"
    | "own_resource_report"
    | "source_revision"
    | "omitted"
    | "actor_change";
  barrierId: number;
  request?: string;
  messageId?: number;
  revision?: string;
  date?: number;
}
export interface BarrierEvent extends Omit<Invalidator, "request"> {
  scope: "historical_barrier_event";
  affectedBlocks: ObservationChannel[];
  source: Source | null;
  sourceMissing: boolean;
}
export interface Observation {
  message: GameMessage;
  source: Source;
  actor: string | null;
  command: string | null;
  epoch: number;
  /** 接收當時的省略批次計數；相同值才可重播連續事件。 */
  coverage?: number;
  /** 已保存訊息被修訂過，不能以新版內容重播舊效果壽命。 */
  revised?: boolean;
}
export interface Checkpoint {
  id: string;
  coverage: number;
  epoch: number;
  actor: string;
  sources: Source[];
  endId: number;
  status: NonNullable<ReturnType<typeof statusFacts>>;
  inventory: ReturnType<typeof parseInventory> | null;
  home: ReturnType<typeof homeFacts> | null;
}
