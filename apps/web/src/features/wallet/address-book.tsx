"use client";
import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { checkedAddress } from "@/lib/chain";

type Contact = {
  id: string;
  label: string;
  address: string;
  is_favorite: boolean;
};
const empty = { label: "", address: "", is_favorite: false };

export function AddressBook({
  onUseAddress,
}: {
  onUseAddress(address: string): void;
}) {
  const contacts = useQuery({
    queryKey: ["contacts"],
    queryFn: () => api<{ contacts: Contact[] }>("/api/contacts"),
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  async function change(action: () => Promise<unknown>, success: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await action();
      setEditing(null);
      setDraft(empty);
      await contacts.refetch();
      setMessage(success);
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "The contact could not be saved.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void change(
      async () =>
        api("/api/contacts", {
          ...(editing ? { id: editing } : {}),
          ...draft,
          address: checkedAddress(draft.address),
        }),
      editing ? "Contact updated." : "Contact saved.",
    );
  }
  return (
    <>
      <h2>Your address book</h2>
      <form
        onSubmit={save}
        aria-label={editing ? "Edit contact" : "Add contact"}
      >
        <label htmlFor="contact-label">Contact name</label>
        <input
          ref={nameInput}
          id="contact-label"
          name="label"
          maxLength={60}
          required
          value={draft.label}
          disabled={busy}
          onChange={(event) =>
            setDraft({ ...draft, label: event.target.value })
          }
        />
        <label htmlFor="contact-address">Ethereum address</label>
        <input
          id="contact-address"
          name="address"
          required
          spellCheck={false}
          autoComplete="off"
          value={draft.address}
          disabled={busy}
          onChange={(event) =>
            setDraft({ ...draft, address: event.target.value })
          }
        />
        <label className="check">
          <input
            type="checkbox"
            name="favorite"
            checked={draft.is_favorite}
            disabled={busy}
            onChange={(event) =>
              setDraft({ ...draft, is_favorite: event.target.checked })
            }
          />
          Favorite
        </label>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Save contact"}
          </button>
          {editing && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setDraft(empty);
                nameInput.current?.focus();
              }}
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>
      <p role="status" className={failed ? "error" : undefined}>
        {message}
      </p>
      {contacts.isPending && <p role="status">Loading contacts…</p>}
      {contacts.isError && (
        <div>
          <p role="alert">Contacts could not be loaded.</p>
          <button
            type="button"
            className="secondary"
            disabled={contacts.isFetching}
            onClick={() => void contacts.refetch()}
          >
            Retry contacts
          </button>
        </div>
      )}
      {contacts.data?.contacts.length === 0 && <p>No saved contacts yet.</p>}
      <ul className="contact-list">
        {contacts.data?.contacts.map((contact) => (
          <li key={contact.id}>
            <strong>{contact.label}</strong>
            {contact.is_favorite && (
              <span className="small-note"> · Favorite</span>
            )}
            <p className="address">{contact.address}</p>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                aria-label={`Use address for ${contact.label}`}
                onClick={() => onUseAddress(contact.address)}
              >
                Use address
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                aria-label={`Edit ${contact.label}`}
                onClick={() => {
                  setEditing(contact.id);
                  setDraft({
                    label: contact.label,
                    address: contact.address,
                    is_favorite: contact.is_favorite,
                  });
                  setMessage("");
                  nameInput.current?.focus();
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void change(
                    () => api("/api/contacts", { id: contact.id }, "DELETE"),
                    "Contact deleted.",
                  )
                }
              >
                Delete {contact.label}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
