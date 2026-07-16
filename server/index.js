const bcrypt = require("bcrypt");
const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
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
app.post("/api/tailor", tailorLimiter, async (req, res) => {
  const { resume, jobDescription } = req.body;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are an expert resume writer. Tailor the following resume to match the job description provided.

Keep the same format but adjust the language, keywords, and emphasis to better match the job requirements.
Return ONLY the tailored resume text, no other commentary.

RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}`
      }]
    });
    const tailoredResume = message.content[0].text;
    res.json({ tailoredResume });
  } catch (error) {
    console.error('Tailor error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Word Doc route
app.post('/api/generate-docx', async (req, res) => {
  const { resumeText, jobTitle, company } = req.body;

  const NAVY = "1F3864";
  const DARK_TEXT = "1A1A1A";
  const LIGHT_BLUE = "D6E4F0";
  // Generate PDF route - mirrors the docx formatting logic
app.post('/api/generate-pdf', async (req, res) => {
  const { resumeText, jobTitle, company } = req.body;
  const PDFDocument = require('pdfkit');

  const NAVY = "#1F3864";
  const DARK_TEXT = "#1A1A1A";

  const lines = resumeText.split('\n').map(l => l.trim()).filter(l => l);
  const sectionKeywords = ['SUMMARY', 'EXPERIENCE', 'EDUCATION', 'SKILLS', 'CERTIFICATIONS', 'TECHNOLOGIES', 'COMPETENCIES', 'TRAINING', 'PROJECTS'];

  function isSection(line) {
    return sectionKeywords.some(k => line.toUpperCase().includes(k));
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

    // Header
    doc.font('Helvetica-Bold').fontSize(24).fillColor(NAVY)
      .text("PAUL CAIN", { align: 'center' });
    doc.font('Helvetica').fontSize(11).fillColor("#444444")
      .text(jobTitle ? `Tailored for: ${jobTitle}${company ? ' at ' + company : ''}` : "IT Operations & Security Manager  |  Active Secret Clearance", { align: 'center' });
    doc.fontSize(9).fillColor("#555555")
      .text("Clarksville, TN  •  (931) 206-1989  •  pcaino3@icloud.com  •  linkedin.com/in/paul-cain-00b28133", { align: 'center' });
    doc.moveDown(1);

    // Body content
    lines.forEach((line) => {
      if (isSection(line)) {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(line.toUpperCase());
        doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - 55, doc.y + 2).strokeColor(NAVY).lineWidth(1).stroke();
        doc.moveDown(0.3);
      } else if (isBullet(line)) {
        doc.font('Helvetica').fontSize(10).fillColor(DARK_TEXT)
          .text(`•  ${cleanBullet(line)}`, { indent: 15 });
      } else if (line.match(/^\d{4}/)) {
        doc.moveDown(0.2);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(line);
      } else if (line.includes('|') && !isSection(line)) {
        doc.font('Helvetica-Oblique').fontSize(10).fillColor("#555555").text(line);
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

  // Parse resume text into sections
  const lines = resumeText.split('\n').map(l => l.trim()).filter(l => l);

  const sectionKeywords = ['SUMMARY', 'EXPERIENCE', 'EDUCATION', 'SKILLS', 'CERTIFICATIONS', 'TECHNOLOGIES', 'COMPETENCIES', 'TRAINING', 'PROJECTS'];

  function isSection(line) {
    return sectionKeywords.some(k => line.toUpperCase().includes(k));
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

  // Header
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 40 },
      children: [new TextRun({ text: "PAUL CAIN", bold: true, size: 48, font: "Arial", color: NAVY })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 40 },
      children: [new TextRun({ text: jobTitle ? `Tailored for: ${jobTitle}${company ? ' at ' + company : ''}` : "IT Operations & Security Manager  |  Active Secret Clearance", size: 20, font: "Arial", color: "444444" })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [new TextRun({ text: "Clarksville, TN  •  (931) 206-1989  •  pcaino3@icloud.com  •  linkedin.com/in/paul-cain-00b28133", size: 18, font: "Arial", color: "555555" })]
    })
  );

  // Parse and add content
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (isSection(line)) {
      children.push(sectionHeader(line));
    } else if (isBullet(line)) {
      children.push(bullet(cleanBullet(line)));
    } else if (line.match(/^\d{4}/)) {
      // Date line - treat as job header
      children.push(new Paragraph({
        spacing: { before: 100, after: 20 },
        children: [new TextRun({ text: line, bold: true, size: 18, font: "Arial", color: NAVY })]
      }));
    } else if (line.includes('|') && !isSection(line)) {
      // Company line
      children.push(new Paragraph({
        spacing: { before: 0, after: 35 },
        children: [new TextRun({ text: line, italics: true, size: 18, font: "Arial", color: "555555" })]
      }));
    } else if (line.length > 0) {
      // Check if it looks like a job title (short, no period)
      if (line.length < 60 && !line.includes('.') && i + 1 < lines.length) {
        children.push(new Paragraph({
          spacing: { before: 100, after: 20 },
          tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
          children: [new TextRun({ text: line, bold: true, size: 20, font: "Arial", color: NAVY })]
        }));
      } else {
        children.push(normalPara(line));
      }
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
// SIGN UP - creates a real account
app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });

    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Failed to create account." });
  }
});

// LOG IN - verifies real credentials
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
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
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  try {
    const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
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
      from: "onboarding@resend.dev",
      to: email,
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
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
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