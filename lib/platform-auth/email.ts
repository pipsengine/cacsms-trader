export type PlatformEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type PlatformEmailResult = {
  sent: boolean;
  devLogged: boolean;
  resetUrl?: string;
  inviteUrl?: string;
};

function appBaseUrl(): string {
  return String(process.env.APP_URL ?? 'http://localhost:3001').replace(/\/$/, '');
}

export async function sendPlatformEmail(payload: PlatformEmailPayload): Promise<PlatformEmailResult> {
  const webhook = String(process.env.PLATFORM_EMAIL_WEBHOOK_URL ?? '').trim();
  if (webhook) {
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { sent: response.ok, devLogged: false };
    } catch {
      // fall through to dev log
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[platform-email]', {
      to: payload.to,
      subject: payload.subject,
      text: payload.text ?? payload.html,
    });
  }

  return { sent: false, devLogged: true };
}

export async function sendPasswordResetEmail(input: {
  email: string;
  token: string;
}): Promise<PlatformEmailResult> {
  const resetUrl = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(input.token)}`;
  const result = await sendPlatformEmail({
    to: input.email,
    subject: 'CACSMS password reset',
    text: `Reset your password: ${resetUrl}`,
    html: `<p>Reset your CACSMS password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  });
  return { ...result, resetUrl: process.env.NODE_ENV === 'production' ? undefined : resetUrl };
}

export async function sendUserInviteEmail(input: {
  email: string;
  token: string;
  invitedBy?: string;
}): Promise<PlatformEmailResult> {
  const inviteUrl = `${appBaseUrl()}/accept-invite?token=${encodeURIComponent(input.token)}`;
  const result = await sendPlatformEmail({
    to: input.email,
    subject: 'CACSMS platform invitation',
    text: `You have been invited to CACSMS${input.invitedBy ? ` by ${input.invitedBy}` : ''}: ${inviteUrl}`,
    html: `<p>You have been invited to CACSMS${input.invitedBy ? ` by <strong>${input.invitedBy}</strong>` : ''}.</p><p><a href="${inviteUrl}">Accept invitation</a></p>`,
  });
  return { ...result, inviteUrl: process.env.NODE_ENV === 'production' ? undefined : inviteUrl };
}
