import { Stars } from "@/components/ui";
import { pluralise, relativeTime } from "@/lib/format";
import type { Product, Review } from "@/lib/types";

function Histogram({ reviews }: { reviews: Review[] }) {
  const total = reviews.length;
  const buckets = [5, 4, 3, 2, 1].map((star) => ({
    star,
    percent:
      total === 0
        ? 0
        : Math.round(
            (reviews.filter((r) => r.rating === star).length / total) * 100,
          ),
  }));

  return (
    <div className="mb-5 flex flex-col gap-2">
      {buckets.map((bucket) => (
        <div key={bucket.star} className="flex items-center gap-2.5 text-[13px]">
          <span className="w-14 shrink-0 text-muted">
            {bucket.star} star{bucket.star === 1 ? "" : "s"}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-line">
            <span
              className="block h-2 rounded-full bg-star"
              style={{ width: `${bucket.percent}%` }}
            />
          </span>
          <span className="w-9 shrink-0 text-right text-muted">
            {bucket.percent}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function ReviewsSection({
  product,
  reviews,
}: {
  product: Product;
  reviews: Review[];
}) {
  // No review history yet, so no score, no stars and no distribution — and no
  // claims about a review process that has not run once.
  const hasReviews = product.review_count > 0;

  return (
    <section id="reviews" className="mt-16 scroll-mt-24">
      <div className="grid items-start gap-10 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-14">
        <div>
          <h2 className="mb-4 text-2xl">
            {hasReviews ? `Reviews (${product.review_count})` : "Reviews"}
          </h2>
          {hasReviews ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                <b className="font-display text-[40px] leading-none">
                  {product.rating.toFixed(1)}
                </b>
                <div>
                  <Stars rating={product.rating} size={17} />
                  <p className="text-[12.5px] text-muted">
                    Based on {pluralise(product.review_count, "review")}
                  </p>
                </div>
              </div>
              {reviews.length > 0 ? <Histogram reviews={reviews} /> : null}
              {/* "We publish them unedited, good and bad" described an
                  editorial process that does not exist: there is no review
                  submission path, no moderation queue and nothing that
                  publishes anything, and the review insert policy was
                  withdrawn from the schema entirely. What is left is a
                  statement about where a review may come from, which is a
                  commitment the shop can keep — and it matches the empty state
                  below. If a review process is ever built, describe the one
                  that exists then. */}
              <p className="text-[13px] text-muted">
                Reviews come from shoppers who bought this piece.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted">
              Nobody has reviewed this piece yet, so there is no rating to show.
              Reviews will only ever come from shoppers who bought it.
            </p>
          )}
        </div>

        <div>
          {reviews.length === 0 ? (
            <div className="card px-6 py-12 text-center">
              <p className="font-bold">No reviews yet</p>
              {/* This said "If you order it, we'll ask what you think once it
                  lands." Nothing asks. There is no review request anywhere in
                  the codebase, no review-submission page or route, and no
                  insert policy behind one — so this promised a message that
                  cannot be sent, to a customer with no way to answer it even if
                  it were. Unlike the neighbouring email claims it was not even
                  gated on isEmailConfigured(), and gating it would not have
                  saved it: the capability that is missing is the review path,
                  not the mailbox. Replaced with the fact, which is all the
                  empty state ever needed to say. */}
              <p className="mt-1.5 text-sm text-muted">
                This one is new to the shop, so nobody has had the chance yet.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {reviews.map((review) => (
                <article
                  key={review.id}
                  className="flex gap-4 border-t border-line py-5 first:border-t-0 first:pt-0"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream font-display font-bold">
                    {review.author_name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Stars rating={review.rating} size={13} />
                      <b className="text-[13.5px]">{review.title}</b>
                    </div>
                    <p className="mt-1 mb-2 text-xs text-muted">
                      {review.author_name}
                      {review.verified ? " · Verified purchase" : ""} ·{" "}
                      {relativeTime(review.created_at)}
                    </p>
                    <p className="text-sm">{review.body}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
