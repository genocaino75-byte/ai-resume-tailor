const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType,
  TabStopType
} = require('docx');

dotenv.config();
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);
const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
app.use(cors());
app.use(express.json());
const rateLimit = require("express-rate-limit");

const tailorLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 10, // limit each IP to 10 requests per hour
  message: { error: "Too many requests. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://postgres:${process.env.DB_PASSWORD}@localhost:5432/resume_tailor`,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('✅ Database connected successfully:', res.rows[0]);
  }
});

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
// Middleware to verify JWT and identify the logged-in user
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

// Test route
app.get('/', (req, res) => {
  res.json({ message: '🚀 AI Resume Tailor API is running!' });
});

// Tailor resume route
app.post("/api/tailor", requireAuth, tailorLimiter, async (req, res) => {
  const { resume, jobDescription } = req.body;
  try {
    // Look up this user's entitlement before doing any work
    const userResult = await pool.query(
      "SELECT free_tailors_used, has_lifetime, email_verified FROM users WHERE id = $1",
      [req.userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const { free_tailors_used, has_lifetime, email_verified } = userResult.rows[0];

    // Require a verified email before any tailoring (keeps throwaway signups out).
    if (!email_verified) {
      return res.status(403).json({
        emailUnverified: true,
        error: "Please verify your email first — check your inbox (and spam) for the verification link.",
      });
    }

    const FREE_LIMIT = 2;
    // Trial users who've hit the limit get a paywall signal, not a tailor
    if (!has_lifetime && free_tailors_used >= FREE_LIMIT) {
      return res.status(402).json({
        paywall: true,
        error: "Free trial limit reached. Upgrade to continue tailoring.",
      });
    }
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are an expert resume writer. Rewrite and tailor the candidate's resume to match the job description, staying truthful to the candidate's real experience, employers, and dates.

Output PLAIN TEXT only — no Markdown, no ** symbols, no # symbols, no commentary. Format it EXACTLY like this:
- Line 1: the candidate's full name, exactly as it appears in their resume.
- Line 2: the candidate's contact details on one line (location, phone, email, LinkedIn), separated by "  •  ".
- Line 3: the candidate's professional title / headline.
- Then the body, using these ALL-CAPS section headings where they apply: SUMMARY, CORE STRENGTHS, PROFESSIONAL EXPERIENCE, EDUCATION, CERTIFICATIONS.
- Under PROFESSIONAL EXPERIENCE, begin each role with ONE line formatted "Job Title — Company — City, ST — Start Date to End Date", then list achievements beneath it.
- Every bullet point MUST begin with "• " (a bullet character followed by a space). Do not put whole bullets in capitals and do not bold them.

Write the SUMMARY and every bullet point in normal sentence case — capitalize only the first word and proper nouns. Do NOT write body text, bullets, or job entries in all capital letters; ONLY the section headings (SUMMARY, CORE STRENGTHS, PROFESSIONAL EXPERIENCE, etc.) are in ALL CAPS.

Only include skills, certifications, licenses, degrees, clearances, and tools that ALREADY appear in the candidate's resume. Do NOT add, invent, or imply any qualification the candidate does not already have. Never mention, flag, note, or draw attention to anything the candidate is missing, and never comment on gaps between the resume and the job description — if the job asks for something the candidate lacks, simply leave it out entirely.

Never replace the candidate's real name or contact information with anyone else's. Adjust only the language, keywords, and emphasis to match the job.

Return ONLY the tailored resume text — no notes, no gap analysis, no suggestions.

RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}`
      }]
    });
    const tailoredResume = message.content[0].text;
    // Count the run ONLY after a successful tailor, and only for non-lifetime users
    if (!has_lifetime) {
      await pool.query(
        "UPDATE users SET free_tailors_used = free_tailors_used + 1 WHERE id = $1",
        [req.userId]
      );
    }
    res.json({ tailoredResume });
  } catch (error) {
    console.error('Tailor error:', error);
    res.status(500).json({ error: error.message });
  }
});

// CONFIRM PURCHASE - records a Google Play purchase and grants lifetime access
app.post("/api/billing/confirm", requireAuth, async (req, res) => {
  const { purchaseToken, productId } = req.body;

  if (!purchaseToken || !productId) {
    return res.status(400).json({ error: "Missing purchase information." });
  }

  // Only the lifetime product grants lifetime access
  if (productId !== "lifetime_access") {
    return res.status(400).json({ error: "Unrecognized product." });
  }

  try {
    // Has this exact purchase token already been recorded?
    // The UNIQUE constraint on purchase_token is the source of truth,
    // but we check first to give a clean response.
    const existing = await pool.query(
      "SELECT id, user_id FROM purchases WHERE purchase_token = $1",
      [purchaseToken]
    );

    if (existing.rows.length > 0) {
      // Token already used. If it belongs to THIS user, treat as success
      // (e.g. a Restore Purchase re-submitting). If another user, reject.
      if (existing.rows[0].user_id === req.userId) {
        await pool.query(
          "UPDATE users SET has_lifetime = true WHERE id = $1",
          [req.userId]
        );
        return res.json({ success: true, hasLifetime: true, restored: true });
      }
      return res.status(409).json({ error: "This purchase is already registered to another account." });
    }

    // Record the purchase and grant lifetime access.
    await pool.query(
      "INSERT INTO purchases (user_id, product_id, purchase_token) VALUES ($1, $2, $3)",
      [req.userId, productId, purchaseToken]
    );
    await pool.query(
      "UPDATE users SET has_lifetime = true WHERE id = $1",
      [req.userId]
    );

    res.json({ success: true, hasLifetime: true });
  } catch (err) {
    console.error("Billing confirm error:", err);
    res.status(500).json({ error: "Failed to confirm purchase." });
  }
});

// Generate Word Doc route
app.post('/api/generate-docx', async (req, res) => {
  const { resumeText, jobTitle, company } = req.body;

  const NAVY = "1F3864";
  const DARK_TEXT = "1A1A1A";
  const LIGHT_BLUE = "D6E4F0";

  // Parse resume text into sections
  const lines = resumeText.split('\n').map(l => l.trim()).filter(l => l);

  const sectionKeywords = ['SUMMARY', 'OBJECTIVE', 'PROFILE', 'EXPERIENCE', 'EDUCATION', 'SKILLS', 'STRENGTHS', 'CERTIFICATIONS', 'LICENSES', 'TECHNOLOGIES', 'COMPETENCIES', 'TRAINING', 'PROJECTS', 'AWARDS', 'ACHIEVEMENTS', 'CLEARANCE', 'AFFILIATIONS', 'HIGHLIGHTS'];

  // A real section heading is a SHORT, standalone, all-caps line (e.g. "SUMMARY",
  // "CORE STRENGTHS") — NOT a sentence or bullet that merely contains a keyword.
  function isSection(line) {
    const t = line.trim().replace(/[:\s]+$/, '').toUpperCase();
    if (t.length === 0 || t.length > 32) return false;
    if (/^[•\-\*]/.test(t)) return false;
    if (!/^[A-Z&/ ]+$/.test(t)) return false;
    return sectionKeywords.some(k => new RegExp(`\\b${k}\\b`).test(t));
  }

  function isBullet(line) {
    return line.startsWith('•') || line.startsWith('-') || line.startsWith('*');
  }

  function cleanBullet(line) {
    return line.replace(/^[•\-\*]\s*/, '').trim();
  }

  function sectionHeader(text) {
    return new Paragraph({
      spacing: { before: 140, after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 3 } },
      children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 20, color: NAVY, font: "Arial" })]
    });
  }

  function bullet(text) {
    return new Paragraph({
      numbering: { reference: "bullets", level: 0 },
      spacing: { before: 25, after: 25 },
      children: [new TextRun({ text, size: 18, font: "Arial", color: DARK_TEXT })]
    });
  }

  function normalPara(text) {
    return new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text, size: 18, font: "Arial", color: DARK_TEXT })]
    });
  }

  // Build document children
  const children = [];

  // Header — use the candidate's OWN name/contact from the top of the resume,
  // never a hardcoded identity. The tailored text begins with name, contact, title.
  function isHeaderLine(line) {
    return line && !isSection(line) && !isBullet(line) && line.length < 120 && !line.trim().endsWith('.');
  }

  const candidateName = lines.length ? lines[0] : "";
  const subtitleLines = [];
  let bodyStart = 0;
  if (candidateName && isHeaderLine(candidateName)) {
    bodyStart = 1;
    while (bodyStart < lines.length && subtitleLines.length < 2 && isHeaderLine(lines[bodyStart])) {
      subtitleLines.push(lines[bodyStart]);
      bodyStart++;
    }
  }

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: subtitleLines.length ? 40 : 120 },
    children: [new TextRun({ text: (candidateName || "Your Name").toUpperCase(), bold: true, size: 44, font: "Arial", color: NAVY })]
  }));
  subtitleLines.forEach((sl, idx) => {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: idx === subtitleLines.length - 1 ? 120 : 40 },
      children: [new TextRun({ text: sl, size: idx === 0 ? 20 : 18, font: "Arial", color: "555555" })]
    }));
  });

  // Parse and add content (skipping the header lines already rendered)
  let i = bodyStart;
  while (i < lines.length) {
    const line = lines[i];

    if (isSection(line)) {
      children.push(sectionHeader(line));
    } else if (isBullet(line)) {
      children.push(bullet(cleanBullet(line)));
    } else if (line.match(/^\d{4}/) || /\s[—–]\s/.test(line)) {
      // Role header: starts with a year, or uses em/en-dash separators
      children.push(new Paragraph({
        spacing: { before: 100, after: 20 },
        children: [new TextRun({ text: line, bold: true, size: 20, font: "Arial", color: NAVY })]
      }));
    } else {
      // Everything else is normal body text — never auto-bold short lines.
      children.push(normalPara(line));
    }
    i++;
  }

  // Build document
  const doc = new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 400, hanging: 200 } } } }]
      }]
    },
    styles: { default: { document: { run: { font: "Arial", size: 18, color: DARK_TEXT } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 720, right: 900, bottom: 720, left: 900 }
        }
      },
      children
    }]
  });

  try {
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=tailored_resume.docx');
    res.send(buffer);
  } catch (err) {
    console.error('DOCX generation error:', err);
    res.status(500).json({ error: 'Failed to generate Word document' });
  }
});

// Generate PDF route - mirrors the docx formatting logic
app.post('/api/generate-pdf', async (req, res) => {
  const { resumeText, jobTitle, company } = req.body;
  const PDFDocument = require('pdfkit');

  const NAVY = "#1F3864";
  const DARK_TEXT = "#1A1A1A";

  const lines = resumeText.split('\n').map(l => l.trim()).filter(l => l);
  const sectionKeywords = ['SUMMARY', 'OBJECTIVE', 'PROFILE', 'EXPERIENCE', 'EDUCATION', 'SKILLS', 'STRENGTHS', 'CERTIFICATIONS', 'LICENSES', 'TECHNOLOGIES', 'COMPETENCIES', 'TRAINING', 'PROJECTS', 'AWARDS', 'ACHIEVEMENTS', 'CLEARANCE', 'AFFILIATIONS', 'HIGHLIGHTS'];

  // A real section heading is a SHORT, standalone, all-caps line — NOT a sentence
  // or bullet that merely contains a keyword like "EXPERIENCE" or "TRAINING".
  function isSection(line) {
    const t = line.trim().replace(/[:\s]+$/, '').toUpperCase();
    if (t.length === 0 || t.length > 32) return false;
    if (/^[•\-\*]/.test(t)) return false;
    if (!/^[A-Z&/ ]+$/.test(t)) return false;
    return sectionKeywords.some(k => new RegExp(`\\b${k}\\b`).test(t));
  }
  function isBullet(line) {
    return line.startsWith('•') || line.startsWith('-') || line.startsWith('*');
  }
  function cleanBullet(line) {
    return line.replace(/^[•\-\*]\s*/, '').trim();
  }

  try {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 55, right: 55 } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=tailored_resume.pdf');
    doc.pipe(res);

    // Header — use the candidate's OWN name/contact from the top of the resume.
    function isHeaderLine(line) {
      return line && !isSection(line) && !isBullet(line) && line.length < 120 && !line.trim().endsWith('.');
    }
    const candidateName = lines.length ? lines[0] : "";
    const subtitleLines = [];
    let bodyStart = 0;
    if (candidateName && isHeaderLine(candidateName)) {
      bodyStart = 1;
      while (bodyStart < lines.length && subtitleLines.length < 2 && isHeaderLine(lines[bodyStart])) {
        subtitleLines.push(lines[bodyStart]);
        bodyStart++;
      }
    }

    doc.font('Helvetica-Bold').fontSize(22).fillColor(NAVY)
      .text((candidateName || "Your Name").toUpperCase(), { align: 'center' });
    subtitleLines.forEach((sl, idx) => {
      doc.font('Helvetica').fontSize(idx === 0 ? 11 : 9).fillColor("#555555")
        .text(sl, { align: 'center' });
    });
    doc.moveDown(1);

    // Body content (skipping the header lines already rendered)
    lines.slice(bodyStart).forEach((line) => {
      if (isSection(line)) {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(line.toUpperCase());
        doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - 55, doc.y + 2).strokeColor(NAVY).lineWidth(1).stroke();
        doc.moveDown(0.3);
      } else if (isBullet(line)) {
        doc.font('Helvetica').fontSize(10).fillColor(DARK_TEXT)
          .text(`•  ${cleanBullet(line)}`, { indent: 15 });
      } else if (line.match(/^\d{4}/) || /\s[—–]\s/.test(line)) {
        doc.moveDown(0.2);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(line);
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(DARK_TEXT).text(line);
      }
    });

    doc.end();
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Save resume route - now tied to the logged-in user
app.post('/api/resumes', requireAuth, async (req, res) => {
  const { original, tailored, jobTitle, company } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO resumes (original, tailored, job_title, company, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [original, tailored, jobTitle, company, req.userId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all resumes route - now only returns the logged-in user's own resumes
app.get('/api/resumes', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM resumes WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch resumes' });
  }
});

// DELETE a saved resume - now verifies it belongs to the logged-in user
app.delete("/api/resumes/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM resumes WHERE id = $1 AND user_id = $2", [id, req.userId]);
    res.status(200).json({ message: "Deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete resume" });
  }
});
// DELETE ACCOUNT - permanently removes the user and all their data
app.delete("/api/auth/account", requireAuth, async (req, res) => {
  try {
    // Thanks to ON DELETE CASCADE on resumes.user_id, deleting the user
    // row automatically deletes all their saved resumes too.
    await pool.query("DELETE FROM users WHERE id = $1", [req.userId]);
    res.status(200).json({ message: "Account deleted successfully." });
  } catch (err) {
    console.error("Account deletion error:", err);
    res.status(500).json({ error: "Failed to delete account." });
  }
});
// --- Email helpers: block disposable domains and collapse alias tricks ---
// Known throwaway / temporary email providers (one burner email in seconds).
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com","guerrillamail.com","guerrillamail.info","grr.la","sharklasers.com",
  "10minutemail.com","10minutemail.net","temp-mail.org","tempmail.com","tempmailo.com",
  "throwawaymail.com","yopmail.com","getnada.com","nada.email","trashmail.com","maildrop.cc",
  "dispostable.com","fakeinbox.com","mailnesia.com","mohmal.com","mailcatch.com","emailondeck.com",
  "mintemail.com","spamgourmet.com","tempinbox.com","tmpmail.org","burnermail.io","moakt.com",
  "inboxkitten.com","1secmail.com","easytrashmail.com","discard.email","mailtemp.net","tempr.email"
]);

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Returns { email (lowercased as entered), canonical (dedupe key), domain }.
// Collapses the two cheapest trial-abuse tricks: "+tag" aliases (all providers)
// and Gmail's ignored dots, so one real inbox can't spawn unlimited accounts.
function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return { email, canonical: email, domain: "" };
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  local = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  return { email, canonical: `${local}@${domain}`, domain };
}

const dns = require("dns").promises;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error("dns-timeout"), { code: "ETIMEOUT" })), ms)
    ),
  ]);
}

// Reject signups whose email DOMAIN has no mail server (fake / typo'd domains).
// An MX record — or a fallback A/AAAA record (implicit MX) — proves the domain
// can receive mail. On a transient DNS failure we ALLOW the signup rather than
// block a real user over a flaky lookup.
async function domainHasMailServer(domain) {
  if (!domain) return false;
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 4000);
    if (Array.isArray(mx) && mx.some((r) => r && r.exchange)) return true;
  } catch (err) {
    // No MX or a lookup hiccup — fall through to the A/AAAA existence check,
    // which is the sole decider on whether to reject.
  }
  try {
    const addrs = await withTimeout(dns.resolve(domain), 4000);
    return Array.isArray(addrs) && addrs.length > 0;
  } catch (err) {
    if (err && (err.code === "ENOTFOUND" || err.code === "ENODATA")) return false; // domain truly doesn't resolve
    return true; // transient / timeout — fail open, never block a real user over a flaky lookup
  }
}

// --- Email verification (prove the inbox is real before the free tailors unlock) ---
const API_BASE_URL = process.env.API_BASE_URL || "https://ai-resume-tailor-api.onrender.com";

function resultPage(title, message, ok) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family:'Segoe UI',system-ui,sans-serif;background:#F9FAFB;margin:0;padding:48px 20px;color:#1a1a1a;">
  <div style="max-width:460px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,0.06);">
    <div style="font-size:40px;margin-bottom:8px;">${ok ? "✅" : "⚠️"}</div>
    <h1 style="color:#3B0764;font-size:22px;margin:0 0 10px;">${title}</h1>
    <p style="color:#444;font-size:15px;line-height:1.6;margin:0;">${message}</p>
  </div>
</body></html>`;
}

// Creates a fresh verification token and emails the user a one-click link.
async function sendVerificationEmail(userId, toEmail) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  await pool.query(
    "INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)",
    [userId, token, expiresAt]
  );
  const verifyLink = `${API_BASE_URL}/api/auth/verify-email?token=${token}`;
  await resend.emails.send({
    from: "Resume Tailored to JD <noreply@cainbuilds.com>",
    to: toEmail,
    subject: "Verify your email for Resume Tailor",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #3B0764;">Verify your email</h2>
        <p style="color: #444;">Welcome to Resume Tailor! Tap the button below to verify your email and unlock your free tailors. This link expires in 24 hours.</p>
        <a href="${verifyLink}" style="display: inline-block; background: #7C3AED; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; margin: 16px 0;">Verify Email</a>
        <p style="color: #888; font-size: 13px;">If you didn't create a Resume Tailor account, you can safely ignore this email.</p>
      </div>
    `,
  });
}

// SIGN UP - creates a real account
app.post("/api/auth/signup", async (req, res) => {
  const { password } = req.body;
  const { email, canonical, domain } = normalizeEmail(req.body.email);
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (!isValidEmail(canonical)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return res.status(400).json({ error: "Please use a permanent email address — temporary email providers aren't allowed." });
  }
  if (!(await domainHasMailServer(domain))) {
    return res.status(400).json({ error: "That email domain can't receive mail. Please double-check your email address." });
  }

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [canonical]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [canonical, passwordHash]
    );

    const user = result.rows[0];

    // Send the verification email (non-fatal if it fails — they can resend from the app).
    try {
      await sendVerificationEmail(user.id, canonical);
    } catch (mailErr) {
      console.error("Verification email failed to send:", mailErr);
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, user: { id: user.id, email: user.email, emailVerified: false } });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Failed to create account." });
  }
});

// VERIFY EMAIL - one-click link from the verification email (returns an HTML page)
app.get("/api/auth/verify-email", async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send(resultPage("Verification failed", "This link is missing its verification token.", false));
  }
  try {
    const r = await pool.query("SELECT * FROM email_verifications WHERE token = $1", [token]);
    const rec = r.rows[0];
    if (!rec) {
      return res.status(400).send(resultPage("Link already used", "This verification link is invalid or has already been used. If you still can't tailor, open the app and tap \"Resend verification.\"", false));
    }
    if (new Date(rec.expires_at) < new Date()) {
      await pool.query("DELETE FROM email_verifications WHERE id = $1", [rec.id]);
      return res.status(400).send(resultPage("Link expired", "This verification link has expired. Open the app and tap \"Resend verification\" to get a new one.", false));
    }
    await pool.query("UPDATE users SET email_verified = TRUE WHERE id = $1", [rec.user_id]);
    await pool.query("DELETE FROM email_verifications WHERE user_id = $1", [rec.user_id]);
    return res.send(resultPage("Email verified", "Your email is confirmed. Head back to the Resume Tailor app and start tailoring.", true));
  } catch (err) {
    console.error("Verify email error:", err);
    return res.status(500).send(resultPage("Something went wrong", "Please try the link again in a moment.", false));
  }
});

// RESEND VERIFICATION - logged-in user requests a fresh verification email
app.post("/api/auth/resend-verification", requireAuth, async (req, res) => {
  try {
    const r = await pool.query("SELECT email, email_verified FROM users WHERE id = $1", [req.userId]);
    const u = r.rows[0];
    if (!u) return res.status(404).json({ error: "User not found." });
    if (u.email_verified) return res.json({ message: "Your email is already verified." });
    await pool.query("DELETE FROM email_verifications WHERE user_id = $1", [req.userId]);
    await sendVerificationEmail(req.userId, u.email);
    res.json({ message: "Verification email sent. Check your inbox (and spam folder)." });
  } catch (err) {
    console.error("Resend verification error:", err);
    res.status(500).json({ error: "Couldn't send the verification email. Please try again." });
  }
});

// LOG IN - verifies real credentials
app.post("/api/auth/login", async (req, res) => {
  const { password } = req.body;
  const { canonical } = normalizeEmail(req.body.email);
  if (!canonical || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [canonical]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Failed to log in." });
  }
});
// REQUEST PASSWORD RESET - sends an email with a reset link
app.post("/api/auth/forgot-password", async (req, res) => {
  const { canonical } = normalizeEmail(req.body.email);
  if (!canonical) {
    return res.status(400).json({ error: "Email is required." });
  }

  try {
    const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [canonical]);
    const user = userResult.rows[0];

    // Always return success, even if the email isn't registered.
    // This prevents attackers from discovering which emails have accounts.
    if (!user) {
      return res.json({ message: "If an account exists for that email, a reset link has been sent." });
    }

    // Generate a secure random token that expires in 1 hour
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      "INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [user.id, token, expiresAt]
    );

    const resetLink = `https://genocaino75-byte.github.io/resume-tailor-mobile/reset-password.html?token=${token}`;

    await resend.emails.send({
      from: "Resume Tailored to JD <noreply@cainbuilds.com>",
      to: canonical,
      subject: "Reset your Resume Tailor password",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #3B0764;">Reset your password</h2>
          <p style="color: #444;">We received a request to reset your Resume Tailor password. Click the button below to choose a new one. This link expires in 1 hour.</p>
          <a href="${resetLink}" style="display: inline-block; background: #7C3AED; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; margin: 16px 0;">Reset Password</a>
          <p style="color: #888; font-size: 13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        </div>
      `,
    });

    res.json({ message: "If an account exists for that email, a reset link has been sent." });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Failed to process request." });
  }
});

// RESET PASSWORD - verifies the token and updates the password
app.post("/api/auth/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required." });
  }

  if (newPassword.length < 10 || (newPassword.match(/[0-9]/g) || []).length < 2) {
    return res.status(400).json({ error: "Password must be at least 10 characters and contain at least 2 numbers." });
  }

  try {
    const resetResult = await pool.query(
      "SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW()",
      [token]
    );
    const resetRecord = resetResult.rows[0];

    if (!resetRecord) {
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, resetRecord.user_id]);

    // Delete the used token so it can't be reused
    await pool.query("DELETE FROM password_resets WHERE id = $1", [resetRecord.id]);

    res.json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Failed to reset password." });
  }
});
// GOOGLE SIGN-IN - verifies Google's ID token and creates/logs in the user
app.post("/api/auth/google", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: "Google ID token is required." });
  }

  try {
    // Verify the token really came from Google and is meant for our app
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;

    if (!email) {
      return res.status(400).json({ error: "Could not retrieve email from Google account." });
    }

    // Find existing user, or create one for this Google account
    let userResult = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
    let user = userResult.rows[0];

    if (!user) {
      // Google-authenticated users don't have a password of their own.
      // Store a random unusable hash so the column constraint is satisfied.
      const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      const insertResult = await pool.query(
        "INSERT INTO users (email, password_hash, email_verified) VALUES ($1, $2, TRUE) RETURNING id, email",
        [email, randomHash]
      );
      user = insertResult.rows[0];
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("Google sign-in error:", err);
    res.status(401).json({ error: "Google sign-in failed. Please try again." });
  }
});


const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});