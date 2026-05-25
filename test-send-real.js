require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function run() {
  console.log("Starting real email delivery test...");
  console.log("Transporter user:", process.env.EMAIL_USER);
  
  const mailOptions = {
    from: `"InnerCircle Hedgefund" <${process.env.EMAIL_USER}>`,
    to: 'guyohalakeofficial@gmail.com',
    subject: 'InnerCircle SMTP Verification Test',
    html: `
      <h1>SMTP Delivery Test</h1>
      <p>This is a real SMTP delivery test to verify email receipt.</p>
      <p>Sent at: ${new Date().toISOString()}</p>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully!");
    console.log("Message ID:", info.messageId);
    console.log("Response:", info.response);
  } catch (error) {
    console.error("Delivery failed with error:", error);
  }
}

run();
