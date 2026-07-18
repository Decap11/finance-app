"use client";

import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import { useToast } from "../context/ToastContext";
import "../styles/featureArea.css";

export default function BroadcastMessageWidget() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { showSuccess } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setSending(true);
    setErrorMsg("");

    try {
      // 1. Get authenticated user session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Authentication session missing. Please log in again.");
      }

      // 2. Fetch the admin's profile to get the group_id (Sacco identifier)
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', session.user.id)
        .single();

      if (profileErr) throw profileErr;
      if (!profile?.group_id) {
        throw new Error("You are not currently linked to any SACCO group.");
      }

      // 3. Retrieve the SACCO table UUID from group_code
      const { data: sacco, error: saccoErr } = await supabase
        .from('saccos')
        .select('id')
        .eq('group_code', profile.group_id)
        .single();

      if (saccoErr) throw saccoErr;

      // 4. Insert broadcast event log into public.audit_events
      const { error: insertErr } = await supabase
        .from('audit_events')
        .insert({
          sacco_id: sacco.id,
          actor_profile_id: session.user.id,
          entity_type: 'broadcast',
          entity_id: sacco.id,
          action: 'new_announcement',
          metadata: {
            title: title.trim(),
            content: content.trim()
          }
        });

      if (insertErr) throw insertErr;

      showSuccess(`Broadcast Message "${title}" published successfully to all group members!`);
      setTitle("");
      setContent("");

    } catch (err) {
      console.error("Failed to publish broadcast message:", err);
      setErrorMsg("Failed to publish message: " + err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="quick-actions quick-actions-broadcast" onSubmit={handleSubmit}>
      <div className="section-header section-header-broadcast">
        <h3 className="section-title">
          <i className="fa-solid fa-bullhorn icon-broadcast"></i>Broadcast Message
        </h3>
      </div>

      {errorMsg && (
        <div style={{ color: "#ef4444", fontSize: "1.3rem", fontWeight: 700, marginBottom: "1.5rem" }}>
          <i className="fa-solid fa-circle-exclamation" style={{ marginRight: "0.6rem" }} />
          {errorMsg}
        </div>
      )}

      <div className="admin-form-group">
        <label>Message Title</label>
        <input 
          type="text" 
          placeholder="e.g. Annual General Meeting" 
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required 
          disabled={sending}
        />
      </div>

      <div className="admin-form-group">
        <label>Content</label>
        <textarea
          rows="4"
          placeholder="Type the message to send to all members..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          disabled={sending}
        ></textarea>
      </div>

      <button type="submit" className="admin-btn-primary" disabled={sending}>
        {sending ? (
          <>Publishing... <i className="fa-solid fa-spinner fa-spin" /></>
        ) : (
          <>Send to All Members <i className="fa-solid fa-paper-plane" /></>
        )}
      </button>
    </form>
  );
}
