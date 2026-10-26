import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const skillRoots: string[] = pkg.files.filter((path: string) =>
  path.startsWith("skills/"),
);

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? markdownFiles(path)
      : entry.name.endsWith(".md")
        ? [path]
        : [];
  });
}

test("套件宣告的 extension 與 skill 入口必須存在", () => {
  for (const path of [...pkg.pi.extensions, ...pkg.pi.skills]) {
    expect(existsSync(resolve(root, path)), path).toBe(true);
  }
});

test("套件預設載入 Agent 可呼叫的 reload extension", () => {
  expect(pkg.pi.extensions).toContain("./extensions/reload-runtime.ts");
});

test("已發佈 skill 的相對文件連結不能依賴未打包的帳號紀錄", () => {
  for (const directory of skillRoots) {
    for (const file of markdownFiles(resolve(root, directory))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
        const target = match[1];
        if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) {
          continue;
        }
        const path = resolve(
          dirname(file),
          decodeURIComponent(target.split("#")[0]),
        );
        expect(existsSync(path), `${file}: ${target}`).toBe(true);
        expect(
          skillRoots.some((directory) => {
            const local = relative(resolve(root, directory), path);
            return (
              local === "" ||
              (!local.startsWith("..") && !local.startsWith("/"))
            );
          }),
          `${file}: ${target} 未包含於已發佈 skills`,
        ).toBe(true);
      }
    }
  }
});

test("啟動文件與目前入口及版本一致", () => {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const lock = JSON.parse(
    readFileSync(resolve(root, "package-lock.json"), "utf8"),
  );
  const version = pkg.devDependencies[
    "@earendil-works/pi-coding-agent"
  ].replace(/^\^/, "");
  const nodeVersion = pkg.engines.node.match(/^>=(\d+\.\d+)\.\d+$/)[1];
  expect(readme).toContain(`pi ${version} 系列`);
  expect(readme).toContain(`Node.js **${nodeVersion} 以上**`);
  expect(readme).toContain("./run.sh");
  expect(existsSync(resolve(root, "run.sh"))).toBe(true);
  expect(readme).not.toContain("just play");
  expect(lock.packages[""].engines).toEqual(pkg.engines);
});
