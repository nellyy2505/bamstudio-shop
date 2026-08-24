"use client";

import { Fragment, useState } from "react";
import {
  Alert,
  Button,
  Field,
  Icon,
  Pill,
  cx,
  inputClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { AU_STATES } from "@/lib/types";
import type { SavedAddress } from "../data";

type FormValues = {
  first_name: string;
  last_name: string;
  line1: string;
  line2: string;
  suburb: string;
  state: string;
  postcode: string;
  phone: string;
  is_default: boolean;
};

type Errors = Partial<Record<keyof FormValues, string>>;

const EMPTY: FormValues = {
  first_name: "",
  last_name: "",
  line1: "",
  line2: "",
  suburb: "",
  state: "NSW",
  postcode: "",
  phone: "",
  is_default: false,
};

function toForm(row: SavedAddress): FormValues {
  return {
    first_name: row.first_name,
    last_name: row.last_name,
    line1: row.line1,
    line2: row.line2 ?? "",
    suburb: row.suburb,
    state: row.state,
    postcode: row.postcode,
    phone: row.phone ?? "",
    is_default: row.is_default,
  };
}

function validate(values: FormValues): Errors {
  const errors: Errors = {};
  if (!values.first_name.trim()) errors.first_name = "Enter a first name";
  if (!values.last_name.trim()) errors.last_name = "Enter a last name";
  if (!values.line1.trim()) errors.line1 = "Enter a street address";
  if (!values.suburb.trim()) errors.suburb = "Enter a suburb";
  if (!(AU_STATES as readonly string[]).includes(values.state)) {
    errors.state = "Choose a state";
  }
  if (!/^\d{4}$/.test(values.postcode.trim())) {
    errors.postcode = "Enter a 4-digit postcode";
  }
  return errors;
}

export function AddressManager({
  initial,
  userId,
}: {
  initial: SavedAddress[];
  userId: string;
}) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function reload() {
    const supabase = createClient();
    const { data } = await supabase
      .from("addresses")
      .select("*")
      .eq("user_id", userId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    setRows((data ?? []) as SavedAddress[]);
  }

  function startAdd() {
    setForm(EMPTY);
    setErrors({});
    setError(null);
    setConfirming(null);
    setEditing("new");
  }

  function startEdit(row: SavedAddress) {
    setForm(toForm(row));
    setErrors({});
    setError(null);
    setConfirming(null);
    setEditing(row.id);
  }

  /** Only one address can be the default, so clear the rest before writing. */
  async function clearDefaults(supabase: ReturnType<typeof createClient>) {
    await supabase
      .from("addresses")
      .update({ is_default: false })
      .eq("user_id", userId);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const target = editing;
    if (!target) return;

    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        line1: form.line1.trim(),
        line2: form.line2.trim() || null,
        suburb: form.suburb.trim(),
        state: form.state,
        postcode: form.postcode.trim(),
        phone: form.phone.trim() || null,
        is_default: form.is_default,
      };

      if (form.is_default) await clearDefaults(supabase);

      const result =
        target === "new"
          ? await supabase
              .from("addresses")
              .insert({ ...payload, user_id: userId })
          : await supabase
              .from("addresses")
              .update(payload)
              .eq("id", target)
              .eq("user_id", userId);

      if (result.error) throw new Error(result.error.message);

      await reload();
      setEditing(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save that address. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: cause } = await supabase
        .from("addresses")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);
      if (cause) throw new Error(cause.message);
      await reload();
      setConfirming(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not remove that address. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await clearDefaults(supabase);
      const { error: cause } = await supabase
        .from("addresses")
        .update({ is_default: true })
        .eq("id", id)
        .eq("user_id", userId);
      if (cause) throw new Error(cause.message);
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update your default address.",
      );
    } finally {
      setBusy(false);
    }
  }

  function renderForm() {
    return (
      <form
        onSubmit={save}
        noValidate
        className="card p-5 sm:col-span-2 sm:p-6"
        aria-label={editing === "new" ? "Add an address" : "Edit address"}
      >
        <b className="font-display text-[16px]">
          {editing === "new" ? "Add a new address" : "Edit address"}
        </b>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="First name"
            htmlFor="addr-first-name"
            error={errors.first_name}
          >
            <input
              id="addr-first-name"
              className={inputClass}
              autoComplete="given-name"
              value={form.first_name}
              onChange={(event) => set("first_name", event.target.value)}
            />
          </Field>

          <Field
            label="Last name"
            htmlFor="addr-last-name"
            error={errors.last_name}
          >
            <input
              id="addr-last-name"
              className={inputClass}
              autoComplete="family-name"
              value={form.last_name}
              onChange={(event) => set("last_name", event.target.value)}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="Address line 1"
              htmlFor="addr-line1"
              error={errors.line1}
            >
              <input
                id="addr-line1"
                className={inputClass}
                autoComplete="address-line1"
                value={form.line1}
                onChange={(event) => set("line1", event.target.value)}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="Address line 2"
              htmlFor="addr-line2"
              hint="Unit, level or building — optional"
            >
              <input
                id="addr-line2"
                className={inputClass}
                autoComplete="address-line2"
                value={form.line2}
                onChange={(event) => set("line2", event.target.value)}
              />
            </Field>
          </div>

          <Field label="Suburb" htmlFor="addr-suburb" error={errors.suburb}>
            <input
              id="addr-suburb"
              className={inputClass}
              autoComplete="address-level2"
              value={form.suburb}
              onChange={(event) => set("suburb", event.target.value)}
            />
          </Field>

          <Field label="State" htmlFor="addr-state" error={errors.state}>
            <select
              id="addr-state"
              className={inputClass}
              autoComplete="address-level1"
              value={form.state}
              onChange={(event) => set("state", event.target.value)}
            >
              {AU_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Postcode"
            htmlFor="addr-postcode"
            error={errors.postcode}
          >
            <input
              id="addr-postcode"
              className={inputClass}
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              autoComplete="postal-code"
              value={form.postcode}
              onChange={(event) => set("postcode", event.target.value)}
            />
          </Field>

          <Field
            label="Phone"
            htmlFor="addr-phone"
            hint="For delivery updates — optional"
          >
            <input
              id="addr-phone"
              className={inputClass}
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(event) => set("phone", event.target.value)}
            />
          </Field>
        </div>

        <label className="mt-4 flex items-center gap-2.5 text-[14px] font-semibold">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-accent)]"
            checked={form.is_default}
            onChange={(event) => set("is_default", event.target.checked)}
          />
          Make this my default delivery address
        </label>

        {error ? (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Saving…" : "Save address"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="soft"
            onClick={() => setEditing(null)}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      {error && !editing ? (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        {rows.map((row) =>
          editing === row.id ? (
            <Fragment key={row.id}>{renderForm()}</Fragment>
          ) : (
            <article key={row.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <b className="font-display text-[15.5px]">
                  {row.first_name} {row.last_name}
                </b>
                {row.is_default ? <Pill tone="accent">Default</Pill> : null}
              </div>

              <address className="mt-2 flex-1 text-[14px] text-muted not-italic">
                <span className="block">{row.line1}</span>
                {row.line2 ? <span className="block">{row.line2}</span> : null}
                <span className="block">
                  {row.suburb} {row.state} {row.postcode}
                </span>
                {row.phone ? <span className="block">{row.phone}</span> : null}
              </address>

              {confirming === row.id ? (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-[13.5px] font-semibold">
                    Remove this address?
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => remove(row.id)}
                      disabled={busy}
                    >
                      Yes, remove
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="soft"
                      onClick={() => setConfirming(null)}
                      disabled={busy}
                    >
                      Keep it
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-[13.5px] font-bold">
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="text-accent underline underline-offset-2 hover:text-accent-dark"
                  >
                    Edit
                    <span className="sr-only"> {row.line1}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setConfirming(row.id);
                    }}
                    className="text-muted underline underline-offset-2 hover:text-danger"
                  >
                    Remove
                    <span className="sr-only"> {row.line1}</span>
                  </button>
                  {row.is_default ? null : (
                    <button
                      type="button"
                      onClick={() => makeDefault(row.id)}
                      disabled={busy}
                      className={cx(
                        "text-muted underline underline-offset-2 hover:text-ink",
                        busy && "opacity-50",
                      )}
                    >
                      Set as default
                      <span className="sr-only"> {row.line1}</span>
                    </button>
                  )}
                </div>
              )}
            </article>
          ),
        )}

        {editing === "new" ? (
          renderForm()
        ) : (
          <button
            type="button"
            onClick={startAdd}
            className="flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line2 p-5 text-muted transition-colors hover:border-ink hover:text-ink"
          >
            <Icon name="plus" size={22} />
            <b className="font-display text-[14.5px]">Add a new address</b>
          </button>
        )}
      </div>
    </>
  );
}
