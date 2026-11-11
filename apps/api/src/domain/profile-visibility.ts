import { sql } from "drizzle-orm";
import { cardBatches, cards, companies, companyEmployees, customerAccounts, customerProfiles } from "../db/schema.js";

// Apply the same publication, owner and card checks to profiles, contact downloads and company directories.
export function publicProfileAvailable() {
  return sql`${customerProfiles.published}
    and not exists (select 1 from ${customerAccounts} owner where not owner.active and
      (owner.profile_id = ${customerProfiles.id} or owner.id in
        (select c.customer_account_id from ${cards} c where c.profile_id = ${customerProfiles.id})))
    and not exists (select 1 from ${companyEmployees} member
      join ${companies} workspace on workspace.id = member.company_id
      join ${customerAccounts} owner on owner.id = workspace.owner_account_id
      where member.profile_id = ${customerProfiles.id} and (not member.active or not owner.active))
    and (not exists (select 1 from ${cards} c where c.profile_id = ${customerProfiles.id})
      or exists (select 1 from ${cards} c join ${cardBatches} b on b.id = c.batch_id
        where c.profile_id = ${customerProfiles.id} and c.lifecycle_status = 'ACTIVATED'
          and (c.qc_status = 'PASSED' or b.print_confirmed_at is not null)))`;
}
