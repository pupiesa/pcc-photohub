import { PhotoboothClient } from "@/photobootAPI/client-sdk/photoboothClient";

export const client = new PhotoboothClient({
  mongoBase: process.env.NEXT_PUBLIC_MONGO_BASE!,
  ncBase: process.env.NEXT_PUBLIC_NC_BASE!,
});
