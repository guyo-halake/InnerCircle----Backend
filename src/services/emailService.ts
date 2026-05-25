import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

interface TransactionEmailOptions {
  to: string;
  investorName: string;
  type: 'Deposit' | 'Withdrawal';
  status: 'Approved' | 'Rejected' | 'Pending';
  amount: number;
}

function formatKSh(amount: number): string {
  return `KSh ${Number(amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function sendTransactionEmail(opts: TransactionEmailOptions): Promise<void> {
  const { to, investorName, type, status, amount } = opts;

  const isApproved = status === 'Approved';
  const isPending = status === 'Pending';
  const isDeposit = type === 'Deposit';

  let actionVerb = 'could not be processed for';
  if (isApproved) {
    actionVerb = isDeposit ? 'added to' : 'removed from';
  } else if (isPending) {
    actionVerb = 'received for';
  }

  let subject = `${type} Update — Action Required`;
  if (isApproved) {
    subject = `${type} Confirmed — ${formatKSh(amount)}`;
  } else if (isPending) {
    subject = `${type} Request Received — ${formatKSh(amount)}`;
  }

  let statusMessage = 'Please contact support if you have any questions.';
  if (isApproved) {
    statusMessage = `The amount has been ${actionVerb} your wallet.`;
  } else if (isPending) {
    statusMessage = `Your request is currently under review by our team.`;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin:0;padding:0;background:#f5efe6;font-family:'Inter',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe6;padding:40px 20px;">
        <tr>
          <td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#fdf9f4;border-radius:16px;overflow:hidden;max-width:560px;width:100%;">

              <!-- Header -->
              <tr>
                <td style="background:#1a1a1a;padding:28px 32px;">
                  <p style="margin:0;font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;">InnerCircle Hedgefund</p>
                  <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;">${type} ${status}</h1>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:32px;">
                  <p style="margin:0 0 8px;font-size:14px;color:#555;">Hello, <strong style="color:#1a1a1a;">${investorName}</strong></p>
                  <p style="margin:0 0 28px;font-size:14px;color:#555;line-height:1.6;">
                    Your ${type.toLowerCase()} request of <strong style="color:#1a1a1a;">${formatKSh(amount)}</strong> has been <strong style="color:#1a1a1a;">${status.toLowerCase()}</strong>.
                    ${statusMessage}
                  </p>

                  <!-- Amount block -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe6;border-radius:12px;margin-bottom:28px;">
                    <tr>
                      <td style="padding:20px 24px;">
                        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Amount ${isDeposit ? 'Deposited' : 'Withdrawn'}</p>
                        <p style="margin:0;font-size:28px;font-weight:700;color:#1a1a1a;">${formatKSh(amount)}</p>
                        <p style="margin:6px 0 0;font-size:12px;color:${isApproved ? '#1a1a1a' : (isPending ? '#f59e0b' : '#cc4444')};">
                          Status: <strong>${status}</strong>
                        </p>
                      </td>
                    </tr>
                  </table>

                  ${isApproved ? `
                  <p style="margin:0 0 4px;font-size:13px;color:#555;">
                    ${isDeposit
                      ? 'Your wallet has been credited. You can view your updated balance on your dashboard.'
                      : 'Your payout has been processed. Funds should reflect in your account within 1–3 business days.'}
                  </p>
                  ` : `
                  <p style="margin:0 0 4px;font-size:13px;color:#cc4444;">
                    Your ${type.toLowerCase()} request was not approved. Please reach out to our support team for assistance.
                  </p>
                  `}
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:20px 32px;border-top:1px solid #ede8e0;">
                  <p style="margin:0;font-size:11px;color:#aaa;line-height:1.8;">
                    This is an automated message from InnerCircle Hedgefund.<br/>
                    Please do not reply to this email.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"InnerCircle Hedgefund" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

import jwt from 'jsonwebtoken';

interface AdminRequestEmailOptions {
  transactionId: number;
  investorName: string;
  type: 'Deposit' | 'Withdrawal';
  amount: number;
  methodDetails?: any;
}

export async function sendAdminRequestEmail(opts: AdminRequestEmailOptions): Promise<void> {
  const { transactionId, investorName, type, amount, methodDetails } = opts;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    console.warn('ADMIN_EMAIL not set, skipping admin notification');
    return;
  }

  // Generate secure JWTs for the action buttons
  const approveToken = jwt.sign({ id: transactionId, action: 'Approved' }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  const denyToken = jwt.sign({ id: transactionId, action: 'Rejected' }, process.env.JWT_SECRET!, { expiresIn: '7d' });

  // Use the API_URL or a fallback
  const baseUrl = process.env.API_URL || 'http://localhost:5000';
  const approveLink = `${baseUrl}/api/admin/quick-action?token=${approveToken}`;
  const denyLink = `${baseUrl}/api/admin/quick-action?token=${denyToken}`;

  let detailsHtml = '';
  if (methodDetails) {
    if (type === 'Deposit') {
      detailsHtml = `
        <p style="margin:0 0 4px;font-size:12px;color:#888;">Reference / Phone:</p>
        <p style="margin:0 0 16px;font-size:14px;color:#1a1a1a;font-family:monospace;">${methodDetails.referenceCode || ''} ${methodDetails.phoneNumber || ''}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#888;">Pasted Message / Proof:</p>
        <div style="background:#f5efe6;padding:12px;border-radius:8px;font-family:monospace;font-size:12px;color:#555;white-space:pre-wrap;">${methodDetails.smsMessage || 'N/A'}</div>
      `;
    } else {
      detailsHtml = `
        <p style="margin:0 0 4px;font-size:12px;color:#888;">Payout Target:</p>
        <p style="margin:0 0 4px;font-size:14px;color:#1a1a1a;font-family:monospace;">M-Pesa: ${methodDetails.phoneNumber || 'N/A'}</p>
        <p style="margin:0 0 4px;font-size:14px;color:#1a1a1a;font-family:monospace;">Bank: ${methodDetails.bankName || 'N/A'} (${methodDetails.accountNumber || ''})</p>
        <p style="margin:0 0 16px;font-size:14px;color:#1a1a1a;font-family:monospace;">Name: ${methodDetails.accountName || 'N/A'}</p>
      `;
    }
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin:0;padding:0;background:#f5efe6;font-family:'Inter',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe6;padding:40px 20px;">
        <tr>
          <td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#fdf9f4;border-radius:16px;overflow:hidden;max-width:560px;width:100%;">
              <tr>
                <td style="background:#1a1a1a;padding:28px 32px;">
                  <p style="margin:0;font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;">Admin Action Required</p>
                  <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;">New ${type} Request</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="margin:0 0 8px;font-size:14px;color:#555;">Hey <strong style="color:#1a1a1a;">Admin</strong>,</p>
                  <p style="margin:0 0 28px;font-size:14px;color:#555;line-height:1.6;">
                    <strong style="color:#1a1a1a;">${investorName}</strong> just requested a ${type.toLowerCase()} of <strong style="color:#1a1a1a;">${formatKSh(amount)}</strong>.
                  </p>

                  <div style="margin-bottom:28px;">
                    ${detailsHtml}
                  </div>

                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="48%">
                        <a href="${approveLink}" style="display:block;width:100%;padding:14px 0;background:#10b981;color:#ffffff;text-align:center;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;">Approve Request</a>
                      </td>
                      <td width="4%"></td>
                      <td width="48%">
                        <a href="${denyLink}" style="display:block;width:100%;padding:14px 0;background:transparent;border:1px solid #ef4444;color:#ef4444;text-align:center;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;">Deny Request</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"InnerCircle System" <${process.env.EMAIL_USER}>`,
    to: adminEmail,
    subject: `Action Required: ${type} Request — ${formatKSh(amount)}`,
    html,
  });
}

