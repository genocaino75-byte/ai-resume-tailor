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

// Save resume route
app.post('/api/resumes', async (req, res) => {
  const { original, tailored, jobTitle, company } = req.body;
  console.log('Save request received:', { jobTitle, company });
  try {
    const result = await pool.query(
      'INSERT INTO resumes (original, tailored, job_title, company) VALUES ($1, $2, $3, $4) RETURNING *',
      [original, tailored, jobTitle, company]
    );
    console.log('Saved successfully:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({ error: error.message });
  }
});
// DELETE a saved resume
app.delete("/api/resumes/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM resumes WHERE id = $1", [id]);
    res.status(200).json({ message: "Deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete resume" });
  }
});

// Get all resumes route
app.get('/api/resumes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM resumes ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch resumes' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});