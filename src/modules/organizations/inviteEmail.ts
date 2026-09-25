import type { MailMessage } from '../../config/mailer.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildInviteEmail(params: {
  to: string;
  organizationName: string;
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
}): MailMessage {
  const org = escapeHtml(params.organizationName);
  const inviter = escapeHtml(params.inviterName);
  const url = escapeHtml(params.inviteUrl);
  const expires = params.expiresAt.toUTCString();

  return {
    to: params.to,
    subject: `${params.inviterName} invited you to join ${params.organizationName} on DevHub`,
    text: [
      `${params.inviterName} invited you to join ${params.organizationName} on DevHub.`,
      '',
      `Accept the invite and set your password: ${params.inviteUrl}`,
      '',
      `This link expires on ${expires}. If you weren't expecting this, you can ignore this email.`,
    ].join('\n'),
    html: `<!doctype html>
<html>
  <body style="margin:0;background:#0c0c14;font-family:Inter,Segoe UI,Arial,sans-serif;color:#ecebf7">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#14141f;border-radius:16px;padding:36px">
          <tr><td>
            <div style="width:44px;height:44px;border-radius:12px;background:#8b7bff;color:#0c0c14;font-weight:700;font-size:20px;line-height:44px;text-align:center">D</div>
            <h1 style="font-size:22px;margin:24px 0 8px">Join ${org} on DevHub</h1>
            <p style="font-size:15px;line-height:1.6;color:#b8b8cc;margin:0 0 28px">
              <strong style="color:#ecebf7">${inviter}</strong> invited you to collaborate with
              <strong style="color:#ecebf7">${org}</strong> — chat, whiteboards and meetings in one place.
            </p>
            <a href="${url}" style="display:inline-block;background:#8b7bff;color:#0c0c14;text-decoration:none;font-weight:600;padding:13px 26px;border-radius:10px">Accept invite &amp; set password</a>
            <p style="font-size:12px;line-height:1.6;color:#8f8fa8;margin:28px 0 0">
              This link expires on ${escapeHtml(expires)}. If the button doesn't work, paste this URL into your browser:<br />
              <span style="color:#a294ff;word-break:break-all">${url}</span>
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}
