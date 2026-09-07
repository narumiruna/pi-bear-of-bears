import { stripVTControlCharacters } from "node:util";

export function plainGameText(text: string) {
  return stripVTControlCharacters(text)
    .replace(/\p{Cc}/gu, (character) => (character === "\n" ? character : " "))
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
}
