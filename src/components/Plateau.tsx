import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, MapPin, Minus, Plus, Swords, Trash2, Users, X } from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api, uid } from '../lib/api';
import { EVENT_TYPES, eventTitle, formatTime, fromYMD, MONTHS_LONG } from '../lib/events';
import { groupsOf } from '../lib/groups';
import { useApp } from '../lib/store';
import type { EventType, PlateauGame, TeamEvent } from '../lib/types';
import { ConvBox, LogoField, TypePicker, eventTypesFor, useLogoPick, useRemoveEvent, type EventFormProps } from './Calendar';
import { Field, Seg, Sheet, useAsync, useToast } from './ui';

/* ------------------------------------------------------------------ résultats */

const RESULT = { win: 'Victoire', draw: 'Nul', loss: 'Défaite' } as const;

/** Plateau : score de chaque match (les matchs pas encore joués affichent un tiret). En `cards`, une carte par match, deux par ligne. */
export function GamesResults({
  games, results, cards,
}: { games: Pick<PlateauGame, 'id' | 'opponent' | 'time'>[]; results: ({ us: number; them: number } | undefined)[]; cards?: boolean }) {
  const done = results.filter((r): r is { us: number; them: number } => !!r);
  const w = done.filter((r) => r.us > r.them).length;
  const dr = done.filter((r) => r.us === r.them).length;
  return (
    <div className="games-results">
      <div className="gr-head">
        <b>{done.length === games.length ? 'Plateau terminé' : `${done.length}/${games.length} matchs joués`}</b>
        <span>
          {w} V · {dr} N · {done.length - w - dr} D
        </span>
      </div>
      <div className={cards ? 'gr-cards' : 'games-results'}>
        {games.map((g, i) => {
          const r = results[i];
          const tone = r ? (r.us > r.them ? 'win' : r.us === r.them ? 'draw' : 'loss') : null;
          return cards ? (
            <div key={g.id} className={`gr-card${tone ? ` ${tone}` : ''}`}>
              <small>
                {`Match ${String(i + 1).padStart(2, '0')}`}
                {tone && <em>{RESULT[tone]}</em>}
              </small>
              <span className="ellipsis">{g.opponent}</span>
              <b>{r ? `${r.us}-${r.them}` : '–'}</b>
            </div>
          ) : (
            <div key={g.id} className={`gr-row${tone ? ` ${tone}` : ''}`}>
              <small>{`Match ${String(i + 1).padStart(2, '0')}`}</small>
              <span className="grow ellipsis">{g.opponent}</span>
              <b>{r ? `${r.us}-${r.them}` : '–'}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ assistant */

type Draft = Omit<TeamEvent, 'id' | 'teamId'>;

const STEPS = [
  { title: 'Le plateau', hint: 'Quand et où', icon: <CalendarDays /> },
  { title: 'Adversaires', hint: 'Les équipes invitées', icon: <Users /> },
  { title: 'Matchs', hint: 'Ordre et durée', icon: <Swords /> },
  { title: 'Convocation', hint: 'Récapitulatif', icon: <Check /> },
];

function Stepper({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="pw-stepper">
      <span>{label}</span>
      <div>
        <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={`${label} : moins`}>
          <Minus size={16} />
        </button>
        <b>
          {value}
          <small> {unit}</small>
        </b>
        <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label={`${label} : plus`}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

const longDay = (ymd: string) => {
  const d = fromYMD(ymd);
  return `${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
};

/**
 * Création d'un plateau (jusqu'en U9) en quatre étapes : infos, adversaires, matchs (générés puis ajustables), convocation.
 * En modification, chaque étape est accessible directement.
 */
export function PlateauWizard({
  teamId, date, event, occurrence, initialGroup, onClose, onSaved, onType,
}: EventFormProps & { onType: (t: EventType) => void }) {
  const toast = useToast();
  const { me } = useApp();
  const groups = groupsOf(me.teams.find((t) => t.id === teamId)?.category);
  const [e, setE] = useState<Draft>(() =>
    event
      ? { ...event, type: 'plateau' }
      : {
          type: 'plateau', title: '', start: date, allDay: false, time: '10:00', endTime: '', meetTime: '', location: '', opponent: '', venue: 'away',
          notes: '', color: '', parents: true, exdates: [], group: initialGroup ?? undefined, recurrence: { freq: 'none', interval: 1, days: [], until: null, count: null },
        },
  );
  const [games, setGames] = useState<PlateauGame[]>(event?.games ?? []);
  const [opponents, setOpponents] = useState<string[]>(() => [...new Set((event?.games ?? []).map((g) => g.opponent))]);
  const [rhythm, setRhythm] = useState({ minutes: event?.games?.[0]?.minutes ?? 12 });
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const logo = useLogoPick();
  const remove = useRemoveEvent(event, occurrence, onSaved);
  const input = useRef<HTMLInputElement>(null);
  const editing = !!event;
  const group = groups.length ? (e.group && groups.includes(e.group) ? e.group : groups[0]) : undefined;
  const home = e.venue === 'home';

  // Adversaires déjà rencontrés : proposés d'un geste.
  const past = useAsync(() => api.get<TeamEvent[]>(`/teams/${teamId}/events`), [teamId]);
  const suggestions = useMemo(() => {
    const seen = new Map<string, number>();
    for (const x of past.data ?? []) {
      const names = x.games?.length ? x.games.map((g) => g.opponent) : x.opponent ? x.opponent.split(/\s*,\s*/) : [];
      for (const n of names) if (n) seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([n]) => n)
      .filter((n) => !opponents.some((o) => o.toLowerCase() === n.toLowerCase()))
      .slice(0, 10);
  }, [past.data, opponents]);

  const addOpponent = (name: string) => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return;
    if (opponents.some((o) => o.toLowerCase() === n.toLowerCase())) return toast(`${n} est déjà dans la liste`);
    if (opponents.length >= 12) return toast('12 adversaires au plus', true);
    setOpponents([...opponents, n]);
    setGames((g) => [...g, { id: uid(8), opponent: n, time: '', minutes: rhythm.minutes }]);
  };
  const removeOpponent = (name: string) => {
    setOpponents(opponents.filter((o) => o !== name));
    setGames((g) => g.filter((x) => x.opponent !== name));
  };
  const editGame = (i: number, patch: Partial<PlateauGame>) => {
    setGames((g) => g.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  };
  // Monter / descendre : les créneaux restent dans l'ordre, ce sont les adversaires qui changent de créneau.
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= games.length) return;
    setGames((g) => {
      const next = [...g];
      const a = { ...next[i] };
      const b = { ...next[j] };
      next[i] = { ...a, opponent: b.opponent, pitch: b.pitch, id: b.id };
      next[j] = { ...b, opponent: a.opponent, pitch: a.pitch, id: a.id };
      return next;
    });
  };
  const valid = [true, opponents.length > 0, games.length > 0 && games.every((g) => g.opponent), true];
  const firstInvalid = valid.findIndex((v) => !v);

  const go = (to: number) => {
    if (to > step && !valid[step]) {
      toast(step === 1 ? 'Ajoutez au moins un adversaire' : 'Chaque match a besoin d’un adversaire ', true);
      if (step === 1) input.current?.focus();
      return;
    }
    if (!editing && to > step + 1) return;
    setDir(to > step ? 'next' : 'prev');
    setStep(to);
  };

  const save = async () => {
    if (firstInvalid >= 0) {
      setStep(firstInvalid);
      return toast(firstInvalid === 1 ? 'Ajoutez au moins un adversaire' : 'Vérifiez les matchs du plateau', true);
    }
    setBusy(true);
    try {
      const id = event?.id ?? uid();
      await api.put(`/events/${id}`, {
        ...e,
        type: 'plateau',
        group,
        teamId,
        endTime: e.endTime,
        meetTime: '',
        games: games.map((g) => ({ ...g, time: '' })),
        recurrence: { freq: 'none', interval: 1, days: [], until: null, count: null },
      });
      if (logo.logo) await api.post(`/events/${id}/logo`, { image: logo.logo });
      toast(editing ? 'Plateau modifié' : `Plateau créé · ${games.length} match${games.length > 1 ? 's' : ''}`);
      onSaved();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const last = step === STEPS.length - 1;
  let body: ReactNode;
  if (step === 0)
    body = (
      <div className="stack" style={{ gap: 16 }}>
        <div className="title-field">
          <input className="input title" placeholder={eventTitle({ ...e, games: games.length ? games : [{ id: '', opponent: '', time: '', minutes: 0 }] })} value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} />
          <TypePicker value="plateau" types={eventTypesFor(true)} onChange={(t) => t !== 'plateau' && onType(t)} />
        </div>
        <div className="ev-2col">
          {groups.length > 0 ? (
            <Field label="Catégorie">
              <Seg<string> value={group!} onChange={(g) => setE({ ...e, group: g })} options={groups.map((g) => ({ value: g, label: g }))} />
            </Field>
          ) : (
            <span className="ev-2col-gap" />
          )}
          <Field label="Lieu du plateau">
            <Seg<string>
              value={e.venue}
              onChange={(v) => setE({ ...e, venue: v as TeamEvent['venue'] })}
              options={[{ value: 'home', label: 'Domicile' }, { value: 'away', label: 'Extérieur' }, { value: 'neutral', label: 'Neutre' }]}
            />
          </Field>
        </div>
        <div className="ev-2col">
          <Field label="Club organisateur">
            <input
              className="input"
              value={home ? '' : e.organizer ?? ''}
              disabled={home}
              placeholder={home ? me.club?.name ?? 'Votre club' : 'Ex. AS Teyran'}
              onChange={(x) => setE({ ...e, organizer: x.target.value })}
            />
          </Field>
          <Field label="Logo de l’organisateur">
            <LogoField logo={logo.logo} saved={e.logo} eventId={event?.id} home={home} onPick={logo.open} />
            {logo.input}
          </Field>
        </div>
        <div className="ev-grid">
          <Field label="Date">
            <input className="input" type="date" value={e.start} onChange={(x) => x.target.value && setE({ ...e, start: x.target.value })} />
          </Field>
          <Field label="Début">
            <input className="input" type="time" value={e.time} onChange={(x) => setE({ ...e, time: x.target.value })} />
          </Field>
          <Field label="Fin">
            <input className="input" type="time" value={e.endTime}  onChange={(x) => setE({ ...e, endTime: x.target.value })} />
          </Field>
        </div>
        <Field label="Adresse">
          <div style={{ position: 'relative' }}>
            <MapPin size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--ink-3)' }} />
            <input className="input" style={{ paddingLeft: 36 }} value={e.location} placeholder="Stade, complexe sportif…" onChange={(x) => setE({ ...e, location: x.target.value })} />
          </div>
        </Field>
      </div>
    );
  else if (step === 1)
    body = (
      <div className="stack" style={{ gap: 18 }}>
        <p className="muted">Qui sera au plateau ? Chaque équipe ajoutée devient un match, que vous pourrez réorganiser à l’étape suivante.</p>
        <form
          className="pw-add"
          onSubmit={(x) => {
            x.preventDefault();
            addOpponent(typed);
            setTyped('');
          }}
        >
          <Swords size={18} />
          <input ref={input} autoFocus value={typed} placeholder="Nom de l’équipe, puis Entrée" onChange={(x) => setTyped(x.target.value)} />
          <button type="submit" className="btn primary sm" disabled={!typed.trim()}>
            <Plus /> Ajouter
          </button>
        </form>
        {opponents.length > 0 ? (
          <ol className="pw-opponents">
            {opponents.map((o, i) => (
              <li key={o} style={{ ['--i' as string]: i } as CSSProperties}>
                <span className="pw-num">{i + 1}</span>
                <b className="grow ellipsis">{o}</b>
                <button type="button" className="btn icon sm ghost" onClick={() => removeOpponent(o)} aria-label={`Retirer ${o}`}>
                  <X />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="pw-empty">
            <Swords size={26} />
            <span>Aucun adversaire pour l’instant</span>
          </div>
        )}
        {suggestions.length > 0 && (
          <div>
            <span className="lbl">Déjà rencontrés</span>
            <div className="chips">
              {suggestions.map((n) => (
                <button key={n} type="button" className="chip" onClick={() => addOpponent(n)}>
                  <Plus size={13} /> {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  else if (step === 2)
    body = (
      <div className="stack" style={{ gap: 16 }}>
        <div className="pw-rhythm">
          <Stepper label="Durée d’un match" value={rhythm.minutes} min={4} max={40} unit="min" onChange={(minutes) => { setRhythm({ minutes }); setGames((gs) => gs.map((g) => ({ ...g, minutes }))); }} />
        </div>
        <ol className="pw-games">
          {games.map((g, i) => (
            <li key={g.id} style={{ ['--i' as string]: i } as CSSProperties}>
              <span className="pw-num">{i + 1}</span>
              <div className="pw-game-main">
                <select className="select" value={g.opponent} onChange={(x) => editGame(i, { opponent: x.target.value })} aria-label="Adversaire">
                  {[...new Set([...opponents, g.opponent])].filter(Boolean).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <div className="pw-game-meta">
                  <label>
                    <input type="number" min={1} max={90} value={g.minutes} onChange={(x) => editGame(i, { minutes: Math.max(1, Math.min(90, Number(x.target.value) || 1)) })} aria-label="Durée" />
                    min
                  </label>
                  <label className="grow">
                    <MapPin size={14} />
                    <input value={g.pitch ?? ''} placeholder="Terrain" onChange={(x) => editGame(i, { pitch: x.target.value || undefined })} aria-label="Terrain" />
                  </label>
                </div>
              </div>
              <div className="pw-game-tools">
                <button type="button" className="btn icon sm ghost" disabled={i === 0} onClick={() => swap(i, i - 1)} aria-label="Plus tôt">
                  <ArrowUp />
                </button>
                <button type="button" className="btn icon sm ghost" disabled={i === games.length - 1} onClick={() => swap(i, i + 1)} aria-label="Plus tard">
                  <ArrowDown />
                </button>
                <button
                  type="button"
                  className="btn icon sm ghost danger"
                  onClick={() => {
                                    setGames(games.filter((_, k) => k !== i));
                  }}
                  aria-label="Supprimer ce match"
                >
                  <Trash2 />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="btn block"
          disabled={!opponents.length || games.length >= 12}
          onClick={() => {
                    setGames([...games, { id: uid(8), opponent: opponents[games.length % opponents.length], time: '', minutes: rhythm.minutes }]);
          }}
        >
          <Plus /> Ajouter un match
        </button>
        <p className="small muted">Un adversaire peut être rencontré deux fois : ajoutez un match puis choisissez l’équipe.</p>
      </div>
    );
  else
    body = (
      <div className="stack" style={{ gap: 16 }}>
        <div className="pw-recap">
          <div className="pw-recap-head">
            <span className="pw-recap-date">
              <small>{longDay(e.start).split(' ')[0].slice(0, 3).toUpperCase()}</small>
              <b>{fromYMD(e.start).getDate()}</b>
            </span>
            <div className="grow">
              <b>{e.title || eventTitle({ ...e, games })}</b>
              <small>
                {group ? `${group} · ` : ''}
                {longDay(e.start)}
                {e.time ? ` · ${formatTime(e.time)}` : ''}
                {e.location ? ` · ${e.location}` : ''}
              </small>
            </div>
          </div>
          <ol>
            {games.map((g) => (
              <li key={g.id}>

                <b className="grow ellipsis">{g.opponent}</b>
                <small>
                  {g.minutes} min{g.pitch ? ` · ${g.pitch}` : ''}
                </small>
              </li>
            ))}
          </ol>
        </div>
        <ConvBox teamId={teamId} e={e} setE={setE} />
        <label className="check">
          <input type="checkbox" checked={e.parents} onChange={(x) => setE({ ...e, parents: x.target.checked })} />
          <span>
            <Users size={14} style={{ verticalAlign: -2 }} /> Visible par les parents
          </span>
        </label>
        <Field label="Notes" hint="visibles des éducateurs uniquement">
          <textarea className="textarea" rows={2} value={e.notes ?? ''} onChange={(x) => setE({ ...e, notes: x.target.value })} placeholder="Chasubles, ballons, goûter…" />
        </Field>
      </div>
    );

  return (
    <Sheet
      wide
      title={
        <span className="row" style={{ gap: 10 }}>
          <i className="type-dot lg" style={{ background: EVENT_TYPES.plateau.color }} />
          {editing ? eventTitle({ ...e, games }) : 'Nouveau plateau'}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          {editing && (
            <button className="btn ghost danger" onClick={remove} aria-label="Supprimer">
              <Trash2 />
            </button>
          )}
          {step > 0 ? (
            <button className="btn ghost" onClick={() => go(step - 1)}>
              <ArrowLeft /> Retour
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>
              Annuler
            </button>
          )}
          <span className="grow" />
          {editing && !last && (
            <button className="btn" disabled={busy} onClick={save}>
              Enregistrer
            </button>
          )}
          {last ? (
            <button className="btn primary" disabled={busy} onClick={save}>
              <Check /> {editing ? 'Enregistrer' : 'Créer le plateau'}
            </button>
          ) : (
            <button className="btn primary" onClick={() => go(step + 1)}>
              Continuer <ArrowRight />
            </button>
          )}
        </>
      }
    >
      <nav className="pw-steps" aria-label="Étapes">
        {STEPS.map((st, i) => (
          <button
            key={st.title}
            type="button"
            className={`${i === step ? 'on' : ''}${i < step || (editing && valid[i]) ? ' done' : ''}`}
            disabled={!editing && i > step + 1}
            onClick={() => go(i)}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="pw-step-ic">{i < step ? <Check /> : st.icon}</span>
            <span className="pw-step-txt">
              <b>{st.title}</b>
              <small>
                {i === 1 && opponents.length ? `${opponents.length} équipe${opponents.length > 1 ? 's' : ''}` : i === 2 && games.length ? `${games.length} match${games.length > 1 ? 's' : ''}` : st.hint}
              </small>
            </span>
          </button>
        ))}
        <i className="pw-progress" style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
      </nav>
      <div key={step} className={`pw-step ${dir}`}>
        {body}
      </div>
    </Sheet>
  );
}
