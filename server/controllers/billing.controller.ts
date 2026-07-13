/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import { dbService } from "../services/db.service";
import Stripe from "stripe";

let stripeClient: Stripe | null = null;
function getStripe(): Stripe | null {
  if (!stripeClient && process.env.STRIPE_SECRET_KEY) {
    try {
      stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2023-10-16" as any,
      });
    } catch (e) {
      console.warn("Failed to initialize real Stripe SDK. Using high-fidelity billing simulator instead.", e);
    }
  }
  return stripeClient;
}

export class BillingController {
  /**
   * Creates a Stripe Checkout Session or simulates sandbox checkout.
   */
  public static async createCheckoutSession(req: Request, res: Response) {
    const { plan, successUrl, cancelUrl } = req.body;
    const userEmail = (req as any).user?.email || "billing-admin@outbound.ai";
    const userId = (req as any).user?.id || "usr-default-admin";

    const stripe = getStripe();
    const isProduction = process.env.NODE_ENV === "production";

    if (isProduction && !stripe) {
      res.status(403).json({ error: "Critical: Stripe is unconfigured or failed to initialize in production mode. Real Stripe keys are required." });
      return;
    }

    if (stripe) {
      try {
        console.log(`[Stripe Billing] Launching checkout session for plan: ${plan}, email: ${userEmail}`);
        
        // Find or create customer
        const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
        let customerId = customers.data[0]?.id;
        if (!customerId) {
          const customer = await stripe.customers.create({ email: userEmail, metadata: { userId } });
          customerId = customer.id;
        }

        // Get Price ID based on tier request
        let priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_ID`];
        if (!priceId) {
          // Fallback demo product creation on-the-fly
          const products = await stripe.products.list({ limit: 10 });
          let product = products.data.find(p => p.name === `Outbound.AI ${plan} Subscription`);
          if (!product) {
            product = await stripe.products.create({
              name: `Outbound.AI ${plan} Subscription`,
              description: `Enterprise-grade SaaS delivery outbound pipeline: ${plan} Tier.`,
            });
          }
          const prices = await stripe.prices.list({ product: product.id, limit: 1 });
          let price = prices.data[0];
          if (!price) {
            price = await stripe.prices.create({
              product: product.id,
              unit_amount: plan === "Enterprise" ? 49900 : 9900,
              currency: "usd",
              recurring: { interval: "month" },
            });
          }
          priceId = price.id;
        }

        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          payment_method_types: ["card"],
          line_items: [{ price: priceId, quantity: 1 }],
          mode: "subscription",
          success_url: successUrl || "http://localhost:3000/?checkout=success",
          cancel_url: cancelUrl || "http://localhost:3000/?checkout=cancel",
        });

        res.json({ success: true, url: session.url, sessionId: session.id, isMock: false });
        return;
      } catch (err: any) {
        console.error("Stripe Checkout Error:", err);
        if (isProduction) {
          res.status(500).json({ error: `Stripe Checkout Session creation failed in production: ${err.message}` });
          return;
        }
        // Fallthrough to sandbox simulator on Stripe error to keep dev sandbox online
      }
    }

    // High-Fidelity Sandbox Payment Simulation Fallback
    console.log(`[Stripe Billing] Utilizing secure offline billing sandbox for ${plan} tier.`);
    
    // Create audit log for simulation
    dbService.logAudit(`Initiated sandbox payment intent for ${plan} subscription`, "SECURITY", userId, undefined, userEmail);

    // Update user subscription state directly in persistent DB
    const dbState = dbService.getState();
    const user = dbState.users.find(u => u.id === userId);
    if (user) {
      (user as any).subscription = {
        plan,
        status: "active",
        currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 days
        stripeCustomerId: "mock_cus_" + Math.random().toString(36).substring(5, 12),
        stripeSubscriptionId: "mock_sub_" + Math.random().toString(36).substring(5, 12),
      };
      dbService.saveDb();
    }

    // Return successful simulation redirect URL back to the main client applet
    res.json({
      success: true,
      url: "/?checkout=success&plan=" + plan,
      isMock: true,
      message: `Simulated checkout completed for plan: ${plan}`
    });
  }

  /**
   * Generates a Stripe Customer Portal link or returns fallback simulation.
   */
  public static async createPortalSession(req: Request, res: Response) {
    const userId = (req as any).user?.id || "usr-default-admin";
    const dbState = dbService.getState();
    const user = dbState.users.find(u => u.id === userId);
    const sub = (user as any)?.subscription;

    const isProduction = process.env.NODE_ENV === "production";
    const stripe = getStripe();

    if (isProduction && (!stripe || !sub?.stripeCustomerId || sub.stripeCustomerId.startsWith("mock_"))) {
      res.status(403).json({ error: "Stripe customer portal session cannot be generated in production mode. Real subscription required." });
      return;
    }

    if (stripe && sub?.stripeCustomerId && !sub.stripeCustomerId.startsWith("mock_")) {
      try {
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: sub.stripeCustomerId,
          return_url: "http://localhost:3000/",
        });
        res.json({ success: true, url: portalSession.url, isMock: false });
        return;
      } catch (err: any) {
        console.error("Stripe Portal Error:", err);
        if (isProduction) {
          res.status(500).json({ error: `Stripe customer portal generation failed in production: ${err.message}` });
          return;
        }
      }
    }

    // Portal Simulator
    res.json({
      success: true,
      url: "/?portal=open",
      isMock: true,
      message: "Simulated Stripe customer portal opened."
    });
  }

  /**
   * Listens and processes authentic webhook events from Stripe servers.
   */
  public static async handleWebhook(req: Request, res: Response) {
    const stripe = getStripe();
    const signature = req.headers["stripe-signature"];

    if (!stripe || !signature || !process.env.STRIPE_WEBHOOK_SECRET) {
      res.status(400).json({ success: false, error: "Stripe Webhook config or signature missing." });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody || JSON.stringify(req.body),
        signature as string,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err: any) {
      console.error(`Webhook Signature Verification Failed:`, err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    console.log(`[Stripe Webhook] Received authentic event: ${event.type}`);

    try {
      const dbState = dbService.getState();

      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;
          const status = subscription.status;
          const priceId = subscription.items.data[0]?.price.id;

          // Map priceId back to a plan
          let plan = "Growth";
          if (priceId === process.env.STRIPE_PRICE_ENTERPRISE_ID) {
            plan = "Enterprise";
          } else if (priceId === process.env.STRIPE_PRICE_FREE_ID) {
            plan = "Free";
          }

          // Find user by customer ID or query customer meta
          const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
          const userId = customer.metadata?.userId;

          const targetUser = dbState.users.find(u => u.id === userId || (u as any).subscription?.stripeCustomerId === customerId);
          if (targetUser) {
            (targetUser as any).subscription = {
              plan,
              status,
              currentPeriodEnd: (subscription as any).current_period_end,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscription.id,
            };
            dbService.saveDb();
            console.log(`[Stripe Webhook] Synchronized user subscription for user ID: ${targetUser.id}`);
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;

          const targetUser = dbState.users.find(u => (u as any).subscription?.stripeCustomerId === customerId);
          if (targetUser) {
            (targetUser as any).subscription.status = "canceled";
            dbService.saveDb();
            console.log(`[Stripe Webhook] Canceled subscription for user ID: ${targetUser.id}`);
          }
          break;
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("Webhook processing logic error:", err);
      res.status(500).json({ error: "Webhook process failed." });
    }
  }
}
