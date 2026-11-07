import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { cardBatches, cards, orderCardAllocations, productionJobs, productionStations, storeOrders } from "../db/schema.js";

export const taskStages = ["payment", "print", "nfc", "qc", "qc_failed", "packing"] as const;
type Stage = typeof taskStages[number];
type Task = {
  key: string; stage: Stage; units: number; orderId: string | null; cardId: string | null;
  batchId: string | null; label: string; station: string | null; jobStatus: string | null;
};

const queue = sql`with work as (
  select c.id::text as key, case
    when o.payment_amount_minor > 0 and o.payment_verified_at is null then 'payment'
    when b.print_confirmed_at is null or c.qr_status <> 'GENERATED' then 'print'
    when c.qc_status = 'FAILED' then 'qc_failed'
    when c.nfc_status <> 'WRITTEN' then 'nfc'
    when c.qc_status <> 'PASSED' then 'qc'
    when o.id is not null and o.invoice_number is null and (
      select count(*) from ${orderCardAllocations} p
      join ${cards} pc on pc.id = p.card_id
      join ${cardBatches} pb on pb.id = pc.batch_id
      where p.order_id = o.id and pb.print_confirmed_at is not null and pc.nfc_status = 'WRITTEN'
        and pc.qc_status = 'PASSED' and pc.lifecycle_status in ('QC_PASSED','ACTIVATED')
    ) = (select sum((item->>'quantity')::int) from jsonb_array_elements(o.items) item) then 'packing'
  end as stage, 1 as units, o.id as "orderId", c.id as "cardId", b.id as "batchId",
    c.public_slug as label, j.station, j.job_status as "jobStatus", c.created_at
  from ${cards} c join ${cardBatches} b on b.id = c.batch_id
  left join ${orderCardAllocations} a on a.card_id = c.id
  left join ${storeOrders} o on o.id = a.order_id
  left join lateral (
    select s.name as station, job.status::text as job_status
    from ${productionJobs} job left join ${productionStations} s on s.id = job.assigned_station_id
    where job.card_id = c.id and job.type = case
      when c.qr_status <> 'GENERATED' then 'QR_GENERATION'
      when c.nfc_status <> 'WRITTEN' then 'NFC_ENCODING'
      else 'QUALITY_CONTROL' end::job_type
      and job.status in ('QUEUED','CLAIMED','RETRYABLE_FAILURE')
    order by job.updated_at desc limit 1
  ) j on true
  where c.lifecycle_status not in ('SUSPENDED','RETIRED')
    and (o.id is null or (o.cancelled_at is null and o.shipped_at is null and o.delivered_at is null and not o.awaiting_payment))
  union all
  select o.id::text, case when o.payment_amount_minor > 0 and o.payment_verified_at is null then 'payment'
    when o.invoice_number is not null then 'packing' else 'print' end,
    missing.units, o.id, null::uuid, null::uuid, coalesce(o.invoice_number, 'Order ' || left(o.id::text, 8)), null, null, o.created_at
  from ${storeOrders} o cross join lateral (
    select (select coalesce(sum((item->>'quantity')::int),0)::int from jsonb_array_elements(o.items) item)
      - (select count(*)::int from ${orderCardAllocations} a where a.order_id = o.id) as units
  ) missing
  where o.cancelled_at is null and o.shipped_at is null and o.delivered_at is null and not o.awaiting_payment and missing.units > 0
)`;

export async function attentionCounts() {
  const result = await db.execute<{ stage: Stage; count: number }>(sql`${queue}
    select stage, sum(units)::int as count from work where stage is not null group by stage`);
  return Object.fromEntries(result.rows.map(row => [row.stage, row.count]));
}

export async function attentionTasks(stage: Stage | undefined, page: number) {
  const result = await db.execute<Task>(sql`${queue} select key, stage, units, "orderId", "cardId", "batchId", label, station, "jobStatus"
    from work where stage is not null ${stage ? sql`and stage = ${stage}` : sql``}
    order by case stage when 'qc_failed' then 0 when 'payment' then 1 when 'print' then 2 else 3 end, created_at, key
    limit 51 offset ${(page - 1) * 50}`);
  return { items: result.rows.slice(0, 50), hasMore: result.rows.length > 50 };
}
