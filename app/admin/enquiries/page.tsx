import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { isEmailConfigured } from "@/lib/email";
import { SHOP } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { Alert, Button, ButtonLink, Field, Icon, Pagination, Pill, inputClass } from "@/components/ui";
import { AdminForm, SubmitButton } from "../AdminForm";
import { setEnquiryHandled, setSignupSubscribed } from "../actions";
import { NoRows, PageHead, Panel } from "../ui";
import {
  ENQUIRY_TOPICS,
  ENQUIRY_TOPIC_LABEL,
  listEnquiries,
  listSignups,
  type EnquiryFilters,
  type EnquiryRow,
  type SignupRow,
} from "../data";

/**
 * The studio inbox: every message sent through /contact, and every address
 * given to hear about new drops.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS SCREEN EXISTS AT ALL.
 *
 * `0006_enquiries.sql` made a customer's message a ROW before it is an email,
 * so that a mail provider having a bad afternoon costs the owner a prompt
 * rather than costing the customer their message. It did the storing half. Then
 * nothing in the shop could read either table, so the notification email went
 * back to being the only way anybody learned a message had arrived — which is
 * the exact failure that migration was written to stop. A row nobody can open
 * is not much better than no row.
 *
 * This is the reading half. The privacy policy was updated in the same change,
 * because it told customers in as many words that no such screen existed and
 * that they should not wait on a reply. Shipping this without that edit would
 * have left a legal page making a false statement about the shop.
 *
 * WHO CAN OPEN IT. `reports` — owner and studio, not Packing. See the comment
 * above `setEnquiryHandled` in actions.ts for the argument and for what a
 * future `"enquiries"` capability would improve.
 *
 * WHAT IT DOES NOT DO. It does not send anything. There is no reply box,
 * because a reply typed here would need a mail provider, a from-address and a
 * thread to land in, and would silently vanish on a deploy with none of them.
 * The customer's address is a mailto: link instead: the answer leaves from the
 * owner's own mail client, which is where it can actually be seen to have gone.
 * ────────────────────────────────────────────────────────────────────────────
 */

// Without its own title a page falls back to the layout default, so several
// studio screens all read "Studio · Bam Studio" in the tab and a person with
// three of them open cannot tell which is which.
export const metadata = { title: "Enquiries · Studio" };

const STATE_OPTIONS = [
  { value: "", label: "All messages" },
  { value: "open", label: "Still to deal with" },
  { value: "handled", label: "Dealt with" },
];

