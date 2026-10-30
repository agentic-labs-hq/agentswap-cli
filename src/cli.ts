#!/usr/bin/env node
import {
  flagBool,
  flagString,
  flagStrings,
  parseCliArgs,
  type FlagValue,
} from "./args.js";
import { runDoctor } from "./core/doctor.js";
import { runLpAdd } from "./core/lp-add.js";
import { runLpRemove } from "./core/lp-remove.js";
import { runPoolCreate } from "./core/pool-create.js";
import { runPositions } from "./core/positions.js";
import { runQuote } from "./core/quote.js";
import { runStatus } from "./core/status.js";
import { runSwap } from "./core/swap.js";
import { runTokenApprove } from "./core/token-approve.js";
import { runTokenCreate } from "./core/token-create.js";
import { runTxExecute } from "./core/tx-execute.js";
import { runTxStatus } from "./core/tx-status.js";
import { errorPayload } from "./errors.js";
import { helpFor, MAIN_HELP } from "./help.js";
import { writeJson } from "./json.js";
import { renderErrorHuman, renderHuman } from "./render.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { readSkillText } from "./skill.js";
import { VERSION } from "./version.js";

const jsonRequested = (argv: readonly string[]): boolean => argv.includes("--json");

async function dispatch(
  command: string,
  flags: Record<string, FlagValue>,
  runtime: Runtime,
): Promise<Record<string, unknown>> {
  switch (command) {
    case "doctor":
      return runDoctor(runtime);
    case "status":
      return runStatus(runtime);
    case "token create":
      return runTokenCreate(runtime, {
        name: flagString(flags, "name", true)!,
        symbol: flagString(flags, "symbol", true)!,
        supply: flagString(flags, "supply", true)!,
        recipients: flagStrings(flags, "recipient", true),
        metadataUri: flagString(flags, "metadata-uri", true)!,
        ...(flagString(flags, "policy") === undefined ? {} : { policy: flagString(flags, "policy") }),
      });
    case "token approve":
      return runTokenApprove(runtime, {
        token: flagString(flags, "token", true)!,
        spender: flagString(flags, "spender", true)!,
        amount: flagString(flags, "amount", true)!,
      });
    case "dex pool create":
      return runPoolCreate(runtime, {
        token: flagString(flags, "token", true)!,
        quote: flagString(flags, "quote", true)!,
        fee: flagString(flags, "fee", true)!,
        ...(flagString(flags, "price") === undefined ? {} : { price: flagString(flags, "price") }),
        ...(flagString(flags, "sqrt-price-x96") === undefined
          ? {}
          : { sqrtPriceX96: flagString(flags, "sqrt-price-x96") }),
      });
    case "dex lp add":
      return runLpAdd(runtime, {
        token: flagString(flags, "token", true)!,
        quote: flagString(flags, "quote", true)!,
        fee: flagString(flags, "fee", true)!,
        tickLower: flagString(flags, "tick-lower", true)!,
        tickUpper: flagString(flags, "tick-upper", true)!,
        amount0: flagString(flags, "amount0", true)!,
        amount1: flagString(flags, "amount1", true)!,
        ...(flagString(flags, "min-amount0") === undefined ? {} : { minAmount0: flagString(flags, "min-amount0") }),
        ...(flagString(flags, "min-amount1") === undefined ? {} : { minAmount1: flagString(flags, "min-amount1") }),
        ...(flagString(flags, "recipient") === undefined ? {} : { recipient: flagString(flags, "recipient") }),
      });
    case "dex lp remove":
      return runLpRemove(runtime, {
        tokenId: flagString(flags, "token-id", true)!,
        ...(flagString(flags, "liquidity") === undefined ? {} : { liquidity: flagString(flags, "liquidity") }),
        ...(flagString(flags, "min-amount0") === undefined ? {} : { minAmount0: flagString(flags, "min-amount0") }),
        ...(flagString(flags, "min-amount1") === undefined ? {} : { minAmount1: flagString(flags, "min-amount1") }),
        ...(flagBool(flags, "no-collect") ? { noCollect: true } : {}),
        ...(flagBool(flags, "no-burn") ? { noBurn: true } : {}),
        ...(flagBool(flags, "collect-only") ? { collectOnly: true } : {}),
      });
    case "dex quote":
      return runQuote(runtime, {
        tokenIn: flagString(flags, "token-in", true)!,
        tokenOut: flagString(flags, "token-out", true)!,
        fee: flagString(flags, "fee", true)!,
        amountIn: flagString(flags, "amount-in", true)!,
        exactOut: flagBool(flags, "exact-out"),
      });
    case "dex swap":
      return runSwap(runtime, {
        tokenIn: flagString(flags, "token-in", true)!,
        tokenOut: flagString(flags, "token-out", true)!,
        fee: flagString(flags, "fee", true)!,
        amountIn: flagString(flags, "amount-in", true)!,
        minOut: flagString(flags, "min-out", true)!,
        ...(flagString(flags, "recipient") === undefined ? {} : { recipient: flagString(flags, "recipient") }),
        ...(flagString(flags, "deadline") === undefined ? {} : { deadline: flagString(flags, "deadline") }),
        nativeOut: flagBool(flags, "native-out"),
      });
    case "dex positions":
      return runPositions(runtime, {
        ...(flagString(flags, "owner") === undefined ? {} : { owner: flagString(flags, "owner") }),
      });
    case "tx execute":
      return runTxExecute(runtime, {
        requestId: flagString(flags, "request-id", true)!,
        confirm: flagBool(flags, "confirm"),
      });
    case "tx status":
      return runTxStatus(runtime, {
        ...(flagString(flags, "order-id") === undefined ? {} : { orderId: flagString(flags, "order-id") }),
        ...(flagString(flags, "tx-hash") === undefined ? {} : { txHash: flagString(flags, "tx-hash") }),
      });
    default:
      throw new Error(`Unhandled command "${command}".`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    const payload = errorPayload(error);
    if (jsonRequested(argv)) writeJson(payload);
    else process.stderr.write(`${renderErrorHuman(payload)}\n`);
    process.exitCode = 1;
    return;
  }

  if (parsed.command === "help") {
    process.stdout.write(`${MAIN_HELP}\n`);
    return;
  }
  if (parsed.command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (flagBool(parsed.flags, "help")) {
    process.stdout.write(`${helpFor(parsed.command)}\n`);
    return;
  }

  if (parsed.command === "skill") {
    const skill = readSkillText();
    if (flagBool(parsed.flags, "json")) {
      writeJson({ ok: true, command: "skill", skill });
    } else {
      process.stdout.write(skill.endsWith("\n") ? skill : `${skill}\n`);
    }
    return;
  }

  const json = flagBool(parsed.flags, "json");
  try {
    const runtime = createRuntime();
    const result = await dispatch(parsed.command, parsed.flags, runtime);
    if (json) writeJson(result);
    else process.stdout.write(`${renderHuman(result)}\n`);
  } catch (error) {
    const payload = errorPayload(error, parsed.command);
    if (json) writeJson(payload);
    else process.stderr.write(`${renderErrorHuman(payload)}\n`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  const payload = errorPayload(error);
  if (jsonRequested(process.argv.slice(2))) writeJson(payload);
  else process.stderr.write(`${renderErrorHuman(payload)}\n`);
  process.exitCode = 1;
});
