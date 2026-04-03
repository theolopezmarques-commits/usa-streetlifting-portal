const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';

async function sendEmail({ to, subject, html }) {
  try {
    const result = await resend.emails.send({ from: FROM, to, subject, html });
    if (result.error) {
      console.error('Email send failed:', result.error);
    } else {
      console.log(`[EMAIL] Sent "${subject}" to ${to} (id: ${result.data?.id})`);
    }
  } catch (err) {
    console.error('Email send error:', err.message);
  }
}

// ── Email templates ──────────────────────────────────────────────────────────

function verificationEmail(name, link) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;">
    <h2 style="color:#132E84;">Verify your email</h2>
    <p>Hi ${name},</p>
    <p>Click the button below to confirm your USASL Judge Portal account:</p>
    <div style="text-align:center;padding:24px 0;">
      <a href="${link}" style="display:inline-block;padding:14px 32px;background:#c0392b;color:#fff;border-radius:6px;text-decoration:none;font-size:1rem;font-weight:bold;">Verify My Email</a>
    </div>
    <p style="color:#888;font-size:.85rem;">This link expires in 1 hour. If you didn't create an account, ignore this email.</p>
    <p style="color:#bbb;font-size:.75rem;word-break:break-all;">Or copy this link: ${link}</p>
  </div>`;
}

function certExpiryEmail(name, level, expiryDate) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;">
    <h2 style="color:#132E84;">Your Level ${level} certification is expiring soon</h2>
    <p>Hi ${name},</p>
    <p>Your <strong>Level ${level} USA Streetlifting Judge Certification</strong> expires on <strong>${expiryDate}</strong> — that's in 30 days.</p>
    <p>Log in to the portal to renew it and keep your judging privileges active.</p>
    <a href="${process.env.BASE_URL}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#c0392b;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">Go to Portal</a>
    <p style="color:#888;font-size:.85rem;margin-top:24px;">USA Streetlifting – Director of Judging</p>
  </div>`;
}

function announcementEmail(name, subject, body) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;">
    <h2 style="color:#132E84;">USA Streetlifting – Judge Announcement</h2>
    <p>Hi ${name},</p>
    <div style="white-space:pre-line;line-height:1.7;">${body}</div>
    <p style="color:#888;font-size:.85rem;margin-top:24px;">– Théo Lopez Marques, USASL Director of Judging</p>
    <p style="color:#bbb;font-size:.75rem;">You received this because you are a certified USASL judge.</p>
  </div>`;
}

function eventConfirmEmail(name, eventName, eventDate, eventLocation) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;">
    <h2 style="color:#132E84;">Event Registration Confirmed</h2>
    <p>Hi ${name},</p>
    <p>You have registered to judge at <strong>${eventName}</strong>.</p>
    <table style="margin-top:16px;border-collapse:collapse;width:100%;">
      <tr><td style="padding:6px 0;color:#888;">Date</td><td style="font-weight:bold;">${eventDate}</td></tr>
      <tr><td style="padding:6px 0;color:#888;">Location</td><td style="font-weight:bold;">${eventLocation}</td></tr>
    </table>
    <p style="margin-top:16px;">The Director will be in touch with further details closer to the event.</p>
    <p style="color:#888;font-size:.85rem;margin-top:24px;">– Théo Lopez Marques, USASL Director of Judging</p>
  </div>`;
}

function welcomeEmail(name) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0a0a0a;padding:32px;border-radius:8px;color:#f0f0f0;">
    <img src="https://usastreetlifting.org/wp-content/uploads/2024/08/cropped-USA-Streetlifting-Transparent-File-PNG-1.png" alt="USA Streetlifting" style="height:48px;margin-bottom:24px;">
    <h2 style="color:#c0392b;margin-bottom:8px;">Welcome to the USASL Judge Portal, ${name}!</h2>
    <p>Your account is verified and ready. Here's how to get certified:</p>
    <ol style="line-height:2;padding-left:1.2em;">
      <li><strong>Pay</strong> for Level 0 or Level 1 certification</li>
      <li><strong>Watch</strong> all course videos</li>
      <li><strong>Pass</strong> the written exam (80%+)</li>
      <li><strong>Book</strong> your oral exam with the Director</li>
      <li><strong>Receive</strong> your official certificate</li>
    </ol>
    <div style="margin-top:20px;padding:14px 18px;background:#1a1a1a;border-left:3px solid #c0392b;border-radius:4px;">
      <strong style="color:#c0392b;">💬 Judge Chat</strong>
      <p style="margin:.5em 0 0;color:#aaa;font-size:.9rem;">Once you receive your certification, you'll get access to the exclusive Judge Chat — a group space to connect with other certified USASL judges and the Director directly from the portal.</p>
    </div>
    <a href="${process.env.BASE_URL}" style="display:inline-block;margin-top:20px;padding:12px 28px;background:#c0392b;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">Go to My Dashboard</a>
    <p style="color:#888;font-size:.85rem;margin-top:28px;">– Théo Lopez Marques, USASL Director of Judging</p>
  </div>`;
}

module.exports = { sendEmail, verificationEmail, certExpiryEmail, announcementEmail, eventConfirmEmail, welcomeEmail };
