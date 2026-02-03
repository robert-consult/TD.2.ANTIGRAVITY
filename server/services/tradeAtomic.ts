import { sql } from "drizzle-orm";

type DbTxLike = { execute: (query: any) => Promise<any> };

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

export async function applyUserBalanceDelta(tx: DbTxLike, params: { userId: number; deltaUsd: number }) {
  assertFiniteNumber(params.deltaUsd, "deltaUsd");
  const res = await tx.execute(sql`
    update users
    set balance = (round(balance::numeric + ${params.deltaUsd}, 2))::text
    where id = ${params.userId}
    returning balance
  `);
  const row = res?.rows?.[0];
  if (!row) throw new Error(`Failed to apply balance delta (userId=${params.userId})`);
  return { balance: String(row.balance) };
}

export async function reserveUserMargin(tx: DbTxLike, params: { userId: number; marginUsd: number }) {
  assertFiniteNumber(params.marginUsd, "marginUsd");
  if (params.marginUsd < 0) throw new Error("marginUsd must be >= 0");
  if (params.marginUsd === 0) return { reserved: true };

  const res = await tx.execute(sql`
    update users
    set
      used_margin = used_margin + ${params.marginUsd},
      free_margin = free_margin - ${params.marginUsd}
    where id = ${params.userId}
      and free_margin >= ${params.marginUsd}
    returning id
  `);
  return { reserved: (res?.rows?.length ?? 0) > 0 };
}

export async function releaseUserMargin(tx: DbTxLike, params: { userId: number; marginUsd: number }) {
  assertFiniteNumber(params.marginUsd, "marginUsd");
  if (params.marginUsd < 0) throw new Error("marginUsd must be >= 0");
  if (params.marginUsd === 0) return { released: true };

  await tx.execute(sql`
    update users
    set
      used_margin = used_margin - least(used_margin, ${params.marginUsd}),
      free_margin = free_margin + least(used_margin, ${params.marginUsd})
    where id = ${params.userId}
  `);
  return { released: true };
}

