import Stripe from "stripe";

const apiVersion = process.env.STRIPE_API_VERSION || undefined;

export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY,
  apiVersion ? { apiVersion } : {}
);

export default stripe;
