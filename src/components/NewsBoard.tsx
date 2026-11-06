import { useEffect, useState } from "preact/hooks";
import { fetchLiveNews, mergeAnnouncements, mergeEvents, type LiveNews, type NewsItem, type StaticAnnouncement, type StaticEvent } from "../lib/compte/news";
import { fmtDate, fmtDateTime } from "../lib/format";

function Items({ items, empty, date, testId }: { items: NewsItem[]; empty: string; date: (iso: string) => string; testId: string }) {
  if (items.length === 0) return <p class="card mt-4 p-5 text-muted">{empty}</p>;
  return (
    <ul class="mt-4 space-y-3" data-testid={testId}>
      {items.map((item) => (
        <li key={item.key} class="card p-5">
          <p class="tnum text-sm text-muted">{date(item.at)}</p>
          <h3 class="mt-1 text-lg">{item.title}</h3>
          {item.body && <p class="mt-2 whitespace-pre-line text-muted">{item.body}</p>}
          {item.url && (
            <a href={item.url} rel="noopener" class="mt-2 inline-block text-blue-text underline">
              En savoir plus
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Les annonces et les événements de l'accueil. Le HTML construit contient ceux du dépôt.
 * Avec `live`, le navigateur y ajoute ceux publiés depuis l'espace Direction.
 */
export default function NewsBoard({ announcements, events, now, live = false }: { announcements: StaticAnnouncement[]; events: StaticEvent[]; now: number; live?: boolean }) {
  const [news, setNews] = useState<LiveNews>({ announcements: [], events: [] });

  useEffect(() => {
    if (!live) return;
    void fetchLiveNews().then((data) => {
      if (data) setNews(data);
    });
  }, [live]);

  return (
    <>
      <div>
        <h2 class="text-2xl">Annonces</h2>
        <Items items={mergeAnnouncements(announcements, news.announcements)} empty="Aucune annonce pour le moment." date={fmtDate} testId="news-announcements" />
      </div>
      <div>
        <h2 class="text-2xl">Événements à venir</h2>
        <Items items={mergeEvents(events, news.events, now)} empty="Aucun événement prévu pour le moment." date={fmtDateTime} testId="news-events" />
      </div>
    </>
  );
}
