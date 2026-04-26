'use strict';

require('dotenv').config();

const express = require('express');
const Stripe  = require('stripe');
const db      = require('./supabase');
const email   = require('./email');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app    = express();
const PORT   = process.env.PORT || 3020;

// ---------------------------------------------------------------------------
// Health check (no auth required Ã¢â‚¬â€ used by nginx upstream health checks)
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'forgerift-payments' }));

// ---------------------------------------------------------------------------
// Stripe webhook Ã¢â‚¬â€ MUST receive raw body for signature verification
// Do NOT use express.json() before this route.
// ---------------------------------------------------------------------------
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      // Signature verification Ã¢â‚¬â€ prevents spoofed webhook payloads
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      // Log the error type only Ã¢â‚¬â€ not the payload (may contain PII)
      console.error('[webhook] Signature verification failed:', err.message);
      return res.status(400).send('Webhook signature invalid');
    }

    // Acknowledge immediately Ã¢â‚¬â€ Stripe retries if we don't respond within 30s
    res.json({ received: true });

    // Process asynchronously so slow DB/email calls don't affect Stripe's timeout
    handleEvent(event).catch(err => {
      // Log event type + ID only Ã¢â‚¬â€ never log raw event data (contains customer PII)
      console.error(`[webhook] Handler error for ${event.type} / ${event.id}:`, err.message);
    });
  }
);

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------
async function handleEvent(event) {
  const type = event.type;
  console.log(`[webhook] Processing ${type} / ${event.id}`);

  switch (type) {

    // -------------------------------------------------------------------------
    // New subscription Ã¢â‚¬â€ provision token and send welcome email
    // -------------------------------------------------------------------------
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') break; // ignore one-time payments

      const customerId     = session.customer;
      const subscriptionId = session.subscription;
      const customerEmail  = session.customer_details?.email;

      if (!customerEmail || !customerId || !subscriptionId) {
        console.error('[webhook] checkout.session.completed missing required fields');
        break;
      }

      // Fetch subscription to get price/trial details
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId      = subscription.items.data[0]?.price?.id;
      const lookupKey    = subscription.items.data[0]?.price?.lookup_key;
      const trialEnd     = subscription.trial_end; // Unix timestamp or null

      const customer = await db.provisionSubscriber({
        email:                  customerEmail,
        stripeCustomerId:       customerId,
        stripeSubscriptionId:   subscriptionId,
        stripePriceId:          priceId,
        lookupKey,
        trialEnd,
      });

      await email.sendWelcomeEmail({
        to:      customerEmail,
        token:   customer.token,
        plan:    customer.plan,
        founder: customer.founder,
        isTrial: customer.status === 'trial',
      });

      console.log(`[webhook] Provisioned ${customer.plan} for customer ${customerId}`);
      break;
    }

    // -------------------------------------------------------------------------
    // Trial ending in 3 days Ã¢â‚¬â€ Stripe sends this automatically if configured
    // (optional: set up in Stripe Dashboard Ã¢â€ â€™ Billing Ã¢â€ â€™ Subscriptions Ã¢â€ â€™ Trial reminder)
    // -------------------------------------------------------------------------
    case 'customer.subscription.trial_will_end': {
      // Activate the subscriber (trial converts to paid)
      const sub = event.data.object;
      await db.activateSubscriber(sub.id);
      console.log(`[webhook] Trial activating for subscription ${sub.id}`);
      break;
    }

    // -------------------------------------------------------------------------
    // Subscription updated Ã¢â‚¬â€ handle trialÃ¢â€ â€™active conversion
    // -------------------------------------------------------------------------
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      if (sub.status === 'active') {
        await db.activateSubscriber(sub.id);
        console.log(`[webhook] Subscription activated: ${sub.id}`);
      }
      break;
    }

    // -------------------------------------------------------------------------
    // Payment failed Ã¢â‚¬â€ start 7-day grace period, warn customer
    // -------------------------------------------------------------------------
    case 'invoice.payment_failed': {
      const invoice        = event.data.object;
      const subscriptionId = invoice.subscription;
      const customerId     = invoice.customer;

      if (!subscriptionId) break; // not a subscription invoice

      await db.startGracePeriod(subscriptionId);

      // Look up email to send warning Ã¢â‚¬â€ fetch from Stripe (not stored in log)
      const stripeCustomer = await stripe.customers.retrieve(customerId);
      const customerEmail  = stripeCustomer.email;
      const gracePeriodUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      if (customerEmail) {
        const row = await db.getSubscriberByEmail(customerEmail);
        await email.sendGraceWarningEmail({
          to:             customerEmail,
          plan:           row?.plan || 'unknown',
          gracePeriodUntil,
        });
      }

      console.log(`[webhook] Grace period started for subscription ${subscriptionId}`);
      break;
    }

    // -------------------------------------------------------------------------
    // Payment succeeded Ã¢â‚¬â€ clear any active grace period
    // -------------------------------------------------------------------------
    case 'invoice.payment_succeeded': {
      const invoice        = event.data.object;
      const subscriptionId = invoice.subscription;
      if (!subscriptionId) break;

      await db.clearGracePeriod(subscriptionId);
      console.log(`[webhook] Payment succeeded, grace cleared for ${subscriptionId}`);
      break;
    }

    // -------------------------------------------------------------------------
    // Subscription cancelled Ã¢â‚¬â€ deactivate immediately
    // Founder Cohort: loses locked rate on cancellation (by design, per ToS Ã‚Â§6.8)
    // -------------------------------------------------------------------------
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await db.deactivateSubscriber(sub.id);
      console.log(`[webhook] Subscription deactivated: ${sub.id}`);
      break;
    }

    default:
      // Unhandled event types Ã¢â‚¬â€ not an error, Stripe sends many event types
      break;
  }
}

