/**
 * A fake `@/lib/stripe` for scripts/check-webhook.mjs.
 *
 * `constructEvent` does not verify the signature: signature verification is
 * Stripe's own code and asserting on it would be testing their library rather
 * than this shop's handler. Everything after it — which is all of the behaviour
 * that can lose a customer's money — is real.
 */

export const stripeState = {
  /** What `listLineItems` should return for the next rebuild. */
  lineItems: [],
  /** Sessions the checkout route asked Stripe to create. */
  created: [],
  /** Sessions the checkout route asked Stripe to expire. */
  expired: [],
  /** Set to make `sessions.create` reject, as a live Stripe outage would. */
  failCreate: false,
};

export function resetStripe() {
  stripeState.lineItems = [];
  stripeState.created = [];
  stripeState.expired = [];
  stripeState.failCreate = false;
}

export function getStripe() {
  return {
    webhooks: {
      constructEvent: (payload) => JSON.parse(payload),
    },
    checkout: {
      sessions: {
        listLineItems: async () => ({ data: stripeState.lineItems }),
        create: async (params) => {
          if (stripeState.failCreate) throw new Error("stripe is down");
          const session = {
            id: `cs_test_${stripeState.created.length + 1}`,
            url: "https://checkout.stripe.test/session",
            ...params,
          };
          stripeState.created.push(session);
          return session;
        },
        expire: async (id) => {
          stripeState.expired.push(id);
          return { id };
        },
      },
    },
  };
}

export function siteUrl() {
  return "https://bamstudio.test";
}
