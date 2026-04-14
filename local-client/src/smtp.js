const nodemailer = require('nodemailer');
const config = require('./config');

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a clean HTML email body for a gallery invitation.
 */
function buildInviteHtml(recipientName, folderName, galleryUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f4f4f7;color:#1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#2563eb;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">LocalSync Portal</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
                Hi ${recipientName},
              </p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
                Your photos from <strong>${folderName}</strong> are ready to view! Click the button below to browse the gallery.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:6px;background-color:#2563eb;">
                    <a href="${galleryUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:6px;">
                      View Gallery
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.5;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 0;font-size:13px;color:#2563eb;word-break:break-all;">
                <a href="${galleryUrl}" style="color:#2563eb;">${galleryUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
                Sent via LocalSync Portal &mdash; Professional Photo Delivery
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a gallery invite to a single recipient.
 *
 * @param {string} toEmail
 * @param {string} recipientName
 * @param {string} folderName
 * @param {string} galleryUrl
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendInvite(toEmail, recipientName, folderName, galleryUrl) {
  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: toEmail,
      subject: `You're invited to view photos: ${folderName}`,
      html: buildInviteHtml(recipientName, folderName, galleryUrl),
    });
    console.log(`[smtp] Invite sent to ${toEmail}`);
    return { success: true };
  } catch (err) {
    console.error(`[smtp] Failed to send to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send gallery invites to multiple recipients with a short delay between sends.
 *
 * @param {Array<{email: string, firstName: string}>} recipients
 * @param {string} folderName
 * @param {string} galleryUrl
 * @returns {Promise<{sent: number, failed: number, results: Array}>}
 */
async function sendBulkInvites(recipients, folderName, galleryUrl) {
  let sent = 0;
  let failed = 0;
  const results = [];

  for (let i = 0; i < recipients.length; i++) {
    const { email, firstName } = recipients[i];
    const result = await sendInvite(email, firstName, folderName, galleryUrl);

    if (result.success) {
      sent++;
    } else {
      failed++;
    }

    results.push({ email, ...result });

    // Small delay between sends to avoid SMTP rate-limiting
    if (i < recipients.length - 1) {
      await sleep(200);
    }
  }

  console.log(`[smtp] Bulk send complete: ${sent} sent, ${failed} failed`);
  return { sent, failed, results };
}

module.exports = { sendInvite, sendBulkInvites };
