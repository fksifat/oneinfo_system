import { createHash, randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { CreateProfileSchema } from "@oneinfo/contracts";
import { z } from "zod";
import { requireOperator } from "../auth.js";
import { isManagedCardUrl } from "../domain/card-urls.js";
import { db } from "../db/client.js";
import { cardActivationSecrets, cardBatches, cardEvents, cards, companies, companyEmployees, customerAccounts, customerProfiles, orderCardAllocations, profileLinks } from "../db/schema.js";
import { requireCustomer } from "../domain/customer-auth.js";
import { parseBody, sendCreated } from "../http.js";
import { publicProfileFields } from "./profiles.js";

const name = z.string().trim().min(2).max(120);
const email = z.email().max(254).transform(value => value.toLowerCase());
const domain = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const companyParams = z.object({ companyId: z.uuid() });
const employeeParams = companyParams.extend({ employeeId: z.uuid() });
const token = z.string().regex(/^[a-zA-Z0-9_-]{43}$/);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const profileEdit = CreateProfileSchema.pick({ displayName: true, headline: true, bio: true, phone: true, email: true, website: true, avatarUrl: true });
const settings = CreateProfileSchema.pick({ headline: true, bio: true, theme: true }).extend({ name, logoUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ })]).default(""), allowEmployeeEdits: z.boolean() });
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
function fail(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }); }

async function ownCompany(tx: Transaction, companyId: string, accountId: string) {
  const [company] = await tx.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.ownerAccountId, accountId))).for("update");
  if (!company) fail("Company workspace not found.", 404);
  return company;
}