/** A query value is a string, a repeated string, or absent. Take the first. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parsePage(value: string | string[] | undefined): number {
  const n = Number.parseInt(one(value) || "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireStaff("reports");

  const params = await searchParams;
  const filters: EnquiryFilters = {
    topic: one(params.topic),
    state: one(params.state),
  };

  const [enquiries, signups] = await Promise.all([
    listEnquiries(parsePage(params.page), filters),
    // Its own page parameter, so paging the sign-ups does not throw away the
    // page of messages somebody was reading.
    listSignups(parsePage(params.spage)),
  ]);

  /*
   * Whether a notification was ever going to be attempted. On a deploy with no
   * mail provider every `notified_at` is null and that is correct rather than
   * broken — so the screen says which of the two it is instead of showing a
   * column of blanks and letting the reader guess.
   */
  const canNotify = isEmailConfigured() && SHOP.hasSupportEmail;

  const hrefFor = (next: { page?: number; spage?: number }) => {
    const query = new URLSearchParams();
    if (filters.topic) query.set("topic", filters.topic);
    if (filters.state) query.set("state", filters.state);
    const page = next.page ?? enquiries.page;
    const spage = next.spage ?? signups.page;
    if (page > 1) query.set("page", String(page));
    if (spage > 1) query.set("spage", String(spage));
    const qs = query.toString();
    return qs ? `/admin/enquiries?${qs}` : "/admin/enquiries";
  };

  const filtered = Boolean(filters.topic || filters.state);

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="Enquiries"
        subtitle="Messages sent through the contact form, and addresses given to hear about new drops."
      />

      {!canNotify ? (
        <Alert>
          This deployment has no mail provider or no support address, so no
          notification email goes out when a message arrives. Nothing is lost —
          every message below was written down before any email was attempted —
          but this screen is the only thing that will tell you one is here.
        </Alert>
      ) : null}

      <Panel title="Find a message">
        {/* A plain GET form: the filters end up in the address bar, so a
            filtered list can be bookmarked and the back button works. */}
        <form method="get" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Topic" htmlFor="topic">
              <select id="topic" name="topic" defaultValue={filters.topic} className={inputClass}>
                <option value="">Every topic</option>
                {ENQUIRY_TOPICS.map((topic) => (
                  <option key={topic} value={topic}>
                    {ENQUIRY_TOPIC_LABEL[topic]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Dealt with"
              htmlFor="state"
              hint="A message counts as dealt with once somebody marks it off below."
            >
              <select id="state" name="state" defaultValue={filters.state} className={inputClass}>
                {STATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm">
              <Icon name="search" size={17} />
              Show these
            </Button>
            {filtered ? (
              <ButtonLink href="/admin/enquiries" variant="soft" size="sm">
                Clear
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </Panel>

      <Panel
        title={filtered ? "Matching messages" : "Messages"}
        note="Newest first. Replying happens in your own mail app — this screen never sends anything."
        padded={false}
      >
        {enquiries.rows.length === 0 ? (
          <NoRows>
            {filtered ? (
              <>
                No message matches that.{" "}
                <Link href="/admin/enquiries" className="font-bold text-accent">
                  Clear the filters
                </Link>
                .
              </>
            ) : (
              <>
                <p>No messages yet.</p>
                <p className="mx-auto mt-2 max-w-[46ch]">
                  Anything sent through the contact form is written down here before
                  the email about it is even attempted, so nothing depends on that
                  email arriving.
                </p>
              </>
            )}
          </NoRows>
        ) : (
          <ul className="divide-y divide-line">
            {enquiries.rows.map((enquiry) => (
              <li key={enquiry.id}>
                <Enquiry enquiry={enquiry} canNotify={canNotify} />
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-line">
          <Pagination
            page={enquiries.page}
            pageCount={enquiries.pageCount}
            total={enquiries.total}
            noun="messages"
            hrefFor={(page) => hrefFor({ page })}
          />
        </div>
      </Panel>

      <Signups
        signups={signups.rows}
        page={signups.page}
        pageCount={signups.pageCount}
        total={signups.total}
        hrefFor={(spage) => hrefFor({ spage })}
      />
    </div>
  );
}

/** One message, in full. Nothing is truncated — the words are the point. */
function Enquiry({ enquiry, canNotify }: { enquiry: EnquiryRow; canNotify: boolean }) {
  const handled = enquiry.handledAt !== null;

  /*
   * One click to a reply. The subject carries the order number when the
   * customer gave one, so the mail lands in the same conversation as anything
   * else about that order, and the body is left empty — a pre-written opening
   * would be the shop putting words in her mouth.
   */
  const subject = enquiry.orderNumber
    ? `${SHOP.name} — your message about ${enquiry.orderNumber}`
    : `${SHOP.name} — your message`;
  // Escaped, because this string came from a stranger and lands in an href.
  // The `@` is put back: it is legal unencoded in a mailto: address and a few
  // mail clients still open `%40` as a malformed recipient.
  const address = encodeURIComponent(enquiry.email).replace(/%40/g, "@");
  const mailto = `mailto:${address}?subject=${encodeURIComponent(subject)}`;

  return (
    <article className="flex flex-col gap-3.5 px-5 py-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Pill tone="accent">{ENQUIRY_TOPIC_LABEL[enquiry.topic] ?? enquiry.topic}</Pill>
        {handled ? (
          <Pill tone="good">Dealt with</Pill>
        ) : (
          <Pill tone="warn">Still to deal with</Pill>
        )}
        <span className="text-[13px] text-muted">{formatDate(enquiry.receivedAt)}</span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-[17px] font-semibold">{enquiry.name}</span>
        <a href={mailto} className="text-[14px] font-bold text-accent hover:text-accent-dark">
          {enquiry.email}
        </a>
        {enquiry.orderNumber ? (
          /*
            * The customer typed this into a text box, so it is what they
            * believe their order number is — not a foreign key, and not
            * necessarily an order that exists. It searches the orders list
            * rather than linking straight at a row, because a link to an
            * order that is not there is worse than a search that finds
            * nothing.
            */
          <Link
            href={`/admin/orders?q=${encodeURIComponent(enquiry.orderNumber)}`}
            className="font-mono text-[13px] font-semibold text-accent hover:text-accent-dark"
          >
            {enquiry.orderNumber}
          </Link>
        ) : null}
      </div>

      {/* The message exactly as it was typed, line breaks and all. `break-words`
          because a stranger can paste a 200-character unspaced string and a
          table that scrolls sideways is a message nobody reads. */}
      <blockquote className="rounded-xl border border-line bg-cream/40 px-4 py-3.5 text-[14.5px] leading-relaxed break-words whitespace-pre-wrap">
        {enquiry.message}
      </blockquote>

      <p className="text-[12.5px] text-muted">
        {enquiry.notifiedAt
          ? `You were emailed about this on ${formatDate(enquiry.notifiedAt)}.`
          : canNotify
            ? "No notification email went out for this one, so this screen is where it was found."
            : "No notification email was attempted — this shop is not set up to send one."}
      </p>

      {handled ? (
        <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface px-4 py-3.5">
          <p className="text-[13.5px] text-muted">
            Marked dealt with on {formatDate(enquiry.handledAt)}
            {enquiry.handledByEmail
              ? ` by ${enquiry.handledByEmail}`
              : enquiry.handledBy
                ? " by an account that is no longer in the studio"
                : ""}
            .
          </p>
          {enquiry.handlingNote ? (
            <p className="text-[14px] break-words whitespace-pre-wrap">{enquiry.handlingNote}</p>
          ) : null}
          <AdminForm action={setEnquiryHandled}>
            <input type="hidden" name="id" value={enquiry.id} />
            <input type="hidden" name="state" value="open" />
            <div>
              <SubmitButton variant="soft" size="sm" pendingLabel="Reopening…">
                Put this back on the list
              </SubmitButton>
            </div>
          </AdminForm>
        </div>
      ) : (
        <AdminForm action={setEnquiryHandled}>
          <input type="hidden" name="id" value={enquiry.id} />
          <input type="hidden" name="state" value="handled" />
          <Field
            label="What you did about it"
            htmlFor={`note-${enquiry.id}`}
            hint="Optional, and only for you — the customer never sees it. Leave it blank if there is nothing to add."
          >
            <input
              id={`note-${enquiry.id}`}
              name="note"
              maxLength={2000}
              placeholder="Replied and posted a replacement"
              className={inputClass}
            />
          </Field>
          <div>
            <SubmitButton size="sm" pendingLabel="Marking…">
              Mark as dealt with
            </SubmitButton>
          </div>
        </AdminForm>
      )}
    </article>
  );
}

/**
 * Addresses that asked to hear about new drops.
 *
 * On this screen because she has no other way to see who asked, and because
 * both tables are filled in by the same two forms. They stay two tables and two
 * panels: an address is a membership and a message is a piece of work, which is
 * the distinction 0006_enquiries.sql is built on.
 *
 * Nothing here offers to mail anybody. There is no newsletter, no welcome
 * email and no unsubscribe link, and the copy must not imply otherwise — see
 * `setSignupSubscribed` for why a "take this address off" control is
 * nevertheless both honest and necessary.
 */
function Signups({
  signups,
  page,
  pageCount,
  total,
  hrefFor,
}: {
  signups: SignupRow[];
  page: number;
  pageCount: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  return (
    <Panel
      title="Asked to hear about new drops"
      note="A record of who asked, not a mailing list. Nothing is ever sent to these addresses."
      padded={false}
    >
      {signups.length === 0 ? (
        <NoRows>Nobody has asked yet.</NoRows>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                <th className="px-5 py-3">ADDRESS</th>
                <th className="px-5 py-3">ASKED</th>
                <th className="px-5 py-3">FROM</th>
                <th className="px-5 py-3">TOLD YOU</th>
                <th className="px-5 py-3">
                  <span className="sr-only">Take off the list</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {signups.map((signup) => {
                const off = signup.unsubscribedAt !== null;
                return (
                  <tr key={signup.email} className="align-middle">
                    <td className="px-5 py-3.5 break-all">
                      {signup.email}
                      {off ? (
                        <span className="mt-1 block text-[12.5px] text-muted">
                          Recorded as off the list on {formatDate(signup.unsubscribedAt)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                      {formatDate(signup.requestedAt)}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-muted">{signup.source}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                      {/* A dash, never a fabricated date. Null means no
                          notification went out for this one — on a deploy with
                          no mail provider that is every row, and the banner at
                          the top of the page is where that is explained. */}
                      {formatDate(signup.notifiedAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <AdminForm action={setSignupSubscribed}>
                        <input type="hidden" name="email" value={signup.email} />
                        <input type="hidden" name="state" value={off ? "on" : "off"} />
                        <div>
                          <SubmitButton
                            variant="soft"
                            size="sm"
                            pendingLabel="Recording…"
                          >
                            {off ? "Taken off in error" : "Record as off the list"}
                          </SubmitButton>
                        </div>
                      </AdminForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-line">
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          noun="addresses"
          hrefFor={hrefFor}
        />
      </div>
    </Panel>
  );
}
