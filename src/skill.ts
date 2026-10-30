import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Absolute path is resolved at build/run time, never embedded in output. */
export const SKILL_PATH = fileURLToPath(new URL("../SKILL.md", import.meta.url));

/** Read the packaged operational guide (`SKILL.md`) for `agentswap skill`. */
export function readSkillText(): string {
  return readFileSync(SKILL_PATH, "utf8");
}
