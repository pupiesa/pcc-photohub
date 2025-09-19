import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const MONGO_BASE =
  process.env.NEXT_PUBLIC_MONGO_BASE || "http://localhost:2000";

const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Phone",
      credentials: { phone: { label: "Phone" }, pin: { label: "PIN" } },
      async authorize(credentials) {
        const phone = (credentials?.phone || "").trim();
        const pin = credentials?.pin || "";
        if (!phone || !pin) return null;

        try {
          const res = await fetch(`${MONGO_BASE}/api/user/check-pin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number: phone, pin }),
          });
          if (res.ok) {
            const payload = await res.json();
            return { phone, ...payload.user };
          }
          if (res.status === 404) {
            const create = await fetch(`${MONGO_BASE}/api/user`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ number: phone, pin }),
            });
            if (create.ok) {
              const data = await create.json();
              return { phone, id: data.id || data._id || null };
            }
          }
          return null;
        } catch {
          throw new Error("AUTH_ERROR");
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.phone = user.phone;
        token.id = user.id ?? user._id ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = session.user ?? {};
      session.user.phone = token.phone;
      session.user.id = token.id;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
