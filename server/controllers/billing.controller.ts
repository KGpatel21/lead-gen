/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stripe billing. If STRIPE_SECRET_KEY is unset, endpoints return HTTP 503.
 * No mock_cus_ / mock_sub_ fabrication anymore.
 */

import { Request, Response } from "express";
import Stripe from "stripe";
import { config } from "../config";
import { userRepository } from "../db/repositories";
import { logAudit } from "../services/db.service";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

let stripeClient: Stripe | null = null;
function getStripe(): Stripe | null {
  if (!config.stripeSecretKey) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripeSecretKey, { apiVersion: "2023-10-16" as any });
  }
  return stripeClient;
}

const NOT_CONFIGURED = {
  status: 503,
  body: {
    success: false,
    error: "Stripe is not configured. Set STRIPE_SECRET_KEY in .env to enable billing.",
  },
};

export class BillingController {
  public static async createCheckoutSession(req: AuthenticatedRequest, res: Response): Promise<void> {
    const stripe = getStripe();
    if (!stripe) {
      res.status(NOT_CONFIGURED.status).json(NOT_CONFIGURED.body);
      return;
    }
    const { plan, successUrl, cancelUrl } = req.body;
    if (typeof plan !== "string") {
      res.status(400).json({ success: false, error: "plan is required." });
      return;
    }
    const userEmail = req.user?.email;
    const userId = req.user?.id;
    if (!userEmail || !userId) {
      res.status(401).json({ success: false, error: "Authentication required." });
      return;
    }
    try {
      const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
      let customerId = customers.data[0]?.id;
      if (!customerId) {
        const customer = await stripe.customers.create({ email: userEmail, metadata: { userId } });
        customerId = customer.id;
      }

      const priceEnvKey =
        plan.toUpperCase() === "ENTERPRISE" ? "stripePriceEnterpriseId" :
        plan.toUpperCase() === "GROWTH" ? "stripePriceGrowthId" :
        "stripePriceFreeId";
      const priceId = (config as any)[priceEnvKey] as string | null;

      if (!priceId) {
        res.status(400).json({
          success: false,
          error: `Stripe price ID for plan "${plan}" is not configured. Set STRIPE_PRICE_${plan.toUpperCase()}_ID.`,
        });
        return;
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: successUrl || `${config.appUrl}/?checkout=success`,
        cancel_url: cancelUrl || `${config.appUrl}/?checkout=cancel`,
      });

      await logAudit(`Checkout session for plan ${plan}`, "SECURITY", { userId, userEmail });
      res.json({ success: true, url: session.url, sessionId: session.id });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  public static async createPortalSession(req: AuthenticatedRequest, res: Response): Promise<void> {
    const stripe = getStripe();
    if (!stripe) {
      res.status(NOT_CONFIGURED.status).json(NOT_CONFIGURED.body);
      return;
    }
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: "Authentication required." });
      return;
    }
    const user = await userRepository.findById(req.user.id);
    if (!user?.stripeCustomerId) {
      res.status(400).json({ success: false, error: "No active Stripe subscription for this user." });
      return;
    }
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: config.appUrl,
      });
      res.json({ success: true, url: session.url });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  public static async handleWebhook(req: Request, res: Response): Promise<void> {
    const stripe = getStripe();
    const signature = req.headers["stripe-signature"];
    if (!stripe || !signature || !config.stripeWebhookSecret) {
      res.status(400).send("Webhook not configured");
      return;
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody || JSON.stringify(req.body),
        signature as string,
        config.stripeWebhookSecret
      );
    } catch (err: any) {
      res.status(400).send(`Webhook signature failed: ${err.message}`);
      return;
    }

    try {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = sub.customer as string;
          const status = sub.status;
          const priceId = sub.items.data[0]?.price.id;

          let plan = "Growth";
          if (priceId === config.stripePriceEnterpriseId) plan = "Enterprise";
          else if (priceId === config.stripePriceFreeId) plan = "Free";

          const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
          const userId = customer.metadata?.userId;
          if (userId) {
            await userRepository.setSubscription(userId, {
              plan,
              status,
              stripeCustomerId: customerId,
              stripeSubscriptionId: sub.id,
              currentPeriodEnd: (sub as any).current_period_end,
            });
          }
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = sub.customer as string;
          const user = await userRepository.findByStripeCustomerId(customerId);
          if (user) {
            await userRepository.setSubscription(user.id, { status: "canceled" });
          }
          break;
        }
      }
      res.json({ received: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}
