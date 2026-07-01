import { useState } from "react";
import axios from "axios";

const API_URL = "https://ai-resume-tailor-api.onrender.com";

export default function App() {
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [tailoredResume, setTailoredResume] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleTailor = async () => {
    if (!resume || !jobDescription) {
      setError("Please enter both your resume and job description!");
      return;
    }
    setLoading(true);
    setError("");
    setSaved(false);
    try {
      const response = await axios.post(`${API_URL}/api/tailor`, {
        resume,
        jobDescription,
      });
      setTailoredResume(response.data.tailoredResume);
    } catch (err) {
      setError("Failed to tailor resume. Check your server!");
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!tailoredResume) return;
    try {
      await axios.post(`${API_URL}/api/resumes`, {
        original: resume,
        tailored: tailoredResume,
        jobTitle,
        company,
      });
      setSaved(true);
    } catch (err) {
      setError("Failed to save resume!");
    }
  };

  return (
    <div style={styles.container}>
      <style>{`
        ::placeholder {
          color: #a0aec0 !important;
          opacity: 1 !important;
        }
        input::placeholder {
          color: #a0aec0 !important;
          opacity: 1 !important;
        }
        textarea::placeholder {
          color: #a0aec0 !important;
          opacity: 1 !important;
        }
      `}</style>

      {/* HEADER */}
      <div style={styles.header}>
        <h1 style={styles.title}>🤖 AI Resume Tailor</h1>
        <p style={styles.subtitle}>Powered by Claude AI</p>
      </div>

      {/* MAIN CONTENT */}
      <div style={styles.content}>
        {/* LEFT COLUMN */}
        <div style={styles.column}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>📄 Your Resume</h2>
            <textarea
              style={styles.textarea}
              placeholder="Paste your resume here..."
              value={resume}
              onChange={(e) => setResume(e.target.value)}
            />
          </div>

          <div style={styles.card}>
            <h2 style={styles.cardTitle}>💼 Job Description</h2>
            <textarea
              style={styles.textarea}
              placeholder="Paste the job description here..."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
            />
          </div>

          <div style={styles.row}>
            <input
              style={styles.input}
              placeholder="Job Title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
            <input
              style={styles.input}
              placeholder="Company Name"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button
            style={loading ? styles.buttonDisabled : styles.button}
            onClick={handleTailor}
            disabled={loading}
          >
            {loading ? "⏳ Tailoring your resume..." : "✨ Tailor My Resume"}
          </button>
        </div>

        {/* RIGHT COLUMN */}
        <div style={styles.column}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>✅ Tailored Resume</h2>
            {tailoredResume ? (
              <>
                <textarea
                  style={styles.textarea}
                  value={tailoredResume}
                  onChange={(e) => setTailoredResume(e.target.value)}
                />
                <div style={styles.buttonRow}>
                  <button
                    style={styles.saveButton}
                    onClick={handleSave}
                  >
                    {saved ? "✅ Saved!" : "💾 Save Resume"}
                  </button>
                  <button
                    style={styles.copyButton}
                    onClick={() => {
                      navigator.clipboard.writeText(tailoredResume);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? "✅ Copied!" : "📋 Copy"}
                  </button>
                </div>
              </>
            ) : (
              <div style={styles.placeholder}>
                <p style={styles.placeholderText}>
                  Your tailored resume will appear here after clicking "Tailor My Resume"
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    background: "#0a0c13",
    color: "#e2e8f0",
    fontFamily: "Inter, sans-serif",
    padding: "0",
  },
  header: {
    background: "linear-gradient(135deg, #1a1f35 0%, #0d1021 100%)",
    borderBottom: "1px solid #2a2f4a",
    padding: "24px 40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: "1.8rem",
    fontWeight: "800",
    background: "linear-gradient(90deg, #00d4ff, #7c5cfc)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    margin: "0",
  },
  subtitle: {
    color: "#6b7280",
    fontSize: "0.9rem",
    margin: "0",
  },
  content: {
    display: "flex",
    gap: "24px",
    padding: "24px 40px",
  },
  column: {
    flex: "1",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  card: {
    background: "linear-gradient(135deg, #141828 0%, #1a1f35 100%)",
    border: "1px solid #2a2f4a",
    borderRadius: "12px",
    padding: "20px",
  },
  cardTitle: {
    fontSize: "1rem",
    fontWeight: "700",
    color: "#00d4ff",
    margin: "0 0 12px 0",
  },
  textarea: {
    width: "100%",
    height: "220px",
    background: "#0a0c13",
    border: "1px solid #2a2f4a",
    borderRadius: "8px",
    color: "#e2e8f0",
    padding: "12px",
    fontSize: "0.85rem",
    resize: "vertical",
    fontFamily: "Inter, sans-serif",
    boxSizing: "border-box",
  },
  row: {
    display: "flex",
    gap: "12px",
  },
  input: {
    flex: "1",
    background: "#141828",
    border: "1px solid #2a2f4a",
    borderRadius: "8px",
    color: "#e2e8f0",
    padding: "10px 14px",
    fontSize: "0.9rem",
    fontFamily: "Inter, sans-serif",
  },
  button: {
    background: "linear-gradient(135deg, #7c5cfc, #00d4ff)",
    color: "white",
    border: "none",
    borderRadius: "10px",
    padding: "14px 24px",
    fontSize: "1rem",
    fontWeight: "700",
    cursor: "pointer",
    width: "100%",
  },
  buttonDisabled: {
    background: "#2a2f4a",
    color: "#6b7280",
    border: "none",
    borderRadius: "10px",
    padding: "14px 24px",
    fontSize: "1rem",
    fontWeight: "700",
    cursor: "not-allowed",
    width: "100%",
  },
  saveButton: {
    background: "#00ff88",
    color: "#0a0c13",
    border: "none",
    borderRadius: "10px",
    padding: "12px 24px",
    fontSize: "0.9rem",
    fontWeight: "700",
    cursor: "pointer",
    flex: "1",
  },
  copyButton: {
    background: "#7c5cfc",
    color: "white",
    border: "none",
    borderRadius: "10px",
    padding: "12px 24px",
    fontSize: "0.9rem",
    fontWeight: "700",
    cursor: "pointer",
    flex: "1",
  },
  buttonRow: {
    display: "flex",
    gap: "10px",
    marginTop: "12px",
  },
  placeholder: {
    height: "220px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px dashed #2a2f4a",
    borderRadius: "8px",
  },
  placeholderText: {
    color: "#6b7280",
    textAlign: "center",
    fontSize: "0.9rem",
  },
  error: {
    color: "#ff6b6b",
    fontSize: "0.85rem",
    margin: "0",
  },
};
