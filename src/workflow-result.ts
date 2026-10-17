import { type Static, Type } from "typebox";
import type { Source } from "./workflow-observations.js";

export const safeInteger = (minimum = 0) =>
  Type.Integer({ minimum, maximum: Number.MAX_SAFE_INTEGER });
export const workflowName = () =>
  Type.String({
    minLength: 1,
    maxLength: 200,
    pattern:
      "^[^/\\s\\u0000-\\u001f\\u007f-\\u009f][^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]*$",
  });
export const snapshotId = () =>
  Type.String({
    pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
  });
const sourceSchema = Type.Object(
  {
    messageId: safeInteger(1),
    revision: Type.String(),
    date: safeInteger(),
    observedAt: safeInteger(),
    originalSourceId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const WORKFLOW_RESULT_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    originalSourceId: Type.Optional(snapshotId()),
    state: Type.Union([
      Type.Literal("ready"),
      Type.Literal("confirmed"),
      Type.Literal("needs_observation"),
      Type.Literal("stopped"),
      Type.Literal("outcome_unknown"),
    ]),
    actor: Type.Union([Type.String(), Type.Null()]),
    sources: Type.Array(sourceSchema),
    steps: Type.Array(
      Type.Object(
        {
          tool: Type.String(),
          state: Type.Union([
            Type.Literal("submitted"),
            Type.Literal("not_dispatched"),
            Type.Literal("rejected"),
            Type.Literal("confirmed"),
            Type.Literal("outcome_unknown"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    blockers: Type.Array(Type.String()),
    next: Type.Array(Type.String()),
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
export type WorkflowResult = Static<typeof WORKFLOW_RESULT_SCHEMA>;
export const SCOPE_SCHEMA = Type.Object(
  {
    character: workflowName(),
    snapshotId: snapshotId(),
    maxCommands: safeInteger(1),
    maxChanges: safeInteger(1),
    maxMilliseconds: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    maxGold: safeInteger(),
  },
  { additionalProperties: false },
);
export type WorkflowScope = Static<typeof SCOPE_SCHEMA>;
export function workflowResult(
  actor: string | null = null,
  sources: Source[] = [],
): WorkflowResult {
  return {
    version: 1,
    state: "needs_observation",
    actor,
    sources,
    steps: [],
    blockers: [],
    next: [],
    data: {},
  };
}
