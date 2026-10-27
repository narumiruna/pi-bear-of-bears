import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, type TSchema, Type } from "typebox";
import type { RecordsStore } from "./records-store.js";

const text = (maxLength = 300) => Type.String({ maxLength });
const integer = (maximum = Number.MAX_SAFE_INTEGER, minimum = 0) =>
  Type.Integer({ minimum, maximum });
const id = Type.String({ pattern: "^[a-f0-9-]{36}$" });
const input = Type.Object(
  {
    kind: Type.Union([Type.Literal("note"), Type.Literal("log")]),
    title: Type.String({ minLength: 1, maxLength: 1000 }),
    body: text(2_000_000),
    eventDate: Type.Optional(
      Type.Union([
        Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        Type.Null(),
      ]),
    ),
    eventTime: Type.Optional(Type.Union([text(30), Type.Null()])),
    timezone: Type.Optional(Type.Union([text(50), Type.Null()])),
    observedAt: Type.Optional(Type.Union([integer(), Type.Null()])),
    characters: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
        maxItems: 100,
      }),
    ),
    sources: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
        maxItems: 100,
      }),
    ),
    origin: Type.Optional(Type.Union([text(500), Type.Null()])),
  },
  { additionalProperties: false },
);
const requestKey = Type.String({ minLength: 1, maxLength: 200 });
const nullableInteger = Type.Union([integer(), Type.Null()]);
const receipt = Type.Object(
  {
    id,
    revision: integer(Number.MAX_SAFE_INTEGER, 1),
    reference: text(200),
    replayed: Type.Boolean(),
    operationalEligibility: Type.Literal(false),
  },
  { additionalProperties: false },
);
const searchResult = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id,
          revision: integer(Number.MAX_SAFE_INTEGER, 1),
          kind: input.properties.kind,
          title: text(1000),
          eventDate: Type.Optional(Type.Union([text(10), Type.Null()])),
          excerpt: text(1000),
          reference: text(200),
        },
        { additionalProperties: false },
      ),
      { maxItems: 10 },
    ),
    nextCursor: Type.Union([text(2000), Type.Null()]),
    operationalEligibility: Type.Literal(false),
  },
  { additionalProperties: false },
);
const pageResult = Type.Object(
  {
    ...input.properties,
    id,
    revision: integer(Number.MAX_SAFE_INTEGER, 1),
    createdAt: integer(),
    importedAt: nullableInteger,
    offset: integer(),
    totalCodePoints: integer(),
    nextOffset: nullableInteger,
    reference: text(200),
    operationalEligibility: Type.Literal(false),
    note: text(300),
  },
  { additionalProperties: false },
);
const resolveResult = Type.Object(
  {
    items: Type.Array(receipt, { maxItems: 10 }),
    nextOffset: nullableInteger,
    snapshot: integer(),
    operationalEligibility: Type.Literal(false),
  },
  { additionalProperties: false },
);
export function recordsOutput(data: unknown) {
  const result = { version: 1, operationalEligibility: false, data };
  const text = JSON.stringify(result);
  if (Buffer.byteLength(text) > 44000) {
    throw new Error("紀錄輸出超限；請縮小全文頁面。");
  }
  return {
    content: [{ type: "text" as const, text }],
    details: {},
    structuredContent: JSON.parse(text),
  };
}
export function registerRecordsTools(
  pi: ExtensionAPI,
  get: () => RecordsStore,
) {
  function register<T extends TSchema>(
    name: string,
    description: string,
    schema: T,
    behavior: { readonly: boolean; output: TSchema },
    run: (store: RecordsStore, args: Static<T>) => unknown,
  ) {
    pi.registerTool({
      name,
      label: name,
      description: `${description} 歷史敘述不是即時遊戲狀態或操作授權；不查Telegram。`,
      exposure: "codemode",
      annotations: {
        readOnlyHint: behavior.readonly,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: schema,
      outputSchema: Type.Object(
        {
          version: Type.Literal(1),
          operationalEligibility: Type.Literal(false),
          data: behavior.output,
        },
        { additionalProperties: false },
      ),
      execute: async (_id, args, signal) => {
        await Promise.resolve();
        signal?.throwIfAborted();
        return recordsOutput(run(get(), args as Static<T>));
      },
    });
  }
  register(
    "records_search",
    "字面搜尋個人日誌；預設最多10筆、8KiB，續頁須保持相同條件。",
    Type.Object(
      {
        query: Type.Optional(text()),
        kind: Type.Optional(
          Type.Union([Type.Literal("note"), Type.Literal("log")]),
        ),
        character: Type.Optional(text()),
        from: Type.Optional(text(10)),
        through: Type.Optional(text(10)),
        limit: Type.Optional(integer(10, 1)),
        cursor: Type.Optional(text(2000)),
      },
      { additionalProperties: false },
    ),
    { readonly: true, output: searchResult },
    (s, a) => s.search(a),
  );
  register(
    "records_get",
    "分頁讀取紀錄；後續頁應固定首次回傳revision，每頁最多6000 code points。",
    Type.Object(
      {
        id,
        revision: Type.Optional(integer(Number.MAX_SAFE_INTEGER, 1)),
        offset: Type.Optional(integer()),
        limit: Type.Optional(integer(6000, 1)),
      },
      { additionalProperties: false },
    ),
    { readonly: true, output: pageResult },
    (s, a) => s.get(a.id, a.revision, a.offset, a.limit),
  );
  register(
    "records_append",
    "新增紀錄；requestKey重送回同一筆，不能以新key盲目重送。",
    Type.Object({ requestKey, record: input }, { additionalProperties: false }),
    { readonly: false, output: receipt },
    (s, a) => s.append(a.requestKey, a.record),
  );
  register(
    "records_revise",
    "修訂紀錄並保留歷史；expectedRevision衝突時拒絕。",
    Type.Object(
      {
        requestKey,
        id,
        expectedRevision: integer(Number.MAX_SAFE_INTEGER, 1),
        record: input,
      },
      { additionalProperties: false },
    ),
    { readonly: false, output: receipt },
    (s, a) => s.revise(a.requestKey, a.id, a.expectedRevision, a.record),
  );
  register(
    "records_resolve",
    "解析紀錄ID、含databaseId的別名集合引用或repository舊路徑／anchor；不讀取任意檔案，集合可能多筆，續頁固定snapshot。",
    Type.Object(
      {
        alias: Type.String({ minLength: 1, maxLength: 1000 }),
        snapshot: Type.Optional(integer()),
        offset: Type.Optional(integer()),
        limit: Type.Optional(integer(10, 1)),
      },
      { additionalProperties: false },
    ),
    { readonly: true, output: resolveResult },
    (s, a) => s.resolve(a.alias, a.offset, a.limit, a.snapshot),
  );
}
