const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'resume_tailor',
    password: process.env.DB_PASSWORD,
    port: 5432,
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
app.post('/api/tailor', async (req, res) => {
    const { resume, jobDescription } = req.body;

    try {
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            messages: [
                {
                    role: 'user',
                    content: `You are an expert resume writer. Tailor the following resume to match the job description provided. 
                    
Keep the same format but adjust the language, keywords, and emphasis to better match the job requirements.
Return ONLY the tailored resume text, no other commentary.

RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}`
                }
            ]
        });

        const tailoredResume = message.content[0].text;

        res.json({ tailoredResume });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to tailor resume' });
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});