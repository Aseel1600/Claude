import React from "react";

export default function Dashboard() {
  return (
    <div style={{ padding: 24 }}>
      <h1>Projects Dashboard</h1>
      <p>List of user projects will appear here (multi-tenant).</p>
      <ul>
        <li>TODO: Integrate with auth (Clerk/Auth0)</li>
        <li>TODO: Projects listing, status, previews</li>
      </ul>
    </div>
  );
}
