ALTER TABLE "store_orders" ALTER COLUMN "stock_reservations" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "store_orders" ALTER COLUMN "stock_reservations" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "handle" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "customer_profiles_handle_unique" ON "customer_profiles" USING btree (lower("handle"));
--> statement-breakpoint
-- The old default [] also covered orders whose original stock usage was unknown.
UPDATE store_orders SET stock_reservations = NULL WHERE stock_reservations = '[]'::jsonb AND NOT awaiting_payment;
--> statement-breakpoint
DO $$
DECLARE profile record; base text; candidate text; suffix integer;
BEGIN
  FOR profile IN SELECT id, display_name FROM customer_profiles WHERE handle IS NULL ORDER BY created_at, id LOOP
    base := left(regexp_replace(normalize(profile.display_name, NFKD), '[^a-zA-Z0-9]', '', 'g'), 48);
    IF base = '' THEN base := 'Oneinfo'; END IF;
    IF lower(base) = ANY(ARRAY['admin','api','c','team','health','assets','dashboard','index','products','arisepay','robots','sitemap','favicon']) THEN base := base || 'Profile'; END IF;
    candidate := base; suffix := 2;
    WHILE EXISTS (SELECT 1 FROM customer_profiles WHERE lower(handle) = lower(candidate)) LOOP
      candidate := base || suffix; suffix := suffix + 1;
    END LOOP;
    UPDATE customer_profiles SET handle = candidate WHERE id = profile.id;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO order_emails (id, order_id, kind, status, updated_at)
SELECT gen_random_uuid(), id, kind, status, created_at FROM (
  SELECT DISTINCT ON (o.id, a.metadata->>'kind') o.id, a.metadata->>'kind' AS kind, a.metadata->>'status' AS status, a.created_at
  FROM audit_logs a JOIN store_orders o ON a.target_id = o.id::text
  WHERE a.action = 'STORE_ORDER_EMAIL_ATTEMPT'
    AND a.metadata->>'kind' IN ('confirmation','payment','shipping','delivery')
    AND a.metadata->>'status' IN ('accepted','failed')
  ORDER BY o.id, a.metadata->>'kind', a.created_at DESC, a.id DESC
) history ON CONFLICT DO NOTHING;
