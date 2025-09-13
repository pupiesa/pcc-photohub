import { PhotoboothClient } from "@/photobootAPI/client-sdk/photoboothClient";

export const client = new PhotoboothClient({
  mongoBase: process.env.NEXT_PUBLIC_MONGO_API || "/mapi",
  ncBase:    process.env.NEXT_PUBLIC_NC_API    || "/ncapi",
  smtpBase:  process.env.NEXT_PUBLIC_SMTP_API  || "/smtpapi",
});
