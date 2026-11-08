ALTER TABLE store_orders ADD COLUMN activation_method text NOT NULL DEFAULT 'LEGACY';
--> statement-breakpoint
ALTER TABLE store_orders ADD CONSTRAINT store_orders_activation_method_check CHECK (activation_method IN ('LEGACY', 'ORDER_SECRET'));
--> statement-breakpoint
ALTER TABLE store_orders ADD COLUMN packed_at timestamptz;
--> statement-breakpoint
CREATE TABLE order_activation_profiles (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES store_orders(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES customer_profiles(id) ON DELETE RESTRICT,
  line_index integer NOT NULL CHECK (line_index >= 0),
  unit_index integer NOT NULL CHECK (unit_index >= 0),
  code_hash varchar(64) NOT NULL,
  encrypted_code text,
  card_id uuid REFERENCES cards(id) ON DELETE RESTRICT,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_activation_profiles_unit_unique UNIQUE (order_id, line_index, unit_index),
  CONSTRAINT order_activation_profiles_profile_unique UNIQUE (profile_id),
  CONSTRAINT order_activation_profiles_code_unique UNIQUE (code_hash),
  CONSTRAINT order_activation_profiles_card_unique UNIQUE (card_id),
  CHECK ((card_id IS NULL) = (redeemed_at IS NULL))
);
