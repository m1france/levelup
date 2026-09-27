import { ArrowDownUp, Car, Check, ChevronRight, Eye, Megaphone, Play, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LivePitch, SceneThumb, coverToExercise } from '../components/Pitch';
import { Calendar, hasConv } from '../components/Calendar';
import { PHASE, matchPath } from '../lib/convocations';
import { GlassArt, HeroSlide, Showcase, type ShowcaseSlide } from '../components/Showcase';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PushCard } from '../components/Notifications';
import { TicketRail } from '../components/Tickets';
import { Spinner, useAsync, useToast } from '../components/ui';
import { nextStep, useTickets } from './Matches';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { MONTHS_LONG, MONTHS_TILE, agenda, formatTime, fromYMD, relativeDay, toYMD } from '../lib/events';
import { dateTile, relative, todayISO, useApp } from '../lib/store';
import type { Announcement, Carpool, ConvSnapshot, ExerciseData, TeamEvent, Ticket, Training } from '../lib/types';
import { HERO_PALETTE } from '../pitch/render';
import { createTraining, totalMinutes } from './Trainings';

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

function SessionCard({ t, past, onClick }: { t: Training; past?: boolean; onClick: () => void }) {
  const tile = dateTile(t.date);
  const cover = useMemo(() => (t.cover ? coverToExercise(t.cover) : null), [t.cover]);
  const done = !!t.attendance?.length;
  return (
    <div className={`s-card${past ? ' past' : ''}`} onClick={onClick}>
      <div className="cover">
        {cover ? <SceneThumb ex={cover} /> : <div className="cover-empty" />}
        <span className="date-chip">
          {tile.weekday} {tile.day} {tile.month}
        </span>
        {done && (
          <span className="done-chip" title={`${t.attendance!.length} présents`}>
            <Check size={14} strokeWidth={3} /> {t.attendance!.length}
          </span>
        )}
      </div>
      <b className="s-title">{t.title}</b>
      <span className="s-meta">{totalMinutes(t)} min</span>
    </div>
  );
}

