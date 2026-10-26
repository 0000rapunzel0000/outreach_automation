// Re-encrypt every encrypted field with a new key (§13). Stub: run with the worker stopped.
//   OLD_FIELD_ENCRYPTION_KEY=... NEW_FIELD_ENCRYPTION_KEY=... npm run rotate-key -- --apply
// Without --apply it only checks that every value decrypts with the old key.
// Afterwards set FIELD_ENCRYPTION_KEY to the new key and restart web + worker.
import { PrismaClient } from "@prisma/client";
import { decryptField, encryptField } from "../src/lib/crypto";

const db = new PrismaClient();
const OLD = process.env.OLD_FIELD_ENCRYPTION_KEY;
const NEW = process.env.NEW_FIELD_ENCRYPTION_KEY;
const apply = process.argv.includes("--apply");

const rotate = (v: string | null) => (v ? encryptField(decryptField(v, OLD), NEW) : v);

async function main() {
  if (!OLD || !NEW) throw new Error("Set OLD_FIELD_ENCRYPTION_KEY and NEW_FIELD_ENCRYPTION_KEY");
  const people = await db.person.findMany({ select: { id: true, panEnc: true, bankAccountEnc: true, ifscEnc: true, upiIdEnc: true } });
  const wa = await db.waAuthState.findMany();
  let n = 0;
  await db.$transaction(
    async (tx) => {
      for (const p of people) {
        const data = { panEnc: rotate(p.panEnc), bankAccountEnc: rotate(p.bankAccountEnc), ifscEnc: rotate(p.ifscEnc), upiIdEnc: rotate(p.upiIdEnc) };
        if (apply) await tx.person.update({ where: { id: p.id }, data });
        n++;
      }
      for (const w of wa) {
        const valueEnc = rotate(w.valueEnc)!;
        if (apply) await tx.waAuthState.update({ where: { key: w.key }, data: { valueEnc } });
        n++;
      }
    },
    { timeout: 120_000 },
  );
  console.log(`${apply ? "rotated" : "verified"} ${n} rows${apply ? "" : " (dry run; pass --apply)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
