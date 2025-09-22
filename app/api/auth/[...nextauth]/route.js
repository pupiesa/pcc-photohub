import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        phone: { label: "Phone", type: "text" },
        pin: { label: "PIN", type: "password" },
      },
      async authorize(credentials) {
        const { phone, pin } = credentials;

        // Replace this with your actual user authentication logic
        const user = await fetch(
          `${process.env.NEXT_PUBLIC_MONGO_BASE}/api/user/check-pin`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number: phone, pin }),
          }
        ).then((res) => res.json());

        if (user?.match) {
          return { id: phone, name: phone };
        }
        return null;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
