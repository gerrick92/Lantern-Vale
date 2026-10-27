"use client";
import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function ProfileForm() {
  const profile = useQuery({
    queryKey: ["account-profile"],
    queryFn: () =>
      api<{ profile: { display_name: string } | null }>("/api/profile"),
    refetchOnWindowFocus: false,
  });
  if (profile.isPending) return <p role="status">Loading your profile…</p>;
  if (profile.isError)
    return (
      <div>
        <p role="alert">Your profile could not be loaded.</p>
        <button
          type="button"
          className="secondary"
          disabled={profile.isFetching}
          onClick={() => void profile.refetch()}
        >
          Retry profile
        </button>
      </div>
    );
  return (
    <ProfileEditor initialName={profile.data.profile?.display_name ?? ""} />
  );
}

function ProfileEditor({ initialName }: { initialName: string }) {
  const client = useQueryClient();
  const [draft, setName] = useState<string | null>(null);
  const name = draft ?? initialName;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await api("/api/profile", { display_name: name });
      setName(name.trim());
      client.setQueryData(["account-profile"], {
        profile: { display_name: name.trim() },
      });
      setMessage("Profile saved.");
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Profile could not be saved.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <label htmlFor="display-name">Display name</label>
      <input
        id="display-name"
        name="name"
        autoComplete="nickname"
        minLength={2}
        maxLength={40}
        required
        value={name}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </button>
      </div>
      <p role="status" className={failed ? "error" : undefined}>
        {message}
      </p>
    </form>
  );
}