export const companyRoutes: FastifyPluginAsync = async app => {
  app.addHook("onRequest", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });

  app.get("/admin", async request => {
    await requireOperator(request, ["SUPER_ADMIN"]);
    return { items: await db.select({ id: companies.id, name: companies.name, domain: companies.domain, ownerEmail: customerAccounts.email })
      .from(companies).innerJoin(customerAccounts, eq(companies.ownerAccountId, customerAccounts.id)).orderBy(asc(companies.name)) };
  });

  app.post("/admin", async (request, reply) => {
    await requireOperator(request, ["SUPER_ADMIN"]);
    const input = parseBody(z.object({ name, ownerEmail: email, domain: domain.optional() }), request.body);
    const [owner] = await db.select({ id: customerAccounts.id }).from(customerAccounts)
      .where(and(eq(customerAccounts.email, input.ownerEmail), eq(customerAccounts.active, true)));
    if (!owner) fail("The company owner needs an active Oneinfo account.", 404);
    const [created] = await db.insert(companies).values({ name: input.name, ownerAccountId: owner.id, domain: input.domain ?? null }).returning({ id: companies.id });
    return sendCreated(reply, created);
  });

  app.put("/admin/:companyId/domain", async request => {
    await requireOperator(request, ["SUPER_ADMIN"]);
    const { companyId } = parseBody(companyParams, request.params);
    const input = parseBody(z.object({ domain: domain.nullable() }), request.body);
    const [updated] = await db.update(companies).set({ ...input, updatedAt: new Date() }).where(eq(companies.id, companyId)).returning({ id: companies.id });
    if (!updated) fail("Company not found.", 404);
    return updated;
  });

  app.post("/admin/:companyId/cards", async request => {
    const actor = await requireOperator(request, ["SUPER_ADMIN"]);
    const { companyId } = parseBody(companyParams, request.params);
    const { cardSlug } = parseBody(z.object({ cardSlug: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) }), request.body);
    return db.transaction(async tx => {
      const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
      if (!company) fail("Company not found.", 404);
      const [card] = await tx.select().from(cards).innerJoin(cardBatches, eq(cardBatches.id, cards.batchId))
        .where(and(eq(cards.publicSlug, cardSlug), isNotNull(cardBatches.printConfirmedAt))).for("update", { of: cards });
      if (!card) fail("Card not found in confirmed stock.", 404);
      const current = card.cards;
      if (current.companyId === companyId) return { assigned: true };
      if (current.companyId || current.profileId || current.customerAccountId || current.qcStatus !== "PASSED" || current.lifecycleStatus !== "QC_PASSED" ||
        current.inventoryStatus !== "SALEABLE" || !isManagedCardUrl(current.canonicalUrl, cardSlug)) fail("This card is not available for a company.");
      const [issued] = await tx.select({ id: cardActivationSecrets.cardId }).from(cardActivationSecrets).where(eq(cardActivationSecrets.cardId, current.id));
      const [allocated] = await tx.select({ id: orderCardAllocations.id }).from(orderCardAllocations).where(eq(orderCardAllocations.cardId, current.id));
      if (issued || allocated) fail("This card already has an activation code or order allocation.");
      await tx.update(cards).set({ companyId, inventoryStatus: "RESERVED", updatedAt: new Date() }).where(eq(cards.id, current.id));
      await tx.insert(cardEvents).values({ cardId: current.id, actorId: actor.operatorId, eventType: "COMPANY_STOCK_RESERVED", metadata: { companyId } });
      return { assigned: true };
    });
  });

  app.get("/me", async request => {
    const account = await requireCustomer(request);
    return { items: await db.select().from(companies).where(eq(companies.ownerAccountId, account.id)).orderBy(asc(companies.name)) };
  });

  app.get("/me/:companyId", async request => {
    const account = await requireCustomer(request);
    const { companyId } = parseBody(companyParams, request.params);
    const [company] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.ownerAccountId, account.id)));
    if (!company) fail("Company workspace not found.", 404);
    const employees = await db.select({ id: companyEmployees.id, email: companyEmployees.email, active: companyEmployees.active,
      profileId: companyEmployees.profileId, name: customerProfiles.displayName, publicSlug: customerProfiles.publicSlug })
      .from(companyEmployees).innerJoin(customerProfiles, eq(companyEmployees.profileId, customerProfiles.id))
      .where(eq(companyEmployees.companyId, companyId)).orderBy(asc(customerProfiles.displayName));
    const stock = await db.select({ id: cards.id, profileId: cards.profileId, publicSlug: cards.publicSlug, lifecycleStatus: cards.lifecycleStatus })
      .from(cards).where(eq(cards.companyId, companyId)).orderBy(asc(cards.publicSlug));
    return { company, employees, cards: stock };
  });

  app.put("/me/:companyId/settings", async request => {
    const account = await requireCustomer(request);
    const { companyId } = parseBody(companyParams, request.params);
    const input = parseBody(settings, request.body);
    return db.transaction(async tx => {
      await ownCompany(tx, companyId, account.id);
      await tx.update(companies).set({ ...input, updatedAt: new Date() }).where(eq(companies.id, companyId));
      const members = tx.select({ id: companyEmployees.profileId }).from(companyEmployees).where(eq(companyEmployees.companyId, companyId));
      await tx.update(customerProfiles).set({ company: input.name, theme: input.theme, updatedAt: new Date() }).where(inArray(customerProfiles.id, members));
      if (!input.allowEmployeeEdits) await tx.update(companyEmployees).set({ editTokenHash: null, editTokenExpiresAt: null }).where(eq(companyEmployees.companyId, companyId));
      return { saved: true };
    });
  });

  app.post("/me/:companyId/employees", { bodyLimit: 128 * 1024 }, async request => {
    const account = await requireCustomer(request);
    const { companyId } = parseBody(companyParams, request.params);
    const { employees } = parseBody(z.object({ employees: z.array(z.object({ name, email, headline: z.string().trim().max(160).optional() })).min(1).max(200) }), request.body);
    return db.transaction(async tx => {
      const company = await ownCompany(tx, companyId, account.id);
      const existing = await tx.select({ email: companyEmployees.email }).from(companyEmployees).where(eq(companyEmployees.companyId, companyId));
      const seen = new Set(existing.map(item => item.email));
      let added = 0;
      for (const employee of employees) {
        if (seen.has(employee.email)) continue;
        seen.add(employee.email);
        const [profile] = await tx.insert(customerProfiles).values({ publicSlug: `team-${randomBytes(12).toString("hex")}`, displayName: employee.name,
          headline: employee.headline || company.headline, company: company.name, bio: company.bio, theme: company.theme, published: true }).returning({ id: customerProfiles.id });
        if (!profile) throw new Error("Employee profile creation failed");
        await tx.insert(companyEmployees).values({ companyId, profileId: profile.id, email: employee.email });
        added++;
      }
      return { added, skipped: employees.length - added };
    });
  });

  app.patch("/me/:companyId/employees/:employeeId", async request => {
    const account = await requireCustomer(request);
    const { companyId, employeeId } = parseBody(employeeParams, request.params);
    const { active } = parseBody(z.object({ active: z.boolean() }), request.body);
    return db.transaction(async tx => {
      await ownCompany(tx, companyId, account.id);
      const [employee] = await tx.update(companyEmployees).set({ active, updatedAt: new Date(), ...(!active ? { editTokenHash: null, editTokenExpiresAt: null } : {}) })
        .where(and(eq(companyEmployees.id, employeeId), eq(companyEmployees.companyId, companyId))).returning();
      if (!employee) fail("Employee not found.", 404);
      await tx.update(customerProfiles).set({ published: active, updatedAt: new Date() }).where(eq(customerProfiles.id, employee.profileId));
      const changed = await tx.update(cards).set({ lifecycleStatus: active ? "ACTIVATED" : "SUSPENDED", updatedAt: new Date() })
        .where(and(eq(cards.companyId, companyId), eq(cards.profileId, employee.profileId), eq(cards.lifecycleStatus, active ? "SUSPENDED" : "ACTIVATED"))).returning({ id: cards.id });
      if (changed.length) await tx.insert(cardEvents).values(changed.map(card => ({ cardId: card.id, actorId: account.id, eventType: active ? "COMPANY_CARD_REACTIVATED" : "COMPANY_CARD_DEACTIVATED", newState: active ? "ACTIVATED" : "SUSPENDED" })));
      return { active };
    });
  });

  app.put("/me/:companyId/cards/:cardId", async request => {
    const account = await requireCustomer(request);
    const { companyId, cardId } = parseBody(companyParams.extend({ cardId: z.uuid() }), request.params);
    const { employeeId } = parseBody(z.object({ employeeId: z.uuid().nullable() }), request.body);
    return db.transaction(async tx => {
      await ownCompany(tx, companyId, account.id);
      const [card] = await tx.select().from(cards).where(and(eq(cards.id, cardId), eq(cards.companyId, companyId))).for("update");
      if (!card || !["QC_PASSED", "ACTIVATED", "SUSPENDED"].includes(card.lifecycleStatus)) fail("Company card is unavailable.", 404);
      const [employee] = employeeId ? await tx.select().from(companyEmployees)
        .where(and(eq(companyEmployees.id, employeeId), eq(companyEmployees.companyId, companyId), eq(companyEmployees.active, true))) : [];
      if (employeeId && !employee) fail("Choose an active employee in this company.", 404);
      const profileId = employee?.profileId ?? null;
      const status = employee ? "ACTIVATED" : "QC_PASSED";
      if (card.profileId === profileId && card.lifecycleStatus === status) return { saved: true };
      await tx.update(cards).set({ profileId, lifecycleStatus: status, updatedAt: new Date() }).where(eq(cards.id, cardId));
      await tx.insert(cardEvents).values({ cardId, actorId: account.id, eventType: employee ? "COMPANY_CARD_ASSIGNED" : "COMPANY_CARD_UNASSIGNED",
        previousState: card.lifecycleStatus, newState: status, metadata: { companyId, employeeId } });
      return { saved: true };
    });
  });

  app.post("/me/:companyId/employees/:employeeId/edit-link", async request => {
    const account = await requireCustomer(request);
    const { companyId, employeeId } = parseBody(employeeParams, request.params);
    return db.transaction(async tx => {
      const company = await ownCompany(tx, companyId, account.id);
      if (!company.allowEmployeeEdits) fail("Enable employee profile edits in company settings first.");
      const secret = randomBytes(32).toString("base64url");
      const [employee] = await tx.update(companyEmployees).set({ editTokenHash: hash(secret), editTokenExpiresAt: new Date(Date.now() + 7 * 86400_000) })
        .where(and(eq(companyEmployees.id, employeeId), eq(companyEmployees.companyId, companyId), eq(companyEmployees.active, true))).returning({ id: companyEmployees.id });
      if (!employee) fail("Active employee not found.", 404);
      return { path: `/team#edit/${secret}` };
    });
  });

  async function editable(tx: Transaction, secret: string) {
    const digest = hash(secret);
    const [recipient] = await tx.select({ companyId: companyEmployees.companyId }).from(companyEmployees).where(eq(companyEmployees.editTokenHash, digest));
    if (!recipient) fail("This employee edit link is invalid or expired.", 404);
    const [company] = await tx.select({ allowed: companies.allowEmployeeEdits }).from(companies).where(eq(companies.id, recipient.companyId)).for("share");
    if (!company?.allowed) fail("This employee edit link is invalid or expired.", 404);
    const [employee] = await tx.select({ profileId: companyEmployees.profileId }).from(companyEmployees)
      .where(and(eq(companyEmployees.editTokenHash, digest), gt(companyEmployees.editTokenExpiresAt, new Date()), eq(companyEmployees.active, true))).for("share");
    if (!employee) fail("This employee edit link is invalid or expired.", 404);
    return employee;
  }

  app.post("/employee/profile", { bodyLimit: 8192 }, async request => {
    const input = parseBody(z.object({ token, profile: profileEdit.optional() }), request.body);
    return db.transaction(async tx => {
      const employee = await editable(tx, input.token);
      if (input.profile) await tx.update(customerProfiles).set({ ...input.profile, updatedAt: new Date() }).where(eq(customerProfiles.id, employee.profileId));
      const [profile] = await tx.select(publicProfileFields).from(customerProfiles).where(eq(customerProfiles.id, employee.profileId));
      return { profile };
    });
  });

  app.get("/public/:domain", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    const input = parseBody(z.object({ domain }), request.params);
    const { profile: slug } = parseBody(z.object({ profile: z.string().max(64).optional() }), request.query);
    const [company] = await db.select({ id: companies.id, name: companies.name, logoUrl: companies.logoUrl, theme: companies.theme })
      .from(companies).where(eq(companies.domain, input.domain));
    if (!company) fail("Company portal not found.", 404);
    const employees = await db.select(slug ? publicProfileFields : { id: customerProfiles.id, publicSlug: customerProfiles.publicSlug, displayName: customerProfiles.displayName, headline: customerProfiles.headline })
      .from(companyEmployees).innerJoin(customerProfiles, eq(companyEmployees.profileId, customerProfiles.id))
      .where(and(eq(companyEmployees.companyId, company.id), eq(companyEmployees.active, true), eq(customerProfiles.published, true), slug ? eq(customerProfiles.publicSlug, slug) : undefined))
      .orderBy(asc(customerProfiles.displayName)).limit(slug ? 1 : 500);
    if (slug && !employees[0]) fail("Employee profile not found.", 404);
    const links = slug && employees[0] ? await db.select({ id: profileLinks.id, label: profileLinks.label, url: profileLinks.url })
      .from(profileLinks).where(and(eq(profileLinks.profileId, employees[0].id), eq(profileLinks.active, true))).orderBy(asc(profileLinks.sortOrder)) : [];
    return { company, employees, links };
  });
};
