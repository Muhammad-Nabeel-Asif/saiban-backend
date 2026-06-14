/**
 * Saiban email brand tokens — aligned with app/globals.css (light theme).
 * Use hex in HTML emails; oklch is not supported in most clients.
 */
export const SAIBAN_EMAIL = {
  fontFamily: "'Roboto', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  colors: {
    background: '#f5f5f5',
    card: '#ffffff',
    foreground: '#252525',
    mutedForeground: '#737373',
    primary: '#1a1a1a',
    primaryForeground: '#fafafa',
    border: '#e8e8e8',
    muted: '#f5f5f5',
    accent: '#f0f0f0',
  },
  radius: '12px',
  brand: {
    name: 'Saiban',
    tagline: 'Homoeopathic Pharma',
  },
} as const;

export interface PasswordResetEmailParams {
  resetUrl: string;
  /** Display name for greeting; falls back to "there" */
  userName?: string | null;
  expiryHours?: number;
  year?: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderPasswordResetPlainText({
  resetUrl,
  userName,
  expiryHours = 1,
  year = new Date().getFullYear(),
}: PasswordResetEmailParams): string {
  const greeting = userName?.trim() ? `Hi ${userName.trim()},` : 'Hi there,';

  return `${greeting}
  
  We received a request to reset the password for your Saiban account.
  
  Reset your password using the link below. This link expires in ${expiryHours} hour${expiryHours === 1 ? '' : 's'} and can only be used once.
  
  ${resetUrl}
  
  If you did not request a password reset, you can safely ignore this email. Your password will not change.
  
  —
  Saiban · Homoeopathic Pharma
  © ${year} Saiban. All rights reserved.
  `;
}

export function renderPasswordResetHtml({
  resetUrl,
  userName,
  expiryHours = 1,
  year = new Date().getFullYear(),
}: PasswordResetEmailParams): string {
  const { fontFamily, colors, radius, brand } = SAIBAN_EMAIL;
  const safeUrl = escapeHtml(resetUrl);
  const greeting = userName?.trim() ? `Hi ${escapeHtml(userName.trim())},` : 'Hi there,';
  const expiryLabel = `${expiryHours} hour${expiryHours === 1 ? '' : 's'}`;

  return `<!DOCTYPE html>
  <html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>Reset your Saiban password</title>
    <!--[if mso]>
    <noscript>
      <xml>
        <o:OfficeDocumentSettings>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
    </noscript>
    <![endif]-->
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
      body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
      img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
      body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
      a { color: ${colors.foreground}; }
      @media only screen and (max-width: 620px) {
        .email-container { width: 100% !important; }
        .card-pad { padding-left: 24px !important; padding-right: 24px !important; }
        .outer-pad { padding-left: 16px !important; padding-right: 16px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${colors.background};font-family:${fontFamily};">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
      Reset your Saiban password — link expires in ${expiryLabel}.
    </div>
  
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${colors.background};">
      <tr>
        <td align="center" class="outer-pad" style="padding:40px 24px;">
  
          <!-- Brand header -->
          <table role="presentation" class="email-container" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
            <tr>
              <td align="center" style="padding-bottom:28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="middle" style="padding-right:12px;">
                      <div style="width:40px;height:40px;background-color:${colors.primary};border-radius:8px;text-align:center;line-height:40px;">
                        <span style="font-family:${fontFamily};font-size:18px;font-weight:700;color:${colors.primaryForeground};letter-spacing:-0.02em;">S</span>
                      </div>
                    </td>
                    <td valign="middle" align="left">
                      <p style="margin:0;font-family:${fontFamily};font-size:15px;font-weight:600;color:${colors.foreground};letter-spacing:-0.01em;line-height:1.2;">
                        ${brand.name}
                      </p>
                      <p style="margin:2px 0 0;font-family:${fontFamily};font-size:11px;font-weight:400;color:${colors.mutedForeground};line-height:1.3;">
                        ${brand.tagline}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
  
          <!-- Card -->
          <table role="presentation" class="email-container" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:${colors.card};border:1px solid ${colors.border};border-radius:${radius};">
            <tr>
              <td class="card-pad" style="padding:40px 40px 32px;">
  
                <h1 style="margin:0 0 8px;font-family:${fontFamily};font-size:24px;font-weight:700;color:${colors.foreground};letter-spacing:-0.02em;line-height:1.25;text-align:center;">
                  Reset your password
                </h1>
                <p style="margin:0 0 28px;font-family:${fontFamily};font-size:14px;font-weight:400;color:${colors.mutedForeground};line-height:1.5;text-align:center;">
                  We received a request to reset the password for your account.
                </p>
  
                <p style="margin:0 0 20px;font-family:${fontFamily};font-size:15px;font-weight:400;color:${colors.foreground};line-height:1.6;">
                  ${greeting}
                </p>
                <p style="margin:0 0 28px;font-family:${fontFamily};font-size:15px;font-weight:400;color:${colors.foreground};line-height:1.6;">
                  Tap the button below to choose a new password. For your security, this link expires in <strong style="font-weight:500;color:${colors.foreground};">${expiryLabel}</strong> and works only once.
                </p>
  
                <!-- CTA -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="padding-bottom:28px;">
                      <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="18%" strokecolor="${colors.primary}" fillcolor="${colors.primary}">
                        <w:anchorlock/>
                        <center style="color:${colors.primaryForeground};font-family:${fontFamily};font-size:14px;font-weight:500;">Reset password</center>
                      </v:roundrect>
                      <![endif]-->
                      <!--[if !mso]><!-->
                      <a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:${colors.primary};color:${colors.primaryForeground};font-family:${fontFamily};font-size:14px;font-weight:500;line-height:44px;text-decoration:none;padding:0 28px;border-radius:8px;mso-padding-alt:0;text-align:center;min-width:180px;">
                        Reset password
                      </a>
                      <!--<![endif]-->
                    </td>
                  </tr>
                </table>
  
                <!-- Security note -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${colors.muted};border-radius:8px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p style="margin:0;font-family:${fontFamily};font-size:13px;font-weight:400;color:${colors.mutedForeground};line-height:1.55;">
                        <strong style="font-weight:500;color:${colors.foreground};">Didn't request this?</strong>
                        You can safely ignore this email. Your password won't change unless you use the link above.
                      </p>
                    </td>
                  </tr>
                </table>
  
                <!-- Fallback URL -->
                <p style="margin:28px 0 0;font-family:${fontFamily};font-size:12px;font-weight:400;color:${colors.mutedForeground};line-height:1.55;">
                  Button not working? Copy and paste this link into your browser:
                </p>
                <p style="margin:8px 0 0;font-family:${fontFamily};font-size:12px;font-weight:400;line-height:1.55;word-break:break-all;">
                  <a href="${safeUrl}" target="_blank" style="color:${colors.foreground};text-decoration:underline;">${safeUrl}</a>
                </p>
  
              </td>
            </tr>
          </table>
  
          <!-- Footer -->
          <table role="presentation" class="email-container" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
            <tr>
              <td align="center" style="padding:28px 16px 0;">
                <p style="margin:0 0 6px;font-family:${fontFamily};font-size:12px;font-weight:500;color:${colors.mutedForeground};line-height:1.4;">
                  ${brand.name} · ${brand.tagline}
                </p>
                <p style="margin:0;font-family:${fontFamily};font-size:11px;font-weight:400;color:${colors.mutedForeground};line-height:1.4;">
                  © ${year} ${brand.name}. All rights reserved.
                </p>
                <p style="margin:10px 0 0;font-family:${fontFamily};font-size:11px;font-weight:400;color:${colors.mutedForeground};line-height:1.4;">
                  This is an automated message. Please do not reply.
                </p>
              </td>
            </tr>
          </table>
  
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}
