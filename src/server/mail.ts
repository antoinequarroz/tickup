import "server-only";
import nodemailer from "nodemailer";

/**
 * E-mail, for the people who asked for their notifications by e-mail.
 *
 *   SMTP_URL   smtps://user:password@mail.example.ch:465 (or smtp://… for STARTTLS on 587)
 *   MAIL_FROM  "TickUp <tickup@example.ch>"
 *
 * Without both, TickUp sends nothing and Réglages says e-mail is not available.
 */
export const mailConfigured = () => /^smtps?:\/\//.test(process.env.SMTP_URL ?? "") && !!process.env.MAIL_FROM?.trim();

const globalForMail = globalThis as unknown as { __tickupMail?: { url: string; transport: nodemailer.Transporter } };

function transport() {
  const url = process.env.SMTP_URL!;
  if (globalForMail.__tickupMail?.url !== url) globalForMail.__tickupMail = { url, transport: nodemailer.createTransport(url) };
  return globalForMail.__tickupMail.transport;
}

/** Fire and forget: a mail server that is down never makes a save fail. */
export function sendMail(to: string, subject: string, text: string) {
  if (!mailConfigured()) return;
  transport()
    .sendMail({ from: process.env.MAIL_FROM, to, subject, text })
    .catch((e: Error) => console.error(`[mail] ${to}: ${e.message}`));
}
