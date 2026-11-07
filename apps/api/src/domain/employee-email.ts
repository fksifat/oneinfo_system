import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { companies, companyEmployees, customerProfiles } from "../db/schema.js";
import { escapeEmailHtml, sendTransactionalEmail, transactionalEmailEnabled } from "./transactional-email.js";

export const employeeEmailEnabled = Boolean(config.STOREFRONT_URL && transactionalEmailEnabled);
export const employeeEditTokenHash = (secret: string) => createHash("sha256").update(secret).digest("hex");

export function employeeEditLink() {
  const secret = randomBytes(32).toString("base64url");
  return { path: `/team#edit/${secret}`, fields: {
    editTokenHash: employeeEditTokenHash(secret), editTokenExpiresAt: new Date(Date.now() + 7 * 86400_000),
  } };
}

async function dispatchEmployeeEmail(id: string, companyId: string) {
  const claim = await db.transaction(async tx => {
    const [company] = await tx.select({ name: companies.name, allowEmployeeEdits: companies.allowEmployeeEdits })
      .from(companies).where(eq(companies.id, companyId)).for("share");
    if (!company) return;
    const [entry] = await tx.select({ employee: companyEmployees, name: customerProfiles.displayName }).from(companyEmployees)
      .innerJoin(customerProfiles, eq(customerProfiles.id, companyEmployees.profileId))
      .where(and(eq(companyEmployees.id, id), eq(companyEmployees.active, true), eq(companyEmployees.inviteEmailStatus, "pending")))
      .for("update", { of: companyEmployees });
    if (!entry) return;
    const link = company.allowEmployeeEdits ? employeeEditLink() : undefined;
    const attemptAt = new Date();
    await tx.update(companyEmployees).set({ inviteEmailStatus: "sending", inviteEmailUpdatedAt: attemptAt, ...link?.fields }).where(eq(companyEmployees.id, id));
    return { ...entry, company, link, attemptAt };
  });
  if (!claim) return;

  const url = claim.link && new URL(claim.link.path, config.STOREFRONT_URL).href;
  const intro = `Hi ${claim.name}, ${claim.company.name} created your company profile on Oneinfo.`;
  const sent = await sendTransactionalEmail({
    to: claim.employee.email,
    subject: "Your Oneinfo employee profile is ready",
    text: `${intro}\n\n${url ? `Edit your profile: ${url}\nThis private link expires in seven days.` : "Contact your company workspace owner to request changes to your profile."}`,
    html: `<p>${escapeEmailHtml(intro)}</p>${url ? `<p><a href="${escapeEmailHtml(url)}">Edit your profile</a></p><p>This private link expires in seven days.</p>` : "<p>Contact your company workspace owner to request changes to your profile.</p>"}`,
    idempotencyKey: `oneinfo-employee/${id}/${claim.attemptAt.getTime()}`,
  });
  await db.transaction(async tx => {
    const [updated] = await tx.update(companyEmployees).set({ inviteEmailStatus: sent ? "accepted" : "failed", inviteEmailUpdatedAt: new Date() })
      .where(and(eq(companyEmployees.id, id), eq(companyEmployees.inviteEmailStatus, "sending"), eq(companyEmployees.inviteEmailUpdatedAt, claim.attemptAt)))
      .returning({ id: companyEmployees.id });
    if (updated && !sent && claim.link) {
      await tx.update(companyEmployees).set({ editTokenHash: claim.employee.editTokenHash, editTokenExpiresAt: claim.employee.editTokenExpiresAt })
        .where(and(eq(companyEmployees.id, id), eq(companyEmployees.editTokenHash, claim.link.fields.editTokenHash)));
    }
  });
}

export async function drainEmployeeEmails() {
  if (!employeeEmailEnabled) return;
  // A crashed SMTP send may have reached the provider. Let the owner retry explicitly.
  await db.update(companyEmployees).set({ inviteEmailStatus: "failed", inviteEmailUpdatedAt: new Date() })
    .where(and(eq(companyEmployees.inviteEmailStatus, "sending"), lt(companyEmployees.inviteEmailUpdatedAt, new Date(Date.now() - 10 * 60_000))));
  const pending = await db.select({ id: companyEmployees.id, companyId: companyEmployees.companyId }).from(companyEmployees)
    .where(and(eq(companyEmployees.inviteEmailStatus, "pending"), eq(companyEmployees.active, true)))
    .orderBy(companyEmployees.inviteEmailUpdatedAt, companyEmployees.id).limit(20);
  for (const employee of pending) await dispatchEmployeeEmail(employee.id, employee.companyId);
}
