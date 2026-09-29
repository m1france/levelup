import { Car, Eye, Megaphone, Play, Plus, Timer } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LivePitch, coverToExercise } from '../components/Pitch';
import { hasConv, usePrepareSession } from '../components/Calendar';
import {
  AgendaBoard, AgendaHistory, AgendaMatchActions, PlannedCard, SessionCard, useAgendaActions, useAgendaPrefs, type AgendaData,
} from '../components/Agenda';
import { PHASE, matchPath } from '../lib/convocations';
import { GlassArt, HeroSlide, Showcase, type ShowcaseSlide } from '../components/Showcase';
import { MatchSlide } from '../components/MatchShowcase';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PushCard } from '../components/Notifications';
import { TicketRail } from '../components/Tickets';
import { Spinner, useAsync } from '../components/ui';
import { ConvCard, nextStep, useTickets } from './Matches';
import { api } from '../lib/api';
import { groupsOf } from '../lib/groups';
import { useLive } from '../lib/live';
import { MONTHS_TILE, agenda, formatTime, fromYMD, relativeDay, toYMD } from '../lib/events';
import { relative, todayISO, useApp } from '../lib/store';
import type { Carpool, ConvSnapshot, ExerciseData, TeamEvent, Ticket, Training } from '../lib/types';
import { HERO_PALETTE } from '../pitch/render';

/** Visuel de repli quand aucune séance n'existe encore : un « passe et suis » animé. */
const DEMO: ExerciseData = {
  title: '', objective: '', instructions: '', easier: '', harder: '', themes: [], duration: 0, players: 4,
  field: { preset: 'foot5', w: 35, h: 25 },
  items: [
    { id: 'm1', kind: 'marker', x: 8, y: 9 }, { id: 'm2', kind: 'marker', x: 14, y: 9 },
    { id: 'm3', kind: 'marker', x: 21, y: 9 }, { id: 'm4', kind: 'marker', x: 27, y: 9 },
    { id: 'a', kind: 'player', x: 22, y: 15, color: 'yellow', label: 'A' },
    { id: 'b', kind: 'player', x: 17, y: 4, color: 'yellow', label: 'B' },
    { id: 'c', kind: 'player', x: 28, y: 14, color: 'yellow', label: 'C' },
    { id: 'd', kind: 'player', x: 7, y: 16, color: 'blue', label: 'D' },
    { id: 'ball', kind: 'ball', x: 23, y: 12 },
  ],
  paths: [],
  frames: [
    { id: 'f0', dur: 0, pos: {}, owner: { ball: 'a' } },
    { id: 'f1', dur: 900, pos: {}, owner: { ball: 'b' } },
    { id: 'f2', dur: 1300, pos: { a: [16, 10], b: [12, 6] }, owner: {} },
    { id: 'f3', dur: 900, pos: {}, owner: { ball: 'c' } },
    { id: 'f4', dur: 1300, pos: { b: [24, 11], c: [22, 16], d: [11, 13] }, owner: {} },
    { id: 'f5', dur: 900, pos: {}, owner: { ball: 'd' } },
    { id: 'f6', dur: 1500, pos: { a: [22, 15], b: [17, 4], c: [28, 14], d: [7, 16] }, owner: { ball: 'a' } },
  ],
};