// ---------------------------------------------------------------------------
// Checkout session creation Ã¢â‚¬â€ GET /checkout?plan=<lookup_key>
// Creates a Stripe Checkout session and redirects to the hosted payment page.
// ---------------------------------------------------------------------------
const ALLOWED_PLANS = new Set([
  'vps-monthly', 'vps-annual', 'vps-founder-monthly',
  'lt-monthly', 'lt-annual', 'lt-founder-monthly',
  'bundle-monthly', 'bundle-annual', 'bundle-founder-monthly',
]);

app.get('/checkout', async (req, res) => {
  const lookupKey = req.query.plan;

  if (!lookupKey || !ALLOWED_PLANS.has(lookupKey)) {
    return res.status(400).send('Invalid or missing plan parameter.');
  }

  try {
    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true });
    if (!prices.data.length) {
      console.error(`[checkout] No active price found for lookup_key: ${lookupKey}`);
      return res.status(404).send('Plan not available.');
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: prices.data[0].id, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
      },
      allow_promotion_codes: true,
      success_url: 'https://forgerift.io/?checkout=success',
      cancel_url: 'https://forgerift.io/#pricing',
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.error('[checkout] Session creation error:', err.message);
    res.status(500).send('Checkout temporarily unavailable. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Token validation -- GET /validate?token=<license_token>
// Called by local-terminal-mcp on startup to verify subscription status.
// Returns 200 { valid, status, plan } or 401 { valid: false, reason }.
// ---------------------------------------------------------------------------
app.get('/validate', async (req, res) => {
  const token = req.query.token;
  if (!token || typeof token !== 'string' || token.length < 16) {
    return res.status(400).json({ valid: false, reason: 'Missing or malformed token' });
  }
  try {
    const result = await db.validateToken(token);
    return result.valid
      ? res.json(result)
      : res.status(401).json(result);
  } catch (err) {
    console.error('[validate] Internal error:', err.message);
    return res.status(500).json({ valid: false, reason: 'Validation temporarily unavailable' });
  }
});
app.listen(PORT, '127.0.0.1', () => {
  // Bind to localhost only Ã¢â‚¬â€ nginx handles public TLS termination
  console.log(`[forgerift-payments] Listening on 127.0.0.1:${PORT}`);
});
