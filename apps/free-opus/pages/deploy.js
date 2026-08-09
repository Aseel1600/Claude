import React from "react";

export default function Deploy() {
  return (
    <div style={{ padding: 24 }}>
      <h1>Deploy to Vercel</h1>
      <p>
        This page will offer a Vercel "Deploy" button and instructions. For demo
        purposes, a guide is shown below.
      </p>
      <h3>Steps</h3>
      <ol>
        <li>Create a GitHub repo and push this project</li>
        <li>Connect the repo in Vercel</li>
        <li>Set required ENV variables (see README)</li>
      </ol>
      <p>TODO: Add Vercel button wiring (uses Vercel Git integration)</p>
    </div>
  );
}