function pickHero(list: Training[]) {
  const today = todayISO();
  const upcoming = list.filter((t) => t.date.slice(0, 10) >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = list.filter((t) => t.date.slice(0, 10) < today).sort((a, b) => b.date.localeCompare(a.date));
  return { hero: upcoming[0] ?? past[0] ?? null, upcoming, past };
}

/** Aperçu de la séance : le terrain animé en perspective. */
function SessionVisual({ training }: { training: Training | null }) {
  const ex = useMemo(() => (training?.cover ? coverToExercise(training.cover) : DEMO), [training?.cover]);
  const long = Math.max(ex.field.w, ex.field.h);
  const short = Math.min(ex.field.w, ex.field.h);
  const pad = long * 0.08 + 1.2;
  return (
    <div className="hero2-frame" style={{ aspectRatio: `${long + pad} / ${short + pad}` }}>
      <LivePitch ex={ex} palette={HERO_PALETTE} />
    </div>
  );
}

const WD_TILE = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
function GlassDate({ date }: { date: string }) {
  const d = fromYMD(date);
  return (
    <span className="ga-date">
      <small>{WD_TILE[d.getDay()]}</small>
      <b>{d.getDate()}</b>
      <small>{MONTHS_TILE[d.getMonth()]}</small>
    </span>
  );
}

/** Prochain événement (calendrier ou séance) à partir de maintenant. */
function nextItem(events: TeamEvent[], trainings: Training[]) {
  const now = new Date();
  const from = toYMD(now);
  const to = toYMD(new Date(now.getFullYear(), now.getMonth() + 3, now.getDate()));
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return agenda(events, trainings, from, to).find((it) => it.date > from || !it.time || it.time >= hm) ?? null;
}

/**
 * Calendrier (accueil) : les diapositives de ce qui compte maintenant, puis le calendrier de l'équipe
 * qui réunit entraînements, séances et matchs, les prochaines séances, les convocations et l'historique.
 */
export function Dashboard() {
  const { team, can, isStaff, me } = useApp();
  const nav = useNavigate();
  const q = useAsync(async () => {
    if (!team) return null;
    const [trainings, events, convs] = await Promise.all([
      api.get<Training[]>(`/teams/${team.id}/trainings`),
      api.get<TeamEvent[]>(`/teams/${team.id}/events`),
      // Toute la saison : les matchs joués rejoignent l'historique du calendrier.
      isStaff ? api.get<ConvSnapshot[]>(`/teams/${team.id}/convocations?past=1`).catch(() => []) : Promise.resolve([] as ConvSnapshot[]),
    ]);
    return { trainings, events, convs };
  }, [team?.id]);
  const tickets = useTickets();
  const anns = useAsync(() => api.get<{ threadId: string | null; messages: { id: string; author: string | null; preview: string; at: number; unread: boolean }[] }>('/chat/announce'), []);
  const carpools = useAsync(() => api.get<Carpool[]>('/carpool-upcoming').catch(() => [] as Carpool[]), []);
  // Annonces du club non lues (salon Annonces de la messagerie).
  const freshAnns = (anns.data?.messages ?? []).filter((a) => a.unread).slice(0, 3);
  // Séances créées ou modifiées par les autres éducateurs, exercices de couverture, matchs et convocations.
  useLive((m) => {
    if ((m.t === 'training' || m.t === 'exercise') && m.teamId === team?.id) q.reload();
    if (m.t === 'conv') q.reload();
    if (m.t === 'carpool') carpools.reload();
    if (m.t === 'chat' && m.threadId === anns.data?.threadId) anns.reload();
  });

  const d = q.data;
  const data = useMemo<AgendaData | null>(
    () => (d ? { events: d.events, trainings: d.trainings, convs: d.convs, tickets: (tickets.data ?? []).filter((t) => t.teamId === team?.id) } : null),
    [d, tickets.data, team?.id],
  );
  const prefs = useAgendaPrefs(groupsOf(team?.category));
  const actions = useAgendaActions(team?.id ?? '', data, q.reload);
  const prepare = usePrepareSession(team?.id ?? '');

  const { hero, upcoming } = pickHero(d?.trainings ?? []);
  const canPlan = isStaff && can('trainings.manage');
  const next = d ? nextItem(d.events, d.trainings) : null;
  // Entraînements programmés des 4 prochaines semaines sans séance préparée.
  const planned = d
    ? agenda(d.events.filter((e) => e.type === 'training'), d.trainings, todayISO(), toYMD(new Date(Date.now() + 28 * 864e5))).filter((it) => it.event && !it.training).slice(0, 8)
    : [];
  const now = Date.now();
  // Éducateur : convocations à préparer dans les 10 prochains jours, en tête d'accueil.
  const todo = (d?.convs ?? []).filter((c) => c.timeline.start > now && c.timeline.start - now < 10 * 864e5 && c.phase !== 'published' && c.phase !== 'played');
  // Parent : billets des prochains matchs (et le dernier résultat de moins de 2 jours).
  // Ce qui demande une action d'abord (répondre), puis les prochains matchs, puis les résultats récents.
  const rank = (t: Ticket) => (t.result ? 2 : t.status === 'to_answer' ? 0 : 1);
  const myTickets = (tickets.data ?? [])
    .filter((t) => t.timeline.start + 2 * 864e5 > now)
    .sort((a, b) => rank(a) - rank(b) || a.timeline.start - b.timeline.start)
    .slice(0, 12);

  const action = hero ? (
    canPlan ? (
      <button className="btn lime" onClick={() => nav(`/seances/${hero.id}/live`)}>
        <Play fill="currentColor" /> Lancer la séance
      </button>
    ) : (
      <button className="btn lime" onClick={() => nav(`/seances/${hero.id}`)}>
        <Eye /> Voir la séance
      </button>
    )
  ) : canPlan && actions.create ? (
    <button className="btn lime" onClick={() => actions.create!(todayISO(), 'training')}>
      <Plus /> Créer une séance
    </button>
  ) : null;

  // Diapositives : les annonces non lues d'abord, puis l'événement le plus proche (entraînement ou match),
  // le covoiturage d'un match juste après la diapositive de ce match.
  const when = (date: string, time?: string | null) => new Date(`${date.slice(0, 10)}T${time || '12:00'}`).getTime();
  const slides: (ShowcaseSlide & { at: number })[] = [];
  /** Matchs qui ont déjà leur diapositive (convocation à préparer, réponse attendue). */
  const covered = new Set<string>();
  for (const a of freshAnns) {
    const [first, ...rest] = a.preview.split('\n');
    const open = () => nav(`/messages/${anns.data?.threadId}`);
    slides.push({
      at: -Infinity,
      key: `ann:${a.id}`,
      node: (
        <HeroSlide
          eyebrow={<><Megaphone size={14} /> Annonce du club · {relative(a.at)}{a.author ? ` · ${a.author}` : ''}</>}
          title={first.length > 90 ? `${first.slice(0, 88)}…` : first}
          text={rest.join(' ').trim() || undefined}
          onOpen={open}
          actions={
            <button className="btn lime" onClick={open}>
              Lire l’annonce
            </button>
          }
          visual={<GlassArt><div className="ga-emoji">📣</div></GlassArt>}
        />
      ),
    });
  }
  for (const c of todo.slice(0, 3)) {
    const answered = c.counts.yes + c.counts.maybe + c.counts.no;
    const urgent = c.phase === 'late' || (c.phase === 'collecting' && c.timeline.deadline - now < 24 * 3600e3);
    const open = () => nav(matchPath(c.eventId, c.date));
    covered.add(`${c.eventId}:${c.date}`);
    slides.push({
      at: when(c.date, c.time),
      key: `conv:${c.eventId}:${c.date}`,
      node: (
        <HeroSlide
          eyebrow={<>Convocation à préparer · {PHASE[c.phase].label}</>}
          warn={urgent}
          title={c.group ? `${c.group} · ${c.title}` : c.title}
          text={
            <>
              {relativeDay(c.date)}
              {c.time ? ` · ${formatTime(c.time)}` : ''}
              {c.location ? ` · ${c.location}` : ''}
              <br />
              {nextStep(c)}
            </>
          }
          onOpen={open}
          actions={
            <button className="btn lime" onClick={open}>
              Préparer la convocation
            </button>
          }
          visual={
            <GlassArt glow={urgent ? 'rgba(255, 170, 90, 0.4)' : undefined}>
              <GlassDate date={c.date} />
              <div className="ga-big">
                {answered}
                <small>/ {c.total} réponses</small>
              </div>
              <div className="ga-bar" aria-hidden>
                <i className="yes" style={{ flex: c.counts.yes }} />
                <i className="maybe" style={{ flex: c.counts.maybe }} />
                <i className="no" style={{ flex: c.counts.no }} />
                <i className="none" style={{ flex: c.counts.none }} />
              </div>
            </GlassArt>
          }
        />
      ),
    });
  }
  for (const t of myTickets.filter((t) => t.status === 'to_answer' && t.timeline.start > now).slice(0, 2)) {
    const open = () => nav(matchPath(t.eventId, t.date));
    covered.add(`${t.eventId}:${t.date}`);
    slides.push({
      at: when(t.date, t.time),
      key: `ticket:${t.key}`,
      node: (
        <HeroSlide
          eyebrow="Réponse attendue"
          warn
          title={`${t.child.firstName} sera là ?`}
          text={`${t.title} · ${relativeDay(t.date)}${t.time ? ` à ${formatTime(t.time)}` : ''}${t.location ? ` · ${t.location}` : ''}`}
          onOpen={open}
          actions={
            <button className="btn lime" onClick={open}>
              Répondre
            </button>
          }
          visual={
            <GlassArt>
              <GlassDate date={t.date} />
              <div className="ga-emoji" style={{ fontSize: 84 }}>⚽</div>
            </GlassArt>
          }
        />
      ),
    });
  }
  // Prochains matchs en grand, avec le logo du club organisateur (ceux qui n'ont pas déjà leur diapositive).
  const comingMatches = [
    ...new Map(
      (isStaff ? (d?.convs ?? []).filter((c) => c.phase !== 'played') : myTickets.filter((t) => !t.result))
        .filter((m) => m.timeline.start > now && !covered.has(`${m.eventId}:${m.date}`))
        .sort((a, b) => a.timeline.start - b.timeline.start)
        .map((m) => [`${m.eventId}:${m.date}`, m] as const),
    ).values(),
  ].slice(0, 2);
  for (const m of comingMatches) {
    slides.push({ at: when(m.date, m.time), key: `match:${m.eventId}:${m.date}`, node: <MatchSlide m={m} /> });
  }
  // Covoiturage : seulement quand une voiture est proposée ou qu'une famille cherche une place.
  // Les matchs déjà passés n'apparaissent pas dans les diapositives.
  const upcomingMatch = (date: string, time: string) => new Date(`${date}T${time || '23:59'}`).getTime() > now;
  for (const c of (carpools.data ?? []).filter((c) => (c.offers.length > 0 || c.requests.length > 0) && upcomingMatch(c.date, c.time)).slice(0, 3)) {
    const need = c.needs > 0 && c.free < c.needs;
    const open = () => nav(`${matchPath(c.eventId, c.date)}?covoiturage=1`);
    slides.push({
      at: when(c.date, c.time) + 1,
      key: `car:${c.eventId}:${c.date}`,
      node: (
        <HeroSlide
          eyebrow={<><Car size={14} /> Covoiturage · {relativeDay(c.date)}</>}
          warn={need}
          title={c.title}
          text={
            <>
              {c.offers.length} voiture{c.offers.length > 1 ? 's' : ''}
              {c.needs ? ` · ${c.needs} enfant${c.needs > 1 ? 's' : ''} cherche${c.needs > 1 ? 'nt' : ''} une place` : ''}
              {c.iDrive ? ' · vous conduisez' : ''}
            </>
          }
          onOpen={open}
          actions={
            <button className="btn lime" onClick={open}>
              {need ? 'Proposer une place' : c.offers.length ? 'Voir les trajets' : 'Proposer mes places'}
            </button>
          }
          visual={
            <GlassArt glow={need ? 'rgba(255, 170, 90, 0.4)' : undefined}>
              <GlassDate date={c.date} />
              <div className="ga-big">
                {c.free}
                <small>place{c.free > 1 ? 's' : ''} libre{c.free > 1 ? 's' : ''}</small>
              </div>
              <span className="ga-car" aria-hidden>
                🚗
              </span>
            </GlassArt>
          }
        />
      ),
    });
  }
  slides.push({
    // Une séance passée (aucune à venir) reste en dernier.
    at: hero && hero.date.slice(0, 10) >= todayISO() ? (hero.date.length > 10 ? new Date(hero.date).getTime() : when(hero.date)) : Infinity,
    key: 'session',
    node: (
      <HeroSlide
        title={hero?.title ?? 'Votre première séance vous attend'}
        onOpen={hero ? () => nav(`/seances/${hero.id}`) : undefined}
        actions={action}
        visual={<SessionVisual training={hero} />}
      />
    ),
  });

  // Convocations en cours (éducateurs), dans la catégorie choisie dans le calendrier.
  const inGroup = (c: ConvSnapshot) => !prefs.group || !c.group || c.group === prefs.group;
  const convTodo = (d?.convs ?? []).filter((c) => c.timeline.start > now && ['collecting', 'late', 'upcoming'].includes(c.phase) && inGroup(c));
  const convReady = (d?.convs ?? []).filter((c) => c.timeline.start > now && c.phase === 'published' && inGroup(c));

  const sessions = [
    ...upcoming.map((t) => ({
      at: t.date,
      key: t.id,
      node: actions.wrap(actions.itemOfTraining(t), <SessionCard t={t} onClick={() => nav(`/seances/${t.id}`)} />),
    })),
    ...planned.map((it) => ({
      at: `${it.date}T${it.time || '12:00'}`,
      key: it.key,
      node: actions.wrap(it, <PlannedCard it={it} canPrepare={canPlan} onPrepare={() => void prepare(it)} />),
    })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 8);

  return (
    <AgendaMatchActions actions={actions}>
      <div className="page wide home">
        <div className="home-head">
          <h1>Bonjour {me.user.name.split(' ')[0]}</h1>
          {next && (
            <button
              className="next-ev"
              onClick={() => (next.training ? nav(`/seances/${next.training.id}`) : next.event && hasConv(next.event) && nav(matchPath(next.event.id, next.date)))}
            >
              <i style={{ background: next.color }} />
              <span>
                <b>{relativeDay(next.date)}{next.time ? ` · ${formatTime(next.time)}` : ''}</b> : {next.title}
              </span>
            </button>
          )}
        </div>
        {q.loading && !d ? (
          <Spinner fill />
        ) : (
          <>
            <Showcase slides={[...slides].sort((a, b) => a.at - b.at)} />
            {!isStaff && me.children.length > 1 && (
              <div className="family-strip">
                {me.children.map((c) => {
                  const t = me.teams.find((x) => x.id === c.teamId);
                  return (
                    <button key={c.id} onClick={() => nav(`/joueurs/${c.id}`)}>
                      <PlayerAvatar player={c} size={40} />
                      <span>
                        <b>{c.firstName}</b>
                        <small>{t?.category}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {!isStaff && (
              <section className="home-matches">
                <PushCard compact />
                {myTickets.length > 0 && (
                  <>
                    <div className="sec-head">
                      <h2>Prochains matchs</h2>
                    </div>
                    <TicketRail tickets={myTickets} onChanged={tickets.reload} />
                  </>
                )}
              </section>
            )}

            {team && data && <AgendaBoard teamId={team.id} data={data} prefs={prefs} actions={actions} onChanged={q.reload} />}

            <section className="reveal">
              <div className="sec-head">
                <h2>Prochaines séances</h2>
              </div>
              {!sessions.length && (
                <p className="muted small">
                  {canPlan ? 'Aucune séance programmée. Cliquez sur un jour du calendrier pour ajouter un entraînement.' : 'Aucune séance à venir pour l’instant.'}
                </p>
              )}
              {/* 2 lignes sur ordinateur, 3 lignes de 2 sur téléphone (CSS). */}
              <div className="s-grid">
                {sessions.map((x) => (
                  <Fragment key={x.key}>{x.node}</Fragment>
                ))}
              </div>
            </section>

            {isStaff && (
              <section className="reveal home-convs">
                <div className="sec-head">
                  <h2>Convocations{prefs.group ? ` · ${prefs.group}` : ''}</h2>
                  <button className="plain-toggle" onClick={() => nav(`/temps-de-jeu${prefs.group ? `?cat=${prefs.group}` : ''}`)} title="Équité des convocations et minutes jouées">
                    <Timer size={15} /> Temps de jeu
                  </button>
                </div>
                {convTodo.length || convReady.length ? (
                  <div className="conv-cols">
                    {convTodo.length > 0 && (
                      <div>
                        <div className="section-title">À préparer</div>
                        <div className="stack" style={{ gap: 10 }}>
                          {convTodo.map((c) => (
                            <ConvCard key={`${c.eventId}:${c.date}`} c={c} />
                          ))}
                        </div>
                      </div>
                    )}
                    {convReady.length > 0 && (
                      <div>
                        <div className="section-title">Convocations publiées</div>
                        <div className="stack" style={{ gap: 10 }}>
                          {convReady.map((c) => (
                            <ConvCard key={`${c.eventId}:${c.date}`} c={c} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="muted small">
                    Aucune convocation en cours. Ajoutez un match, un plateau ou un tournoi en cliquant sur un jour du calendrier : la convocation se prépare toute seule
                    (disponibilités, relances, date limite).
                  </p>
                )}
              </section>
            )}

            {data && <AgendaHistory data={data} actions={actions} group={prefs.group} />}
          </>
        )}
        {team && actions.sheets}
      </div>
    </AgendaMatchActions>
  );
}
