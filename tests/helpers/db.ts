import { systemDb, schema } from "@/lib/db";
import { hashPassword } from "@/lib/security/crypto";
import { provisionUser } from "@/lib/services/accounts";

let n = 0;
export async function makeUser(name = "Test User") {
  n++;
  const email = `user${Date.now()}${n}@example.test`;
  const { user, workspace } = await provisionUser({ email, name, passwordHash: await hashPassword("correct horse battery staple") });
  return { user, workspace, email };
}

export { systemDb, schema };
