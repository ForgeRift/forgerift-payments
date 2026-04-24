'use strict';

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/**
 * Generate a cryptographically secure subscriber token.
 * 32 random bytes = 64-char hex string. Sufficient entropy for auth token use.
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Map a Stripe lookup key to the plan slug stored in the customers table.
 * e.g. "vps-monthly" → "vps-control", "bundle-founder-monthly" → "bundle"
 */
function lookupKeyToPlan(lookupKey) {
  if (!lookupKey) return null;
  if (lookupKey.startsWith('vps-'))    return 'vps-control';
  if (lookupKey.startsWith('lt-'))     return 'local-terminal';
  if (lookupKey.startsWith('bundle-')) return 'bundle';
  return null;
}

function lookupKeyToInterval(lookupKey) {
  if (!lookupKey) return 'month';
  return lookupKey.includes('annual') ? 'year' : 'month';
}

function lookupKeyIsFounder(lookupKey) {
  return typeof lookupKey === 'string' && lookupKey.includes('founder');
}

/**
 * Provision a new subscriber on checkout.session.completed.
 * Creates or updates the customers row and returns the auth token.
 *
 * trialEnd: Unix timestamp (seconds) or null
 */
async function provisionSubscriber({ email, stripeCustomerId, stripeSubscriptionId, stripePriceId, lookupKey, trialEnd }) {
  const plan     = lookupKeyToPlan(lookupKey);
  const interval = lookupKeyToInterval(lookupKey);
  const founder  = lookupKeyIsFounder(lookupKey);
  const token    = generateToken();
  const status   = trialEnd ? 'trial' : 'active';
  const trialEndTs = trialEnd ? new Date(trialEnd * 1000).toISOString() : null;

  // Upsert on stripe_customer_id in case of retried webhooks
  const { data, error } = await supabase
    .from('customers')
    .upsert({
      email,
      token,
      plan,
      plan_interval:          interval,
      founder,
      status,
      stripe_customer_id:     stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_price_id:        stripePriceId,
      trial_end:              trialEndTs,
      expires_at:             null, // set on subscription deletion / payment failure
      deleted_at:             null,
    }, {
      onConflict:   'stripe_customer_id',
      ignoreDuplicates: false,
    })
    .select('token, plan, founder, status')
    .single();

  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  return data;
}

/**
 * Mark subscription as in grace period (payment failed).
 * Grace period = 7 days. Features stay on, support is gated.
 */
async function startGracePeriod(stripeSubscriptionId) {
  const gracePeriodUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('customers')
    .update({ status: 'grace', grace_period_until: gracePeriodUntil })
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .is('deleted_at', null);
  if (error) throw new Error(`Grace period update failed: ${error.message}`);
}

/**
 * Clear grace period on successful payment.
 */
async function clearGracePeriod(stripeSubscriptionId) {
  const { error } = await supabase
    .from('customers')
    .update({ status: 'active', grace_period_until: null })
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .is('deleted_at', null);
  if (error) throw new Error(`Clear grace period failed: ${error.message}`);
}

/**
 * Activate subscriber when trial converts (trial_will_end / subscription updated to active).
 */
async function activateSubscriber(stripeSubscriptionId) {
  const { error } = await supabase
    .from('customers')
    .update({ status: 'active', trial_end: null })
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .is('deleted_at', null);
  if (error) throw new Error(`Activation failed: ${error.message}`);
}

/**
 * Deactivate on cancellation. Preserve row for GDPR/Stripe reconciliation.
 * Founder Cohort: once cancelled, loses founder rate permanently (by design).
 */
async function deactivateSubscriber(stripeSubscriptionId) {
  const { error } = await supabase
    .from('customers')
    .update({
      status:       'inactive',
      cancelled_at: new Date().toISOString(),
      expires_at:   new Date().toISOString(),
    })
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .is('deleted_at', null);
  if (error) throw new Error(`Deactivation failed: ${error.message}`);
}

/**
 * Look up a subscriber's token and status by email (for support lookups).
 * Returns null if not found or deleted.
 */
async function getSubscriberByEmail(email) {
  const { data, error } = await supabase
    .from('customers')
    .select('email, plan, status, founder, created_at, expires_at, trial_end')
    .eq('email', email)
    .is('deleted_at', null)
    .single();
  if (error) return null;
  return data;
}

module.exports = {
  provisionSubscriber,
  startGracePeriod,
  clearGracePeriod,
  activateSubscriber,
  deactivateSubscriber,
  getSubscriberByEmail,
};
