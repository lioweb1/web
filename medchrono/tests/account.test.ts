import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("password reset and team invites (PostgreSQL)", async () => {
  process.env.DATABASE_URL = url;
  const { db, closeDb } = await import("@/lib/db");
  const auth = await import("@/lib/auth");
  const account = await import("@/lib/account");
  const { devOutbox } = await import("@/lib/email");
  const BASE = "https://app.test";
  const tokenFrom = (text: string) => /token=([\w-]+)/.exec(text)![1];
  const last = () => devOutbox[devOutbox.length - 1];

  let owner: Awaited<ReturnType<typeof auth.userFromToken>>;
  const ownerEmail = `boss+${Date.now()}@firm.test`;

  beforeAll(async () => {
    await (await db()).query("truncate orgs, users, sessions, usage_events, stripe_events, login_attempts, password_resets, invites cascade");
    const s = await auth.signUp({ email: ownerEmail, password: "original password", name: "Boss", firm: "Boss Law", acceptTerms: true });
    owner = await auth.userFromToken(s.token);
  });
  afterAll(closeDb);

  it("requires accepting the terms at signup and records the version", async () => {
    await expect(auth.signUp({ email: "x@y.test", password: "long enough pw", name: "X", firm: "Y", acceptTerms: false })).rejects.toThrow(/Terms/);
    const { rows } = await (await db()).query("select terms_version from users where id = $1", [owner!.id]);
    expect(rows[0].terms_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe("password reset", () => {
    it("is silent for unknown emails", async () => {
      const n = devOutbox.length;
      await account.requestPasswordReset("nobody@nowhere.test", BASE);
      expect(devOutbox.length).toBe(n);
    });

    it("emails a single-use link that changes the password and signs out other sessions", async () => {
      const other = await auth.createSession(owner!.id);
      await account.requestPasswordReset(ownerEmail.toUpperCase(), BASE);
      expect(last().to).toBe(ownerEmail);
      expect(last().text).toContain(`${BASE}/reset-password?token=`);
      const token = tokenFrom(last().text);
      // Token is stored hashed only.
      const raw = await (await db()).query("select 1 from password_resets where token_hash = $1", [token]);
      expect(raw.rowCount).toBe(0);

      await expect(account.resetPassword(token, "short")).rejects.toThrow(/10 characters/);
      const fresh = await account.resetPassword(token, "brand new password");
      expect(await auth.userFromToken(other.token)).toBeNull();
      expect(await auth.userFromToken(fresh.token)).not.toBeNull();
      await expect(account.resetPassword(token, "another password!")).rejects.toThrow(/invalid or has expired/);
      await expect(auth.logIn(ownerEmail, "original password", "9.9.9.9")).rejects.toThrow(/Incorrect/);
      await expect(auth.logIn(ownerEmail, "brand new password", "9.9.9.9")).resolves.toHaveProperty("token");
    });

    it("rejects expired links and limits requests per hour", async () => {
      await account.requestPasswordReset(ownerEmail, BASE);
      const token = tokenFrom(last().text);
      await (await db()).query("update password_resets set expires_at = now() - interval '1 minute' where user_id = $1 and used_at is null", [owner!.id]);
      await expect(account.resetPassword(token, "brand new password 2")).rejects.toThrow(/expired/);
      const n = devOutbox.length;
      for (let i = 0; i < 5; i++) await account.requestPasswordReset(ownerEmail, BASE);
      expect(devOutbox.length - n).toBeLessThanOrEqual(1); // 3 per hour in total
    });
  });

  describe("team", () => {
    let memberToken = "";

    it("invites by email and the invitee joins the same firm", async () => {
      await account.inviteMember(owner!, "Para.Legal@Firm.test", "member", BASE);
      expect(last().to).toBe("para.legal@firm.test");
      expect(last().subject).toContain("Boss Law");
      const token = tokenFrom(last().text);
      expect(await account.inviteInfo(token)).toMatchObject({ email: "para.legal@firm.test", org: "Boss Law", inviter: "Boss" });
      await expect(account.acceptInvite(token, { name: "Pat", password: "paralegal pass", acceptTerms: false })).rejects.toThrow(/Terms/);
      const s = await account.acceptInvite(token, { name: "Pat", password: "paralegal pass", acceptTerms: true });
      memberToken = s.token;
      const m = await auth.userFromToken(s.token);
      expect(m).toMatchObject({ role: "member", org: { id: owner!.org.id } });
      await expect(account.acceptInvite(token, { name: "Pat", password: "paralegal pass", acceptTerms: true })).rejects.toThrow(/already used/);
    });

    it("blocks members from managing the team and protects other firms' users", async () => {
      const member = (await auth.userFromToken(memberToken))!;
      await expect(account.inviteMember(member, "x@firm.test", "member", BASE)).rejects.toThrow(/Only account owners/);
      await expect(account.removeMember(member, owner!.id)).rejects.toThrow(/Only account owners/);
      const other = await auth.signUp({ email: `other+${Date.now()}@else.test`, password: "other firm pw", name: "O", firm: "Else", acceptTerms: true });
      const otherUser = (await auth.userFromToken(other.token))!;
      await expect(account.removeMember(owner!, otherUser.id)).rejects.toThrow(/not found/);
      await expect(account.inviteMember(owner!, otherUser.email, "member", BASE)).rejects.toThrow(/another firm/);
      await expect(account.inviteMember(owner!, member.email, "member", BASE)).rejects.toThrow(/already on your team/);
    });

    it("enforces seat limits counting pending invites", async () => {
      // Free plan: 3 seats. Boss + Pat = 2, so one invite fits.
      await account.inviteMember(owner!, "third@firm.test", "member", BASE);
      await expect(account.inviteMember(owner!, "fourth@firm.test", "member", BASE)).rejects.toThrow(/includes 3 users/);
      // Re-inviting the same address replaces its link instead of using a seat.
      await expect(account.inviteMember(owner!, "third@firm.test", "member", BASE)).resolves.toMatchObject({ emailed: false, url: expect.stringContaining("/invite?token=") });
      const { invites } = await account.teamOverview(owner!.org.id);
      expect(invites.map((i) => i.email)).toEqual(["third@firm.test"]);
      await account.revokeInvite(owner!, invites[0].id);
      expect((await account.teamOverview(owner!.org.id)).invites).toHaveLength(0);
    });

    it("keeps at least one owner, and removing a member signs them out", async () => {
      const member = (await auth.userFromToken(memberToken))!;
      await expect(account.changeRole(owner!, owner!.id, "member")).rejects.toThrow(/at least one owner/);
      await account.changeRole(owner!, member.id, "owner");
      expect((await auth.userFromToken(memberToken))!.role).toBe("owner");
      await account.changeRole(owner!, member.id, "member");
      await expect(account.removeMember(owner!, owner!.id)).rejects.toThrow(/yourself/);
      await account.removeMember(owner!, member.id);
      expect(await auth.userFromToken(memberToken)).toBeNull();
    });
  });
});
