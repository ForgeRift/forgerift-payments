'use strict';

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.FROM_EMAIL || 'ForgeRift <support@forgerift.io>';

/**
 * Welcome email sent immediately after checkout.session.completed.
 * Contains the auth token and setup links.
 */
async function sendWelcomeEmail({ to, token, plan, founder, isTrial }) {
  const planLabel = {
    'vps-control':   'vps-control-mcp',
    'local-terminal':'local-terminal-mcp',
    'bundle':        'vps-control-mcp + local-terminal-mcp',
  }[plan] || plan;

  const setupUrl = plan === 'local-terminal'
    ? 'https://github.com/ForgeRift/local-terminal-mcp/blob/main/GETTING_STARTED.md'
    : 'https://github.com/ForgeRift/vps-control-mcp/blob/main/GETTING_STARTED.md';

  const trialNote = isTrial
    ? `<p style="background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;font-size:14px;">
        <strong>Your 14-day free trial is active.</strong> You won't be charged until the trial ends.
        No refunds after the trial period has elapsed.
       </p>`
    : '';

  const founderNote = founder
    ? `<p style="background:#e8f5e9;border-left:4px solid #22c55e;padding:12px 16px;margin:16px 0;font-size:14px;">
        <strong>Founder Cohort:</strong> Your pricing is locked for life as long as your subscription stays active.
       </p>`
    : '';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;margin:0;padding:32px 16px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">

    <div style="background:#0f1115;padding:24px 32px;display:flex;align-items:center;gap:12px;">
      <div style="width:36px;height:36px;background:#14b8a6;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#0f1115;">FR</div>
      <span style="color:#e8ecf3;font-weight:700;font-size:18px;">ForgeRift</span>
    </div>

    <div style="padding:32px;">
      <h1 style="margin:0 0 8px;font-size:22px;color:#0f1115;">You're in. Here's your auth token.</h1>
      <p style="margin:0 0 24px;color:#6b7280;font-size:15px;">
        Thanks for subscribing to <strong>${planLabel}</strong>. Copy the token below into your plugin config to get started.
      </p>

      ${trialNote}
      ${founderNote}

      <div style="background:#0f1115;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
        <p style="margin:0 0 8px;color:#9aa3b2;font-size:11px;letter-spacing:.08em;text-transform:uppercase;">Your Auth Token</p>
        <code style="color:#14b8a6;font-family:'SF Mono','Fira Code',monospace;font-size:13px;word-break:break-all;">${token}</code>
      </div>

      <p style="margin:0 0 8px;color:#374151;font-size:15px;font-weight:600;">Next steps:</p>
      <ol style="margin:0 0 24px;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">
        <li>Follow the <a href="${setupUrl}" style="color:#14b8a6;">Getting Started guide</a> to install the plugin</li>
        <li>Add your token to the <code style="background:#f4f4f5;padding:1px 6px;border-radius:4px;">.env</code> file as <code style="background:#f4f4f5;padding:1px 6px;border-radius:4px;">MCP_AUTH_TOKEN</code></li>
        <li>Connect in Claude Desktop under Settings → Plugins</li>
        <li>Ask Claude: <em>"Check my system status"</em> to verify the connection</li>
      </ol>

      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">
        Keep this token private — anyone with it can run commands through your plugin.
        If you think it's been compromised, reply to this email and we'll rotate it.
      </p>

      <a href="${setupUrl}" style="display:inline-block;background:#14b8a6;color:#0f1115;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;">Open Setup Guide →</a>
    </div>

    <div style="padding:20px 32px;border-top:1px solid #f4f4f5;color:#9ca3af;font-size:12px;line-height:1.6;">
      <p style="margin:0 0 4px;">ForgeRift LLC · 5821 W Mineral St, West Allis, WI 53214</p>
      <p style="margin:0;">
        <a href="https://forgerift.io/terms.html" style="color:#9ca3af;">Terms</a> ·
        <a href="https://forgerift.io/privacy.html" style="color:#9ca3af;">Privacy</a> ·
        You're receiving this because you purchased a ForgeRift subscription.
      </p>
    </div>
  </div>
</body>
</html>`;

  await resend.emails.send({
    from:    FROM,
    to,
    subject: `Your ForgeRift auth token — ${planLabel}`,
    html,
  });
}

/**
 * Grace period warning — sent when invoice.payment_failed fires.
 * Informs the user they have 7 days before access is suspended.
 */
async function sendGraceWarningEmail({ to, plan, gracePeriodUntil }) {
  const planLabel = {
    'vps-control':   'vps-control-mcp',
    'local-terminal':'local-terminal-mcp',
    'bundle':        'ForgeRift Bundle',
  }[plan] || plan;

  const deadline = new Date(gracePeriodUntil).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;margin:0;padding:32px 16px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:#0f1115;padding:24px 32px;">
      <span style="color:#e8ecf3;font-weight:700;font-size:18px;">ForgeRift</span>
    </div>
    <div style="padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;color:#0f1115;">Payment failed — 7-day grace period active</h1>
      <p style="color:#374151;font-size:15px;">
        We couldn't process your payment for <strong>${planLabel}</strong>. Your plugin access remains active
        until <strong>${deadline}</strong> while we retry.
      </p>
      <p style="color:#374151;font-size:15px;">
        Update your payment method in the <a href="https://forgerift.io/#pricing" style="color:#14b8a6;">billing portal</a>
        to avoid interruption. If payment succeeds before the deadline, nothing changes.
      </p>
      <p style="color:#6b7280;font-size:14px;">Questions? Reply to this email or contact support@forgerift.io.</p>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #f4f4f5;color:#9ca3af;font-size:12px;">
      <p style="margin:0;">ForgeRift LLC · 5821 W Mineral St, West Allis, WI 53214</p>
    </div>
  </div>
</body>
</html>`;

  await resend.emails.send({
    from:    FROM,
    to,
    subject: 'Action needed: ForgeRift payment failed',
    html,
  });
}

module.exports = { sendWelcomeEmail, sendGraceWarningEmail };