export async function sendCustomEmail(opts: { to: string; subject: string; body: string }): Promise<void> {
  const { to, subject, body } = opts;
  await transporter.sendMail({
    from: `"InnerCircle Support" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: sans-serif; padding: 20px; color: #1a1a1a; background: #f5efe6; margin: 0;">
        <div style="max-width: 600px; margin: 0 auto; background: #fdf9f4; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #ede8e0;">
          <div style="background: #1a1a1a; padding: 24px; color: #ffffff;">
            <p style="margin: 0; font-size: 11px; color: #888; letter-spacing: 2px; text-transform: uppercase;">InnerCircle Hedgefund</p>
            <h1 style="margin: 4px 0 0; font-size: 18px; font-weight: 700;">Support Update</h1>
          </div>
          <div style="padding: 24px; font-size: 14px; line-height: 1.6; color: #333;">
            <div style="white-space: pre-wrap;">${body}</div>
          </div>
          <div style="padding: 16px 24px; background: #fdf9f4; border-top: 1px solid #ede8e0; font-size: 11px; color: #aaa;">
            This is a message from InnerCircle Hedgefund administration. If you have questions, please write back or contact support.
          </div>
        </div>
      </body>
      </html>
    `,
  });
}

export async function sendWelcomeEmail(to: string, investorName: string): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin:0;padding:0;background:#f5efe6;font-family:'Inter',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe6;padding:40px 20px;">
        <tr>
          <td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#fdf9f4;border-radius:16px;overflow:hidden;max-width:560px;width:100%;">
              <!-- Header -->
              <tr>
                <td style="background:#1a1a1a;padding:28px 32px;">
                  <p style="margin:0;font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;">InnerCircle Hedgefund</p>
                  <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;">Welcome to InnerCircle</h1>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:32px;">
                  <p style="margin:0 0 8px;font-size:14px;color:#555;">Hello <strong style="color:#1a1a1a;">${investorName}</strong>,</p>
                  <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;">
                    Welcome to **InnerCircle**, an exclusive private investment portal designed to provide institutional performance with complete transparency.
                  </p>
                  <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;">
                    Your account has been registered successfully. You can now login to your personal dashboard to make your first capital allocation and monitor pool yields in real-time.
                  </p>
                  <div style="margin-top:28px;">
                    <a href="https://innercircleinvestors.vercel.app/login" style="display:inline-block;padding:14px 28px;background:#1a1a1a;color:#ffffff;text-align:center;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;">Access Your Dashboard</a>
                  </div>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="padding:20px 32px;border-top:1px solid #ede8e0;">
                  <p style="margin:0;font-size:11px;color:#aaa;line-height:1.8;">
                    This is an automated welcome message from InnerCircle Hedgefund.<br/>
                    Please do not reply to this email.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"InnerCircle Hedgefund" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Welcome to InnerCircle",
    html,
  });
}

