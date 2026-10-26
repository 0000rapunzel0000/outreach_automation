// Seed: default settings, TOS v1 placeholder, one SUPER_ADMIN from env (§14 M1). Safe to re-run.
import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { SETTINGS } from "../src/lib/settings";

const db = new PrismaClient();

const TOS_V1 = `# Terms of Service (placeholder, v1)

**Replace this text with the terms your lawyer approves before going live.**

## 1. What you're agreeing to
You join our outreach team as an independent contributor and are paid monthly as agreed.

## 2. Your LinkedIn account
You connect your own LinkedIn account through our partner Unipile. While it is connected, our system may send connection requests and messages on your behalf for our outreach campaigns. We never see your LinkedIn password. LinkedIn may restrict accounts used this way; you accept that risk.

## 3. Staying connected
Keep your LinkedIn connected. If it disconnects we'll message you on WhatsApp with a reconnect link. Long disconnections may affect your pay.

## 4. Your data
We store your name, contact details, address, PAN and payment details to pay you. PAN and bank details are encrypted. We keep records of connection uptime as evidence for payroll. See our privacy notice for retention periods.

## 5. Ending
You or we can end this arrangement at any time. When it ends we remove your LinkedIn from Unipile.
`;

async function main() {
  for (const [key, def] of Object.entries(SETTINGS)) {
    await db.setting.upsert({ where: { key }, create: { key, value: def.default as Prisma.InputJsonValue }, update: {} });
  }

  if (!(await db.tosVersion.findFirst())) {
    await db.tosVersion.create({
      data: { version: 1, contentMd: TOS_V1, contentHash: createHash("sha256").update(TOS_V1).digest("hex"), publishedAt: new Date(), isCurrent: true },
    });
    console.log("seeded TOS v1 placeholder");
  }

  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.user.upsert({ where: { email }, create: { email, passwordHash, role: "SUPER_ADMIN" }, update: { role: "SUPER_ADMIN" } });
    console.log(`super admin: ${email}`);
  } else {
    console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; no admin created");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
