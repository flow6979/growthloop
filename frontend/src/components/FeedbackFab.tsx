import { useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { errMsg } from "../lib";
import { Field, Modal, useStatus } from "./ui";

export function RatingInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} className={`star ${value !== null && n <= value ? "on" : ""}`}
          onClick={() => onChange(value === n ? null : n)} aria-label={`${n} stars`}>
          ★
        </button>
      ))}
    </div>
  );
}

export function FeedbackFab() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const loc = useLocation();
  const { toast } = useStatus();

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addFeedback({ text: text.trim(), rating, page: loc.pathname });
      toast("Thanks: agents will read this next cycle");
      setText("");
      setRating(null);
      setOpen(false);
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="fab" onClick={() => setOpen(true)}>Feedback</button>
      {open && (
        <Modal title="Feedback" onClose={() => setOpen(false)}>
          <p className="muted small">
            Saved as a learning that every agent reads next cycle. Page: <code>{loc.pathname}</code>
          </p>
          <Field label="What's on your mind?">
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus
              placeholder="e.g. The marketing drafts are too long for WhatsApp" />
          </Field>
          <Field label="Rating (optional)">
            <RatingInput value={rating} onChange={setRating} />
          </Field>
          <div className="row gap end">
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={submit}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