export async function sendAdminNewUserEmail(
  investorName: string,
  investorEmail: string,
  investorPhone: string,
  investorCountry: string
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.warn('ADMIN_EMAIL not set, skipping admin user notification');
    return;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin:0;padding:0;background:#f5efe6;font-family:'Inter',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe6;padding:40px 20px;">
        <tr>
          <td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#fdf9f4;border-radius:16px;overflow:hidden;max-width:560px;width:100%;">
              <!-- Header -->
              <tr>
                <td style="background:#1a1a1a;padding:28px 32px;">
                  <p style="margin:0;font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;">Admin Notification</p>
                  <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;">New Investor Registered</h1>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:32px;">
                  <p style="margin:0 0 8px;font-size:14px;color:#555;">Hey <strong style="color:#1a1a1a;">Admin</strong>,</p>
                  <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;">
                    A new investor has created an account on the platform:
                  </p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe6;border-radius:12px;margin-bottom:28px;">
                    <tr>
                      <td style="padding:20px 24px; font-size:13px; line-height:1.8; color:#333;">
                        <p style="margin:0;"><strong>Full Name:</strong> ${investorName}</p>
                        <p style="margin:0;"><strong>Email:</strong> ${investorEmail}</p>
                        <p style="margin:0;"><strong>Phone:</strong> ${investorPhone}</p>
                        <p style="margin:0;"><strong>Country:</strong> ${investorCountry}</p>
                      </td>
                    </tr>
                  </table>
                  <div style="margin-top:20px;">
                    <a href="https://innercircleinvestors.vercel.app/admin" style="display:inline-block;padding:14px 28px;background:#1a1a1a;color:#ffffff;text-align:center;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;">Open Admin Panel</a>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"InnerCircle System" <${process.env.EMAIL_USER}>`,
    to: adminEmail,
    subject: `New Investor Account Created: ${investorName}`,
    html,
  });
}
