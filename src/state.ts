import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { CliError } from "./errors.js";

export interface TxRecord {
  requestId: string;
  orderId: string;
  status: string;
  txHash: string | null;
  message: string | null;
  recordedAt: string;
}

export interface PreviewRecord {
  requestId: string;
  chainId: number;
  wallet: string;
  to: string;
  value: string;
  inputDataHash: string;
  action: string;
  functionName: string;
  createdAt: string;
  expiresAt: number | null;
  usedAt: string | null;
}

export interface TxJournal {
  version: 1;
  executions: Record<string, TxRecord>;
  previews?: Record<string, PreviewRecord>;
}

export interface StateStore {
  recordPreview(record: Omit<PreviewRecord, "createdAt" | "usedAt">): Promise<PreviewRecord>;
  consumePreview(requestId: string, expected: { chainId: number; wallet: string }): Promise<PreviewRecord>;
  findExecution(orderId: string): Promise<TxRecord | null>;
  recordExecution(record: Omit<TxRecord, "recordedAt">): Promise<TxRecord>;
}

/** Override for tests/agents; defaults to a per-user state directory (no secrets). */
export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AGENTSWAP_STATE_DIR?.trim();
  return configured === undefined || configured === "" ? join(homedir(), ".agentswap") : configured;
}

function emptyJournal(): TxJournal {
  return { version: 1, executions: {}, previews: {} };
}

/**
 * Local journal mapping BAW requestId -> preview binding and BAW orderId ->
 * execution record. BAW 1.11.0 exposes no contract-call order lookup, so this is
 * what makes preview-bound execute and `tx status --order-id` possible. It
 * contains no credentials and is written 0600.
 */
export class FileStateStore implements StateStore {
  private readonly file: string;
  private readonly directory: string;

  constructor(
    directory: string = defaultStateDir(),
    private readonly lockTimeoutMs = 5_000,
  ) {
    this.directory = directory;
    this.file = join(directory, "tx-journal.json");
  }

  private async readJournal(): Promise<TxJournal> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyJournal();
      throw new CliError("STATE_UNREADABLE", "Could not read the local transaction journal.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CliError("STATE_UNREADABLE", "The local transaction journal is not valid JSON.");
    }
    if (parsed === null || typeof parsed !== "object") {
      throw new CliError("STATE_UNREADABLE", "The local transaction journal has an unexpected shape.");
    }
    const journal = parsed as Partial<TxJournal>;
    if (journal.version !== 1 || journal.executions === null || typeof journal.executions !== "object") {
      throw new CliError("STATE_UNREADABLE", "The local transaction journal has an unsupported version.");
    }
    return {
      version: 1,
      executions: journal.executions,
      previews: journal.previews !== null && typeof journal.previews === "object" ? journal.previews : {},
    };
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
    } catch {
      throw new CliError("STATE_WRITE_FAILED", "Could not create the local transaction state directory.");
    }
  }


  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    await this.ensureDirectory();
    const lock = `${this.file}.lock`;
    const token = randomUUID();
    const started = Date.now();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    while (handle === undefined) {
      try {
        handle = await open(lock, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`, "utf8");
        } catch {
          await handle.close().catch(() => undefined);
          await unlink(lock).catch(() => undefined);
          throw new CliError("STATE_WRITE_FAILED", "Could not create the local transaction lock.");
        }
      } catch (error) {
        if (error instanceof CliError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw new CliError("STATE_WRITE_FAILED", "Could not acquire the local transaction lock.");
        }
        if (Date.now() - started > this.lockTimeoutMs) {
          throw new CliError(
            "STATE_LOCK_TIMEOUT",
            "The local transaction journal lock is held. If a previous process crashed, remove the stale lock manually after confirming no agent is running.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      return await action();
    } finally {
      await handle.close().catch(() => undefined);
      // Only remove the lock if this process still owns this exact lock file.
      try {
        const current = JSON.parse(await readFile(lock, "utf8")) as { token?: unknown };
        if (current.token === token) await unlink(lock).catch(() => undefined);
      } catch {
        // Do not unlink a path we can no longer prove we own.
      }
    }
  }

  private async writeJournal(journal: TxJournal): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.file);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("STATE_WRITE_FAILED", "Could not update the local transaction journal.");
    }
  }

  async recordPreview(record: Omit<PreviewRecord, "createdAt" | "usedAt">): Promise<PreviewRecord> {
    const saved: PreviewRecord = {
      ...record,
      createdAt: new Date().toISOString(),
      usedAt: null,
    };
    return this.withLock(async () => {
      const journal = await this.readJournal();
      journal.previews = journal.previews ?? {};
      journal.previews[saved.requestId] = saved;
      await this.writeJournal(journal);
      return saved;
    });
  }

  async consumePreview(requestId: string, expected: { chainId: number; wallet: string }): Promise<PreviewRecord> {
    return this.withLock(async () => {
      const journal = await this.readJournal();
      const preview = journal.previews?.[requestId];
      if (preview === undefined) {
        throw new CliError(
          "PREVIEW_NOT_FOUND",
          "This requestId was not produced by a local preview. Run the preview command again before executing.",
          { requestId },
        );
      }
      if (preview.usedAt !== null) {
        throw new CliError("PREVIEW_ALREADY_USED", "This preview has already been consumed. Run the preview command again.", {
          requestId,
        });
      }
      if (preview.chainId !== expected.chainId) {
        throw new CliError("PREVIEW_CHAIN_MISMATCH", "The preview was created for a different chain.", {
          requestId,
          expectedChainId: expected.chainId,
          previewChainId: preview.chainId,
        });
      }
      if (preview.wallet.toLowerCase() !== expected.wallet.toLowerCase()) {
        throw new CliError("PREVIEW_WALLET_MISMATCH", "The connected wallet differs from the preview wallet.", {
          requestId,
          expectedWallet: expected.wallet,
          previewWallet: preview.wallet,
        });
      }
      preview.usedAt = new Date().toISOString();
      journal.previews![requestId] = preview;
      await this.writeJournal(journal);
      return preview;
    });
  }

  async recordExecution(record: Omit<TxRecord, "recordedAt">): Promise<TxRecord> {
    const saved: TxRecord = { ...record, recordedAt: new Date().toISOString() };
    return this.withLock(async () => {
      const journal = await this.readJournal();
      journal.executions[saved.orderId] = saved;
      await this.writeJournal(journal);
      return saved;
    });
  }

  async findExecution(orderId: string): Promise<TxRecord | null> {
    const journal = await this.readJournal();
    return journal.executions[orderId] ?? null;
  }
}

export function createStateStore(env: NodeJS.ProcessEnv = process.env): StateStore {
  return new FileStateStore(defaultStateDir(env));
}
