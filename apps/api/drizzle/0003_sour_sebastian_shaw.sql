ALTER TABLE "products" ADD COLUMN "variants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "products" SET "variants" = jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid(),
  'name', CASE WHEN "finish" <> '' THEN initcap("finish") ELSE 'Original' END,
  'colorHex', CASE "appearance" WHEN 'dark' THEN '#0a201f' WHEN 'metal' THEN '#484d4b' ELSE '#fcfcf8' END,
  'priceMinor', "price_minor", 'salePriceMinor', NULL, 'available', true,
  'finish', "finish", 'appearance', "appearance", 'imageUrl', "image_url"
)), "version" = "version" + 1;
