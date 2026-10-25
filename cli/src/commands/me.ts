import { requireClient, type Ctx } from "../context.js";
import { EXIT } from "../exit.js";
import { printError, printJson } from "../output.js";
import type { Me } from "../types.js";

const PLAN_LABEL: Record<string, string> = { free: "Free", pack: "Pack", pro: "Pro", max: "Max" };

export function describeMe(me: Me): string[] {
  const plan = PLAN_LABEL[me.plan] ?? me.plan;
  const c = me.credits;
  const lines = [`${me.email ?? me.uid} · ${plan} plan`];
  if (c) {
    const parts = [`${c.period_remaining} left this period`, `${c.extra} extra`];
    lines.push(`Credits: ${c.total} available (${parts.join(" + ")})`);
  }
  lines.push(
    me.watermark
      ? "Watermark on new decks: yes (any purchase removes it)"
      : "Watermark on new decks: no",
  );
  if (me.key) {
    const used = me.key.last_used_at ? `last used ${me.key.last_used_at.slice(0, 10)}` : "not used before now";
    lines.push(`Key: ${me.key.hint} “${me.key.label}” (${me.key.src}), ${used}`);
  }
  return lines;
}

export async function runMe(opts: { json: boolean }, ctx: Ctx): Promise<number> {
  try {
    const me = await requireClient(ctx).request<Me>("GET", "/v1/me");
    if (opts.json) printJson(me, ctx.io);
    else for (const line of describeMe(me)) ctx.io.stdout(line);
    return EXIT.OK;
  } catch (err) {
    return printError(err, opts, ctx.io);
  }
}
