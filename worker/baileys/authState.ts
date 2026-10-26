import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataTypeMap } from "baileys";
import { db } from "@/lib/db";
import { decryptField, encryptField } from "@/lib/crypto";

// DB-backed equivalent of Baileys' useMultiFileAuthState (§5.1): WaAuthState rows, BufferJSON, encrypted.

async function read(key: string): Promise<any> {
  const row = await db.waAuthState.findUnique({ where: { key } });
  if (!row) return null;
  return JSON.parse(decryptField(row.valueEnc), BufferJSON.reviver);
}

async function write(key: string, value: unknown) {
  const valueEnc = encryptField(JSON.stringify(value, BufferJSON.replacer));
  await db.waAuthState.upsert({ where: { key }, create: { key, valueEnc }, update: { valueEnc } });
}

async function remove(key: string) {
  await db.waAuthState.deleteMany({ where: { key } });
}

export async function useDbAuthState(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const creds = (await read("creds")) ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
              data[id] = value;
            }),
          );
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? write(key, value) : remove(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write("creds", creds),
  };
}

export async function clearDbAuthState() {
  await db.waAuthState.deleteMany({});
}
