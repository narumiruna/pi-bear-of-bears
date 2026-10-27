import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";

const MAX_BYTES = 256 * 1024 * 1024;
/** 不接受 symlink 路徑；既有過寬權限不暗中 chmod。 */
export function privateLedgerDirectory(directory: string) {
  if (!isAbsolute(directory)) {
    throw new Error("記帳目錄必須是絕對路徑。");
  }
  let part = parse(directory).root;
  for (const segment of resolve(directory).slice(part.length).split(/[\\/]/u)) {
    if (!segment) {
      continue;
    }
    part = join(part, segment);
    try {
      const stat = lstatSync(part);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("記帳路徑不可含 symlink 或一般檔案。");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      mkdirSync(part, { mode: 0o700 });
    }
  }
  if ((statSync(directory).mode & 0o077) !== 0) {
    throw new Error("記帳目錄權限必須為 0700。");
  }
}
export function privateFile(path: string, create: boolean) {
  if (create) {
    try {
      const fd = openSync(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      closeSync(fd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
  try {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > MAX_BYTES
    ) {
      throw new Error(
        "記帳檔案必須是私有單一連結的一般檔案，且不超過 256 MiB。",
      );
    }
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}
