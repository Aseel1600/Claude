import React, { useState } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState(null);

  async function generateSite(e) {
    e.preventDefault();
    setStatus("Submitting site job...");
    const res = await fetch("/api/generate/site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    const json = await res.json();
    setStatus(JSON.stringify(json));
  }

  async function generateVideo(e) {
    e.preventDefault();
    setStatus("Submitting video job...");
    const res = await fetch("/api/generate/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    const json = await res.json();
    setStatus(JSON.stringify(json));
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Free Opus — Prompt-driven Jamstack & Video MVP</h1>
      <form>
        <label>Prompt</label>
        <br />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          cols={80}
          placeholder="Describe the site or the video you want"
        />
        <br />
        <button onClick={generateSite} style={{ marginRight: 8 }}>
          Generate Site
        </button>
        <button onClick={generateVideo}>Generate Video</button>
      </form>
      <section style={{ marginTop: 20 }}>
        <h3>Response</h3>
        <pre>{status ? status : "No activity yet."}</pre>
      </section>
      <hr />
      <p>
        Go to <a href="/dashboard">/dashboard</a> or <a href="/deploy">/deploy</a>
      </p>
    </div>
  );
}
