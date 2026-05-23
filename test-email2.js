require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('ADMIN_EMAIL:', process.env.ADMIN_EMAIL);

if (!process.env.EMAIL_PASS) {
  console.log('EMAIL_PASS is missing!');
} else {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  transporter.verify(function(error, success) {
    if (error) {
      console.log("Error:", error);
    } else {
      console.log("Server is ready to take our messages");
    }
  });
}
