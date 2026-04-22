// Resend API wrapper — minimal, dependency-free.
//
// Resend's REST API is a simple POST; we don't pull the `resend` npm package
// because it's bigger than we need and bundles Node-style imports that
// confuse the Workers runtime.

export interface SendArgs {
  apiKey: string;
  from: string;   // "Maxbridge <founders@maxbridge.ai>"
  to: string;     // recipient email
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  status?: number;
  detail?: string;
}

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      reply_to: args.replyTo,
    }),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false, status: res.status, detail: body.slice(0, 500) };
  }
  try {
    const parsed = JSON.parse(body);
    return { ok: true, id: parsed?.id, status: res.status };
  } catch {
    return { ok: true, status: res.status };
  }
}

export function renderWelcomeEmail(opts: {
  name: string;
  downloadUrl: string;
  licenseSlug: string;
  landingUrl: string;
}): { subject: string; html: string; text: string } {
  const name = opts.name || 'friend';
  const subject = 'Your Maxbridge license — activate in 30 seconds';
  const text = [
    `Hi ${name},`,
    '',
    'Maxbridge is ready. Your activation file:',
    opts.downloadUrl,
    '',
    'To install: open the file on the Mac where you run OpenClaw, then drag-drop',
    'it into your OpenClaw bot chat (Telegram / WhatsApp / etc). Your bot will',
    'execute the install autonomously — takes about 2 minutes, one setup-token',
    'browser login from you.',
    '',
    'License reference: ' + opts.licenseSlug,
    '',
    'If the link expires or you need help: just reply to this email.',
    '',
    '— Maxbridge',
    opts.landingUrl,
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 12px 0">Maxbridge is ready, ${escapeHtml(name)}.</h2>
      <p>Your activation file is one click away.</p>
      <p style="margin:24px 0">
        <a href="${opts.downloadUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Download activation file</a>
      </p>
      <p><strong>To install:</strong> open Terminal on the Mac where you run OpenClaw and paste <code>curl -fsSL https://install.marsirius.ai | bash</code>. The script installs everything (Homebrew, Claude CLI, Maxbridge daemon, OpenClaw wire-up) and pauses once for you to sign into Claude in the browser. ~90 seconds end-to-end.</p>
      <p style="color:#666;font-size:13px">Prefer drag-drop? Your download above carries the same command — drop it into your OpenClaw bot chat and the bot will run it for you.</p>
      <p style="color:#666;font-size:13px;margin-top:32px">License reference: <code>${escapeHtml(opts.licenseSlug)}</code></p>
      <p style="color:#666;font-size:13px">If the link expires or you need help, reply to this email.</p>
      <p style="margin-top:32px">— <a href="${opts.landingUrl}">Maxbridge</a></p>
    </div>
  `;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
