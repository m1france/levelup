import { ArrowDownUp, Check, ChevronRight, Eye, Play, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LivePitch, SceneThumb, coverToExercise } from '../components/Pitch';
import { Calendar } from '../components/Calendar';
import { Spinner, useAsync, useToast } from '../components/ui';
import { api } from '../lib/api';
import { MONTHS_LONG, agenda, formatTime, relativeDay, toYMD } from '../lib/events';
import { dateTile, todayISO, useApp } from '../lib/store';
import type { ExerciseData, TeamEvent, Training } from '../lib/types';
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

function Hero({ training, action }: { training: Training | null; action: React.ReactNode }) {
  const nav = useNavigate();
  const ex = useMemo(() => (training?.cover ? coverToExercise(training.cover) : DEMO), [training?.cover]);
  const long = Math.max(ex.field.w, ex.field.h);
  const short = Math.min(ex.field.w, ex.field.h);
  const pad = long * 0.08 + 1.2;
  return (
    <section className="hero2">
      <div className="hero2-text">
        <h1 onClick={() => training && nav(`/seances/${training.id}`)} style={{ cursor: training ? 'pointer' : undefined }}>
          {training?.title ?? 'Votre première séance vous attend'}
        </h1>
        {action}
      </div>
      <div className="hero2-visual" onClick={() => training && nav(`/seances/${training.id}`)}>
        <div className="hero2-frame" style={{ aspectRatio: `${long + pad} / ${short + pad}` }}>
          <LivePitch ex={ex} palette={HERO_PALETTE} />
        </div>
      </div>
    </section>
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
    const [trainings, events] = await Promise.all([
      api.get<Training[]>(`/teams/${team.id}/trainings`),
      api.get<TeamEvent[]>(`/teams/${team.id}/events`),
    ]);
    return { trainings, events };
  }, [team?.id]);

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

  return (
    <div className="page home">
      <div className="home-head">
        <h1>Bonjour {me.user.name.split(' ')[0]}</h1>
        {next && (
          <button className="next-ev" onClick={() => next.training && nav(`/seances/${next.training.id}`)}>
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
          <Hero training={hero} action={action} />

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
