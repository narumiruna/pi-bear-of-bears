import { afterEach, expect, test, vi } from "vitest";
import { printHelloWorld } from "../src/hello";

afterEach(() => {
  vi.restoreAllMocks();
});

test('prints "Hello, world!"', () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

  printHelloWorld();

  expect(log).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith("Hello, world!");
});