/** Séances regroupées par mois, en accordéon : le mois à gauche, une ligne pleine largeur avec ses séances. */
function MonthAccordion({ list, onOpen }: { list: Training[]; onOpen: (t: Training) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Training[]>();
    for (const t of [...list].sort((a, b) => b.date.localeCompare(a.date))) {
      const k = t.date.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m];
  }, [list]);
  const current = todayISO().slice(0, 7);
  const [open, setOpen] = useState<Set<string>>(() => new Set([groups.find(([k]) => k === current)?.[0] ?? groups[0]?.[0]].filter(Boolean) as string[]));
  const today = todayISO();
  return (
    <div className="months">
      {groups.map(([k, items]) => {
        const [y, m] = k.split('-').map(Number);
        const isOpen = open.has(k);
        return (
          <div key={k} className={`month-row${isOpen ? ' open' : ''}`}>
            <button
              className="month-label"
              onClick={() => setOpen((o) => {
                const n = new Set(o);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })}
              aria-expanded={isOpen}
            >
              <ChevronRight className="chev" />
              <span>
                <b>{MONTHS_LONG[m - 1].replace(/^./, (c) => c.toUpperCase())}</b>
                <small>{y}</small>
              </span>
            </button>
            {isOpen ? (
              <div className="month-line">
                {items.map((t) => (
                  <SessionCard key={t.id} t={t} past={t.date.slice(0, 10) < today} onClick={() => onOpen(t)} />
                ))}
              </div>
            ) : (
              <button className="month-rule" onClick={() => setOpen((o) => new Set(o).add(k))}>
                <span />
                <small>{items.length}</small>
              </button>
            )}
          </div>
        );
      })}
    </div>
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

export function Dashboard() {
  const { team, can, isStaff, me } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [byMonth, setByMonth] = useState(false);
  const q = useAsync(async () => {
    if (!team) return null;
    const [trainings, events, convs] = await Promise.all([
      api.get<Training[]>(`/teams/${team.id}/trainings`),
      api.get<TeamEvent[]>(`/teams/${team.id}/events`),
      isStaff ? api.get<ConvSnapshot[]>(`/teams/${team.id}/convocations`).catch(() => []) : Promise.resolve([] as ConvSnapshot[]),
    ]);
    return { trainings, events, convs };
  }, [team?.id]);
  const tickets = useTickets();
  const anns = useAsync(() => api.get<Announcement[]>('/announcements'), []);
  const carpools = useAsync(() => api.get<Carpool[]>('/carpool-upcoming').catch(() => [] as Carpool[]), []);
  const freshAnns = (anns.data ?? []).filter((a) => a.target && (!a.read || (a.important && Date.now() - a.createdAt < 3 * 864e5))).slice(0, 3);
  // Séances créées ou modifiées par les autres éducateurs, et exercices de couverture.
  useLive((m) => {
    if ((m.t === 'training' || m.t === 'exercise') && m.teamId === team?.id) q.reload();
    if (m.t === 'conv' && isStaff) q.reload();
    if (m.t === 'carpool') carpools.reload();
    if (m.t === 'announcement') anns.reload();
  });

  const newTraining = async () => {
    if (!team) return;
    try {
      nav(`/seances/${(await createTraining(team.id)).id}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const d = q.data;
  const { hero, upcoming, past } = pickHero(d?.trainings ?? []);
  const canPlan = isStaff && can('trainings.manage');
  const next = d ? nextItem(d.events, d.trainings) : null;
  const all = [...upcoming, ...past];
  const now = Date.now();
  // Éducateur : convocations à préparer dans les 10 prochains jours, en tête d'accueil.
  const todo = (d?.convs ?? []).filter((c) => c.timeline.start > now && c.timeline.start - now < 10 * 864e5 && c.phase !== 'published');
  // Parent : billets des prochains matchs (et le dernier résultat de moins de 2 jours).
  // Ce qui demande une action d'abord (répondre), puis les prochains matchs, puis les résultats récents.
  const rank = (t: Ticket) => (t.result ? 2 : t.status === 'to_answer' ? 0 : 1);
  const myTickets = (tickets.data ?? [])
    .filter((t) => t.timeline.start + 2 * 864e5 > now)
    .sort((a, b) => rank(a) - rank(b) || a.timeline.start - b.timeline.start)
    .slice(0, 6);

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
  ) : canPlan ? (
    <button className="btn lime" onClick={newTraining}>
      <Plus /> Créer une séance
    </button>
  ) : null;

  // Diapositives : les actualités passent avant l'aperçu de la séance.
  const slides: ShowcaseSlide[] = [];
  for (const a of freshAnns) {
    slides.push({
      key: `ann:${a.id}`,
      node: (
        <HeroSlide
          eyebrow={<><Megaphone size={14} /> {a.important ? 'Annonce importante' : 'Annonce du club'} · {relative(a.createdAt)}</>}
          warn={a.important}
          title={a.title}
          text={a.body}
          onOpen={() => nav(`/annonces/${a.id}`)}
          actions={
            <button className="btn lime" onClick={() => nav(`/annonces/${a.id}`)}>
              Lire l’annonce
            </button>
          }
          visual={<GlassArt glow={a.important ? 'rgba(255, 150, 120, 0.4)' : undefined}><div className="ga-emoji">{a.emoji}</div></GlassArt>}
        />
      ),
    });
  }
  for (const c of todo.slice(0, 3)) {
    const answered = c.counts.yes + c.counts.maybe + c.counts.no;
    const urgent = c.phase === 'late' || (c.phase === 'collecting' && c.timeline.deadline - now < 24 * 3600e3);
    const open = () => nav(matchPath(c.eventId, c.date));
    slides.push({
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
  for (const t of myTickets.filter((t) => t.status === 'to_answer').slice(0, 2)) {
    const open = () => nav(matchPath(t.eventId, t.date));
    slides.push({
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
  for (const c of (carpools.data ?? []).slice(0, 3)) {
    const need = c.needs > 0 && c.free < c.needs;
    const open = () => nav(`${matchPath(c.eventId, c.date)}?covoiturage=1`);
    slides.push({
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

  return (
    <div className="page home">
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
          <Showcase slides={slides} />
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
                    <button className="plain-toggle" onClick={() => nav('/matchs')}>
                      Tout voir
                    </button>
                  </div>
                  <TicketRail tickets={myTickets} onChanged={tickets.reload} />
                </>
              )}
            </section>
          )}

          {team && d && (
            <section>
              <Calendar teamId={team.id} events={d.events} trainings={d.trainings} canEdit={isStaff && can('events.manage')} onChanged={q.reload} />
            </section>
          )}

          <section>
            <div className="sec-head">
              <h2>Séances</h2>
              <div className="row" style={{ gap: 4 }}>
                {all.length >= 6 && (
                  <button className={`plain-toggle${byMonth ? ' on' : ''}`} onClick={() => setByMonth((b) => !b)} aria-pressed={byMonth}>
                    <ArrowDownUp size={15} /> Date
                  </button>
                )}
                {canPlan && (
                  <button className="btn icon sm only-mobile" onClick={newTraining} aria-label="Nouvelle séance">
                    <Plus />
                  </button>
                )}
              </div>
            </div>
            {byMonth && all.length >= 6 ? (
              <MonthAccordion list={all} onOpen={(t) => nav(`/seances/${t.id}`)} />
            ) : (
              <div className="s-grid">
                {canPlan && (
                  <button className="s-card s-new hide-mobile" onClick={newTraining} aria-label="Nouvelle séance">
                    <div className="cover">
                      <Plus />
                    </div>
                  </button>
                )}
                {upcoming.map((t) => (
                  <SessionCard key={t.id} t={t} onClick={() => nav(`/seances/${t.id}`)} />
                ))}
                {past.map((t) => (
                  <SessionCard key={t.id} t={t} past onClick={() => nav(`/seances/${t.id}`)} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
