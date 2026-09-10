import OutboxClient from "./OutboxClient";

export const dynamic = "force-dynamic";

/**
 * Outbox — everything that went out, and what sent it.
 *
 * No server-rendered first page, unlike its neighbours: the list is paged by
 * cursor and filtered on the client, and a page rendered here would be replaced
 * by the first filter or tab change anyway.
 */
export default function Page() {
  return <OutboxClient />;
}
