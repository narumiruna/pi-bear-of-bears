import { expect, test } from "vitest";
import { parseEquipmentRefinement } from "../src/equipment-refinement.js";

test("observed refined rows preserve base and effective values", () => {
  expect(parseEquipmentRefinement(1, "ATK 518→539　DEF 555→577")).toEqual({
    level: 1,
    text: "ATK 518→539　DEF 555→577",
    base: { attack: 518, defense: 555 },
    effective: { attack: 539, defense: 577 },
  });
  expect(parseEquipmentRefinement(5, "INT 1890→2268")?.effective).toEqual({
    intelligence: 2268,
  });
  expect(
    parseEquipmentRefinement(3, "DEF 53→59　INT 128→143　AGI 43→48")?.base,
  ).toEqual({
    defense: 53,
    intelligence: 128,
    agility: 43,
  });
});

test.each([0, 6, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  "unsupported refinement level %s does not produce values",
  (level) =>
    expect(parseEquipmentRefinement(level, "DEF 278→300")).toBeUndefined(),
);

test.each([
  "",
  "DEF 278→300 DEF 278→300",
  "DEF 278→300INT 128→143",
  "DEF 278→300 傷害減免 12%",
  "DEF 278→300%",
  "DEF 278→3e2",
  "DEF 278→277",
  "DEF -1→300",
  "DEF 278→9007199254740992",
  "HP 278→300",
])("unknown or conflicting row %s remains unsupported", (text) => {
  expect(parseEquipmentRefinement(2, text)).toBeUndefined();
});
