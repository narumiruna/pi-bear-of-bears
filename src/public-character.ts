const BASE = "https://lab4.kvzhuang.net/gen-art/bears-life-detail/";

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|lt|gt|quot|#39);/g,
      (entity) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&#39;": "'",
        })[entity] ?? entity,
    )
    .replace(/\s+/g, " ")
    .trim();
}

function number(value: string): number {
  return Number(value.replaceAll(",", ""));
}

export function parsePublicCharacter(html: string, requestedName: string) {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const name =
    heading &&
    text(heading[1])
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .trim();
  if (!name || name !== requestedName) {
    throw new Error("公開角色頁沒有對應角色，或姓名不符。");
  }
  const section = html.match(
    /<h3\b[^>]*>[^<]*裝備評分[\s\S]*?<\/h3>([\s\S]*?)(?=<\/div>\s*<\/div>\s*<div class="box"|<h3\b|$)/i,
  );
  if (!section) {
    throw new Error("公開角色頁缺少裝備評分區塊。");
  }
  const scoreText = text(section[1]);
  const metric = (label: string) => {
    const match = scoreText.match(new RegExp(`${label}\\s*([\\d,]+)`));
    if (!match) {
      throw new Error(`公開角色頁缺少${label}。`);
    }
    return number(match[1]);
  };
  const rank = text(
    html.match(/<h3\b[^>]*>([\s\S]*?裝備評分[\s\S]*?)<\/h3>/i)?.[1] ?? "",
  ).match(/全服第\s*([\d,]+)\s*名/);
  const activity = text(html).match(/最後活動\s*(\d{4}-\d\d-\d\d\s+\d\d:\d\d)/);
  const equipmentBlock =
    html.split(/<h3\b[^>]*>[^<]*身上裝備/)[1]?.split(/<h3\b/)[0] ?? "";
  const equipment = [
    ...equipmentBlock.matchAll(
      /<div class="it">([\s\S]*?)(?=<div class="it">|<\/div>\s*<\/div>)/g,
    ),
  ].map((match) => {
    const item = match[1];
    const field = (className: string) =>
      text(
        item.match(
          new RegExp(
            `<(?:div|span) class="${className}"[^>]*>([\\s\\S]*?)<\\/(?:div|span)>`,
          ),
        )?.[1] ?? "",
      );
    return {
      slot: field("slot"),
      name: field("nm"),
      stats: field("st"),
      score: number(field("sc").match(/[\d,]+/)?.[0] ?? "0"),
    };
  });
  if (
    !equipmentBlock ||
    equipment.some(
      (item) => !item.slot || !item.name || !item.stats || !item.score,
    )
  ) {
    throw new Error("公開角色頁身上裝備資料不完整。");
  }
  return {
    name,
    score: metric("總評分"),
    equippedPower: metric("裝備力（身上）"),
    lifetimeRarePoints: metric("終身稀有積分 ×0\\.4"),
    rank: rank ? number(rank[1]) : null,
    lastActivity: activity?.[1] ?? null,
    equipment,
  };
}

export async function getPublicCharacter(
  name: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const normalized = name.trim();
  if (
    !normalized ||
    normalized.length > 80 ||
    [...normalized].some(
      (char) => char.charCodeAt(0) < 32 || char.codePointAt(0) === 127,
    )
  ) {
    throw new Error("角色名稱格式錯誤。");
  }
  signal?.throwIfAborted();
  const url = `${BASE}?u=${encodeURIComponent(normalized)}`;
  const response = await fetcher(url, {
    credentials: "omit",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`公開角色頁 HTTP ${response.status} 或內容為空。`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) {
        throw new Error("公開角色頁超過 2 MiB。");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  signal?.throwIfAborted();
  return {
    source: url,
    fetchedAt: new Date().toISOString(),
    note: "公開角色頁快照；最後活動為網站顯示的時間，未標明時區。裝備評分是網站指標，不等同四軸加權分數或勝率；頁面不含完整背包。",
    ...parsePublicCharacter(Buffer.concat(chunks).toString("utf8"), normalized),
  };
}
