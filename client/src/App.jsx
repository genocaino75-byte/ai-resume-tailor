import { useState, useEffect } from "react";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

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
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [page, setPage] = useState("main"); // "main" or "history"
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [historyCopied, setHistoryCopied] = useState(null);

  const handleTailor = async () => {
    if (!resume || !jobDescription) {
      setError("Please enter both your resume and job description!");
      return;
    }
    setLoading(true);
    setError("");
    setSaved(false);
    setProgress(0);

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) { clearInterval(interval); return 90; }
        return prev + 10;
      });
    }, 400);

    try {
      const response = await axios.post(`${API_URL}/api/tailor`, { resume, jobDescription });
      setTailoredResume(response.data.tailoredResume);
      setProgress(100);
    } catch (err) {
      setError("Failed to tailor resume. Check your server!");
    }

    clearInterval(interval);
    setLoading(false);
    setTimeout(() => setProgress(0), 1000);
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

  const handleDownload = async () => {
    if (!tailoredResume) return;
    setDownloading(true);
    try {
      const response = await axios.post(
        `${API_URL}/api/generate-docx`,
        { resumeText: tailoredResume, jobTitle, company },
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${company || "tailored"}_resume.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError("Failed to download Word document!");
    }
    setDownloading(false);
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await axios.get(`${API_URL}/api/resumes`);
      setHistory(response.data);
    } catch (err) {
      setError("Failed to load history!");
    }
    setHistoryLoading(false);
  };

  const handleShowHistory = () => {
    setPage("history");
    loadHistory();
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  };

  return (
    <div style={styles.container}>
      <style>{`
        ::placeholder { color: #a0aec0 !important; opacity: 1 !important; }
        input::placeholder { color: #a0aec0 !important; opacity: 1 !important; }
        textarea::placeholder { color: #a0aec0 !important; opacity: 1 !important; }
        .history-card:hover { border-color: #7c5cfc !important; }
      `}</style>

      {/* HEADER */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>🤖 AI Resume Tailor</h1>
          <p style={styles.subtitle}>Powered by Claude AI</p>
        </div>
        <button
          style={page === "history" ? styles.historyButtonActive : styles.historyButton}
          onClick={() => page === "history" ? setPage("main") : handleShowHistory()}
        >
          {page === "history" ? "← Back to Tailor" : "📋 Resume History"}
        </button>
      </div>

      {/* MAIN PAGE */}
      {page === "main" && (
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
              <p style={styles.counter}>
                📝 {resume.trim() === "" ? 0 : resume.trim().split(/\s+/).length} words  |  {resume.length} characters
              </p>
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>💼 Job Description</h2>
              <textarea
                style={styles.textarea}
                placeholder="Paste the job description here..."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
              />
              <p style={styles.counter}>
                📝 {jobDescription.trim() === "" ? 0 : jobDescription.trim().split(/\s+/).length} words  |  {jobDescription.length} characters
              </p>
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

            {loading && (
              <div style={styles.progressContainer}>
                <div style={styles.progressLabel}>
                  <span>Claude is analyzing your resume...</span>
                  <span>{progress}%</span>
                </div>
                <div style={styles.progressBar}>
                  <div style={{ ...styles.progressFill, width: `${progress}%` }} />
                </div>
              </div>
            )}
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
                    <button style={styles.saveButton} onClick={handleSave}>
                      {saved ? "✅ Saved!" : "💾 Save"}
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
                    <button
                      style={downloading ? styles.downloadButtonDisabled : styles.downloadButton}
                      onClick={handleDownload}
                      disabled={downloading}
                    >
                      {downloading ? "⏳..." : "⬇️ Word Doc"}
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
      )}

      {/* HISTORY PAGE */}
      {page === "history" && (
        <div style={styles.historyContainer}>
          <h2 style={styles.historyTitle}>📋 Resume History</h2>
          <p style={styles.historySubtitle}>All your previously saved tailored resumes</p>

          {historyLoading && (
            <div style={styles.historyEmpty}>
              <p style={styles.placeholderText}>⏳ Loading your resume history...</p>
            </div>
          )}

          {!historyLoading && history.length === 0 && (
            <div style={styles.historyEmpty}>
              <p style={styles.placeholderText}>No saved resumes yet! Tailor and save a resume to see it here. 😊</p>
            </div>
          )}

          {!historyLoading && history.map((item) => (
            <div
              key={item.id}
              className="history-card"
              style={styles.historyCard}
            >
              <div style={styles.historyCardHeader}>
                <div>
                  <h3 style={styles.historyJobTitle}>
                    {item.job_title || "Untitled Position"}
                  </h3>
                  <p style={styles.historyCompany}>
                    🏢 {item.company || "No company specified"}  •  🕐 {formatDate(item.created_at)}
                  </p>
                </div>
                <div style={styles.historyActions}>
                  <button
                    style={styles.historyExpandBtn}
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  >
                    {expandedId === item.id ? "▲ Hide" : "▼ View"}
                  </button>
                  <button
                    style={styles.historyCopyBtn}
                    onClick={() => {
                      navigator.clipboard.writeText(item.tailored);
                      setHistoryCopied(item.id);
                      setTimeout(() => setHistoryCopied(null), 2000);
                    }}
                  >
                    {historyCopied === item.id ? "✅ Copied!" : "📋 Copy"}
                  </button>
                </div>
              </div>

              {expandedId === item.id && (
                <div style={styles.historyExpanded}>
                  <div style={styles.historySection}>
                    <h4 style={styles.historySectionTitle}>✅ Tailored Resume</h4>
                    <textarea
                      style={styles.historyTextarea}
                      value={item.tailored}
                      readOnly
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* FOOTER */}
      <div style={styles.footer}>
        <p style={styles.footerText}>
          © {new Date().getFullYear()} Paul Cain — AI Resume Tailor. All rights reserved.
        </p>
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
    margin: "4px 0 0",
  },
  historyButton: {
    background: "#141828",
    color: "#00d4ff",
    border: "1px solid #2a2f4a",
    borderRadius: "10px",
    padding: "10px 20px",
    fontSize: "0.9rem",
    fontWeight: "700",
    cursor: "pointer",
  },
  historyButtonActive: {
    background: "linear-gradient(135deg, #7c5cfc, #00d4ff)",
    color: "white",
    border: "none",
    borderRadius: "10px",
    padding: "10px 20px",
    fontSize: "0.9rem",
    fontWeight: "700",
    cursor: "pointer",
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
  counter: {
    color: "#6b7280",
    fontSize: "0.75rem",
    margin: "6px 0 0",
    textAlign: "right",
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
  buttonRow: {
    display: "flex",
    gap: "10px",
    marginTop: "12px",
  },
  saveButton: {
    background: "#00ff88",
    color: "#0a0c13",
    border: "none",
    borderRadius: "10px",
    padding: "12px 16px",
    fontSize: "0.85rem",
    fontWeight: "700",
    cursor: "pointer",
    flex: "1",
  },
  copyButton: {
    background: "#7c5cfc",
    color: "white",
    border: "none",
    borderRadius: "10px",
    padding: "12px 16px",
    fontSize: "0.85rem",
    fontWeight: "700",
    cursor: "pointer",
    flex: "1",
  },
  downloadButton: {
    background: "#00d4ff",
    color: "#0a0c13",
    border: "none",
    borderRadius: "10px",
    padding: "12px 16px",
    fontSize: "0.85rem",
    fontWeight: "700",
    cursor: "pointer",
    flex: "1",
  },
  downloadButtonDisabled: {
    background: "#2a2f4a",
    color: "#6b7280",
    border: "none",
    borderRadius: "10px",
    padding: "12px 16px",
    fontSize: "0.85rem",
    fontWeight: "700",
    cursor: "not-allowed",
    flex: "1",
  },
  progressContainer: {
    marginTop: "12px",
    background: "#141828",
    border: "1px solid #2a2f4a",
    borderRadius: "10px",
    padding: "14px 16px",
  },
  progressLabel: {
    display: "flex",
    justifyContent: "space-between",
    color: "#a0aec0",
    fontSize: "0.8rem",
    marginBottom: "8px",
  },
  progressBar: {
    background: "#2a2f4a",
    borderRadius: "999px",
    height: "8px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #7c5cfc, #00d4ff)",
    borderRadius: "999px",
    transition: "width 0.4s ease",
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
  footer: {
    background: "#0d1021",
    borderTop: "1px solid #2a2f4a",
    padding: "16px 40px",
    textAlign: "center",
  },
  footerText: {
    color: "#6b7280",
    fontSize: "0.8rem",
    margin: "0",
  },
  historyContainer: {
    padding: "24px 40px",
    maxWidth: "900px",
    margin: "0 auto",
  },
  historyTitle: {
    fontSize: "1.5rem",
    fontWeight: "800",
    color: "#00d4ff",
    margin: "0 0 8px",
  },
  historySubtitle: {
    color: "#6b7280",
    fontSize: "0.9rem",
    margin: "0 0 24px",
  },
  historyEmpty: {
    background: "#141828",
    border: "1px dashed #2a2f4a",
    borderRadius: "12px",
    padding: "40px",
    textAlign: "center",
  },
  historyCard: {
    background: "linear-gradient(135deg, #141828 0%, #1a1f35 100%)",
    border: "1px solid #2a2f4a",
    borderRadius: "12px",
    padding: "20px",
    marginBottom: "16px",
    transition: "border-color 0.2s ease",
    cursor: "pointer",
  },
  historyCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
  },
  historyJobTitle: {
    fontSize: "1rem",
    fontWeight: "700",
    color: "#e2e8f0",
    margin: "0 0 4px",
  },
  historyCompany: {
    color: "#6b7280",
    fontSize: "0.82rem",
    margin: "0",
  },
  historyActions: {
    display: "flex",
    gap: "8px",
    flexShrink: "0",
  },
  historyExpandBtn: {
    background: "#1a1f35",
    color: "#00d4ff",
    border: "1px solid #2a2f4a",
    borderRadius: "8px",
    padding: "8px 14px",
    fontSize: "0.82rem",
    fontWeight: "600",
    cursor: "pointer",
  },
  historyCopyBtn: {
    background: "#7c5cfc",
    color: "white",
    border: "none",
    borderRadius: "8px",
    padding: "8px 14px",
    fontSize: "0.82rem",
    fontWeight: "600",
    cursor: "pointer",
  },
  historyExpanded: {
    marginTop: "16px",
    borderTop: "1px solid #2a2f4a",
    paddingTop: "16px",
  },
  historySection: {
    marginBottom: "16px",
  },
  historySectionTitle: {
    fontSize: "0.85rem",
    fontWeight: "700",
    color: "#00d4ff",
    margin: "0 0 8px",
  },
  historyTextarea: {
    width: "100%",
    height: "300px",
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
};
